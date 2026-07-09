import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver } from '../../src/drivers/index.js';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

describe('Schema catalog — SQLite sample', () => {
  const driver = createDriver({
    id: 'cat-sqlite',
    name: 'cat',
    engine: 'sqlite',
    filename: path.join(dataDir, 'ecommerce.db'),
    createdAt: new Date().toISOString(),
  });

  before(async () => {
    await driver.connect();
  });
  after(async () => {
    await driver.disconnect();
  });

  it('discovers tables, columns, FKs, indexes, constraints, and graph', async () => {
    const catalog = await driver.getCatalog();
    assert.equal(catalog.engine, 'sqlite');
    assert.ok(catalog.objects.length >= 4);
    assert.ok(catalog.objects.every((o) => o.columns.length > 0));
    assert.ok(catalog.foreignKeys.length >= 1, 'expected foreign keys');
    assert.ok(catalog.indexes.length >= 1);
    assert.ok(catalog.constraints.length >= 1);
    assert.ok(catalog.graph.nodes.length >= 4);
    assert.ok(catalog.graph.edges.length >= 1);
  });

  it('returns object details with sample and statistics', async () => {
    const details = await driver.getObjectDetails('orders', 'table');
    assert.equal(details.name, 'orders');
    assert.ok(details.columns.length >= 3);
    assert.ok(details.sample);
    assert.ok((details.sample?.rowCount ?? 0) > 0);
    assert.ok(details.statistics.rowCount !== null && details.statistics.rowCount! > 0);
    assert.ok(details.statistics.columnCount >= 3);
  });
});

describe('Schema catalog — DuckDB in-memory', () => {
  const driver = createDriver({
    id: 'cat-duck',
    name: 'cat',
    engine: 'duckdb',
    filename: ':memory:',
    createdAt: new Date().toISOString(),
  });

  before(async () => {
    await driver.connect();
    await driver.execute(`
      CREATE TABLE parents (id INTEGER PRIMARY KEY, name VARCHAR);
      CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER, label VARCHAR);
      INSERT INTO parents VALUES (1, 'a'), (2, 'b');
      INSERT INTO children VALUES (1, 1, 'x'), (2, 1, 'y'), (3, 2, 'z');
    `);
  });
  after(async () => {
    await driver.disconnect();
  });

  it('discovers tables and graph nodes', async () => {
    const catalog = await driver.getCatalog();
    assert.equal(catalog.engine, 'duckdb');
    assert.ok(catalog.objects.some((o) => o.name === 'parents'));
    assert.ok(catalog.objects.some((o) => o.name === 'children'));
    assert.ok(catalog.graph.nodes.length >= 2);
  });

  it('returns sample rows for selected table', async () => {
    const details = await driver.getObjectDetails('children', 'table');
    assert.ok(details.sample && details.sample.rowCount >= 1);
    assert.ok(details.statistics.columnCount >= 2);
  });
});
