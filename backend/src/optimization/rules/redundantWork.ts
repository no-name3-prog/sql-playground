import { v4 as uuid } from 'uuid';
import type { OptimizationRecommendation } from '../../types/optimization.js';
import { type PlanContext, toPlanRef } from '../planContext.js';

export function ruleRedundantWork(ctx: PlanContext): OptimizationRecommendation[] {
  const recs: OptimizationRecommendation[] = [];
  const { sorts, joins, sequentialScans, analysis, sqlHints } = ctx;

  // Unnecessary sort: ORDER BY constant / primary key already ordered - hard to detect
  // Offset-heavy pagination anti-pattern
  if (sqlHints.hasOffset && sqlHints.hasOrderBy) {
    const sort = sorts.find((s) => s.costPercent >= 5 || s.isExpensive);
    const refs = sort
      ? [toPlanRef(sort)]
      : analysis.expensiveNodes.slice(0, 2).map((n) => ({
          nodeId: n.id,
          label: n.label,
          category: n.category,
          costPercent: n.costPercent,
          detail: n.detail,
        }));
    if (refs.length) {
      recs.push({
        id: uuid(),
        type: 'rewrite',
        severity: 'medium',
        title: 'OFFSET pagination increases scan/sort work in the plan',
        problem:
          'Query uses OFFSET with ORDER BY. Plans typically still scan/sort and discard skipped rows, so cost grows with page number.',
        suggestion:
          'Switch to keyset/seek pagination: WHERE (sort_col, id) > (?, ?) ORDER BY sort_col, id LIMIT N.',
        why:
          `Plan operators involved in ordering/scanning (${refs.map((ref) => ref.nodeId).join(', ')}) ` +
          `must still produce skipped rows for OFFSET. Keyset pagination bounds work per page.`,
        estimatedImprovement: {
          summary: 'Keyset pagination keeps per-page cost flat versus OFFSET growth',
          costReductionPercentMin: 10,
          costReductionPercentMax: 70,
          confidence: 'medium',
          speedupLabel: 'Large on deep pages',
        },
        planReferences: refs,
        tags: ['rewrite', 'pagination', 'offset'],
      });
    }
  }

  // Cross join risk: join without ON in SQL and join in plan
  const sql = analysis.sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  if (/\bCROSS\s+JOIN\b/i.test(sql) || /\bFROM\s+\w+\s*,\s*\w+/i.test(sql)) {
    const j = joins[0] || sequentialScans[0];
    if (j) {
      recs.push({
        id: uuid(),
        type: 'anti-pattern',
        severity: 'critical',
        title: 'Cartesian-style join pattern with plan join/scan cost',
        problem:
          'SQL suggests a CROSS JOIN or comma join; the plan still pays for join/scan operators that can explode row counts.',
        suggestion: 'Add an explicit join predicate (ON/USING) that matches business keys.',
        why: `Plan node ${j.id} (“${j.label}”) participates in combining inputs. Without selective predicates, estimated rows and cost grow multiplicatively.`,
        estimatedImprovement: {
          summary: 'Adding a selective join key can reduce row explosion by orders of magnitude',
          costReductionPercentMin: 30,
          costReductionPercentMax: 95,
          confidence: 'high',
          speedupLabel: 'Critical',
        },
        planReferences: [toPlanRef(j)],
        tags: ['anti-pattern', 'cartesian', 'join'],
      });
    }
  }

  // Healthy plan note when few issues - handled in optimizeService summary

  // Subquery / materialize heavy
  const materials = analysis.root
    ? ctx.nodes.filter((n) => n.category === 'materialize' && (n.costPercent >= 8 || n.isExpensive))
    : [];
  for (const m of materials) {
    recs.push({
      id: uuid(),
      type: 'warning',
      severity: 'medium',
      title: `Materialize operator costs ~${m.costPercent.toFixed(0)}%`,
      problem: `Plan materializes intermediate results at “${m.label}” (~${m.costPercent.toFixed(1)}% cost).`,
      suggestion:
        'Consider rewriting CTEs as inline views (or vice versa depending on engine), or adding indexes so materialization is unnecessary.',
      why: `Node ${m.id} shows explicit materialization cost in the execution plan.`,
      estimatedImprovement: {
        summary: 'Avoiding materialize can reclaim its full cost share',
        costReductionPercentMin: Math.round(m.costPercent * 0.4),
        costReductionPercentMax: Math.round(m.costPercent * 0.95),
        confidence: 'low',
      },
      planReferences: [toPlanRef(m)],
      tags: ['materialize', 'warning'],
    });
  }

  return recs;
}
