import type { DatabaseEngine } from './index.js';

/** High-level operator categories used for coloring and filtering. */
export type OperatorCategory =
  | 'scan'
  | 'join'
  | 'sort'
  | 'aggregate'
  | 'filter'
  | 'project'
  | 'limit'
  | 'materialize'
  | 'modify'
  | 'other';

export interface PlanNode {
  id: string;
  /** Short display name, e.g. "Hash Join" */
  label: string;
  /** Raw engine operator string */
  operator: string;
  category: OperatorCategory;
  /** Table, index, condition, etc. */
  detail?: string;
  /** Plain-English description of this operator */
  explanation: string;
  /** Relative cost units (engine-native or estimated) */
  estimatedCost: number;
  estimatedRows?: number;
  /** Actual time when EXPLAIN ANALYZE is available */
  actualTimeMs?: number;
  /** Share of total plan cost (0–100) */
  costPercent: number;
  /** True when this node is among the dominant cost contributors */
  isExpensive: boolean;
  children: PlanNode[];
  metadata: Record<string, unknown>;
  depth: number;
  /** Number of nodes in this subtree (inclusive) */
  subtreeSize: number;
}

export interface ExpensiveOperator {
  id: string;
  label: string;
  category: OperatorCategory;
  costPercent: number;
  estimatedCost: number;
  explanation: string;
  detail?: string;
}

export interface QueryAnalysis {
  engine: DatabaseEngine;
  sql: string;
  root: PlanNode;
  totalEstimatedCost: number;
  totalNodes: number;
  maxDepth: number;
  expensiveNodes: ExpensiveOperator[];
  /** High-level narrative of the plan */
  summary: string;
  warnings: string[];
  /** Category counts for legend / filters */
  categoryCounts: Partial<Record<OperatorCategory, number>>;
  rawPlan: unknown;
  analyzedAt: string;
}

export interface RawExplainResult {
  engine: DatabaseEngine;
  format: 'json' | 'text' | 'rows';
  payload: unknown;
}
