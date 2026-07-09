import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOperator } from '../../src/analysis/classify.js';
import { explainOperator, buildPlanSummary } from '../../src/analysis/explainEnglish.js';
import { estimateNodeCost, finalizeTree, createNodeId } from '../../src/analysis/cost.js';
import type { PlanNode } from '../../src/types/analysis.js';

describe('classifyOperator', () => {
  it('maps common operators', () => {
    assert.equal(classifyOperator('Seq Scan', 'table orders'), 'scan');
    assert.equal(classifyOperator('Hash Join', 'INNER'), 'join');
    assert.equal(classifyOperator('Sort', 'ORDER BY name'), 'sort');
    assert.equal(classifyOperator('HashAggregate', 'count(*)'), 'aggregate');
    assert.equal(classifyOperator('Filter', 'status = completed'), 'filter');
    assert.equal(classifyOperator('Limit', '10'), 'limit');
  });
});

describe('explainOperator', () => {
  it('returns plain English for scans and joins', () => {
    const scan = explainOperator({
      operator: 'Seq Scan',
      category: 'scan',
      detail: 'orders',
      estimatedRows: 500,
      metadata: { table: 'orders' },
    });
    assert.match(scan, /orders/i);
    assert.match(scan, /scan|read/i);

    const join = explainOperator({
      operator: 'Hash Join',
      category: 'join',
      metadata: { joinType: 'INNER', condition: 'a.id = b.a_id' },
      estimatedRows: 200,
    });
    assert.match(join, /hash|join/i);
  });
});

describe('finalizeTree cost dominance', () => {
  it('highlights expensive operators and assigns percentages', () => {
    const counter = { n: 0 };
    const mk = (
      label: string,
      category: PlanNode['category'],
      cost: number,
      children: PlanNode[] = []
    ): PlanNode => ({
      id: createNodeId('t', counter),
      label,
      operator: label,
      category,
      explanation: `Does ${label}`,
      estimatedCost: cost,
      costPercent: 0,
      isExpensive: false,
      children,
      metadata: {},
      depth: 0,
      subtreeSize: 1,
    });

    const root = mk('Root', 'project', 1, [
      mk('Seq Scan big', 'scan', 50),
      mk('Tiny Project', 'project', 1),
      mk('Sort huge', 'sort', 40),
    ]);

    const stats = finalizeTree(root);
    assert.ok(stats.expensiveNodes.length >= 1);
    assert.ok(stats.expensiveNodes.some((e) => /scan|sort/i.test(e.label)));
    assert.ok(root.children[0].isExpensive || root.children[2].isExpensive);
    assert.ok(root.children[0].costPercent > root.children[1].costPercent);
  });

  it('builds a narrative summary', () => {
    const counter = { n: 0 };
    const leaf: PlanNode = {
      id: createNodeId('t', counter),
      label: 'Seq Scan',
      operator: 'Seq Scan',
      category: 'scan',
      detail: 'orders',
      explanation: 'Reads orders',
      estimatedCost: 20,
      costPercent: 80,
      isExpensive: true,
      children: [],
      metadata: {},
      depth: 1,
      subtreeSize: 1,
    };
    const root: PlanNode = {
      id: createNodeId('t', counter),
      label: 'Aggregate',
      operator: 'Aggregate',
      category: 'aggregate',
      explanation: 'Groups rows',
      estimatedCost: 5,
      costPercent: 20,
      isExpensive: false,
      children: [leaf],
      metadata: {},
      depth: 0,
      subtreeSize: 2,
    };
    finalizeTree(root);
    const summary = buildPlanSummary(root, 'postgresql');
    assert.match(summary, /postgresql/i);
    assert.match(summary, /scan|operator/i);
  });
});

describe('estimateNodeCost heuristics', () => {
  it('prefers engine costs and penalizes full scans', () => {
    const withEngine = estimateNodeCost({
      category: 'scan',
      operator: 'Seq Scan',
      engineCost: 99,
    });
    assert.equal(withEngine, 99);

    const full = estimateNodeCost({
      category: 'scan',
      operator: 'Seq Scan',
      estimatedRows: 10000,
    });
    const idx = estimateNodeCost({
      category: 'scan',
      operator: 'Index Scan',
      detail: 'USING INDEX idx_x',
      estimatedRows: 10000,
    });
    assert.ok(full > idx, 'full scan costlier than index scan');
  });
});
