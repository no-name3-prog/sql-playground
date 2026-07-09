import type { OperatorCategory, PlanNode } from '../types/analysis.js';

function rowsPhrase(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '';
  if (n < 1) return ' producing few or no rows';
  if (n === 1) return ' (about 1 row)';
  if (n < 1000) return ` (about ${Math.round(n)} rows)`;
  if (n < 1_000_000) return ` (about ${(n / 1000).toFixed(1)}k rows)`;
  return ` (about ${(n / 1_000_000).toFixed(2)}M rows)`;
}

export function explainOperator(input: {
  operator: string;
  category: OperatorCategory;
  detail?: string;
  estimatedRows?: number;
  metadata?: Record<string, unknown>;
}): string {
  const { operator, category, detail, estimatedRows, metadata = {} } = input;
  const d = (detail || '').trim();
  const rows = rowsPhrase(estimatedRows);
  const joinType = String(metadata.joinType || metadata['Join Type'] || '').toUpperCase();
  const table = String(metadata.table || metadata.Table || extractTable(d) || '').trim();
  const index = String(metadata.index || metadata.Index || extractIndex(d) || '').trim();
  const condition = String(
    metadata.condition || metadata.Conditions || metadata['Join Filter'] || metadata.Filter || ''
  ).trim();

  switch (category) {
    case 'scan': {
      if (/index|search|ref|eq_ref/i.test(operator + d)) {
        const idx = index ? ` using index “${index}”` : ' using an index';
        const t = table ? ` on table “${table}”` : '';
        return `Looks up matching rows${t}${idx} instead of reading the whole table${rows}.`;
      }
      if (table) {
        return `Reads rows from table “${table}” with a sequential (full) scan${rows}. This can get expensive as the table grows.`;
      }
      return `Scans data from storage${d ? ` (${d})` : ''}${rows}.`;
    }
    case 'join': {
      const jt = joinType || (/\binner\b/i.test(d) ? 'INNER' : /\bleft\b/i.test(d) ? 'LEFT' : '');
      const how = /hash/i.test(operator)
        ? 'Builds a hash table on one input and probes it with the other'
        : /merge/i.test(operator)
          ? 'Merges two pre-sorted inputs'
          : /nested|loop/i.test(operator)
            ? 'For each row from the outer input, probes the inner input'
            : 'Combines rows from two inputs';
      const cond = condition ? ` on ${condition}` : d ? ` (${d})` : '';
      return `${how}${jt ? ` for a ${jt} join` : ''}${cond}${rows}.`;
    }
    case 'sort': {
      return `Sorts intermediate rows${d ? ` by ${d}` : ''}${rows}. Sorting large sets often dominates runtime and may spill to disk.`;
    }
    case 'aggregate': {
      const aggs = String(metadata.Aggregates || metadata.aggregates || '').trim();
      return `Groups rows and computes aggregates${aggs ? ` (${aggs})` : d ? ` (${d})` : ''}${rows}. Hash aggregation is usually cheaper than sort-based grouping when memory allows.`;
    }
    case 'filter': {
      return `Drops rows that do not match the predicate${condition || d ? ` “${condition || d}”` : ''}${rows}. Earlier filters reduce work for operators above.`;
    }
    case 'project': {
      return `Selects or computes output columns${d ? ` (${shorten(d, 80)})` : ''}${rows}. Usually inexpensive unless expressions are heavy.`;
    }
    case 'limit': {
      return `Stops after returning a limited number of rows${d ? ` (${d})` : ''}. Can short-circuit expensive work if pushed down.`;
    }
    case 'materialize': {
      return `Materializes intermediate results (temporary storage)${d ? `: ${d}` : ''}${rows}. Useful for reuse, but costs memory and I/O.`;
    }
    case 'modify': {
      return `Modifies table data (${operator}${d ? `: ${d}` : ''}).`;
    }
    default:
      return `Runs operator “${operator}”${d ? ` — ${shorten(d, 100)}` : ''}${rows}.`;
  }
}

export function buildPlanSummary(root: PlanNode, engine: string): string {
  const flat = flatten(root);
  const scans = flat.filter((n) => n.category === 'scan');
  const joins = flat.filter((n) => n.category === 'join');
  const sorts = flat.filter((n) => n.category === 'sort');
  const aggs = flat.filter((n) => n.category === 'aggregate');
  const expensive = flat.filter((n) => n.isExpensive);

  const parts: string[] = [];
  parts.push(
    `This ${engine} plan has ${flat.length} operator${flat.length === 1 ? '' : 's'}` +
      ` (depth ${maxDepth(root)}).`
  );

  if (scans.length) {
    const full = scans.filter((s) => /seq|full|scan(?!.*index)/i.test(s.operator + (s.detail || '')));
    const idx = scans.length - full.length;
    parts.push(
      `It reads data via ${scans.length} scan${scans.length === 1 ? '' : 's'}` +
        (full.length ? ` including ${full.length} sequential/full scan${full.length === 1 ? '' : 's'}` : '') +
        (idx > 0 ? ` and ${idx} index lookup${idx === 1 ? '' : 's'}` : '') +
        '.'
    );
  }
  if (joins.length) {
    parts.push(
      `There ${joins.length === 1 ? 'is' : 'are'} ${joins.length} join${joins.length === 1 ? '' : 's'}` +
        ` (${joins.map((j) => j.label).slice(0, 3).join(', ')}${joins.length > 3 ? '…' : ''}).`
    );
  }
  if (sorts.length) {
    parts.push(
      `${sorts.length} sort step${sorts.length === 1 ? '' : 's'} may dominate if the working set is large.`
    );
  }
  if (aggs.length) {
    parts.push(`Aggregation is performed in ${aggs.length} step${aggs.length === 1 ? '' : 's'}.`);
  }
  if (expensive.length) {
    const top = expensive
      .slice(0, 3)
      .map((e) => `${e.label} (~${e.costPercent.toFixed(0)}%)`)
      .join(', ');
    parts.push(`Likely time sinks: ${top}.`);
  }

  return parts.join(' ');
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function maxDepth(node: PlanNode): number {
  if (!node.children.length) return node.depth;
  return Math.max(...node.children.map(maxDepth));
}

function extractTable(detail: string): string | null {
  const m =
    detail.match(/\bTABLE\s*[:=]?\s*["']?([\w.]+)["']?/i) ||
    detail.match(/\bSCAN\s+(?:TABLE\s+)?(\w+)/i) ||
    detail.match(/\bFROM\s+(\w+)/i);
  return m?.[1] ?? null;
}

function extractIndex(detail: string): string | null {
  const m =
    detail.match(/\bINDEX\s*[:=]?\s*["']?([\w.]+)["']?/i) ||
    detail.match(/\bUSING\s+(?:INTEGER PRIMARY KEY|INDEX|COVERING INDEX)\s*\(?([\w\s]*)/i);
  return m?.[1]?.trim() || null;
}

function shorten(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
