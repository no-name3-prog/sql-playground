import { v4 as uuid } from 'uuid';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver, type BaseDriver } from '../drivers/index.js';
import type {
  ConnectionConfig,
  CreateConnectionInput,
  DatabaseEngine,
} from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../data');

class ConnectionService {
  private connections = new Map<string, ConnectionConfig>();
  private drivers = new Map<string, BaseDriver>();

  async initSampleConnections(): Promise<void> {
    const samples: CreateConnectionInput[] = [
      {
        name: 'Sample E-Commerce (SQLite)',
        engine: 'sqlite',
        filename: path.join(DATA_DIR, 'ecommerce.db'),
      },
      {
        name: 'Sample Analytics (DuckDB)',
        engine: 'duckdb',
        filename: path.join(DATA_DIR, 'analytics.duckdb'),
      },
    ];

    for (const sample of samples) {
      const existing = [...this.connections.values()].find(
        (c) => c.isSample && c.engine === sample.engine
      );
      if (existing) continue;

      const config: ConnectionConfig = {
        id: uuid(),
        ...sample,
        isSample: true,
        createdAt: new Date().toISOString(),
      };
      this.connections.set(config.id, config);

      try {
        const driver = createDriver(config);
        await driver.connect();
        this.drivers.set(config.id, driver);
      } catch (err) {
        console.warn(
          `Sample connection "${config.name}" not ready (run npm run sample):`,
          (err as Error).message
        );
      }
    }
  }

  list(): ConnectionConfig[] {
    return [...this.connections.values()].map(sanitize);
  }

  get(id: string): ConnectionConfig | undefined {
    const c = this.connections.get(id);
    return c ? sanitize(c) : undefined;
  }

  getRaw(id: string): ConnectionConfig | undefined {
    return this.connections.get(id);
  }

  async create(input: CreateConnectionInput, test = true): Promise<ConnectionConfig> {
    this.validate(input);

    const config: ConnectionConfig = {
      id: uuid(),
      name: input.name,
      engine: input.engine,
      filename: input.filename,
      host: input.host,
      port: input.port,
      database: input.database,
      user: input.user,
      password: input.password,
      ssl: input.ssl,
      isSample: false,
      createdAt: new Date().toISOString(),
    };

    const driver = createDriver(config);
    if (test) {
      await driver.connect();
      await driver.testConnection();
    } else {
      await driver.connect();
    }

    this.connections.set(config.id, config);
    this.drivers.set(config.id, driver);
    return sanitize(config);
  }

  async remove(id: string): Promise<boolean> {
    const config = this.connections.get(id);
    if (!config) return false;
    if (config.isSample) {
      throw new Error('Cannot delete sample connections');
    }
    const driver = this.drivers.get(id);
    if (driver) {
      await driver.disconnect();
      this.drivers.delete(id);
    }
    this.connections.delete(id);
    return true;
  }

  async getDriver(id: string): Promise<BaseDriver> {
    let driver = this.drivers.get(id);
    if (driver) {
      if (!driver.isConnected()) {
        await driver.connect();
      }
      return driver;
    }

    const config = this.connections.get(id);
    if (!config) {
      throw new Error(`Connection not found: ${id}`);
    }

    driver = createDriver(config);
    await driver.connect();
    this.drivers.set(id, driver);
    return driver;
  }

  private validate(input: CreateConnectionInput): void {
    if (!input.name?.trim()) throw new Error('Connection name is required');
    const engine = input.engine as DatabaseEngine;
    if (!['sqlite', 'duckdb', 'postgresql', 'mysql'].includes(engine)) {
      throw new Error(`Unsupported engine: ${input.engine}`);
    }
    if ((engine === 'sqlite' || engine === 'duckdb') && !input.filename) {
      throw new Error(`${engine} requires a filename`);
    }
    if ((engine === 'postgresql' || engine === 'mysql') && !input.host) {
      throw new Error(`${engine} requires a host`);
    }
  }
}

function sanitize(c: ConnectionConfig): ConnectionConfig {
  const { password, ...rest } = c;
  return {
    ...rest,
    password: password ? '********' : undefined,
  };
}

export const connectionService = new ConnectionService();
