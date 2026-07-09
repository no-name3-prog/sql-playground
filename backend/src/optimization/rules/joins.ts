import { v4 as uuid } from 'uuid';
import type { OptimizationRecommendation } from '../../types/optimization.js';
import { type PlanContext, toPlanRef, extractTableName } from '../planContext.js';

export function ruleJoins(ctx: PlanContext): OptimizationRecommendation[] {
  const recs: OptimizationRecommendation[] = [];
  const { joins, nestedLoopJoins, sequentialScans, sqlHints } = ctx;

  for (const join of joins) {
    if (join.costPercent < 10 && !join.isExpensive) continue;

    const isNested = /nested|loop/i.test(join.operator + ' ' + (join.detail || ''));
    const cost = join.costPercent;
    const joinCols = sqlHints.joinColumns;

    if (isNested || nestedLoopJoins.includes(join)) {
      recs.push({
        id: uuid(),
        type: 'warning',
        severity: cost >= 20 || join.isExpensive ? 'high' : 'medium',
        title: `Nested-loop style join is costly (~${cost.toFixed(0)}%)`,
        problem:
          `Plan join operator “${join.label}” (${join.operator}) contributes ~${cost.toFixed(1)}% ` +
          `of estimated cost. Nested loops re-probe the inner input per outer row and scale poorly ` +
          `when both sides are large.`,
        suggestion:
          joinCols.length > 0
            ? `Index the join keys (${joinCols.join(', ')}) on the inner table so each probe is an index lookup, or rewrite to encourage a hash/merge join when both inputs are large.`
            : 'Index join keys on the inner input, or ensure statistics allow a hash join for large sets.',
        why:
          `Grounded in plan node ${join.id} (category join, ${cost.toFixed(1)}% cost). ` +
          `When this node is expensive, join algorithm and access path dominate runtime.`,
        estimatedImprovement: {
          summary: `Index-backed probes can cut this join’s cost by ~40–80%`,
          costReductionPercentMin: Math.round(cost * 0.4),
          costReductionPercentMax: Math.round(cost * 0.8),
          confidence: 'medium',
          speedupLabel: 'High when inner side is large',
        },
        planReferences: [toPlanRef(join)],
        ddl:
          joinCols.length && sqlHints.tables[1]
            ? `CREATE INDEX idx_${sqlHints.tables[1]}_${joinCols[0]} ON ${sqlHints.tables[1]} (${joinCols[0]});`
            : undefined,
        tags: ['join', 'nested-loop', 'index'],
      });
    }

    if (join.isExpensive || cost >= 15) {
      // Join with sequential scans on inputs
      const childScans = sequentialScans.filter(
        (s) => s.depth >= join.depth || true // all seq scans as potential join inputs
      );
      const related = childScans.filter((s) => s.costPercent >= 5).slice(0, 3);
      if (related.length) {
        recs.push({
          id: uuid(),
          type: 'anti-pattern',
          severity: 'high',
          title: 'Join fed by sequential scan(s)',
          problem:
            `Join “${join.label}” (~${cost.toFixed(0)}% cost) coexists with sequential scan(s) ` +
            `${related.map((s) => `“${s.label}”`).join(', ')}. Building a join over full scans multiplies work.`,
          suggestion:
            `Index foreign-key / join columns so the plan can use index nested-loop or reduce ` +
            `hash-build input size. Keys seen in SQL: ${joinCols.join(', ') || 'inspect ON clause'}.`,
          why:
            `Plan references join ${join.id} and scan node(s) ${related.map((s) => s.id).join(', ')}. ` +
            `Cost shares show both stages contribute; fixing only the join algorithm leaves scan I/O intact.`,
          estimatedImprovement: {
            summary: 'Combined join+scan fixes often yield the largest wins',
            costReductionPercentMin: Math.round((cost + related[0].costPercent) * 0.2),
            costReductionPercentMax: Math.min(
              85,
              Math.round((cost + related[0].costPercent) * 0.65)
            ),
            confidence: 'medium',
          },
          planReferences: [toPlanRef(join), ...related.map(toPlanRef)],
          tags: ['anti-pattern', 'join', 'scan'],
        });
      }
    }
  }

  // Many joins
  if (joins.length >= 3) {
    const refs = joins.map(toPlanRef);
    const total = joins.reduce((s, j) => s + j.costPercent, 0);
    recs.push({
      id: uuid(),
      type: 'warning',
      severity: total >= 40 ? 'medium' : 'low',
      title: `${joins.length} join operators in the plan`,
      problem: `The plan performs ${joins.length} joins (combined ~${total.toFixed(0)}% cost). Complex join graphs hide unnecessary joins.`,
      suggestion:
        'Confirm every join is required for the result. Remove unused tables and prefer joining on selective keys with indexes.',
      why: `Plan join nodes: ${joins.map((j) => j.id).join(', ')}. Unnecessary joins still allocate cost even if filtered later.`,
      estimatedImprovement: {
        summary: 'Dropping one unused join can remove its full cost share',
        costReductionPercentMin: Math.round((joins[joins.length - 1]?.costPercent || 5) * 0.5),
        costReductionPercentMax: Math.round(total * 0.3),
        confidence: 'low',
      },
      planReferences: refs.slice(0, 5),
      tags: ['join', 'complexity'],
    });
  }

  // Rewrite: suggest EXISTS instead of JOIN when selecting only from one table with join+agg pattern is hard
  // Simpler rewrite: if join count matches and select list only uses one table alias - skip for reliability

  void extractTableName;
  return recs;
}
