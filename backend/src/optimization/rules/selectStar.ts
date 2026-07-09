import { v4 as uuid } from 'uuid';
import type { OptimizationRecommendation } from '../../types/optimization.js';
import { type PlanContext, toPlanRef } from '../planContext.js';

export function ruleSelectStar(ctx: PlanContext): OptimizationRecommendation[] {
  const recs: OptimizationRecommendation[] = [];
  const { sqlHints, sequentialScans, scans, analysis } = ctx;

  if (!sqlHints.selectStar) return recs;

  const related = (sequentialScans.length ? sequentialScans : scans).filter(
    (s) => s.costPercent >= 5 || s.isExpensive
  );
  if (!related.length && analysis.totalNodes > 0) {
    // still warn but need plan refs — use root / expensive
    related.push(...ctx.expensive.slice(0, 2));
  }
  if (!related.length) related.push(analysis.root);

  const cost = related.reduce((s, n) => s + n.costPercent, 0);
  const table = sqlHints.tables[0] || 't';

  recs.push({
    id: uuid(),
    type: 'rewrite',
    severity: cost >= 20 ? 'medium' : 'low',
    title: 'SELECT * widens scan/projection work visible in the plan',
    problem:
      `Query uses SELECT * while the plan performs scan operator(s) ` +
      `${related.map((n) => `“${n.label}”`).join(', ')} ` +
      `(~${Math.min(100, cost).toFixed(0)}% combined cost). Wide rows increase I/O and memory through the pipeline.`,
    suggestion: `Project only needed columns, e.g. SELECT id, name FROM ${table} …`,
    why:
      `Plan scans ${related.map((n) => n.id).join(', ')} still read base rows. ` +
      `Narrowing the select list enables covering indexes and reduces data movement between operators.`,
    estimatedImprovement: {
      summary: 'Column pruning often saves 10–40% I/O on wide tables (workload-dependent)',
      costReductionPercentMin: 5,
      costReductionPercentMax: Math.min(40, Math.round(Math.max(cost, 15) * 0.4)),
      confidence: 'low',
      speedupLabel: 'Higher on wide rows',
    },
    planReferences: related.slice(0, 4).map(toPlanRef),
    sqlBefore: analysis.sql.trim(),
    sqlAfter: analysis.sql.replace(/\bSELECT\s+\*/i, `SELECT /* columns */ id /* , ... */`),
    tags: ['rewrite', 'projection', 'select-star'],
  });

  return recs;
}
