import type { DatabaseEngine } from './index.js';
import type { OperatorCategory } from './analysis.js';

export type RecommendationType =
  | 'anti-pattern'
  | 'index'
  | 'rewrite'
  | 'warning';

export type RecommendationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface PlanReference {
  nodeId: string;
  label: string;
  category: OperatorCategory;
  costPercent: number;
  detail?: string;
  operator?: string;
}

export interface ImprovementEstimate {
  /** Human-readable range, e.g. "25–50% lower plan cost on large tables" */
  summary: string;
  /** Expected reduction in the referenced plan cost share (percentage points of total plan) */
  costReductionPercentMin: number;
  costReductionPercentMax: number;
  confidence: 'low' | 'medium' | 'high';
  /** Optional qualitative speedup label */
  speedupLabel?: string;
}

export interface OptimizationRecommendation {
  id: string;
  type: RecommendationType;
  severity: RecommendationSeverity;
  title: string;
  /** What is wrong / risky */
  problem: string;
  /** Concrete action to take */
  suggestion: string;
  /** Why this helps, tied to plan behavior */
  why: string;
  estimatedImprovement: ImprovementEstimate;
  /** Plan nodes this recommendation is grounded in (required) */
  planReferences: PlanReference[];
  sqlBefore?: string;
  sqlAfter?: string;
  /** Suggested DDL such as CREATE INDEX */
  ddl?: string;
  tags: string[];
}

export interface OptimizationReport {
  engine: DatabaseEngine;
  sql: string;
  generatedAt: string;
  /** Overall narrative from the assistant */
  summary: string;
  score: number; // 0–100 health score (higher = better)
  recommendations: OptimizationRecommendation[];
  antiPatternCount: number;
  indexSuggestionCount: number;
  rewriteCount: number;
  warningCount: number;
  /** Source of insights */
  mode: 'plan-rules' | 'plan-rules+llm';
}
