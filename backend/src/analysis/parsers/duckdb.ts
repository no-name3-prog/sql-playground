import type { PlanNode } from '../../types/analysis.js';
import { classifyOperator, humanizeOperator } from '../classify.js';
import { explainOperator } from '../explainEnglish.js';
import { createNodeId, estimateNodeCost } from '../cost.js';

interface DuckNode {
  name?: string;
  children?: DuckNode[];
  extra_info?: Record<string, unknown>;
}

/**
 * Parse DuckDB EXPLAIN (FORMAT JSON) payload into a PlanNode tree.
 * Payload is typically: [{ explain_key, explain_value: "<json string>" }]
 * or a direct array/object of plan nodes.
 */
export function parseDuckdbPlan(payload: unknown): PlanNode {
  const counter = { n: 0 };
  const tree = extractDuckTree(payload);

  if (!tree) {
    return {
      id: createNodeId('duckdb', counter),
      label: 'Empty Plan',
      operator: 'empty',
      category: 'other',
      explanation: 'DuckDB returned an empty or unparseable plan.',
      estimatedCost: 0.01,
      costPercent: 0,
      isExpensive: false,
      children: [],
      metadata: {},
      depth: 0,
      subtreeSize: 1,
    };
  }

  const nodes = Array.isArray(tree) ? tree : [tree];
  if (nodes.length === 1) {
    return convert(nodes[0], 0, counter);
  }

  return {
    id: createNodeId('duckdb', counter),
    label: 'Query Plan',
    operator: 'QUERY PLAN',
    category: 'other',
    explanation: `DuckDB plan with ${nodes.length} root operators.`,
    estimatedCost: 0.01,
    costPercent: 0,
    isExpensive: false,
    children: nodes.map((n) => convert(n, 1, counter)),
    metadata: {},
    depth: 0,
    subtreeSize: 1,
  };
}

function extractDuckTree(payload: unknown): DuckNode | DuckNode[] | null {
  if (!payload) return null;

  // rows from driver: [{ explain_key, explain_value }]
  if (Array.isArray(payload) && payload[0] && typeof payload[0] === 'object') {
    const first = payload[0] as Record<string, unknown>;
    if ('explain_value' in first) {
      const val = first.explain_value;
      if (typeof val === 'string') {
        try {
          return JSON.parse(val) as DuckNode[];
        } catch {
          return null;
        }
      }
      if (typeof val === 'object' && val) return val as DuckNode | DuckNode[];
    }
    // already a list of duck nodes
    if ('name' in first) return payload as DuckNode[];
  }

  if (typeof payload === 'object' && payload && 'name' in (payload as object)) {
    return payload as DuckNode;
  }

  if (typeof payload === 'string') {
    try {
      return extractDuckTree(JSON.parse(payload));
    } catch {
      return null;
    }
  }

  return null;
}

function convert(node: DuckNode, depth: number, counter: { n: number }): PlanNode {
  const operator = String(node.name || 'OPERATOR').trim();
  const extra = node.extra_info || {};
  const detail = formatExtra(extra);
  const category = classifyOperator(operator, detail);
  const estimatedRows = parseRows(
    extra['Estimated Cardinality'] ?? extra.estimated_cardinality ?? extra.Cardinality
  );

  const estimatedCost = estimateNodeCost({
    category,
    operator,
    detail,
    estimatedRows,
  });

  const metadata: Record<string, unknown> = { ...extra };
  if (extra.Table) metadata.table = extra.Table;
  if (extra['Join Type']) metadata.joinType = extra['Join Type'];
  if (extra.Conditions) metadata.condition = extra.Conditions;

  const children = (node.children || []).map((c) => convert(c, depth + 1, counter));

  return {
    id: createNodeId('duckdb', counter),
    label: humanizeOperator(operator),
    operator,
    category,
    detail: detail || undefined,
    explanation: explainOperator({
      operator,
      category,
      detail,
      estimatedRows,
      metadata,
    }),
    estimatedCost,
    estimatedRows,
    costPercent: 0,
    isExpensive: false,
    children,
    metadata,
    depth,
    subtreeSize: 1,
  };
}

function formatExtra(extra: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'Estimated Cardinality') continue;
    if (v === undefined || v === null || v === '') continue;
    const val = Array.isArray(v) ? v.join(', ') : String(v);
    if (val.startsWith('__internal_')) continue;
    parts.push(`${k}: ${val}`);
  }
  return parts.join(' · ');
}

function parseRows(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
