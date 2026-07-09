import type { PlanNode } from '../../types/analysis.js';
import { classifyOperator, humanizeOperator } from '../classify.js';
import { explainOperator } from '../explainEnglish.js';
import { createNodeId, estimateNodeCost } from '../cost.js';

interface PgPlan {
  'Node Type'?: string;
  'Parallel Aware'?: boolean;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Alias'?: string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Plan Width'?: number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  'Join Type'?: string;
  'Hash Cond'?: string;
  'Merge Cond'?: string;
  'Join Filter'?: string;
  'Filter'?: string;
  'Index Cond'?: string;
  'Recheck Cond'?: string;
  'Sort Key'?: string[] | string;
  'Group Key'?: string[] | string;
  'Output'?: string[];
  Plans?: PgPlan[];
  [key: string]: unknown;
}

/**
 * Parse PostgreSQL EXPLAIN (FORMAT JSON) output.
 * Shape: [{ Plan: {...}, 'Planning Time': n, 'Execution Time': n }]
 */
export function parsePostgresPlan(payload: unknown): PlanNode {
  const counter = { n: 0 };
  const plan = extractPgPlan(payload);

  if (!plan) {
    return {
      id: createNodeId('pg', counter),
      label: 'Empty Plan',
      operator: 'empty',
      category: 'other',
      explanation: 'PostgreSQL returned an empty or unparseable plan.',
      estimatedCost: 0.01,
      costPercent: 0,
      isExpensive: false,
      children: [],
      metadata: {},
      depth: 0,
      subtreeSize: 1,
    };
  }

  return convert(plan, 0, counter);
}

function extractPgPlan(payload: unknown): PgPlan | null {
  if (!payload) return null;

  if (Array.isArray(payload)) {
    const first = payload[0] as Record<string, unknown> | undefined;
    if (first?.Plan) return first.Plan as PgPlan;
    if (first && first['Node Type']) return first as PgPlan;
  }

  if (typeof payload === 'object' && payload) {
    const obj = payload as Record<string, unknown>;
    if (obj.Plan) return obj.Plan as PgPlan;
    if (obj['Node Type']) return obj as PgPlan;
  }

  if (typeof payload === 'string') {
    try {
      return extractPgPlan(JSON.parse(payload));
    } catch {
      return null;
    }
  }

  return null;
}

function convert(plan: PgPlan, depth: number, counter: { n: number }): PlanNode {
  const operator = String(plan['Node Type'] || 'Node');
  const relation = plan['Relation Name'] || plan.Alias;
  const index = plan['Index Name'];
  const joinType = plan['Join Type'];
  const condition =
    plan['Hash Cond'] ||
    plan['Merge Cond'] ||
    plan['Join Filter'] ||
    plan['Index Cond'] ||
    plan.Filter ||
    plan['Recheck Cond'];

  const sortKey = plan['Sort Key'];
  const groupKey = plan['Group Key'];

  const detailParts: string[] = [];
  if (relation) detailParts.push(String(relation));
  if (index) detailParts.push(`index ${index}`);
  if (joinType) detailParts.push(`${joinType} join`);
  if (condition) detailParts.push(String(condition));
  if (sortKey) detailParts.push(`sort: ${arr(sortKey)}`);
  if (groupKey) detailParts.push(`group: ${arr(groupKey)}`);
  const detail = detailParts.join(' · ');

  const category = classifyOperator(operator, detail);
  const estimatedRows = num(plan['Plan Rows'] ?? plan['Actual Rows']);
  const engineCost = num(plan['Total Cost']);
  const actualTimeMs = num(plan['Actual Total Time']);

  const estimatedCost = estimateNodeCost({
    category,
    operator,
    detail,
    estimatedRows,
    engineCost: engineCost && engineCost > 0 ? engineCost : undefined,
  });

  const metadata: Record<string, unknown> = {
    startupCost: plan['Startup Cost'],
    totalCost: plan['Total Cost'],
    planRows: plan['Plan Rows'],
    planWidth: plan['Plan Width'],
  };
  if (relation) metadata.table = relation;
  if (index) metadata.index = index;
  if (joinType) metadata.joinType = joinType;
  if (condition) metadata.condition = condition;

  const children = (plan.Plans || []).map((c) => convert(c, depth + 1, counter));

  // Exclusive cost approximation: total - sum(child totals)
  const childCostSum = (plan.Plans || []).reduce((s, c) => s + (num(c['Total Cost']) || 0), 0);
  const exclusive =
    engineCost !== undefined && engineCost >= childCostSum
      ? Math.max(0.01, engineCost - childCostSum)
      : estimatedCost;

  return {
    id: createNodeId('pg', counter),
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
    estimatedCost: exclusive,
    estimatedRows,
    actualTimeMs,
    costPercent: 0,
    isExpensive: false,
    children,
    metadata,
    depth,
    subtreeSize: 1,
  };
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function arr(v: string[] | string): string {
  return Array.isArray(v) ? v.join(', ') : String(v);
}
