import type { DatabaseEngine } from '../../types/index.js';
import type { PlanNode, RawExplainResult } from '../../types/analysis.js';
import { parseSqlitePlan, type SqliteEqpRow } from './sqlite.js';
import { parseDuckdbPlan } from './duckdb.js';
import { parsePostgresPlan } from './postgres.js';
import { parseMysqlPlan } from './mysql.js';

export function parseExplainResult(raw: RawExplainResult): PlanNode {
  switch (raw.engine) {
    case 'sqlite':
      return parseSqlitePlan(raw.payload as SqliteEqpRow[]);
    case 'duckdb':
      return parseDuckdbPlan(raw.payload);
    case 'postgresql':
      return parsePostgresPlan(raw.payload);
    case 'mysql':
      return parseMysqlPlan(raw.payload);
    default:
      throw new Error(`No parser for engine: ${(raw as RawExplainResult).engine}`);
  }
}

export {
  parseSqlitePlan,
  parseDuckdbPlan,
  parsePostgresPlan,
  parseMysqlPlan,
};
export type { SqliteEqpRow };
export type { DatabaseEngine };
