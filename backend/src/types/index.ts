export type DatabaseEngine = 'sqlite' | 'duckdb' | 'postgresql' | 'mysql';

export interface ConnectionConfig {
  id: string;
  name: string;
  engine: DatabaseEngine;
  /** File path for sqlite/duckdb, or connection details for server DBs */
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

export interface ExecuteQueryRequest {
  connectionId: string;
  sql: string;
  maxRows?: number;
  /** When true (default), attach query analysis / execution plan */
  analyze?: boolean;
}

export interface ExecuteQueryResponse {
  success: boolean;
  result?: QueryResult;
  error?: QueryError;
  historyId?: string;
  analysis?: import('./analysis.js').QueryAnalysis;
  analysisError?: string;
  optimization?: import('./optimization.js').OptimizationReport;
  optimizationError?: string;
}

export interface AnalyzeQueryRequest {
  connectionId: string;
  sql: string;
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

export type {
  OperatorCategory,
  PlanNode,
  ExpensiveOperator,
  QueryAnalysis,
  RawExplainResult,
} from './analysis.js';

export type {
  OptimizationReport,
  OptimizationRecommendation,
  PlanReference,
  ImprovementEstimate,
  RecommendationType,
  RecommendationSeverity,
} from './optimization.js';
