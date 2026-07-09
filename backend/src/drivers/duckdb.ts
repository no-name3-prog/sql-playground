import duckdb from 'duckdb';
import path from 'node:path';
import { BaseDriver, DEFAULT_MAX_ROWS } from './base.js';
import type { ColumnMeta, QueryResult, SchemaInfo } from '../types/index.js';
import type { RawExplainResult } from '../types/analysis.js';

function runQuery<T = unknown>(
  conn: duckdb.Connection,
  sql: string
): Promise<{ columns: { name: string; type: string }[]; rows: T[] }> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) return reject(err);
      const list = (rows || []) as Record<string, unknown>[];
      const columns =
        list.length > 0
          ? Object.keys(list[0]).map((name) => ({ name, type: 'unknown' }))
          : [];
      resolve({ columns, rows: list as T[] });
    });
  });
}

function runExec(conn: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export class DuckdbDriver extends BaseDriver {
  private db: duckdb.Database | null = null;
  private conn: duckdb.Connection | null = null;

  async connect(): Promise<void> {
    const filename = this.config.filename ?? ':memory:';
    const resolved =
      filename === ':memory:'
        ? ':memory:'
        : path.isAbsolute(filename)
          ? filename
          : path.resolve(process.cwd(), filename);

    await new Promise<void>((resolve, reject) => {
      this.db = new duckdb.Database(resolved, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.conn = this.db!.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.conn) {
        this.conn.close(() => {
          this.conn = null;
          if (this.db) {
            this.db.close(() => {
              this.db = null;
              resolve();
            });
          } else resolve();
        });
      } else if (this.db) {
        this.db.close(() => {
          this.db = null;
          resolve();
        });
      } else resolve();
    });
    this.connected = false;
  }

  async testConnection(): Promise<boolean> {
    if (!this.conn) await this.connect();
    await runQuery(this.conn!, 'SELECT 1 AS ok');
    return true;
  }

  async execute(sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
    if (!this.conn) await this.connect();
    const start = performance.now();
    const trimmed = sql.trim();

    // Detect SELECT-like vs DDL/DML
    const isQuery = /^\s*(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN|PRAGMA|CALL)\b/i.test(trimmed);

    if (isQuery) {
      const { columns, rows } = await runQuery<Record<string, unknown>>(this.conn!, trimmed);
      const normalized = rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          out[k] = this.normalizeValue(v);
        }
        return out;
      });
      const colMeta: ColumnMeta[] = columns.map((c) => ({ name: c.name, type: c.type }));
      // If empty result, try to get columns from LIMIT 0
      if (colMeta.length === 0) {
        try {
          const empty = await runQuery(this.conn!, `SELECT * FROM (${trimmed}) AS _q LIMIT 0`);
          empty.columns.forEach((c) => colMeta.push({ name: c.name, type: c.type }));
        } catch {
          /* ignore */
        }
      }
      const elapsed = performance.now() - start;
      return this.buildResult(colMeta, normalized, Math.round(elapsed * 100) / 100, maxRows);
    }

    await runExec(this.conn!, trimmed);
    const elapsed = performance.now() - start;
    return {
      columns: [{ name: 'status', type: 'varchar' }],
      rows: [{ status: 'OK' }],
      rowCount: 1,
      executionTimeMs: Math.round(elapsed * 100) / 100,
      truncated: false,
    };
  }

  async getSchema(): Promise<SchemaInfo> {
    if (!this.conn) await this.connect();
    const { rows: tables } = await runQuery<{ name: string }>(
      this.conn!,
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = 'main' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );

    const result = [];
    for (const t of tables) {
      const { rows: cols } = await runQuery<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        this.conn!,
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'main' AND table_name = '${t.name.replace(/'/g, "''")}'
         ORDER BY ordinal_position`
      );
      result.push({
        name: t.name,
        columns: cols.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
        })),
      });
    }

    return { tables: result, engine: 'duckdb' };
  }

  async getExplainPlan(sql: string): Promise<RawExplainResult> {
    if (!this.conn) await this.connect();
    const statement = this.stripTrailingSemicolon(sql);
    try {
      const { rows } = await runQuery(
        this.conn!,
        `EXPLAIN (FORMAT JSON) ${statement}`
      );
      return {
        engine: 'duckdb',
        format: 'json',
        payload: rows,
      };
    } catch {
      // Fallback to text plan
      const { rows } = await runQuery(this.conn!, `EXPLAIN ${statement}`);
      return {
        engine: 'duckdb',
        format: 'text',
        payload: rows,
      };
    }
  }
}
