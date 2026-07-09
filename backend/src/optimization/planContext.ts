import type { PlanNode, QueryAnalysis, OperatorCategory } from '../types/analysis.js';
import type { PlanReference } from '../types/optimization.js';

export interface SqlHints {
  selectStar: boolean;
  hasOrderBy: boolean;
  hasGroupBy: boolean;
  hasDistinct: boolean;
  hasLimit: boolean;
  hasOffset: boolean;
  hasHaving: boolean;
  joinCount: number;
  whereColumns: string[];
  orderByColumns: string[];
  groupByColumns: string[];
  joinColumns: string[];
  tables: string[];
  leadingSelectList: string;
}

export interface PlanContext {
  analysis: QueryAnalysis;
  nodes: PlanNode[];
  scans: PlanNode[];
  sequentialScans: PlanNode[];
  indexScans: PlanNode[];
  joins: PlanNode[];
  nestedLoopJoins: PlanNode[];
  sorts: PlanNode[];
  aggregates: PlanNode[];
  filters: PlanNode[];
  expensive: PlanNode[];
  sqlHints: SqlHints;
}

export function buildPlanContext(analysis: QueryAnalysis): PlanContext {
  const nodes = flatten(analysis.root);
  const scans = nodes.filter((n) => n.category === 'scan');
  const sequentialScans = scans.filter((n) => isSequentialScan(n));
  const indexScans = scans.filter((n) => !isSequentialScan(n));
  const joins = nodes.filter((n) => n.category === 'join');
  const nestedLoopJoins = joins.filter((n) =>
    /nested|loop/i.test(n.operator + ' ' + (n.detail || ''))
  );
  const sorts = nodes.filter((n) => n.category === 'sort');
  const aggregates = nodes.filter((n) => n.category === 'aggregate');
  const filters = nodes.filter((n) => n.category === 'filter');
  const expensive = nodes.filter((n) => n.isExpensive);

  return {
    analysis,
    nodes,
    scans,
    sequentialScans,
    indexScans,
    joins,
    nestedLoopJoins,
    sorts,
    aggregates,
    filters,
    expensive,
    sqlHints: parseSqlHints(analysis.sql),
  };
}

export function toPlanRef(node: PlanNode): PlanReference {
  return {
    nodeId: node.id,
    label: node.label,
    category: node.category,
    costPercent: node.costPercent,
    detail: node.detail,
    operator: node.operator,
  };
}

export function isSequentialScan(node: PlanNode): boolean {
  const text = `${node.operator} ${node.detail || ''} ${node.label}`;
  if (/index|search|ref|eq_ref|covering|primary key/i.test(text) && !/seq|full/i.test(text)) {
    // SEARCH / Index Scan are not sequential
    if (/search|index\s*scan|index\s*only|ref\b|eq_ref/i.test(text)) return false;
  }
  return /seq|full\s*table|table\s*scan|access\s*\(\s*all\s*\)|\bSCAN\b(?!.*INDEX)|Type:\s*Sequential/i.test(
    text
  ) || (/^SCAN\b/i.test(node.operator) && !/SEARCH|INDEX/i.test(text));
}

