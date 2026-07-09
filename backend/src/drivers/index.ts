import type { ConnectionConfig } from '../types/index.js';
import { BaseDriver } from './base.js';
import { SqliteDriver } from './sqlite.js';
import { DuckdbDriver } from './duckdb.js';
import { PostgresDriver } from './postgres.js';
import { MysqlDriver } from './mysql.js';

export function createDriver(config: ConnectionConfig): BaseDriver {
  switch (config.engine) {
    case 'sqlite':
      return new SqliteDriver(config);
    case 'duckdb':
      return new DuckdbDriver(config);
    case 'postgresql':
      return new PostgresDriver(config);
    case 'mysql':
      return new MysqlDriver(config);
    default:
      throw new Error(`Unsupported engine: ${(config as ConnectionConfig).engine}`);
  }
}

export { BaseDriver } from './base.js';
export { SqliteDriver } from './sqlite.js';
export { DuckdbDriver } from './duckdb.js';
export { PostgresDriver } from './postgres.js';
export { MysqlDriver } from './mysql.js';
