import pg from 'pg';
import { BaseDriver, DEFAULT_MAX_ROWS } from './base.js';
import type { ColumnMeta, QueryResult, SchemaInfo } from '../types/index.js';
import type { RawExplainResult } from '../types/analysis.js';
import type { ObjectDetails, SchemaCatalog } from '../types/schema.js';
import { buildObjectDetails } from '../schema/objectDetails.js';

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


  async getCatalog(): Promise<SchemaCatalog> {
    if (!this.client) await this.connect();
    const client = this.client!;

    const tablesRes = await client.query<{ table_name: string; table_type: string }>(
      `SELECT table_name, table_type FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_type, table_name`
    );

    const objects = [];
    for (const t of tablesRes.rows) {
      const kind = t.table_type === 'VIEW' ? 'view' : 'table';
      const colsRes = await client.query<{
        column_name: string; data_type: string; is_nullable: string;
        column_default: string | null; ordinal_position: number;
      }>(
        `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [t.table_name]
      );
      const pkRes = await client.query<{ column_name: string }>(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY kcu.ordinal_position`,
        [t.table_name]
      );
      const pk = new Set(pkRes.rows.map((r) => r.column_name));
      const columns = colsRes.rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        defaultValue: c.column_default,
        isPrimaryKey: pk.has(c.column_name),
        ordinal: c.ordinal_position,
      }));
      let rowCount: number | null = null;
      try {
        const r = await client.query(`SELECT COUNT(*)::bigint AS c FROM ${this.quoteIdent(t.table_name)}`);
        rowCount = Number(r.rows[0].c);
      } catch { rowCount = null; }
      objects.push({ id: `${kind}:${t.table_name}`, name: t.table_name, kind: kind as 'table'|'view', columns, rowCount });
    }

    const fkRes = await client.query<{
      constraint_name: string; table_name: string; column_name: string;
      foreign_table_name: string; foreign_column_name: string;
    }>(
      `SELECT tc.constraint_name, kcu.table_name, kcu.column_name,
              ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
       ORDER BY tc.constraint_name, kcu.ordinal_position`
    );
    const fkMap = new Map<string, { name: string; fromTable: string; toTable: string; fromColumns: string[]; toColumns: string[] }>();
    for (const r of fkRes.rows) {
      const key = r.constraint_name;
      if (!fkMap.has(key)) {
        fkMap.set(key, { name: r.constraint_name, fromTable: r.table_name, toTable: r.foreign_table_name, fromColumns: [], toColumns: [] });
      }
      const e = fkMap.get(key)!;
      e.fromColumns.push(r.column_name);
      e.toColumns.push(r.foreign_column_name);
    }
    const foreignKeys = [...fkMap.entries()].map(([name, v]) => ({
      id: `fk-${name}`, name: v.name, fromTable: v.fromTable, fromColumns: v.fromColumns,
      toTable: v.toTable, toColumns: v.toColumns,
    }));

    const idxRes = await client.query<{
      indexname: string; tablename: string; indexdef: string;
    }>(`SELECT indexname, tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'`);
    const indexes = idxRes.rows.map((r) => ({
      id: `idx-${r.indexname}`,
      name: r.indexname,
      tableName: r.tablename,
      columns: extractPgIndexCols(r.indexdef),
      unique: /unique/i.test(r.indexdef),
      primary: /_pkey\b/.test(r.indexname),
    }));

    const consRes = await client.query<{
      constraint_name: string; table_name: string; constraint_type: string;
    }>(
      `SELECT constraint_name, table_name, constraint_type
       FROM information_schema.table_constraints WHERE table_schema = 'public'`
    );
    const constraints = consRes.rows.map((r) => ({
      id: `c-${r.constraint_name}`,
      name: r.constraint_name,
      tableName: r.table_name,
      type: mapPgConstraint(r.constraint_type),
    }));

    return {
      engine: 'postgresql',
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
    let definition: string | null = null;
    try {
      if (obj.kind === 'view' && this.client) {
        const r = await this.client.query(
          `SELECT pg_get_viewdef($1::regclass, true) AS def`,
          [name]
        );
        definition = r.rows[0]?.def ?? null;
      }
    } catch { /* ignore */ }
    return buildObjectDetails(this, {
      name,
      kind: obj.kind,
      columns: obj.columns,
      foreignKeys: catalog.foreignKeys.filter((fk) => fk.fromTable === name || fk.toTable === name),
      indexes: catalog.indexes.filter((i) => i.tableName === name),
      constraints: catalog.constraints.filter((c) => c.tableName === name),
      definition,
    });
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

function extractPgIndexCols(def: string): string[] {
  const m = def.match(/\(([^)]+)\)/);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/"/g, ''));
}

function mapPgConstraint(t: string): 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK' | 'OTHER' {
  if (t === 'PRIMARY KEY') return 'PRIMARY KEY';
  if (t === 'FOREIGN KEY') return 'FOREIGN KEY';
  if (t === 'UNIQUE') return 'UNIQUE';
  if (t === 'CHECK') return 'CHECK';
  return 'OTHER';
}
