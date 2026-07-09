import type { BaseDriver } from '../drivers/base.js';
import type {
  CatalogColumn,
  ConstraintMeta,
  ForeignKeyMeta,
  IndexMeta,
  ObjectDetails,
  ObjectStatistics,
} from '../types/schema.js';

export async function buildObjectDetails(
  driver: BaseDriver,
  opts: {
    name: string;
    kind: 'table' | 'view';
    columns: CatalogColumn[];
    foreignKeys: ForeignKeyMeta[];
    indexes: IndexMeta[];
    constraints: ConstraintMeta[];
    definition?: string | null;
    sampleLimit?: number;
    statsMaxRows?: number;
  }
): Promise<ObjectDetails> {
  const sampleLimit = opts.sampleLimit ?? 25;
  const qName = quote(opts.name);

  let sample = null;
  try {
    sample = await driver.execute(`SELECT * FROM ${qName} LIMIT ${sampleLimit}`, sampleLimit);
  } catch {
    sample = null;
  }

  let rowCount: number | null = null;
  try {
    const countRes = await driver.execute(`SELECT COUNT(*) AS c FROM ${qName}`, 1);
    const row = countRes.rows[0] || {};
    const v = row.c ?? row.C ?? row['COUNT(*)'] ?? Object.values(row)[0];
    rowCount = v === null || v === undefined ? null : Number(v);
  } catch {
    rowCount = null;
  }

  const columnsStats = [];
  for (const col of opts.columns.slice(0, 40)) {
    const cq = quote(col.name);
    let nullCount: number | null = null;
    let distinctCount: number | null = null;
    let min: unknown = null;
    let max: unknown = null;
    try {
      if (rowCount !== null && rowCount <= (opts.statsMaxRows ?? 100_000)) {
        const r = await driver.execute(
          `SELECT COUNT(*) - COUNT(${cq}) AS nulls, COUNT(DISTINCT ${cq}) AS dist FROM ${qName}`,
          1
        );
        nullCount = num(r.rows[0]?.nulls);
        distinctCount = num(r.rows[0]?.dist);
      }
    } catch {
      /* skip */
    }
    try {
      if (isNumericOrDate(col.type) && rowCount !== null && rowCount <= (opts.statsMaxRows ?? 100_000)) {
        const r = await driver.execute(
          `SELECT MIN(${cq}) AS mn, MAX(${cq}) AS mx FROM ${qName}`,
          1
        );
        min = r.rows[0]?.mn ?? null;
        max = r.rows[0]?.mx ?? null;
      }
    } catch {
      /* skip */
    }
    columnsStats.push({ name: col.name, nullCount, distinctCount, min, max });
  }

  const statistics: ObjectStatistics = {
    rowCount,
    columnCount: opts.columns.length,
    columns: columnsStats,
    indexCount: opts.indexes.length,
    foreignKeyCount: opts.foreignKeys.length,
    constraintCount: opts.constraints.length,
  };

  return {
    kind: opts.kind,
    name: opts.name,
    columns: opts.columns,
    foreignKeys: opts.foreignKeys,
    indexes: opts.indexes,
    constraints: opts.constraints,
    definition: opts.definition ?? null,
    statistics,
    sample,
  };
}

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isNumericOrDate(type: string): boolean {
  return /int|real|floa|doub|num|dec|date|time|year|serial|money/i.test(type);
}
