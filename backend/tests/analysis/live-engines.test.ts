import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver } from '../../src/drivers/index.js';
import { analyzeQuery, isExplainableSql } from '../../src/analysis/analyzeService.js';
import type { ConnectionConfig, DatabaseEngine } from '../../src/types/index.js';
import type { PlanNode } from '../../src/types/analysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');

function conn(
  engine: DatabaseEngine,
  extra: Partial<ConnectionConfig>
): ConnectionConfig {
  return {
    id: `test-${engine}`,
    name: `test-${engine}`,
    engine,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

describe('isExplainableSql', () => {
  it('accepts SELECT/WITH and rejects EXPLAIN', () => {
    assert.equal(isExplainableSql('SELECT 1'), true);
    assert.equal(isExplainableSql('WITH x AS (SELECT 1) SELECT * FROM x'), true);
    assert.equal(isExplainableSql('EXPLAIN SELECT 1'), false);
    assert.equal(isExplainableSql('CREATE TABLE t (id int)'), false);
  });
});

describe('Live SQLite analysis', () => {
  const driver = createDriver(
    conn('sqlite', { filename: path.join(dataDir, 'ecommerce.db') })
  );

  before(async () => {
    await driver.connect();
  });
  after(async () => {
    await driver.disconnect();
  });

  it('generates plan with scans/joins and English explanations', async () => {
    const sql = `
      SELECT c.name, COUNT(o.id) AS n
      FROM customers c
      JOIN orders o ON o.customer_id = c.id
      WHERE o.status = 'completed'
      GROUP BY c.name
      ORDER BY n DESC
    `;
    const analysis = await analyzeQuery(driver, sql);
    assert.equal(analysis.engine, 'sqlite');
    assert.ok(analysis.totalNodes >= 1);
    assert.ok(analysis.summary.length > 20);
    assert.ok(analysis.expensiveNodes.length >= 1);

    const all = flatten(analysis.root);
    for (const n of all) {
      assert.ok(n.explanation, `explanation for ${n.label}`);
    }
    assert.ok(all.some((n) => n.category === 'scan' || /scan|search/i.test(n.operator)));
  });

  it('exposes raw plan via getExplainPlan', async () => {
    const raw = await driver.getExplainPlan('SELECT * FROM products WHERE price > 10');
    assert.equal(raw.engine, 'sqlite');
    assert.ok(Array.isArray(raw.payload));
    assert.ok((raw.payload as unknown[]).length >= 1);
  });
});

describe('Live DuckDB analysis', () => {
  // Use in-memory DB so tests do not contend with the dev server file lock
  const driver = createDriver(conn('duckdb', { filename: ':memory:' }));

  before(async () => {
    await driver.connect();
    await driver.execute(`
      CREATE TABLE users (id INTEGER, username VARCHAR, plan VARCHAR);
      CREATE TABLE events (id INTEGER, user_id INTEGER, event_name VARCHAR);
      INSERT INTO users VALUES (1, 'alice', 'pro'), (2, 'bob', 'free');
      INSERT INTO events VALUES (1, 1, 'page_view'), (2, 1, 'click'), (3, 2, 'page_view');
    `);
  });
  after(async () => {
    await driver.disconnect();
  });

  it('generates structured plan with categorized operators', async () => {
    const sql = `
      SELECT u.username, COUNT(e.id) AS events
      FROM users u
      LEFT JOIN events e ON e.user_id = u.id
      GROUP BY u.username
      ORDER BY events DESC
    `;
    const analysis = await analyzeQuery(driver, sql);
    assert.equal(analysis.engine, 'duckdb');
    assert.ok(analysis.totalNodes >= 2);
    assert.ok(analysis.maxDepth >= 1);

    const cats = new Set(flatten(analysis.root).map((n) => n.category));
    // DuckDB physical plans include scans and typically joins/aggs for this query
    assert.ok(cats.has('scan') || cats.has('join') || cats.has('aggregate') || cats.has('project'));
    assert.ok(analysis.expensiveNodes.every((e) => e.costPercent > 0));
  });
});

describe('PostgreSQL analysis (optional live)', () => {
  const enabled = Boolean(process.env.TEST_PG_HOST);

  it('parses live EXPLAIN when TEST_PG_* env is set', async (t) => {
    if (!enabled) {
      t.skip('Set TEST_PG_HOST, TEST_PG_USER, TEST_PG_DATABASE to run live Postgres tests');
      return;
    }
    const driver = createDriver(
      conn('postgresql', {
        host: process.env.TEST_PG_HOST,
        port: Number(process.env.TEST_PG_PORT || 5432),
        user: process.env.TEST_PG_USER || 'postgres',
        password: process.env.TEST_PG_PASSWORD || '',
        database: process.env.TEST_PG_DATABASE || 'postgres',
      })
    );
    await driver.connect();
    try {
      const analysis = await analyzeQuery(
        driver,
        'SELECT 1 AS n UNION ALL SELECT 2 ORDER BY 1'
      );
      assert.equal(analysis.engine, 'postgresql');
      assert.ok(analysis.totalNodes >= 1);
      assert.ok(analysis.root.explanation);
    } finally {
      await driver.disconnect();
    }
  });
});

describe('MySQL analysis (optional live)', () => {
  const enabled = Boolean(process.env.TEST_MYSQL_HOST);

  it('parses live EXPLAIN when TEST_MYSQL_* env is set', async (t) => {
    if (!enabled) {
      t.skip('Set TEST_MYSQL_HOST, TEST_MYSQL_USER, TEST_MYSQL_DATABASE to run live MySQL tests');
      return;
    }
    const driver = createDriver(
      conn('mysql', {
        host: process.env.TEST_MYSQL_HOST,
        port: Number(process.env.TEST_MYSQL_PORT || 3306),
        user: process.env.TEST_MYSQL_USER || 'root',
        password: process.env.TEST_MYSQL_PASSWORD || '',
        database: process.env.TEST_MYSQL_DATABASE || 'mysql',
      })
    );
    await driver.connect();
    try {
      const analysis = await analyzeQuery(driver, 'SELECT 1 AS n');
      assert.equal(analysis.engine, 'mysql');
      assert.ok(analysis.totalNodes >= 1);
    } finally {
      await driver.disconnect();
    }
  });
});
