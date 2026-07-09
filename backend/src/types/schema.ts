import type { DatabaseEngine, QueryResult } from './index.js';

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
  /** Approximate / exact row count when cheap to compute */
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
  graph: {
    nodes: SchemaGraphNode[];
    edges: SchemaGraphEdge[];
  };
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
