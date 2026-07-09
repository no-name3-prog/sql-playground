import duckdb from 'duckdb';
import path from 'node:path';
import { BaseDriver, DEFAULT_MAX_ROWS } from './base.js';
import type { ColumnMeta, QueryResult, SchemaInfo } from '../types/index.js';
import type { RawExplainResult } from '../types/analysis.js';
import type { ObjectDetails, SchemaCatalog } from '../types/schema.js';
import { buildObjectDetails } from '../schema/objectDetails.js';

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


  async getCatalog(): Promise<SchemaCatalog> {
    if (!this.conn) await this.connect();
    const { rows: tableRows } = await runQuery<{
      table_name: string;
      table_type: string;
    }>(
      this.conn!,
      `SELECT table_name, table_type FROM information_schema.tables
       WHERE table_schema = 'main'
       ORDER BY table_type, table_name`
    );

    const objects: import('../types/schema.js').CatalogObject[] = [];
    const foreignKeys: import('../types/schema.js').ForeignKeyMeta[] = [];
    const indexes: import('../types/schema.js').IndexMeta[] = [];
    const constraints: import('../types/schema.js').ConstraintMeta[] = [];

    for (const t of tableRows) {
      const kind = /view/i.test(t.table_type) ? 'view' : 'table';
      const { rows: cols } = await runQuery<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
        ordinal_position: number;
      }>(
        this.conn!,
        `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
         FROM information_schema.columns
         WHERE table_schema = 'main' AND table_name = '${t.table_name.replace(/'/g, "''")}'
         ORDER BY ordinal_position`
      );

      // PKs via duckdb_constraints if available
      let pkCols: string[] = [];
      try {
        const { rows: pks } = await runQuery<{ column_names: string[] | string }>(
          this.conn!,
          `SELECT constraint_column_names AS column_names FROM duckdb_constraints()
           WHERE table_name = '${t.table_name.replace(/'/g, "''")}' AND constraint_type = 'PRIMARY KEY'`
        );
        if (pks[0]) {
          const raw = pks[0].column_names;
          pkCols = Array.isArray(raw) ? raw.map(String) : String(raw).replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
        }
      } catch {
        /* optional */
      }

      const columns = cols.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        defaultValue: c.column_default,
        isPrimaryKey: pkCols.includes(c.column_name),
        ordinal: Number(c.ordinal_position),
      }));

      let rowCount: number | null = null;
      try {
        const { rows } = await runQuery<{ c: number }>(
          this.conn!,
          `SELECT COUNT(*) AS c FROM "${t.table_name.replace(/"/g, '""')}"`
        );
        rowCount = Number(rows[0]?.c);
      } catch {
        rowCount = null;
      }

      objects.push({
        id: `${kind}:${t.table_name}`,
        name: t.table_name,
        kind: kind as 'table' | 'view',
        columns,
        rowCount,
      });

      if (pkCols.length) {
        constraints.push({
          id: `pk-${t.table_name}`,
          name: `${t.table_name}_pkey`,
          tableName: t.table_name,
          type: 'PRIMARY KEY' as const,
          columns: pkCols,
        });
      }
    }

    // Foreign keys via duckdb_constraints
    try {
      const { rows: fks } = await runQuery<Record<string, unknown>>(
        this.conn!,
        `SELECT * FROM duckdb_constraints() WHERE constraint_type = 'FOREIGN KEY'`
      );
      fks.forEach((row, i) => {
        const table = String(row.table_name || '');
        const refTable = String(row.referenced_table || row.referenced_table_name || '');
        const fromCols = normalizeCols(row.constraint_column_names || row.column_names);
        const toCols = normalizeCols(row.referenced_column_names || row.referenced_columns);
        if (!table || !refTable) return;
        const id = `fk-${table}-${i}`;
        foreignKeys.push({
          id,
          name: String(row.constraint_name || id),
          fromTable: table,
          fromColumns: fromCols,
          toTable: refTable,
          toColumns: toCols,
        });
        constraints.push({
          id: `cfk-${id}`,
          name: String(row.constraint_name || id),
          tableName: table,
          type: 'FOREIGN KEY' as const,
          columns: fromCols,
        });
      });
    } catch {
      /* no FK catalog */
    }

    // Indexes
    try {
      const { rows: idxs } = await runQuery<Record<string, unknown>>(
        this.conn!,
        `SELECT * FROM duckdb_indexes()`
      );
      idxs.forEach((row, i) => {
        const tableName = String(row.table_name || '');
        const name = String(row.index_name || `idx_${i}`);
        indexes.push({
          id: `idx-${name}`,
          name,
          tableName,
          columns: normalizeCols(row.column_names || row.expressions),
          unique: Boolean(row.is_unique || row.unique),
          primary: Boolean(row.is_primary || row.primary),
        });
      });
    } catch {
      /* optional */
    }

    return {
      engine: 'duckdb',
      objects,
      foreignKeys,
      indexes,
      constraints,
      graph: this.buildGraph(objects, foreignKeys),
      discoveredAt: new Date().toISOString(),
    };
  }

  async getObjectDetails(name: string, _kind: 'table' | 'view' = 'table'): Promise<ObjectDetails> {
    const catalog = await this.getCatalog();
    const obj = catalog.objects.find((o) => o.name === name);
    if (!obj) throw new Error(`Object not found: ${name}`);
    return buildObjectDetails(this, {
      name,
      kind: obj.kind,
      columns: obj.columns,
      foreignKeys: catalog.foreignKeys.filter((fk) => fk.fromTable === name || fk.toTable === name),
      indexes: catalog.indexes.filter((i) => i.tableName === name),
      constraints: catalog.constraints.filter((c) => c.tableName === name),
    });
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

function normalizeCols(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  const s = String(v).replace(/^[{\[]|[}\]]$/g, '');
  return s.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}
