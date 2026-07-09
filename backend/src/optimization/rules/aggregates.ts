import { v4 as uuid } from 'uuid';
import type { OptimizationRecommendation } from '../../types/optimization.js';
import { type PlanContext, toPlanRef } from '../planContext.js';

export function ruleAggregates(ctx: PlanContext): OptimizationRecommendation[] {
  const recs: OptimizationRecommendation[] = [];
  const { aggregates, sorts, sequentialScans, sqlHints } = ctx;

  for (const agg of aggregates) {
    if (agg.costPercent < 8 && !agg.isExpensive) continue;

    const cost = agg.costPercent;
    const groupCols = sqlHints.groupByColumns;
    const table = sqlHints.tables[0] || 'table_name';

    // Temp B-tree / filesort style grouping often co-occurs with sort nodes
    const usesTemp =
      /temp|b-tree|filesort|external/i.test(agg.operator + ' ' + (agg.detail || '') + ' ' + agg.label) ||
      sorts.some((s) => /group|temp/i.test(s.detail || ''));

    if (groupCols.length > 0) {
      recs.push({
        id: uuid(),
        type: 'index',
        severity: cost >= 20 || agg.isExpensive ? 'high' : 'medium',
        title: `Aggregation hotspot (~${cost.toFixed(0)}%) — index GROUP BY keys`,
        problem:
          `Aggregate operator “${agg.label}” uses ~${cost.toFixed(1)}% of plan cost` +
          `${usesTemp ? ' and appears to materialize/sort for grouping' : ''}.`,
        suggestion: `CREATE INDEX on (${groupCols.join(', ')}) to support group aggregation or ordered grouping without a full sort.`,
        why:
          `Plan node ${agg.id} is an aggregate with material cost share. ` +
          `An index on group keys can turn hash/sort aggregation into a cheaper ordered group or reduce build size.`,
        estimatedImprovement: {
          summary: `${Math.round(cost * 0.25)}–${Math.round(cost * 0.7)}% plan cost reduction when grouping is index-backed`,
          costReductionPercentMin: Math.round(cost * 0.25),
          costReductionPercentMax: Math.round(cost * 0.7),
          confidence: 'medium',
        },
        planReferences: [toPlanRef(agg)],
        ddl: `CREATE INDEX idx_${table}_grp_${groupCols.join('_')} ON ${table} (${groupCols.join(', ')});`,
        tags: ['aggregate', 'group-by', 'index'],
      });
    }

    // Aggregate over sequential scan without prior filter
    const bigScan = sequentialScans.find((s) => s.costPercent >= 10 || s.isExpensive);
    if (bigScan && (agg.isExpensive || cost >= 12)) {
      recs.push({
        id: uuid(),
        type: 'anti-pattern',
        severity: 'high',
        title: 'Aggregate over a wide sequential scan',
        problem:
          `The plan aggregates via “${agg.label}” after sequential scan “${bigScan.label}” ` +
          `(scan ~${bigScan.costPercent.toFixed(0)}%, agg ~${cost.toFixed(0)}%). ` +
          `All scanned rows enter aggregation.`,
        suggestion:
          'Push selective filters before aggregation, and index filter + group columns so fewer rows reach the aggregate node.',
        why:
          `Plan path references scan ${bigScan.id} and aggregate ${agg.id}. ` +
          `Reducing rows into the aggregate cuts both operators’ cost.`,
        estimatedImprovement: {
          summary: 'Row reduction before aggregation multiplies savings across both nodes',
          costReductionPercentMin: Math.round((cost + bigScan.costPercent) * 0.2),
          costReductionPercentMax: Math.min(
            80,
            Math.round((cost + bigScan.costPercent) * 0.6)
          ),
          confidence: 'medium',
          speedupLabel: 'High with selective WHERE',
        },
        planReferences: [toPlanRef(agg), toPlanRef(bigScan)],
        tags: ['anti-pattern', 'aggregate', 'scan'],
      });
    }
  }

  // DISTINCT without limit
  if (sqlHints.hasDistinct && !sqlHints.hasLimit) {
    const refNodes = [...aggregates, ...sorts].filter((n) => n.costPercent >= 5);
    if (refNodes.length) {
      recs.push({
        id: uuid(),
        type: 'rewrite',
        severity: 'medium',
        title: 'DISTINCT may force extra sort/aggregate work in the plan',
        problem: `SELECT DISTINCT is present and plan nodes ${refNodes.map((n) => n.label).join(', ')} show grouping/sort cost.`,
        suggestion:
          'Prefer GROUP BY when computing aggregates, or ensure DISTINCT columns are indexed. Remove DISTINCT if uniqueness is already guaranteed.',
        why: `Plan evidence from nodes: ${refNodes.map((n) => n.id).join(', ')}. DISTINCT is not free — it often adds sort or hash unique operators.`,
        estimatedImprovement: {
          summary: 'Removing unnecessary DISTINCT can drop unique/sort operators entirely',
          costReductionPercentMin: 5,
          costReductionPercentMax: Math.round(
            refNodes.reduce((s, n) => s + n.costPercent, 0) * 0.5
          ),
          confidence: 'low',
        },
        planReferences: refNodes.map(toPlanRef),
        tags: ['rewrite', 'distinct'],
      });
    }
  }

  return recs;
}
