import type { PlanNode } from '../../types/analysis.js';
import { classifyOperator, humanizeOperator } from '../classify.js';
import { explainOperator } from '../explainEnglish.js';
import { createNodeId, estimateNodeCost } from '../cost.js';

/**
 * Parse MySQL EXPLAIN FORMAT=JSON output.
 * Root usually: { query_block: { ... } }
 */
export function parseMysqlPlan(payload: unknown): PlanNode {
  const counter = { n: 0 };
  const root = extractRoot(payload);

  if (!root) {
    return empty(counter, 'MySQL returned an empty or unparseable plan.');
  }

  return convertQueryBlock(root, 0, counter, 'Query Block');
}

function extractRoot(payload: unknown): Record<string, unknown> | null {
  if (!payload) return null;

  if (typeof payload === 'string') {
    try {
      return extractRoot(JSON.parse(payload));
    } catch {
      return null;
    }
  }

  if (typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;

  // Sometimes wrapped as { EXPLAIN: "..." } string
  if (typeof obj.EXPLAIN === 'string') {
    try {
      return extractRoot(JSON.parse(obj.EXPLAIN));
    } catch {
      /* fall through */
    }
  }

  if (obj.query_block && typeof obj.query_block === 'object') {
    return obj.query_block as Record<string, unknown>;
  }

  // driver may return rows: [{ EXPLAIN: jsonstring }]
  if (Array.isArray(payload)) {
    const first = payload[0] as Record<string, unknown> | undefined;
    if (first) return extractRoot(first);
  }

  return obj;
}

function convertQueryBlock(
  block: Record<string, unknown>,
  depth: number,
  counter: { n: number },
  label: string
): PlanNode {
  const children: PlanNode[] = [];

  // Nested operations / ordering / grouping
  if (block.ordering_operation && typeof block.ordering_operation === 'object') {
    children.push(
      convertOperation(
        block.ordering_operation as Record<string, unknown>,
        depth + 1,
        counter,
        'Sort'
      )
    );
  } else if (block.grouping_operation && typeof block.grouping_operation === 'object') {
    children.push(
      convertOperation(
        block.grouping_operation as Record<string, unknown>,
        depth + 1,
        counter,
        'Group By'
      )
    );
  } else if (block.nested_loop && Array.isArray(block.nested_loop)) {
    for (const item of block.nested_loop) {
      children.push(convertNestedItem(item as Record<string, unknown>, depth + 1, counter));
    }
  } else if (block.table && typeof block.table === 'object') {
    children.push(convertTable(block.table as Record<string, unknown>, depth + 1, counter));
  } else if (block.union_result && typeof block.union_result === 'object') {
    children.push(
      convertOperation(
        block.union_result as Record<string, unknown>,
        depth + 1,
        counter,
        'Union'
      )
    );
  }

  // Also handle duplicates if both ordering and table present without nesting
  if (
    !children.length &&
    block.table &&
    typeof block.table === 'object'
  ) {
    children.push(convertTable(block.table as Record<string, unknown>, depth + 1, counter));
  }

  const selectId = block.select_id !== undefined ? `select #${block.select_id}` : undefined;
  const costInfo = (block.cost_info || {}) as Record<string, unknown>;
  const engineCost = num(costInfo.query_cost);

  const operator = label;
  const category = classifyOperator(operator);
  const estimatedCost = estimateNodeCost({
    category,
    operator,
    engineCost: engineCost && engineCost > 0 ? engineCost : undefined,
  });

  // If only one child and label is generic, promote child slightly with wrapper for context
  return {
    id: createNodeId('mysql', counter),
    label: humanizeOperator(operator),
    operator,
    category: children.length ? 'other' : category,
    detail: selectId,
    explanation: explainOperator({
      operator,
      category: children.length ? 'other' : category,
      detail: selectId,
      metadata: { queryCost: costInfo.query_cost },
    }),
    estimatedCost: engineCost && engineCost > 0 ? Math.max(0.01, engineCost * 0.05) : estimatedCost,
    costPercent: 0,
    isExpensive: false,
    children,
    metadata: { ...block, cost_info: costInfo },
    depth,
    subtreeSize: 1,
  };
}

function convertOperation(
  op: Record<string, unknown>,
  depth: number,
  counter: { n: number },
  defaultLabel: string
): PlanNode {
  const usingFilesort = op.using_filesort === true;
  const usingTmp = op.using_temporary_table === true;
  const label = usingFilesort ? 'Filesort' : defaultLabel;
  const operator = label;
  const detailParts: string[] = [];
  if (usingFilesort) detailParts.push('using filesort');
  if (usingTmp) detailParts.push('using temporary table');

  const category = classifyOperator(operator, detailParts.join(' '));
  const costInfo = (op.cost_info || {}) as Record<string, unknown>;
  const engineCost = num(costInfo.sort_cost) || num(costInfo.query_cost);

  const children: PlanNode[] = [];
  if (op.nested_loop && Array.isArray(op.nested_loop)) {
    for (const item of op.nested_loop) {
      children.push(convertNestedItem(item as Record<string, unknown>, depth + 1, counter));
    }
  } else if (op.table && typeof op.table === 'object') {
    children.push(convertTable(op.table as Record<string, unknown>, depth + 1, counter));
  } else if (op.grouping_operation && typeof op.grouping_operation === 'object') {
    children.push(
      convertOperation(
        op.grouping_operation as Record<string, unknown>,
        depth + 1,
        counter,
        'Group By'
      )
    );
  }

  const detail = detailParts.join(' · ');
  return {
    id: createNodeId('mysql', counter),
    label: humanizeOperator(operator),
    operator,
    category,
    detail: detail || undefined,
    explanation: explainOperator({ operator, category, detail }),
    estimatedCost: estimateNodeCost({
      category,
      operator,
      detail,
      engineCost: engineCost && engineCost > 0 ? engineCost : undefined,
    }),
    costPercent: 0,
    isExpensive: false,
    children,
    metadata: op,
    depth,
    subtreeSize: 1,
  };
}

function convertNestedItem(
  item: Record<string, unknown>,
  depth: number,
  counter: { n: number }
): PlanNode {
  if (item.table && typeof item.table === 'object') {
    return convertTable(item.table as Record<string, unknown>, depth, counter);
  }
  if (item.query_block && typeof item.query_block === 'object') {
    return convertQueryBlock(
      item.query_block as Record<string, unknown>,
      depth,
      counter,
      'Subquery'
    );
  }
  return {
    id: createNodeId('mysql', counter),
    label: 'Nested Loop',
    operator: 'nested_loop',
    category: 'join',
    explanation: explainOperator({ operator: 'nested_loop', category: 'join' }),
    estimatedCost: estimateNodeCost({ category: 'join', operator: 'nested_loop' }),
    costPercent: 0,
    isExpensive: false,
    children: [],
    metadata: item,
    depth,
    subtreeSize: 1,
  };
}

function convertTable(
  table: Record<string, unknown>,
  depth: number,
  counter: { n: number }
): PlanNode {
  const tableName = String(table.table_name || table.table || 'table');
  const accessType = String(table.access_type || 'ALL');
  const key = table.key ? String(table.key) : '';
  const rows = num(table.rows_examined_per_scan) ?? num(table.rows);
  const filtered = num(table.filtered);

  const operator =
    accessType.toUpperCase() === 'ALL'
      ? 'Table Scan'
      : /index/i.test(accessType)
        ? 'Index Scan'
        : `Access (${accessType})`;

  const detailParts = [`table ${tableName}`, `access ${accessType}`];
  if (key) detailParts.push(`key ${key}`);
  if (filtered !== undefined) detailParts.push(`filtered ${filtered}%`);
  const detail = detailParts.join(' · ');

  const category = classifyOperator(operator + ' ' + accessType, detail);
  const costInfo = (table.cost_info || {}) as Record<string, unknown>;
  const engineCost =
    num(costInfo.read_cost) !== undefined || num(costInfo.eval_cost) !== undefined
      ? (num(costInfo.read_cost) || 0) + (num(costInfo.eval_cost) || 0)
      : undefined;

  // Attached subqueries / materializations
  const children: PlanNode[] = [];
  if (table.materialized_from_subquery && typeof table.materialized_from_subquery === 'object') {
    const mat = table.materialized_from_subquery as Record<string, unknown>;
    if (mat.query_block && typeof mat.query_block === 'object') {
      children.push(
        convertQueryBlock(
          mat.query_block as Record<string, unknown>,
          depth + 1,
          counter,
          'Materialized Subquery'
        )
      );
    }
  }

  return {
    id: createNodeId('mysql', counter),
    label: humanizeOperator(operator),
    operator,
    category,
    detail,
    explanation: explainOperator({
      operator,
      category,
      detail,
      estimatedRows: rows,
      metadata: { table: tableName, index: key, accessType },
    }),
    estimatedCost: estimateNodeCost({
      category,
      operator,
      detail,
      estimatedRows: rows,
      engineCost: engineCost && engineCost > 0 ? engineCost : undefined,
    }),
    estimatedRows: rows,
    costPercent: 0,
    isExpensive: false,
    children,
    metadata: table,
    depth,
    subtreeSize: 1,
  };
}

function empty(counter: { n: number }, message: string): PlanNode {
  return {
    id: createNodeId('mysql', counter),
    label: 'Empty Plan',
    operator: 'empty',
    category: 'other',
    explanation: message,
    estimatedCost: 0.01,
    costPercent: 0,
    isExpensive: false,
    children: [],
    metadata: {},
    depth: 0,
    subtreeSize: 1,
  };
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
