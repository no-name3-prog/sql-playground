import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseSqlitePlan,
  parseDuckdbPlan,
  parsePostgresPlan,
  parseMysqlPlan,
} from '../../src/analysis/parsers/index.js';
import { finalizeTree } from '../../src/analysis/cost.js';
import type { PlanNode, OperatorCategory } from '../../src/types/analysis.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtures, name), 'utf8'));
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function assertPlanShape(root: PlanNode, engine: string) {
  assert.ok(root.id, `${engine}: root has id`);
  assert.ok(root.label, `${engine}: root has label`);
  assert.ok(root.explanation, `${engine}: root has English explanation`);
  assert.ok(typeof root.estimatedCost === 'number', `${engine}: cost is number`);
  assert.ok(Array.isArray(root.children), `${engine}: children array`);

  const stats = finalizeTree(root);
  assert.ok(stats.totalNodes >= 1, `${engine}: at least one node`);
  assert.ok(stats.totalCost > 0, `${engine}: total cost > 0`);
  assert.ok(stats.expensiveNodes.length >= 1, `${engine}: marks expensive ops`);

  const all = flatten(root);
  for (const n of all) {
    assert.ok(n.explanation.length > 10, `${engine}: explanation for ${n.label}`);
    assert.ok(n.costPercent >= 0 && n.costPercent <= 100, `${engine}: cost% for ${n.label}`);
    assert.ok(
      [
        'scan',
        'join',
        'sort',
        'aggregate',
        'filter',
        'project',
        'limit',
        'materialize',
        'modify',
        'other',
      ].includes(n.category),
      `${engine}: valid category ${n.category}`
    );
  }

  const sum = all.reduce((s, n) => s + n.costPercent, 0);
  assert.ok(sum > 90 && sum < 110, `${engine}: cost percents roughly 100% (got ${sum})`);
}

describe('SQLite plan parser', () => {
  it('parses EXPLAIN QUERY PLAN rows into a categorized tree', () => {
    const rows = loadJson('sqlite-eqp.json') as Parameters<typeof parseSqlitePlan>[0];
    const root = parseSqlitePlan(rows);
    assertPlanShape(root, 'sqlite');

    const all = flatten(root);
    assert.ok(
      all.some((n) => n.category === 'scan'),
      'detects scan operators'
    );
    assert.ok(
      all.some((n) => n.category === 'aggregate' || /group/i.test(n.operator + n.label)),
      'detects group by / aggregate'
    );
    assert.ok(
      all.some((n) => /search|index|primary key/i.test(n.operator + (n.detail || '') + n.explanation)),
      'explains index lookup'
    );
  });
});

describe('DuckDB plan parser', () => {
  it('parses EXPLAIN (FORMAT JSON) into join/scan/aggregate tree', () => {
    const payload = loadJson('duckdb-plan.json');
    const root = parseDuckdbPlan(payload);
    assertPlanShape(root, 'duckdb');

    const all = flatten(root);
    const cats = new Set(all.map((n) => n.category));
    assert.ok(cats.has('scan'), 'has scan');
    assert.ok(cats.has('join'), 'has join');
    assert.ok(cats.has('aggregate'), 'has aggregate');
    assert.ok(
      all.some((n) => /users|events/i.test(n.detail || '')),
      'includes table names in detail'
    );
  });
});

describe('PostgreSQL plan parser', () => {
  it('parses EXPLAIN (FORMAT JSON) with exclusive costs', () => {
    const payload = loadJson('postgres-plan.json');
    const root = parsePostgresPlan(payload);
    assertPlanShape(root, 'postgresql');

    const all = flatten(root);
    assert.equal(root.category, 'aggregate');
    assert.ok(all.some((n) => n.category === 'join'));
    assert.ok(all.some((n) => n.category === 'scan' && /orders|customers/i.test(n.detail || '')));
    assert.ok(
      all.some((n) => n.metadata && n.metadata.totalCost !== undefined),
      'preserves engine cost metadata'
    );
  });
});

describe('MySQL plan parser', () => {
  it('parses EXPLAIN FORMAT=JSON with filesort and nested loop', () => {
    const payload = loadJson('mysql-plan.json');
    const root = parseMysqlPlan(payload);
    assertPlanShape(root, 'mysql');

    const all = flatten(root);
    assert.ok(
      all.some((n) => n.category === 'sort' || /sort|filesort/i.test(n.label + n.operator)),
      'detects filesort'
    );
    assert.ok(all.some((n) => n.category === 'scan'));
    assert.ok(
      all.some((n) => /customers|orders/i.test(n.detail || n.label)),
      'includes tables'
    );
  });
});

describe('Category highlighting coverage', () => {
  it('classifies scan, join, sort, and aggregate across engines', () => {
    const engines: Array<{ name: string; root: PlanNode; need: OperatorCategory[] }> = [
      {
        name: 'sqlite',
        root: parseSqlitePlan(loadJson('sqlite-eqp.json') as never),
        need: ['scan', 'aggregate'],
      },
      {
        name: 'duckdb',
        root: parseDuckdbPlan(loadJson('duckdb-plan.json')),
        need: ['scan', 'join', 'aggregate'],
      },
      {
        name: 'postgresql',
        root: parsePostgresPlan(loadJson('postgres-plan.json')),
        need: ['scan', 'join', 'aggregate'],
      },
      {
        name: 'mysql',
        root: parseMysqlPlan(loadJson('mysql-plan.json')),
        need: ['scan', 'sort'],
      },
    ];

    for (const e of engines) {
      finalizeTree(e.root);
      const cats = new Set(flatten(e.root).map((n) => n.category));
      for (const c of e.need) {
        assert.ok(cats.has(c), `${e.name} should classify ${c}`);
      }
    }
  });
});
