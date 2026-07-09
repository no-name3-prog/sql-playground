import type { OptimizationRecommendation } from '../../types/optimization.js';
import type { PlanContext } from '../planContext.js';
import { ruleSequentialScans } from './sequentialScans.js';
import { ruleExpensiveSorts } from './expensiveSorts.js';
import { ruleJoins } from './joins.js';
import { ruleAggregates } from './aggregates.js';
import { ruleSelectStar } from './selectStar.js';
import { ruleFilters } from './filters.js';
import { ruleRedundantWork } from './redundantWork.js';

export type RuleFn = (ctx: PlanContext) => OptimizationRecommendation[];

const RULES: RuleFn[] = [
  ruleSequentialScans,
  ruleExpensiveSorts,
  ruleJoins,
  ruleAggregates,
  ruleSelectStar,
  ruleFilters,
  ruleRedundantWork,
];

export function runOptimizationRules(ctx: PlanContext): OptimizationRecommendation[] {
  const out: OptimizationRecommendation[] = [];
  for (const rule of RULES) {
    try {
      out.push(...rule(ctx));
    } catch (err) {
      console.warn('Optimization rule failed:', err);
    }
  }
  return out;
}
