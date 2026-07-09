import mysql from 'mysql2/promise';
import { BaseDriver, DEFAULT_MAX_ROWS } from './base.js';
import type { ColumnMeta, QueryResult, SchemaInfo } from '../types/index.js';
import type { RawExplainResult } from '../types/analysis.js';

export class MysqlDriver extends BaseDriver {
  private pool: mysql.Pool | null = null;

  private buildConfig(): mysql.PoolOptions {
    return {
      host: this.config.host || 'localhost',
      port: this.config.port || 3306,
      database: this.config.database,
      user: this.config.user || 'root',
      password: this.config.password || '',
      ssl: this.config.ssl ? {} : undefined,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 8000,
    };
  }

  async connect(): Promise<void> {
    this.pool = mysql.createPool(this.buildConfig());
    const conn = await this.pool.getConnection();
    conn.release();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.connected = false;
  }

  async testConnection(): Promise<boolean> {
    if (!this.pool) await this.connect();
    await this.pool!.query('SELECT 1');
    return true;
  }

  async execute(sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
    if (!this.pool) await this.connect();
    const start = performance.now();
    const [rows, fields] = await this.pool!.query(sql);
    const elapsed = performance.now() - start;

    if (Array.isArray(fields) && fields.length > 0 && Array.isArray(rows)) {
      const columns: ColumnMeta[] = (fields as mysql.FieldPacket[]).map((f) => ({
        name: f.name,
        type: String(f.type ?? 'unknown'),
      }));
      const normalized = (rows as Record<string, unknown>[]).map((r) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          out[k] = this.normalizeValue(v);
        }
        return out;
      });
      return this.buildResult(columns, normalized, Math.round(elapsed * 100) / 100, maxRows);
    }

    const resultHeader = rows as mysql.ResultSetHeader;
    return {
      columns: [
        { name: 'affectedRows', type: 'integer' },
        { name: 'insertId', type: 'integer' },
      ],
      rows: [
        {
          affectedRows: resultHeader.affectedRows ?? 0,
          insertId: resultHeader.insertId ?? 0,
        },
      ],
      rowCount: 1,
      executionTimeMs: Math.round(elapsed * 100) / 100,
      truncated: false,
    };
  }

  async getSchema(): Promise<SchemaInfo> {
    if (!this.pool) await this.connect();
    const db = this.config.database;
    if (!db) throw new Error('MySQL connection requires a database name');

    const [tableRows] = await this.pool!.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [db]
    );

    const tables = [];
    for (const t of tableRows) {
      const [cols] = await this.pool!.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [db, t.name]
      );
      tables.push({
        name: t.name as string,
        columns: cols.map((c) => ({
          name: c.name as string,
          type: c.type as string,
          nullable: c.nullable === 'YES',
        })),
      });
    }

    return { tables, engine: 'mysql' };
  }

  async getExplainPlan(sql: string): Promise<RawExplainResult> {
    if (!this.pool) await this.connect();
    const statement = this.stripTrailingSemicolon(sql);
    const [rows] = await this.pool!.query(`EXPLAIN FORMAT=JSON ${statement}`);
    const list = rows as mysql.RowDataPacket[];
    let payload: unknown = list;

    // MySQL returns [{ EXPLAIN: "<json string>" }]
    if (Array.isArray(list) && list[0] && 'EXPLAIN' in list[0]) {
      const raw = list[0].EXPLAIN;
      if (typeof raw === 'string') {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = raw;
        }
      } else {
        payload = raw;
      }
    }

    return {
      engine: 'mysql',
      format: 'json',
      payload,
    };
  }
}
