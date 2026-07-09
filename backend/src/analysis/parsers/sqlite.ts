import type { PlanNode } from '../../types/analysis.js';
import { classifyOperator, humanizeOperator } from '../classify.js';
import { explainOperator } from '../explainEnglish.js';
import { createNodeId, estimateNodeCost } from '../cost.js';

export interface SqliteEqpRow {
  id: number;
  parent: number;
  notused?: number;
  detail: string;
}

/**
 * Parse SQLite EXPLAIN QUERY PLAN rows into a PlanNode tree.
 * Rows form a parent/child tree via id/parent columns.
 */
export function parseSqlitePlan(rows: SqliteEqpRow[]): PlanNode {
  const counter = { n: 0 };

  if (!rows?.length) {
    return leafNode(counter, 'Empty Plan', 'empty', 'No query plan steps returned.');
  }

  type Mutable = PlanNode & { _parentId: number; _id: number };
  const nodes = new Map<number, Mutable>();

  for (const row of rows) {
    const detail = String(row.detail || '');
    const operator = extractSqliteOperator(detail);
    const category = classifyOperator(operator, detail);
    const estimatedRows = undefined;
    const estimatedCost = estimateNodeCost({
      category,
      operator,
      detail,
      // SQLite notused sometimes holds rough ordering weight
      engineCost: row.notused && row.notused > 0 ? Math.log10(row.notused + 1) * 5 : undefined,
    });

    const node: Mutable = {
      id: createNodeId('sqlite', counter),
      label: humanizeOperator(operator),
      operator,
      category,
      detail,
      explanation: explainOperator({ operator, category, detail, estimatedRows }),
      estimatedCost,
      estimatedRows,
      costPercent: 0,
      isExpensive: false,
      children: [],
      metadata: { id: row.id, parent: row.parent, notused: row.notused },
      depth: 0,
      subtreeSize: 1,
      _parentId: row.parent,
      _id: row.id,
    };
    nodes.set(row.id, node);
  }

  const roots: Mutable[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node._parentId);
    if (parent && node._parentId !== node._id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // SQLite often uses parent=0 for all top-level steps; wrap if multiple roots
  let root: PlanNode;
  if (roots.length === 1) {
    root = roots[0];
  } else {
    root = {
      id: createNodeId('sqlite', counter),
      label: 'Query Plan',
      operator: 'QUERY PLAN',
      category: 'other',
      detail: `${roots.length} steps`,
      explanation: `SQLite produced ${roots.length} top-level plan steps for this statement.`,
      estimatedCost: 0.01,
      costPercent: 0,
      isExpensive: false,
      children: roots,
      metadata: {},
      depth: 0,
      subtreeSize: 1,
    };
  }

  assignDepth(root, 0);
  stripInternal(root);
  return root;
}

function extractSqliteOperator(detail: string): string {
  const d = detail.trim();
  if (/^SCAN\b/i.test(d)) return 'SCAN';
  if (/^SEARCH\b/i.test(d)) return 'SEARCH';
  if (/USE TEMP B-TREE FOR GROUP BY/i.test(d)) return 'GROUP BY';
  if (/USE TEMP B-TREE FOR (ORDER BY|DISTINCT|COUNT)/i.test(d)) {
    const m = d.match(/USE TEMP B-TREE FOR (\w+(?:\s+\w+)?)/i);
    return m?.[1] || 'TEMP B-TREE';
  }
  if (/^COMPOUND/i.test(d)) return 'COMPOUND';
  if (/^EXECUTE/i.test(d)) return 'EXECUTE';
  if (/^CO-ROUTINE/i.test(d)) return 'CO-ROUTINE';
  if (/^MATERIALIZE/i.test(d)) return 'MATERIALIZE';
  if (/^MERGE/i.test(d)) return 'MERGE';
  const first = d.split(/\s+/)[0];
  return first || 'STEP';
}

function assignDepth(node: PlanNode, depth: number) {
  node.depth = depth;
  for (const c of node.children) assignDepth(c, depth + 1);
}

function stripInternal(node: PlanNode) {
  delete (node as { _parentId?: number })._parentId;
  delete (node as { _id?: number })._id;
  for (const c of node.children) stripInternal(c);
}

function leafNode(counter: { n: number }, label: string, operator: string, explanation: string): PlanNode {
  return {
    id: createNodeId('sqlite', counter),
    label,
    operator,
    category: 'other',
    explanation,
    estimatedCost: 0.01,
    costPercent: 0,
    isExpensive: false,
    children: [],
    metadata: {},
    depth: 0,
    subtreeSize: 1,
  };
}
