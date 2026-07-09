import { v4 as uuid } from 'uuid';
import type { OptimizationRecommendation } from '../../types/optimization.js';
import { type PlanContext, toPlanRef } from '../planContext.js';

export function ruleFilters(ctx: PlanContext): OptimizationRecommendation[] {
  const recs: OptimizationRecommendation[] = [];
  const { filters, sequentialScans, sqlHints } = ctx;

  // Explicit filter operators that are expensive
  for (const filter of filters) {
    if (filter.costPercent < 8 && !filter.isExpensive) continue;
    recs.push({
      id: uuid(),
      type: 'warning',
      severity: filter.isExpensive ? 'medium' : 'low',
      title: `Late filter operator costs ~${filter.costPercent.toFixed(0)}%`,
      problem:
        `Filter “${filter.label}” (${filter.detail || filter.operator}) appears as its own plan node ` +
        `with ~${filter.costPercent.toFixed(1)}% cost — rows are produced then discarded.`,
      suggestion:
        'Push predicates into index conditions or earlier access paths; avoid wrapping columns in functions in WHERE.',
      why: `Plan node ${filter.id} shows residual filtering cost. Index-conditioned scans avoid creating rows that fail the predicate.`,
      estimatedImprovement: {
        summary: 'Predicate pushdown can remove most residual filter cost',
        costReductionPercentMin: Math.round(filter.costPercent * 0.3),
        costReductionPercentMax: Math.round(filter.costPercent * 0.9),
        confidence: 'medium',
      },
      planReferences: [toPlanRef(filter)],
      tags: ['filter', 'predicate'],
    });
  }

  // Function on column anti-pattern (SQL) only if plan shows seq scan
  const sql = ctx.analysis.sql;
  const wrapped =
    /\bWHERE\b[\s\S]*\b(LOWER|UPPER|DATE|YEAR|MONTH|CAST|SUBSTRING|TRIM)\s*\(\s*[\w.]+\s*\)/i.test(
      sql
    );
  if (wrapped && sequentialScans.some((s) => s.costPercent >= 8 || s.isExpensive)) {
    const scans = sequentialScans.filter((s) => s.costPercent >= 5 || s.isExpensive);
    recs.push({
      id: uuid(),
      type: 'anti-pattern',
      severity: 'high',
      title: 'Function-wrapped column likely blocks index use (plan still scans)',
      problem:
        'WHERE applies a function to a column while the plan still shows sequential scan(s). ' +
        'That pattern usually prevents a plain index match.',
      suggestion:
        'Rewrite predicates to keep columns bare (e.g. col >= x AND col < y instead of YEAR(col)=…), or use a functional/expression index if the engine supports it.',
      why:
        `Plan sequential scan node(s) ${scans.map((s) => s.id).join(', ')} remain. ` +
        `If an index were usable, these nodes would typically become index searches.`,
      estimatedImprovement: {
        summary: 'Enabling an index access path can remove most of the scan cost share',
        costReductionPercentMin: Math.round(scans[0].costPercent * 0.4),
        costReductionPercentMax: Math.round(scans[0].costPercent * 0.9),
        confidence: 'medium',
        speedupLabel: 'High',
      },
      planReferences: scans.map(toPlanRef),
      sqlBefore: undefined,
      tags: ['anti-pattern', 'sargability', 'index'],
    });
  }

  // Leading wildcard LIKE
  if (/\bLIKE\s+'%[^']+'/i.test(sql) && sequentialScans.length) {
    const scans = sequentialScans.filter((s) => s.costPercent >= 5 || s.isExpensive);
    if (scans.length) {
      recs.push({
        id: uuid(),
        type: 'anti-pattern',
        severity: 'medium',
        title: 'Leading-wildcard LIKE with sequential scan in plan',
        problem:
          'LIKE \'%…\' cannot use a standard btree index prefix, and the plan still shows sequential scan(s).',
        suggestion:
          'Avoid leading wildcards, use full-text search, or trigram/GIN indexes where supported.',
        why: `Plan evidence: ${scans.map((s) => `${s.label} (${s.id})`).join(', ')} remain sequential while the pattern is non-sargable.`,
        estimatedImprovement: {
          summary: 'Specialized indexes or rewritten search can replace full scans',
          costReductionPercentMin: Math.round(scans[0].costPercent * 0.3),
          costReductionPercentMax: Math.round(scans[0].costPercent * 0.85),
          confidence: 'low',
        },
        planReferences: scans.map(toPlanRef),
        tags: ['anti-pattern', 'like', 'scan'],
      });
    }
  }

  void sqlHints;
  return recs;
}
