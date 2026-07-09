export type DatabaseEngine = 'sqlite' | 'duckdb' | 'postgresql' | 'mysql';
export type Theme = 'dark' | 'light';

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

export interface ConnectionConfig {
  id: string;
  name: string;
  engine: DatabaseEngine;
  filename?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  isSample?: boolean;
  createdAt: string;
}

export interface ColumnMeta {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
  truncated: boolean;
}

export interface QueryError {
  message: string;
  code?: string;
  position?: number;
}

export interface PlanNode {
  id: string;
  label: string;
  operator: string;
  category: OperatorCategory;
  detail?: string;
  explanation: string;
  estimatedCost: number;
  estimatedRows?: number;
  actualTimeMs?: number;
  costPercent: number;
  isExpensive: boolean;
  children: PlanNode[];
  metadata: Record<string, unknown>;
  depth: number;
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
  summary: string;
  warnings: string[];
  categoryCounts: Partial<Record<OperatorCategory, number>>;
  rawPlan: unknown;
  analyzedAt: string;
}

export type RecommendationType = 'anti-pattern' | 'index' | 'rewrite' | 'warning';
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
  summary: string;
  costReductionPercentMin: number;
  costReductionPercentMax: number;
  confidence: 'low' | 'medium' | 'high';
  speedupLabel?: string;
}

export interface OptimizationRecommendation {
  id: string;
  type: RecommendationType;
  severity: RecommendationSeverity;
  title: string;
  problem: string;
  suggestion: string;
  why: string;
  estimatedImprovement: ImprovementEstimate;
  planReferences: PlanReference[];
  sqlBefore?: string;
  sqlAfter?: string;
  ddl?: string;
  tags: string[];
}

export interface OptimizationReport {
  engine: DatabaseEngine;
  sql: string;
  generatedAt: string;
  summary: string;
  score: number;
  recommendations: OptimizationRecommendation[];
  antiPatternCount: number;
  indexSuggestionCount: number;
  rewriteCount: number;
  warningCount: number;
  mode: 'plan-rules' | 'plan-rules+llm';
}

export interface ExecuteQueryResponse {
  success: boolean;
  result?: QueryResult;
  error?: QueryError;
  historyId?: string;
  analysis?: QueryAnalysis;
  analysisError?: string;
  optimization?: OptimizationReport;
  optimizationError?: string;
}

export interface HistoryEntry {
  id: string;
  connectionId: string;
  connectionName: string;
  engine: DatabaseEngine;
  sql: string;
  success: boolean;
  rowCount?: number;
  executionTimeMs?: number;
  errorMessage?: string;
  executedAt: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnMeta[];
}

export interface SchemaInfo {
  tables: TableSchema[];
  engine: DatabaseEngine;
}

export interface EditorTab {
  id: string;
  title: string;
  sql: string;
  connectionId: string | null;
  result: QueryResult | null;
  error: QueryError | null;
  analysis: QueryAnalysis | null;
  analysisError: string | null;
  optimization: OptimizationReport | null;
  optimizationError: string | null;
  isRunning: boolean;
  resultsView: 'results' | 'analysis' | 'optimize';
}

export interface CreateConnectionInput {
  name: string;
  engine: DatabaseEngine;
  filename?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}


export interface CatalogColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string | null;
  isPrimaryKey?: boolean;
  ordinal?: number;
}

export interface ForeignKeyMeta {
  id: string;
  name?: string;
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  onUpdate?: string;
  onDelete?: string;
}

export interface IndexMeta {
  id: string;
  name: string;
  tableName: string;
  columns: string[];
  unique: boolean;
  primary?: boolean;
}

export interface ConstraintMeta {
  id: string;
  name: string;
  tableName: string;
  type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK' | 'NOT NULL' | 'OTHER';
  definition?: string;
  columns?: string[];
}

export interface CatalogObject {
  id: string;
  name: string;
  kind: 'table' | 'view';
  columns: CatalogColumn[];
  rowCount?: number | null;
}

export interface SchemaGraphNode {
  id: string;
  label: string;
  kind: 'table' | 'view';
  columnCount: number;
  rowCount?: number | null;
}

export interface SchemaGraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  fkId: string;
}

export interface SchemaCatalog {
  engine: DatabaseEngine;
  objects: CatalogObject[];
  foreignKeys: ForeignKeyMeta[];
  indexes: IndexMeta[];
  constraints: ConstraintMeta[];
  graph: { nodes: SchemaGraphNode[]; edges: SchemaGraphEdge[] };
  discoveredAt: string;
}

export interface ColumnStats {
  name: string;
  nullCount?: number | null;
  distinctCount?: number | null;
  min?: unknown;
  max?: unknown;
}

export interface ObjectStatistics {
  rowCount?: number | null;
  columnCount: number;
  columns: ColumnStats[];
  indexCount?: number;
  foreignKeyCount?: number;
  constraintCount?: number;
}

export interface ObjectDetails {
  kind: 'table' | 'view';
  name: string;
  columns: CatalogColumn[];
  foreignKeys: ForeignKeyMeta[];
  indexes: IndexMeta[];
  constraints: ConstraintMeta[];
  definition?: string | null;
  statistics: ObjectStatistics;
  sample: QueryResult | null;
}
