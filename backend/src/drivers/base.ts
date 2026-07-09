import type {
  ColumnMeta,
  ConnectionConfig,
  QueryResult,
  SchemaInfo,
  TableSchema,
} from '../types/index.js';
import type { RawExplainResult } from '../types/analysis.js';
import type { ObjectDetails, SchemaCatalog } from '../types/schema.js';

export const DEFAULT_MAX_ROWS = 1000;

export abstract class BaseDriver {
  protected config: ConnectionConfig;
  protected connected = false;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  get id(): string {
    return this.config.id;
  }

  get engine() {
    return this.config.engine;
  }

  get name(): string {
    return this.config.name;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract execute(sql: string, maxRows?: number): Promise<QueryResult>;
  abstract getSchema(): Promise<SchemaInfo>;
  abstract testConnection(): Promise<boolean>;
  abstract getExplainPlan(sql: string): Promise<RawExplainResult>;

  /** Full catalog for interactive schema explorer (tables, views, FKs, indexes, constraints, graph). */
  abstract getCatalog(): Promise<SchemaCatalog>;

  /** Metadata + sample rows + statistics for a table or view. */
  abstract getObjectDetails(name: string, kind?: 'table' | 'view'): Promise<ObjectDetails>;

  isConnected(): boolean {
    return this.connected;
  }

  protected buildResult(
    columns: ColumnMeta[],
    rows: Record<string, unknown>[],
    executionTimeMs: number,
    maxRows: number
  ): QueryResult {
    const truncated = rows.length > maxRows;
    const limited = truncated ? rows.slice(0, maxRows) : rows;
    return {
      columns,
      rows: limited,
      rowCount: limited.length,
      executionTimeMs,
      truncated,
    };
  }

  protected normalizeValue(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'bigint') return value.toString();
    if (Buffer.isBuffer(value)) return value.toString('hex');
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return String(value);
      }
    }
    return value;
  }

  protected rowsFromMatrix(
    columns: string[],
    matrix: unknown[][]
  ): Record<string, unknown>[] {
    return matrix.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = this.normalizeValue(row[i]);
      });
      return obj;
    });
  }

  protected stripTrailingSemicolon(sql: string): string {
    return sql.replace(/;\s*$/, '').trim();
  }

  protected quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  protected buildGraph(
    objects: { id: string; name: string; kind: 'table' | 'view'; columns: unknown[]; rowCount?: number | null }[],
    foreignKeys: { id: string; name?: string; fromTable: string; toTable: string; fromColumns: string[]; toColumns: string[] }[]
  ) {
    const nodes = objects.map((o) => ({
      id: o.id,
      label: o.name,
      kind: o.kind,
      columnCount: o.columns.length,
      rowCount: o.rowCount ?? null,
    }));
    const edges = foreignKeys.map((fk) => ({
      id: `edge-${fk.id}`,
      from: `table:${fk.fromTable}`,
      to: `table:${fk.toTable}`,
      label: `${fk.fromColumns.join(',')} → ${fk.toColumns.join(',')}`,
      fkId: fk.id,
    }));
    return { nodes, edges };
  }
}

export type { ColumnMeta, QueryResult, SchemaInfo, TableSchema };
