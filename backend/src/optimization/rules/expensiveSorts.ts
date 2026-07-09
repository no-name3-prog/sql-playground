import { v4 as uuid } from 'uuid';
import type { OptimizationRecommendation } from '../../types/optimization.js';
import { type PlanContext, toPlanRef } from '../planContext.js';

export function ruleExpensiveSorts(ctx: PlanContext): OptimizationRecommendation[] {
  const recs: OptimizationRecommendation[] = [];
  const { sorts, sqlHints, sequentialScans } = ctx;

  for (const sort of sorts) {
    if (sort.costPercent < 10 && !sort.isExpensive) continue;

    const orderCols = sqlHints.orderByColumns;
    const cols = orderCols.length ? orderCols : ['<order_column>'];
    const table = sqlHints.tables[0] || 'table_name';
    const cost = sort.costPercent;

    recs.push({
      id: uuid(),
      type: 'warning',
      severity: cost >= 25 || sort.isExpensive ? 'high' : 'medium',
      title: `Expensive sort operator (~${cost.toFixed(0)}% of plan)`,
      problem:
        `Plan operator “${sort.label}” (${sort.operator}${sort.detail ? ` — ${sort.detail}` : ''}) ` +
        `accounts for ~${cost.toFixed(1)}% of estimated cost` +
        `${sort.estimatedRows ? ` over ~${sort.estimatedRows} rows` : ''}. ` +
        `Explicit sorts often dominate runtime and may spill to disk.`,
      suggestion: sqlHints.hasLimit
        ? `If you only need top-N rows, ensure LIMIT is present (it is) and consider an index on (${cols.join(', ')}) matching ORDER BY so the engine can avoid a full sort.`
        : `Add LIMIT if the client only needs a page of rows, and/or create an index matching ORDER BY (${cols.join(', ')}) to allow an index-ordered scan.`,
      why:
        `This recommendation is anchored on sort node ${sort.id} with cost share ${cost.toFixed(1)}%. ` +
        `An ordered index can replace “sort entire input” with “scan already ordered keys”, ` +
        `removing this operator or shrinking its input.`,
      estimatedImprovement: {
        summary: `${Math.round(cost * 0.5)}–${Math.round(cost * 0.95)}% of plan cost removable if sort is avoided`,
        costReductionPercentMin: Math.round(cost * 0.5),
        costReductionPercentMax: Math.min(95, Math.round(cost * 0.95)),
        confidence: orderCols.length ? 'medium' : 'low',
        speedupLabel: cost >= 30 ? 'Major' : 'Meaningful',
      },
      planReferences: [toPlanRef(sort)],
      ddl:
        orderCols.length > 0
          ? `CREATE INDEX idx_${table}_${cols.join('_')} ON ${table} (${cols.join(', ')});`
          : undefined,
      tags: ['sort', 'order-by', 'performance'],
    });

    // Rewrite: sort without limit
    if (sqlHints.hasOrderBy && !sqlHints.hasLimit && (sort.isExpensive || cost >= 15)) {
      recs.push({
        id: uuid(),
        type: 'rewrite',
        severity: 'medium',
        title: 'ORDER BY without LIMIT forces full sort in the plan',
        problem:
          `SQL includes ORDER BY but no LIMIT, and the plan still pays for sort node “${sort.label}” ` +
          `at ~${cost.toFixed(0)}% cost — every qualifying row is ordered.`,
        suggestion:
          'If the application only displays a page of results, add LIMIT (and keyset pagination). ' +
          'That can enable top-N heapsort and reduce work under this sort operator.',
        why:
          `Plan evidence: sort operator ${sort.id} remains costly. LIMIT does not always remove sorts, ` +
          `but it often changes the sort strategy and reduces memory/I/O for this node.`,
        estimatedImprovement: {
          summary: 'Top-N with LIMIT often cuts sort cost dramatically when N ≪ input size',
          costReductionPercentMin: Math.round(cost * 0.3),
          costReductionPercentMax: Math.round(cost * 0.85),
          confidence: 'medium',
          speedupLabel: 'Depends on N',
        },
        planReferences: [toPlanRef(sort)],
        sqlBefore: trimSql(ctx.analysis.sql),
        sqlAfter: appendLimit(trimSql(ctx.analysis.sql), 100),
        tags: ['rewrite', 'sort', 'limit'],
      });
    }

    // Sort after sequential scan of same pipeline
    const relatedScans = sequentialScans.filter((s) => s.costPercent >= 5);
    if (relatedScans.length && sort.isExpensive) {
      recs.push({
        id: uuid(),
        type: 'anti-pattern',
        severity: 'high',
        title: 'Sort fed by sequential scan(s)',
        problem:
          `Expensive sort “${sort.label}” sits above sequential scan(s) in the plan. ` +
          `The engine reads broadly, then sorts — a common O(n log n) hotspot.`,
        suggestion:
          `Create a composite index that supports both filter/join predicates and ORDER BY ` +
          `(${cols.join(', ')}) so the plan can use an ordered index scan instead of scan+sort.`,
        why:
          `Referenced plan nodes: sort ${sort.id} (~${cost.toFixed(0)}%) and scan(s) ` +
          `${relatedScans.map((s) => s.id).join(', ')}. Removing either stage multiplies savings.`,
        estimatedImprovement: {
          summary: 'Eliminating scan+sort pipeline can outperform either fix alone',
          costReductionPercentMin: Math.round((cost + relatedScans[0].costPercent) * 0.25),
          costReductionPercentMax: Math.min(
            90,
            Math.round((cost + relatedScans[0].costPercent) * 0.7)
          ),
          confidence: 'medium',
        },
        planReferences: [toPlanRef(sort), ...relatedScans.slice(0, 2).map(toPlanRef)],
        tags: ['anti-pattern', 'sort', 'scan'],
      });
    }
  }

  return recs;
}

function trimSql(sql: string): string {
  return sql.trim().replace(/;\s*$/, '');
}

function appendLimit(sql: string, n: number): string {
  if (/\bLIMIT\b/i.test(sql)) return sql + ';';
  return `${sql}\nLIMIT ${n};`;
}
