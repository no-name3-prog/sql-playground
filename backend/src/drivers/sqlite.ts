import Database from 'better-sqlite3';
import path from 'node:path';
import { BaseDriver, DEFAULT_MAX_ROWS } from './base.js';
import type { ColumnMeta, QueryResult, SchemaInfo } from '../types/index.js';
import type { RawExplainResult } from '../types/analysis.js';

export class SqliteDriver extends BaseDriver {
  private db: Database.Database | null = null;

  async connect(): Promise<void> {
    const filename = this.config.filename;
    if (!filename) {
      throw new Error('SQLite connection requires a filename');
    }
    const resolved = path.isAbsolute(filename)
      ? filename
      : path.resolve(process.cwd(), filename);
    this.db = new Database(resolved, { readonly: false, fileMustExist: false });
    this.db.pragma('journal_mode = WAL');
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.connected = false;
  }

  async testConnection(): Promise<boolean> {
    if (!this.db) await this.connect();
    this.db!.prepare('SELECT 1').get();
    return true;
  }

  async execute(sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
    if (!this.db) await this.connect();
    const start = performance.now();
    const trimmed = sql.trim();

    // multi-statement: run all but return last result set if any
    const statements = this.splitStatements(trimmed);
    let lastResult: QueryResult | null = null;

    for (const statement of statements) {
      if (!statement.trim()) continue;
      const stmt = this.db!.prepare(statement);
      if (stmt.reader) {
        const rawRows = stmt.all() as Record<string, unknown>[];
        const inferred = this.inferColumnsFromStmt(stmt);
        const columns: ColumnMeta[] =
          inferred.length > 0
            ? inferred
            : rawRows.length > 0
              ? Object.keys(rawRows[0]).map((name) => ({ name, type: 'TEXT' }))
              : [];
        const rows = rawRows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(r)) {
            out[k] = this.normalizeValue(v);
          }
          return out;
        });
        const elapsed = performance.now() - start;
        lastResult = this.buildResult(columns, rows, Math.round(elapsed * 100) / 100, maxRows);
      } else {
        const info = stmt.run();
        const elapsed = performance.now() - start;
        lastResult = {
          columns: [
            { name: 'changes', type: 'integer' },
            { name: 'lastInsertRowid', type: 'integer' },
          ],
          rows: [
            {
              changes: info.changes,
              lastInsertRowid: Number(info.lastInsertRowid),
            },
          ],
          rowCount: 1,
          executionTimeMs: Math.round(elapsed * 100) / 100,
          truncated: false,
        };
      }
    }

    if (!lastResult) {
      throw new Error('No executable SQL statements found');
    }
    return lastResult;
  }

  async getSchema(): Promise<SchemaInfo> {
    if (!this.db) await this.connect();
    const tables = this.db!
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all() as { name: string }[];

    const result = [];
    for (const t of tables) {
      const cols = this.db!.prepare(`PRAGMA table_info(${quoteIdent(t.name)})`).all() as {
        name: string;
        type: string;
        notnull: number;
      }[];
      result.push({
        name: t.name,
        columns: cols.map((c) => ({
          name: c.name,
          type: c.type || 'TEXT',
          nullable: c.notnull === 0,
        })),
      });
    }

    return { tables: result, engine: 'sqlite' };
  }

  async getExplainPlan(sql: string): Promise<RawExplainResult> {
    if (!this.db) await this.connect();
    const statement = this.stripTrailingSemicolon(sql);
    // Use first statement only for multi-statement scripts
    const first = statement.split(';')[0]?.trim() || statement;
    const rows = this.db!.prepare(`EXPLAIN QUERY PLAN ${first}`).all();
    return {
      engine: 'sqlite',
      format: 'rows',
      payload: rows,
    };
  }

  private inferColumnsFromStmt(stmt: Database.Statement): ColumnMeta[] {
    try {
      const info = stmt.columns();
      return info.map((c) => ({ name: c.name, type: c.type || 'unknown' }));
    } catch {
      return [];
    }
  }

  private splitStatements(sql: string): string[] {
    // Simple split on ; outside of quotes — good enough for playground use
    const parts: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        current += ch;
      } else if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        current += ch;
      } else if (ch === ';' && !inSingle && !inDouble) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current);
    return parts;
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
