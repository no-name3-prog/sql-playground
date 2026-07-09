import type { OperatorCategory, PlanNode, ExpensiveOperator } from '../types/analysis.js';

/** Heuristic base weights when the engine does not provide costs. */
const CATEGORY_WEIGHT: Record<OperatorCategory, number> = {
  scan: 8,
  join: 12,
  sort: 14,
  aggregate: 10,
  filter: 3,
  project: 1,
  limit: 1,
  materialize: 6,
  modify: 8,
  other: 4,
};

/**
 * Estimate a relative cost for a node before percentages are assigned.
 */
export function estimateNodeCost(input: {
  category: OperatorCategory;
  estimatedRows?: number;
  engineCost?: number;
  operator: string;
  detail?: string;
}): number {
  if (input.engineCost !== undefined && input.engineCost > 0) {
    return input.engineCost;
  }

  let cost = CATEGORY_WEIGHT[input.category] ?? 4;
  const rows = input.estimatedRows ?? 0;

  if (rows > 0) {
    // log-scaled row influence
    cost *= 1 + Math.log10(rows + 1);
  }

  // Full table scans are costlier than index lookups
  if (input.category === 'scan') {
    if (/index|search|ref|eq_ref|covering/i.test(input.operator + ' ' + (input.detail || ''))) {
      cost *= 0.45;
    } else if (/seq|full|table scan|SCAN (?!.*INDEX)/i.test(input.operator + ' ' + (input.detail || ''))) {
      cost *= 1.6;
    }
  }

  if (input.category === 'join' && /nested|loop/i.test(input.operator)) {
    cost *= 1.35;
  }

  if (input.category === 'sort') {
    cost *= 1.25;
  }

  return Math.max(0.01, cost);
}

/**
 * Walk the tree: compute subtree sizes, cost percentages, expensive flags.
 * Mutates nodes in place and returns aggregates.
 */
export function finalizeTree(
  root: PlanNode,
  options: { expensiveThresholdPercent?: number; maxExpensive?: number } = {}
): {
  totalCost: number;
  totalNodes: number;
  maxDepth: number;
  expensiveNodes: ExpensiveOperator[];
  categoryCounts: Partial<Record<OperatorCategory, number>>;
} {
  const threshold = options.expensiveThresholdPercent ?? 15;
  const maxExpensive = options.maxExpensive ?? 8;

  const all: PlanNode[] = [];
  walk(root, all);

  const totalCost = all.reduce((s, n) => s + n.estimatedCost, 0) || 1;

  for (const n of all) {
    n.costPercent = Math.round(((n.estimatedCost / totalCost) * 10000)) / 100;
  }

  // Mark expensive: above threshold OR top-N by cost
  const ranked = [...all].sort((a, b) => b.estimatedCost - a.estimatedCost);
  const topIds = new Set(ranked.slice(0, Math.min(3, ranked.length)).map((n) => n.id));

  for (const n of all) {
    n.isExpensive = n.costPercent >= threshold || topIds.has(n.id);
    // Don't mark trivial project/limit as expensive unless truly dominant
    if (
      (n.category === 'project' || n.category === 'limit') &&
      n.costPercent < 25 &&
      !topIds.has(n.id)
    ) {
      n.isExpensive = false;
    }
  }

  // Ensure at least the hottest node is highlighted when plan has real cost
  if (ranked[0] && !ranked[0].isExpensive && ranked[0].costPercent >= 5) {
    ranked[0].isExpensive = true;
  }

  const expensiveNodes: ExpensiveOperator[] = ranked
    .filter((n) => n.isExpensive)
    .slice(0, maxExpensive)
    .map((n) => ({
      id: n.id,
      label: n.label,
      category: n.category,
      costPercent: n.costPercent,
      estimatedCost: n.estimatedCost,
      explanation: n.explanation,
      detail: n.detail,
    }));

  const categoryCounts: Partial<Record<OperatorCategory, number>> = {};
  for (const n of all) {
    categoryCounts[n.category] = (categoryCounts[n.category] || 0) + 1;
  }

  // subtree sizes
  assignSubtreeSize(root);

  return {
    totalCost,
    totalNodes: all.length,
    maxDepth: Math.max(...all.map((n) => n.depth), 0),
    expensiveNodes,
    categoryCounts,
  };
}

function walk(node: PlanNode, out: PlanNode[]) {
  out.push(node);
  for (const c of node.children) walk(c, out);
}

function assignSubtreeSize(node: PlanNode): number {
  let size = 1;
  for (const c of node.children) size += assignSubtreeSize(c);
  node.subtreeSize = size;
  return size;
}

export function createNodeId(prefix: string, counter: { n: number }): string {
  counter.n += 1;
  return `${prefix}-${counter.n}`;
}
