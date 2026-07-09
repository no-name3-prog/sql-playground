import type { OperatorCategory } from '../types/analysis.js';

const RULES: Array<{ category: OperatorCategory; patterns: RegExp[] }> = [
  {
    category: 'scan',
    patterns: [
      /\b(seq[_\s-]?scan|sequential\s*scan|table\s*scan|scan\b|index\s*scan|index\s*only\s*scan|bitmap\s*heap\s*scan|bitmap\s*index\s*scan|search\b|table\s*access|full\s*table|range\s*scan|ref\b|eq_ref|const\b|system\b|all\b)/i,
      /\bread\b/i,
    ],
  },
  {
    category: 'join',
    patterns: [
      /\b(hash[_\s-]?join|merge[_\s-]?join|nested[_\s-]?loop|join\b|block\s*nested|bnl|bka|bat\w*\s*join)/i,
    ],
  },
  {
    category: 'sort',
    patterns: [/\b(sort|order\s*by|top-?n|external\s*sort|filesort|use temp b-tree for order)/i],
  },
  {
    category: 'aggregate',
    patterns: [
      /\b(aggregate|group[_\s-]?by|hash[_\s-]?group|perfect_hash_group|hashaggregate|groupaggregate|ungroup|windowagg|window\b)/i,
      /\b(count|sum|avg|min|max)\s*\(/i,
    ],
  },
  {
    category: 'filter',
    patterns: [/\b(filter|where|having|select\s*rows|rowid[_\s-]?filter|bitmap\s*and|bitmap\s*or)/i],
  },
  {
    category: 'project',
    patterns: [/\b(projection|project|result|output|gather|append|unique|setop|union)/i],
  },
  {
    category: 'limit',
    patterns: [/\b(limit|top\b|fetch|row[_\s-]?number\s*filter)/i],
  },
  {
    category: 'materialize',
    patterns: [/\b(materialize|cte\s*scan|temp\s*table|hash|worktable|buffer|memoize)/i],
  },
  {
    category: 'modify',
    patterns: [/\b(insert|update|delete|modify|truncate)/i],
  },
];

/**
 * Map a raw operator string to a high-level category.
 */
export function classifyOperator(operator: string, detail = ''): OperatorCategory {
  const text = `${operator} ${detail}`.trim();
  if (!text) return 'other';

  // Prefer more specific matches first by rule order above
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return rule.category;
    }
  }
  return 'other';
}

export function humanizeOperator(operator: string): string {
  return operator
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