export function extractTableName(node: PlanNode): string | null {
  const meta = node.metadata || {};
  const fromMeta = meta.table || meta.Table || meta['Relation Name'] || meta.table_name;
  if (fromMeta) return String(fromMeta).replace(/["'`]/g, '');

  const d = node.detail || '';
  const patterns = [
    /table[:\s]+["'`]?([\w.]+)["'`]?/i,
    /\bSCAN\s+(?:TABLE\s+)?(\w+)/i,
    /\bFROM\s+(\w+)/i,
    /\btable\s+(\w+)/i,
    /^(\w+)\s*$/i,
  ];
  for (const p of patterns) {
    const m = d.match(p);
    if (m?.[1] && !/join|inner|left|right|full|type|access/i.test(m[1])) {
      return m[1];
    }
  }
  // "SCAN o" style — alias only
  const scanAlias = d.match(/^SCAN\s+(\w+)\s*$/i);
  if (scanAlias) return scanAlias[1];
  return null;
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function parseSqlHints(sql: string): SqlHints {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const selectMatch = cleaned.match(/\bSELECT\s+(DISTINCT\s+)?([\s\S]+?)\s+FROM\b/i);
  const selectList = selectMatch?.[2]?.trim() || '';
  const selectStar = /^\*\s*(,|$)/.test(selectList) || selectList === '*';

  const whereClause = sliceClause(cleaned, /\bWHERE\b/i, /\b(GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT)\b/i);
  const orderClause = sliceClause(cleaned, /\bORDER\s+BY\b/i, /\b(LIMIT|OFFSET|UNION|INTERSECT|EXCEPT)\b/i);
  const groupClause = sliceClause(cleaned, /\bGROUP\s+BY\b/i, /\b(HAVING|ORDER\s+BY|LIMIT|OFFSET|UNION)\b/i);

  const joinCount = (cleaned.match(/\bJOIN\b/gi) || []).length;
  const tables = extractTables(cleaned);

  return {
    selectStar,
    hasOrderBy: /\bORDER\s+BY\b/i.test(cleaned),
    hasGroupBy: /\bGROUP\s+BY\b/i.test(cleaned),
    hasDistinct: /\bSELECT\s+DISTINCT\b/i.test(cleaned),
    hasLimit: /\bLIMIT\b/i.test(cleaned),
    hasOffset: /\bOFFSET\b/i.test(cleaned),
    hasHaving: /\bHAVING\b/i.test(cleaned),
    joinCount,
    whereColumns: extractColumns(whereClause),
    orderByColumns: extractColumns(orderClause),
    groupByColumns: extractColumns(groupClause),
    joinColumns: extractJoinColumns(cleaned),
    tables,
    leadingSelectList: selectList,
  };
}

function sliceClause(sql: string, start: RegExp, end: RegExp): string {
  const s = sql.search(start);
  if (s < 0) return '';
  const rest = sql.slice(s);
  const m = rest.match(start);
  if (!m) return '';
  const after = rest.slice(m[0].length);
  const e = after.search(end);
  return (e < 0 ? after : after.slice(0, e)).trim();
}

function extractColumns(clause: string): string[] {
  if (!clause) return [];
  const cols: string[] = [];
  const re = /\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\b|\b([a-zA-Z_][\w]*)\b/g;
  let m: RegExpExecArray | null;
  const stop = new Set([
    'and', 'or', 'not', 'in', 'is', 'null', 'like', 'between', 'exists', 'true', 'false',
    'asc', 'desc', 'nulls', 'first', 'last', 'as', 'case', 'when', 'then', 'else', 'end',
    'on', 'using', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'join',
  ]);
  while ((m = re.exec(clause))) {
    const col = (m[2] || m[3] || '').toLowerCase();
    if (!col || stop.has(col) || /^\d/.test(col)) continue;
    if (!cols.includes(col)) cols.push(col);
  }
  return cols;
}

function extractJoinColumns(sql: string): string[] {
  const cols: string[] = [];
  const re = /\bON\s+([\w.]+)\s*=\s*([\w.]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    for (const side of [m[1], m[2]]) {
      const parts = side.split('.');
      const col = parts[parts.length - 1].toLowerCase();
      if (col && !cols.includes(col)) cols.push(col);
    }
  }
  return cols;
}

function extractTables(sql: string): string[] {
  const tables: string[] = [];
  const re = /\b(?:FROM|JOIN)\s+([`"[]?[\w.]+[`"\]]?)(?:\s+(?:AS\s+)?(\w+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const raw = m[1].replace(/[`"[\]]/g, '');
    const name = raw.split('.').pop() || raw;
    if (name && !tables.includes(name)) tables.push(name);
  }
  return tables;
}

export type { OperatorCategory };
