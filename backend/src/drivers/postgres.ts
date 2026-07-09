import pg from 'pg';
import { BaseDriver, DEFAULT_MAX_ROWS } from './base.js';
import type { ColumnMeta, QueryResult, SchemaInfo } from '../types/index.js';
import type { RawExplainResult } from '../types/analysis.js';

const { Client } = pg;

export class PostgresDriver extends BaseDriver {
  private client: pg.Client | null = null;

  private buildClientConfig(): pg.ClientConfig {
    return {
      host: this.config.host || 'localhost',
      port: this.config.port || 5432,
      database: this.config.database || 'postgres',
      user: this.config.user || 'postgres',
      password: this.config.password || '',
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 8000,
      statement_timeout: 30000,
    };
  }

  async connect(): Promise<void> {
    this.client = new Client(this.buildClientConfig());
    await this.client.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
    this.connected = false;
  }

  async testConnection(): Promise<boolean> {
    if (!this.client) await this.connect();
    await this.client!.query('SELECT 1');
    return true;
  }

  async execute(sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
    if (!this.client) await this.connect();
    const start = performance.now();
    const result = await this.client!.query(sql);
    const elapsed = performance.now() - start;

    const fields = result.fields || [];
    const columns: ColumnMeta[] = fields.map((f) => ({
      name: f.name,
      type: oidToType(f.dataTypeID),
    }));

    if (result.command && !fields.length) {
      return {
        columns: [
          { name: 'command', type: 'text' },
          { name: 'rowCount', type: 'integer' },
        ],
        rows: [{ command: result.command, rowCount: result.rowCount ?? 0 }],
        rowCount: 1,
        executionTimeMs: Math.round(elapsed * 100) / 100,
        truncated: false,
      };
    }

    const rows = (result.rows as Record<string, unknown>[]).map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        out[k] = this.normalizeValue(v);
      }
      return out;
    });

    return this.buildResult(columns, rows, Math.round(elapsed * 100) / 100, maxRows);
  }

  async getSchema(): Promise<SchemaInfo> {
    if (!this.client) await this.connect();
    const tablesRes = await this.client!.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );

    const tables = [];
    for (const t of tablesRes.rows) {
      const colsRes = await this.client!.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [t.table_name]
      );
      tables.push({
        name: t.table_name,
        columns: colsRes.rows.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
        })),
      });
    }

    return { tables, engine: 'postgresql' };
  }

  async getExplainPlan(sql: string): Promise<RawExplainResult> {
    if (!this.client) await this.connect();
    const statement = this.stripTrailingSemicolon(sql);
    // Estimated plan only (no ANALYZE) to avoid re-executing DML with side effects
    const result = await this.client!.query(`EXPLAIN (FORMAT JSON) ${statement}`);
    const payload = result.rows?.[0]?.['QUERY PLAN'] ?? result.rows;
    return {
      engine: 'postgresql',
      format: 'json',
      payload,
    };
  }
}

function oidToType(oid: number): string {
  const map: Record<number, string> = {
    16: 'boolean',
    20: 'bigint',
    21: 'smallint',
    23: 'integer',
    25: 'text',
    700: 'real',
    701: 'double',
    1043: 'varchar',
    1082: 'date',
    1114: 'timestamp',
    1184: 'timestamptz',
    1700: 'numeric',
    2950: 'uuid',
    3802: 'jsonb',
  };
  return map[oid] || `oid:${oid}`;
}
