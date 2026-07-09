import Database from 'better-sqlite3';
import path from 'node:path';
import { BaseDriver, DEFAULT_MAX_ROWS } from './base.js';
import type { ColumnMeta, QueryResult, SchemaInfo } from '../types/index.js';
import type { RawExplainResult } from '../types/analysis.js';
import type { CatalogColumn, ObjectDetails, SchemaCatalog } from '../types/schema.js';
import { buildObjectDetails } from '../schema/objectDetails.js';

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


  async getCatalog(): Promise<SchemaCatalog> {
    if (!this.db) await this.connect();
    const db = this.db!;

    const tableRows = db
      .prepare(
        `SELECT name, type, sql FROM sqlite_master
         WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
         ORDER BY type, name`
      )
      .all() as { name: string; type: string; sql: string | null }[];

    const objects = [];
    const allFks = [];
    const allIndexes = [];
    const allConstraints = [];

    for (const t of tableRows) {
      const kind = t.type === 'view' ? 'view' : 'table';
      const colsRaw = db.prepare(`PRAGMA table_info(${quoteIdent(t.name)})`).all() as {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }[];

      const columns: CatalogColumn[] = colsRaw.map((c) => ({
        name: c.name,
        type: c.type || 'TEXT',
        nullable: c.notnull === 0 && c.pk === 0,
        defaultValue: c.dflt_value === undefined ? null : String(c.dflt_value),
        isPrimaryKey: c.pk > 0,
        ordinal: c.cid,
      }));

      let rowCount: number | null = null;
      try {
        const r = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(t.name)}`).get() as { c: number };
        rowCount = Number(r.c);
      } catch {
        rowCount = null;
      }

      objects.push({
        id: `${kind}:${t.name}`,
        name: t.name,
        kind: kind as 'table' | 'view',
        columns,
        rowCount,
      });

      // PK constraint
      const pkCols = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
      if (pkCols.length) {
        allConstraints.push({
          id: `pk-${t.name}`,
          name: `${t.name}_pkey`,
          tableName: t.name,
          type: 'PRIMARY KEY' as const,
          columns: pkCols,
          definition: `PRIMARY KEY (${pkCols.join(', ')})`,
        });
      }

      // Foreign keys
      if (kind === 'table') {
        const fks = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(t.name)})`).all() as {
          id: number;
          seq: number;
          table: string;
          from: string;
          to: string;
          on_update: string;
          on_delete: string;
        }[];
        const byId = new Map<number, typeof fks>();
        for (const fk of fks) {
          if (!byId.has(fk.id)) byId.set(fk.id, []);
          byId.get(fk.id)!.push(fk);
        }
        for (const [id, parts] of byId) {
          parts.sort((a, b) => a.seq - b.seq);
          const fkMeta = {
            id: `fk-${t.name}-${id}`,
            name: `fk_${t.name}_${parts[0].table}_${id}`,
            fromTable: t.name,
            fromColumns: parts.map((p) => p.from),
            toTable: parts[0].table,
            toColumns: parts.map((p) => p.to),
            onUpdate: parts[0].on_update,
            onDelete: parts[0].on_delete,
          };
          allFks.push(fkMeta);
          allConstraints.push({
            id: `chk-fk-${t.name}-${id}`,
            name: fkMeta.name!,
            tableName: t.name,
            type: 'FOREIGN KEY' as const,
            columns: fkMeta.fromColumns,
            definition: `FOREIGN KEY (${fkMeta.fromColumns.join(', ')}) REFERENCES ${fkMeta.toTable}(${fkMeta.toColumns.join(', ')})`,
          });
        }

        // Indexes
        const idxList = db.prepare(`PRAGMA index_list(${quoteIdent(t.name)})`).all() as {
          name: string;
          unique: number;
          origin: string;
          partial: number;
        }[];
        for (const idx of idxList) {
          const info = db.prepare(`PRAGMA index_info(${quoteIdent(idx.name)})`).all() as {
            seqno: number;
            name: string;
          }[];
          info.sort((a, b) => a.seqno - b.seqno);
          const columnsIdx = info.map((i) => i.name).filter(Boolean);
          allIndexes.push({
            id: `idx-${idx.name}`,
            name: idx.name,
            tableName: t.name,
            columns: columnsIdx,
            unique: idx.unique === 1,
            primary: idx.origin === 'pk',
          });
          if (idx.unique === 1 && idx.origin !== 'pk') {
            allConstraints.push({
              id: `uq-${idx.name}`,
              name: idx.name,
              tableName: t.name,
              type: 'UNIQUE' as const,
              columns: columnsIdx,
              definition: `UNIQUE (${columnsIdx.join(', ')})`,
            });
          }
        }
      }
    }

    return {
      engine: 'sqlite',
      objects,
      foreignKeys: allFks,
      indexes: allIndexes,
      constraints: allConstraints,
      graph: this.buildGraph(objects, allFks),
      discoveredAt: new Date().toISOString(),
    };
  }

  async getObjectDetails(name: string, kind: 'table' | 'view' = 'table'): Promise<ObjectDetails> {
    const catalog = await this.getCatalog();
    const obj = catalog.objects.find((o) => o.name === name);
    if (!obj) throw new Error(`Object not found: ${name}`);

    let definition: string | null = null;
    if (this.db) {
      const row = this.db
        .prepare(`SELECT sql FROM sqlite_master WHERE name = ?`)
        .get(name) as { sql: string | null } | undefined;
      definition = row?.sql ?? null;
    }

    return buildObjectDetails(this, {
      name,
      kind: obj.kind,
      columns: obj.columns,
      foreignKeys: catalog.foreignKeys.filter(
        (fk) => fk.fromTable === name || fk.toTable === name
      ),
      indexes: catalog.indexes.filter((i) => i.tableName === name),
      constraints: catalog.constraints.filter((c) => c.tableName === name),
      definition,
    });
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
