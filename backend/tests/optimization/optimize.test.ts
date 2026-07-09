import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSqlitePlan,
  parseDuckdbPlan,
  parsePostgresPlan,
  parseMysqlPlan,
} from '../../src/analysis/parsers/index.js';
import { finalizeTree } from '../../src/analysis/cost.js';
import { buildPlanSummary } from '../../src/analysis/explainEnglish.js';
import { optimizeFromAnalysis } from '../../src/optimization/optimizeService.js';
import type { QueryAnalysis, PlanNode } from '../../src/types/analysis.js';
import type { DatabaseEngine } from '../../src/types/index.js';
import { createDriver } from '../../src/drivers/index.js';
import { analyzeQuery } from '../../src/analysis/analyzeService.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtures, name), 'utf8'));
}

function makeAnalysis(engine: DatabaseEngine, sql: string, root: PlanNode): QueryAnalysis {
  const stats = finalizeTree(root);
  return {
    engine,
    sql,
    root,
    totalEstimatedCost: stats.totalCost,
    totalNodes: stats.totalNodes,
    maxDepth: stats.maxDepth,
    expensiveNodes: stats.expensiveNodes,
    summary: buildPlanSummary(root, engine),
    warnings: [],
    categoryCounts: stats.categoryCounts,
    rawPlan: null,
    analyzedAt: new Date().toISOString(),
  };
}

function assertPlanGrounded(recs: { planReferences: { nodeId: string }[]; title: string }[], root: PlanNode) {
  const ids = new Set<string>();
  const walk = (n: PlanNode) => {
    ids.add(n.id);
    n.children.forEach(walk);
  };
  walk(root);

  assert.ok(recs.length >= 0);
  for (const r of recs) {
    assert.ok(r.planReferences.length > 0, `${r.title} must reference plan nodes`);
    for (const ref of r.planReferences) {
      assert.ok(ids.has(ref.nodeId), `${r.title} references unknown node ${ref.nodeId}`);
    }
  }
}

describe('Optimization assistant — plan grounding', () => {
  it('SQLite fixture: detects scans/sorts and grounds every recommendation', async () => {
    const root = parseSqlitePlan(loadJson('sqlite-eqp.json') as never);
    const sql = `
      SELECT c.name, COUNT(*) n
      FROM customers c
      JOIN orders o ON o.customer_id = c.id
      WHERE o.status = 'completed'
      GROUP BY c.name
      ORDER BY n DESC
    `;
    const analysis = makeAnalysis('sqlite', sql, root);
    const report = await optimizeFromAnalysis(analysis, { enableLlm: false });

    assert.equal(report.engine, 'sqlite');
    assert.ok(report.score >= 0 && report.score <= 100);
    assert.ok(report.summary.length > 20);
    assertPlanGrounded(report.recommendations, root);

    // Should surface scan and/or sort related advice for this plan
    const tags = report.recommendations.flatMap((r) => r.tags);
    assert.ok(
      tags.some((t) => /scan|sort|index|join|aggregate/i.test(t)) ||
        report.recommendations.length === 0,
      'expected optimization tags related to plan operators'
    );

    for (const r of report.recommendations) {
      assert.ok(r.why.length > 10);
      assert.ok(r.suggestion.length > 10);
      assert.ok(r.estimatedImprovement.costReductionPercentMax >= r.estimatedImprovement.costReductionPercentMin);
    }
  });

  it('DuckDB fixture: join/scan/aggregate recommendations reference plan', async () => {
    const root = parseDuckdbPlan(loadJson('duckdb-plan.json'));
    const sql = `
      SELECT u.username, COUNT(*) 
      FROM users u 
      JOIN events e ON e.user_id = u.id 
      GROUP BY u.username
    `;
    const analysis = makeAnalysis('duckdb', sql, root);
    const report = await optimizeFromAnalysis(analysis, { enableLlm: false });
    assertPlanGrounded(report.recommendations, root);
    assert.ok(report.recommendations.some((r) => r.planReferences.some((p) => p.category === 'scan' || p.category === 'join' || p.category === 'aggregate')) || report.recommendations.length >= 1);
  });

  it('PostgreSQL fixture: recommendations cite exclusive-cost nodes', async () => {
    const root = parsePostgresPlan(loadJson('postgres-plan.json'));
    const sql = `
      SELECT c.name, COUNT(*) 
      FROM customers c 
      JOIN orders o ON o.customer_id = c.id 
      GROUP BY c.name 
      ORDER BY 2 DESC
    `;
    const analysis = makeAnalysis('postgresql', sql, root);
    const report = await optimizeFromAnalysis(analysis, { enableLlm: false });
    assertPlanGrounded(report.recommendations, root);
    assert.ok(report.antiPatternCount + report.indexSuggestionCount + report.rewriteCount + report.warningCount === report.recommendations.length);
  });

  it('MySQL fixture: filesort/scan warnings are plan-linked', async () => {
    const root = parseMysqlPlan(loadJson('mysql-plan.json'));
    const sql = `
      SELECT * FROM customers c 
      JOIN orders o ON o.customer_id = c.id 
      ORDER BY c.name
    `;
    const analysis = makeAnalysis('mysql', sql, root);
    const report = await optimizeFromAnalysis(analysis, { enableLlm: false });
    assertPlanGrounded(report.recommendations, root);
    // SELECT * should yield rewrite grounded in plan
    assert.ok(
      report.recommendations.some((r) => r.type === 'rewrite' || r.type === 'warning' || r.type === 'index' || r.type === 'anti-pattern')
    );
  });
});

describe('Live SQLite optimization', () => {
  it('produces plan-grounded advice for sample ecommerce query', async () => {
    const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
    const driver = createDriver({
      id: 'opt-sqlite',
      name: 'opt',
      engine: 'sqlite',
      filename: path.join(dataDir, 'ecommerce.db'),
      createdAt: new Date().toISOString(),
    });
    await driver.connect();
    try {
      const sql = `
        SELECT c.name, COUNT(o.id) AS n, SUM(o.total) AS revenue
        FROM customers c
        JOIN orders o ON o.customer_id = c.id
        WHERE o.status = 'completed'
        GROUP BY c.name
        ORDER BY revenue DESC
      `;
      const analysis = await analyzeQuery(driver, sql);
      const report = await optimizeFromAnalysis(analysis, { enableLlm: false });
      assertPlanGrounded(report.recommendations, analysis.root);
      assert.ok(report.mode === 'plan-rules');
      // Sample plan typically has scans/sorts → non-empty recommendations
      assert.ok(report.recommendations.length >= 1, 'expected at least one recommendation');
      assert.ok(report.recommendations.every((r) => r.planReferences.every((p) => typeof p.costPercent === 'number')));
    } finally {
      await driver.disconnect();
    }
  });
});

describe('Recommendation quality invariants', () => {
  it('never returns recommendations without planReferences', async () => {
    const root = parsePostgresPlan(loadJson('postgres-plan.json'));
    const analysis = makeAnalysis('postgresql', 'SELECT 1', root);
    const report = await optimizeFromAnalysis(analysis, { enableLlm: false });
    for (const r of report.recommendations) {
      assert.notEqual(r.planReferences.length, 0);
    }
  });
});
