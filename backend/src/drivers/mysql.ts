import mysql from 'mysql2/promise';
import { BaseDriver, DEFAULT_MAX_ROWS } from './base.js';
import type { ColumnMeta, QueryResult, SchemaInfo } from '../types/index.js';
import type { RawExplainResult } from '../types/analysis.js';
import type { ObjectDetails, SchemaCatalog } from '../types/schema.js';
import { buildObjectDetails } from '../schema/objectDetails.js';

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


  async getCatalog(): Promise<SchemaCatalog> {
    if (!this.pool) await this.connect();
    const db = this.config.database;
    if (!db) throw new Error('MySQL connection requires a database name');
    const pool = this.pool!;

    const [tableRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS table_type
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME`,
      [db]
    );

    const objects = [];
    for (const t of tableRows) {
      const name = String(t.name);
      const kind = String(t.table_type).includes('VIEW') ? 'view' : 'table';
      const [cols] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable,
                COLUMN_DEFAULT AS def, COLUMN_KEY AS ckey, ORDINAL_POSITION AS ord
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [db, name]
      );
      const columns = cols.map((c) => ({
        name: String(c.name),
        type: String(c.type),
        nullable: c.nullable === 'YES',
        defaultValue: c.def === undefined ? null : (c.def as string | null),
        isPrimaryKey: c.ckey === 'PRI',
        ordinal: Number(c.ord),
      }));
      let rowCount: number | null = null;
      try {
        const [r] = await pool.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS c FROM \`${name.replace(/`/g, '``')}\``);
        rowCount = Number(r[0]?.c);
      } catch { rowCount = null; }
      objects.push({ id: `${kind}:${name}`, name, kind: kind as 'table'|'view', columns, rowCount });
    }

    const [fkRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, ORDINAL_POSITION
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
      [db]
    );
    const fkMap = new Map<string, { name: string; fromTable: string; toTable: string; fromColumns: string[]; toColumns: string[] }>();
    for (const r of fkRows) {
      const key = String(r.CONSTRAINT_NAME);
      if (!fkMap.has(key)) {
        fkMap.set(key, {
          name: key,
          fromTable: String(r.TABLE_NAME),
          toTable: String(r.REFERENCED_TABLE_NAME),
          fromColumns: [],
          toColumns: [],
        });
      }
      const e = fkMap.get(key)!;
      e.fromColumns.push(String(r.COLUMN_NAME));
      e.toColumns.push(String(r.REFERENCED_COLUMN_NAME));
    }
    const foreignKeys = [...fkMap.entries()].map(([name, v]) => ({
      id: `fk-${name}`, ...v, name: v.name,
    }));

    const [idxRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT INDEX_NAME, TABLE_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [db]
    );
    const idxMap = new Map<string, { name: string; tableName: string; columns: string[]; unique: boolean; primary: boolean }>();
    for (const r of idxRows) {
      const key = `${r.TABLE_NAME}::${r.INDEX_NAME}`;
      if (!idxMap.has(key)) {
        idxMap.set(key, {
          name: String(r.INDEX_NAME),
          tableName: String(r.TABLE_NAME),
          columns: [],
          unique: Number(r.NON_UNIQUE) === 0,
          primary: r.INDEX_NAME === 'PRIMARY',
        });
      }
      idxMap.get(key)!.columns.push(String(r.COLUMN_NAME));
    }
    const indexes = [...idxMap.values()].map((v) => ({
      id: `idx-${v.tableName}-${v.name}`,
      ...v,
    }));

    const [consRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT CONSTRAINT_NAME, TABLE_NAME, CONSTRAINT_TYPE
       FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ?`,
      [db]
    );
    const constraints = consRows.map((r) => ({
      id: `c-${r.CONSTRAINT_NAME}-${r.TABLE_NAME}`,
      name: String(r.CONSTRAINT_NAME),
      tableName: String(r.TABLE_NAME),
      type: mapMysqlConstraint(String(r.CONSTRAINT_TYPE)),
    }));

    return {
      engine: 'mysql',
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

function mapMysqlConstraint(t: string): 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK' | 'OTHER' {
  if (t === 'PRIMARY KEY') return 'PRIMARY KEY';
  if (t === 'FOREIGN KEY') return 'FOREIGN KEY';
  if (t === 'UNIQUE') return 'UNIQUE';
  if (t === 'CHECK') return 'CHECK';
  return 'OTHER';
}
