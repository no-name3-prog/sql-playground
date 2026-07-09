import type { QueryAnalysis } from '../types/analysis.js';
import type {
  OptimizationRecommendation,
  OptimizationReport,
  RecommendationSeverity,
} from '../types/optimization.js';
import { buildPlanContext } from './planContext.js';
import { runOptimizationRules } from './rules/index.js';
import { enhanceWithLlm } from './llmEnhance.js';

const SEVERITY_RANK: Record<RecommendationSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * AI optimization assistant grounded in the execution plan.
 * Every recommendation must include planReferences from the analyzed plan.
 */
export async function optimizeFromAnalysis(
  analysis: QueryAnalysis,
  options: { enableLlm?: boolean } = {}
): Promise<OptimizationReport> {
  const ctx = buildPlanContext(analysis);
  let recommendations = runOptimizationRules(ctx);

  // Drop any recommendation that lost plan grounding
  recommendations = recommendations.filter((r) => r.planReferences?.length > 0);

  let mode: OptimizationReport['mode'] = 'plan-rules';
  if (options.enableLlm !== false) {
    const enhanced = await enhanceWithLlm(analysis, recommendations);
    if (enhanced) {
      recommendations = enhanced.filter((r) => r.planReferences?.length > 0);
      mode = 'plan-rules+llm';
    }
  }

  recommendations = sortRecommendations(recommendations);

  const antiPatternCount = recommendations.filter((r) => r.type === 'anti-pattern').length;
  const indexSuggestionCount = recommendations.filter((r) => r.type === 'index').length;
  const rewriteCount = recommendations.filter((r) => r.type === 'rewrite').length;
  const warningCount = recommendations.filter((r) => r.type === 'warning').length;

  const score = computeHealthScore(analysis, recommendations);
  const summary = buildAssistantSummary(analysis, recommendations, score);

  return {
    engine: analysis.engine,
    sql: analysis.sql,
    generatedAt: new Date().toISOString(),
    summary,
    score,
    recommendations,
    antiPatternCount,
    indexSuggestionCount,
    rewriteCount,
    warningCount,
    mode,
  };
}

function sortRecommendations(
  recs: OptimizationRecommendation[]
): OptimizationRecommendation[] {
  return [...recs].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    const aCost = Math.max(...a.planReferences.map((p) => p.costPercent), 0);
    const bCost = Math.max(...b.planReferences.map((p) => p.costPercent), 0);
    return bCost - aCost;
  });
}

function computeHealthScore(
  analysis: QueryAnalysis,
  recs: OptimizationRecommendation[]
): number {
  // Diminishing penalties so overlapping tips do not always floor at 0
  let score = 100;
  const sorted = [...recs].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
  sorted.forEach((r, i) => {
    const decay = Math.max(0.35, 1 - i * 0.12);
    let penalty = 0;
    if (r.severity === 'critical') penalty = 18;
    else if (r.severity === 'high') penalty = 11;
    else if (r.severity === 'medium') penalty = 6;
    else if (r.severity === 'low') penalty = 2;
    score -= penalty * decay;
  });

  const hotScan = analysis.expensiveNodes.some((n) => n.category === 'scan');
  const hotSort = analysis.expensiveNodes.some((n) => n.category === 'sort');
  if (hotScan) score -= 4;
  if (hotSort) score -= 4;

  // Floor: even rough plans keep a readable score band
  return Math.max(12, Math.min(100, Math.round(score)));
}

function buildAssistantSummary(
  analysis: QueryAnalysis,
  recs: OptimizationRecommendation[],
  score: number
): string {
  if (recs.length === 0) {
    return (
      `Plan looks healthy (score ${score}/100) for this ${analysis.engine} query. ` +
      `${analysis.totalNodes} operators, max depth ${analysis.maxDepth}. ` +
      `No major anti-patterns detected from the execution plan. ` +
      `Continue monitoring as data volume grows — sequential scans and sorts become riskier at scale.`
    );
  }

  const top = recs[0];
  const parts = [
    `Optimization assistant reviewed the ${analysis.engine} execution plan ` +
      `(${analysis.totalNodes} operators) and found ${recs.length} recommendation` +
      `${recs.length === 1 ? '' : 's'} (health score ${score}/100).`,
    `Highest priority: “${top.title}” (severity ${top.severity}), grounded in plan node(s) ` +
      `${top.planReferences.map((p) => p.label).join(', ')}.`,
  ];

  const types = [
    recs.filter((r) => r.type === 'anti-pattern').length
      ? `${recs.filter((r) => r.type === 'anti-pattern').length} anti-pattern(s)`
      : null,
    recs.filter((r) => r.type === 'index').length
      ? `${recs.filter((r) => r.type === 'index').length} index suggestion(s)`
      : null,
    recs.filter((r) => r.type === 'rewrite').length
      ? `${recs.filter((r) => r.type === 'rewrite').length} rewrite(s)`
      : null,
    recs.filter((r) => r.type === 'warning').length
      ? `${recs.filter((r) => r.type === 'warning').length} warning(s)`
      : null,
  ].filter(Boolean);

  if (types.length) parts.push(`Includes ${types.join(', ')}.`);
  parts.push('Every suggestion references concrete plan operators and their cost share — not SQL heuristics alone.');

  return parts.join(' ');
}
