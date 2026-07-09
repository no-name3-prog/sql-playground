import type { BaseDriver } from '../drivers/base.js';
import type { DatabaseEngine } from '../types/index.js';
import type { QueryAnalysis } from '../types/analysis.js';
import { parseExplainResult } from './parsers/index.js';
import { finalizeTree } from './cost.js';
import { buildPlanSummary } from './explainEnglish.js';

/** Only statements that generally support EXPLAIN */
const EXPLAINABLE = /^\s*(WITH|SELECT|UPDATE|DELETE|INSERT|REPLACE)\b/i;

export function isExplainableSql(sql: string): boolean {
  const trimmed = stripComments(sql).trim();
  if (!trimmed) return false;
  // skip pure EXPLAIN of EXPLAIN
  if (/^\s*EXPLAIN\b/i.test(trimmed)) return false;
  return EXPLAINABLE.test(trimmed);
}

/**
 * Fetch EXPLAIN from the driver, normalize, annotate costs & English explanations.
 */
export async function analyzeQuery(
  driver: BaseDriver,
  sql: string
): Promise<QueryAnalysis> {
  if (!isExplainableSql(sql)) {
    throw new Error('Statement type does not support execution plan analysis');
  }

  const raw = await driver.getExplainPlan(sql);
  const root = parseExplainResult(raw);
  const stats = finalizeTree(root);

  const warnings = collectWarnings(root, driver.engine);

  return {
    engine: driver.engine,
    sql,
    root,
    totalEstimatedCost: Math.round(stats.totalCost * 100) / 100,
    totalNodes: stats.totalNodes,
    maxDepth: stats.maxDepth,
    expensiveNodes: stats.expensiveNodes,
    summary: buildPlanSummary(root, driver.engine),
    warnings,
    categoryCounts: stats.categoryCounts,
    rawPlan: raw.payload,
    analyzedAt: new Date().toISOString(),
  };
}

function collectWarnings(root: QueryAnalysis['root'], engine: DatabaseEngine): string[] {
  const warnings: string[] = [];
  const nodes = flatten(root);

  const seqScans = nodes.filter(
    (n) =>
      n.category === 'scan' &&
      /seq|full|table scan|SCAN(?!.*INDEX)|access \(all\)/i.test(
        `${n.operator} ${n.detail || ''}`
      )
  );
  if (seqScans.length) {
    warnings.push(
      `${seqScans.length} sequential/full table scan${seqScans.length === 1 ? '' : 's'} detected — consider indexes if tables grow.`
    );
  }

  const nestedLoops = nodes.filter(
    (n) => n.category === 'join' && /nested|loop/i.test(n.operator)
  );
  if (nestedLoops.length) {
    warnings.push(
      'Nested loop join(s) present — fine for small inputs, costly when both sides are large.'
    );
  }

  const sorts = nodes.filter((n) => n.category === 'sort');
  if (sorts.some((s) => (s.estimatedRows ?? 0) > 10000 || s.costPercent > 20)) {
    warnings.push('Sort operator is a major cost contributor — an index matching ORDER BY may help.');
  }

  if (nodes.length > 80) {
    warnings.push(
      `Large plan (${nodes.length} operators). Use collapse controls and cost filters to focus on expensive nodes.`
    );
  }

  if (engine === 'sqlite') {
    warnings.push(
      'SQLite EXPLAIN QUERY PLAN provides structural cost hints only (not wall-clock timings).'
    );
  }

  return warnings;
}

function flatten(node: QueryAnalysis['root']): QueryAnalysis['root'][] {
  return [node, ...node.children.flatMap(flatten)];
}

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}
