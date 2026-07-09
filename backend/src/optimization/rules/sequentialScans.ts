import { v4 as uuid } from 'uuid';
import type { OptimizationRecommendation } from '../../types/optimization.js';
import {
  type PlanContext,
  extractTableName,
  toPlanRef,
} from '../planContext.js';

/**
 * Full/sequential scans that dominate cost → index suggestions grounded in plan nodes.
 */
export function ruleSequentialScans(ctx: PlanContext): OptimizationRecommendation[] {
  const recs: OptimizationRecommendation[] = [];
  const { sequentialScans, sqlHints, analysis } = ctx;

  for (const scan of sequentialScans) {
    // Only flag scans that matter — expensive or non-trivial cost share
    if (scan.costPercent < 8 && !scan.isExpensive) continue;

    const table =
      extractTableName(scan) ||
      guessTableFromAlias(scan, sqlHints.tables) ||
      'target_table';

    const filterCols = sqlHints.whereColumns;
    const joinCols = sqlHints.joinColumns;
    const orderCols = sqlHints.orderByColumns;
    const groupCols = sqlHints.groupByColumns;

    // Prefer columns that appear in WHERE / JOIN for this table context
    const indexCols = unique([
      ...filterCols.slice(0, 2),
      ...joinCols.slice(0, 2),
      ...groupCols.slice(0, 1),
      ...orderCols.slice(0, 1),
    ]).slice(0, 3);

    const cols = indexCols.length ? indexCols : ['<column>'];
    const indexName = `idx_${sanitize(table)}_${cols.map(sanitize).join('_')}`.slice(0, 60);
    const ddl = `CREATE INDEX ${indexName} ON ${table} (${cols.join(', ')});`;

    const costShare = scan.costPercent;
    const min = Math.min(60, Math.round(costShare * 0.35));
    const max = Math.min(85, Math.round(costShare * 0.75));

    recs.push({
      id: uuid(),
      type: 'index',
      severity: costShare >= 25 || scan.isExpensive ? 'high' : 'medium',
      title: `Sequential scan on “${table}” is a plan hotspot`,
      problem:
        `The execution plan spends ~${costShare.toFixed(0)}% of estimated cost on operator ` +
        `“${scan.label}” (${scan.operator}${scan.detail ? `: ${scan.detail}` : ''}), ` +
        `which is a sequential/full scan rather than an index lookup.`,
      suggestion:
        `Add an index on ${table}(${cols.join(', ')}) so the optimizer can replace this scan ` +
        `with an index search/seek when predicates or join keys match.`,
      why:
        `Plan node “${scan.label}” (id ${scan.id}) is classified as a sequential scan and ` +
        `${scan.isExpensive ? 'is marked expensive' : `contributes ${costShare.toFixed(1)}% of plan cost`}. ` +
        `Indexes convert full reads into selective lookups, cutting I/O for this operator and ` +
        `often reducing rows fed into upstream joins/aggregates.`,
      estimatedImprovement: {
        summary: `${min}–${max}% reduction in this scan’s share of plan cost (when predicates are selective)`,
        costReductionPercentMin: min,
        costReductionPercentMax: max,
        confidence: indexCols.length ? 'medium' : 'low',
        speedupLabel: costShare >= 30 ? 'High impact' : 'Moderate impact',
      },
      planReferences: [toPlanRef(scan)],
      ddl,
      tags: ['scan', 'index', 'seq-scan', table],
    });

    // Anti-pattern: expensive full scan under a selective-looking WHERE
    if (filterCols.length > 0 && (scan.isExpensive || costShare >= 15)) {
      recs.push({
        id: uuid(),
        type: 'anti-pattern',
        severity: 'high',
        title: 'Filter predicate not pushed into an index access path',
        problem:
          `SQL filters on (${filterCols.join(', ')}) but the plan still uses sequential scan ` +
          `“${scan.label}” at ~${costShare.toFixed(0)}% cost — the predicate is applied after ` +
          `(or without) a selective access path.`,
        suggestion:
          `Ensure columns in WHERE are leading columns of an index used by this scan. ` +
          `Verify with EXPLAIN after creating: ${ddl}`,
        why:
          `Referencing plan node ${scan.id}: a sequential scan with non-trivial cost while ` +
          `filter columns exist indicates the engine could not pick an index. That is a classic ` +
          `anti-pattern for growing tables.`,
        estimatedImprovement: {
          summary: `Could eliminate most of the ${costShare.toFixed(0)}% scan cost if selectivity is high`,
          costReductionPercentMin: Math.round(costShare * 0.4),
          costReductionPercentMax: Math.round(costShare * 0.9),
          confidence: 'medium',
          speedupLabel: 'Often dramatic on large tables',
        },
        planReferences: [toPlanRef(scan)],
        ddl,
        tags: ['anti-pattern', 'filter', 'scan'],
      });
    }
  }

  // Multiple sequential scans across the plan
  if (sequentialScans.length >= 2) {
    const refs = sequentialScans.filter((s) => s.costPercent >= 5 || s.isExpensive).map(toPlanRef);
    if (refs.length >= 2) {
      const total = sequentialScans.reduce((s, n) => s + n.costPercent, 0);
      recs.push({
        id: uuid(),
        type: 'warning',
        severity: total >= 40 ? 'high' : 'medium',
        title: `${sequentialScans.length} sequential scans in one plan`,
        problem:
          `The plan contains ${sequentialScans.length} sequential/full scans ` +
          `(combined ~${total.toFixed(0)}% estimated cost). Each may grow linearly with table size.`,
        suggestion:
          'Review each scan node below and add indexes for join keys and filter columns involved.',
        why:
          'Multiple full scans compound I/O. Plan cost shares show which scans dominate; ' +
          'optimize the highest % nodes first.',
        estimatedImprovement: {
          summary: `Indexing the top scans could reclaim ~${Math.round(total * 0.3)}–${Math.round(total * 0.7)}% of plan cost`,
          costReductionPercentMin: Math.round(total * 0.3),
          costReductionPercentMax: Math.round(total * 0.7),
          confidence: 'medium',
        },
        planReferences: refs.slice(0, 6),
        tags: ['scan', 'warning', 'scale'],
      });
    }
  }

  void analysis;
  return dedupeByTitle(recs);
}

function guessTableFromAlias(
  scan: { detail?: string },
  tables: string[]
): string | null {
  const d = scan.detail || '';
  const alias = d.match(/\bSCAN\s+(\w+)/i)?.[1];
  if (alias && tables.length === 1) return tables[0];
  // common sample aliases
  const map: Record<string, string> = {
    c: 'customers',
    o: 'orders',
    p: 'products',
    oi: 'order_items',
    u: 'users',
    e: 'events',
    s: 'sessions',
  };
  if (alias && map[alias.toLowerCase()]) return map[alias.toLowerCase()];
  return tables[0] || null;
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

function sanitize(s: string): string {
  return s.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').toLowerCase() || 'col';
}

function dedupeByTitle(recs: OptimizationRecommendation[]): OptimizationRecommendation[] {
  const seen = new Set<string>();
  return recs.filter((r) => {
    const key = r.title + r.ddl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
