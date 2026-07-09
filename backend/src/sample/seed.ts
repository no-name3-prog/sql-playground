/**
 * Seeds sample SQLite and DuckDB databases used by the playground.
 */
import Database from 'better-sqlite3';
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function seedSqlite() {
  const dbPath = path.join(DATA_DIR, 'ecommerce.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      city TEXT,
      country TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      status TEXT NOT NULL,
      total REAL NOT NULL,
      ordered_at TEXT NOT NULL
    );

    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
  `);

  const insertCustomer = db.prepare(
    `INSERT INTO customers (id, name, email, city, country, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const customers = [
    [1, 'Alice Johnson', 'alice@example.com', 'San Francisco', 'USA', '2024-01-15'],
    [2, 'Bob Smith', 'bob@example.com', 'New York', 'USA', '2024-02-20'],
    [3, 'Clara Chen', 'clara@example.com', 'Toronto', 'Canada', '2024-03-10'],
    [4, 'David Müller', 'david@example.com', 'Berlin', 'Germany', '2024-04-05'],
    [5, 'Elena Rossi', 'elena@example.com', 'Milan', 'Italy', '2024-05-12'],
    [6, 'Frank Lee', 'frank@example.com', 'Seoul', 'South Korea', '2024-06-01'],
    [7, 'Grace Kim', 'grace@example.com', 'Austin', 'USA', '2024-06-18'],
    [8, 'Hiro Tanaka', 'hiro@example.com', 'Tokyo', 'Japan', '2024-07-22'],
  ];
  for (const c of customers) insertCustomer.run(...c);

  const insertProduct = db.prepare(
    `INSERT INTO products (id, name, category, price, stock) VALUES (?, ?, ?, ?, ?)`
  );
  const products = [
    [1, 'Wireless Mouse', 'Electronics', 29.99, 150],
    [2, 'Mechanical Keyboard', 'Electronics', 89.99, 80],
    [3, 'USB-C Hub', 'Electronics', 49.99, 200],
    [4, 'Standing Desk', 'Furniture', 399.0, 25],
    [5, 'Ergonomic Chair', 'Furniture', 249.0, 40],
    [6, 'Notebook Set', 'Stationery', 12.5, 500],
    [7, 'Monitor 27"', 'Electronics', 329.0, 60],
    [8, 'Desk Lamp', 'Furniture', 45.0, 120],
    [9, 'Webcam HD', 'Electronics', 79.99, 90],
    [10, 'Laptop Stand', 'Accessories', 34.99, 180],
  ];
  for (const p of products) insertProduct.run(...p);

  const insertOrder = db.prepare(
    `INSERT INTO orders (id, customer_id, status, total, ordered_at) VALUES (?, ?, ?, ?, ?)`
  );
  const orders = [
    [1, 1, 'completed', 119.98, '2024-08-01'],
    [2, 2, 'completed', 399.0, '2024-08-05'],
    [3, 1, 'shipped', 79.99, '2024-09-10'],
    [4, 3, 'completed', 294.0, '2024-09-15'],
    [5, 4, 'pending', 89.99, '2024-10-01'],
    [6, 5, 'completed', 374.98, '2024-10-12'],
    [7, 6, 'cancelled', 49.99, '2024-10-20'],
    [8, 7, 'completed', 444.0, '2024-11-02'],
    [9, 8, 'shipped', 329.0, '2024-11-18'],
    [10, 2, 'completed', 62.49, '2024-12-01'],
    [11, 3, 'completed', 249.0, '2025-01-08'],
    [12, 1, 'pending', 34.99, '2025-01-20'],
  ];
  for (const o of orders) insertOrder.run(...o);

  const insertItem = db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)`
  );
  const items = [
    [1, 1, 1, 1, 29.99],
    [2, 1, 2, 1, 89.99],
    [3, 2, 4, 1, 399.0],
    [4, 3, 9, 1, 79.99],
    [5, 4, 5, 1, 249.0],
    [6, 4, 8, 1, 45.0],
    [7, 5, 2, 1, 89.99],
    [8, 6, 7, 1, 329.0],
    [9, 6, 8, 1, 45.0],
    [10, 7, 3, 1, 49.99],
    [11, 8, 4, 1, 399.0],
    [12, 8, 8, 1, 45.0],
    [13, 9, 7, 1, 329.0],
    [14, 10, 1, 1, 29.99],
    [15, 10, 10, 1, 34.99],
    [16, 11, 5, 1, 249.0],
    [17, 12, 10, 1, 34.99],
  ];
  for (const i of items) insertItem.run(...i);

  db.close();
  console.log(`  ✓ SQLite sample → ${dbPath}`);
}

function seedDuckdb(): Promise<void> {
  const dbPath = path.join(DATA_DIR, 'analytics.duckdb');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  // also remove wal if any
  for (const suffix of ['.wal', '.tmp']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(dbPath, (err) => {
      if (err) return reject(err);
      const conn = db.connect();

      const sql = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          username VARCHAR NOT NULL,
          plan VARCHAR NOT NULL,
          signup_date DATE
        );

        CREATE TABLE sessions (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL,
          started_at TIMESTAMP,
          duration_sec INTEGER,
          device VARCHAR
        );

        CREATE TABLE events (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL,
          session_id INTEGER,
          event_name VARCHAR NOT NULL,
          properties JSON,
          occurred_at TIMESTAMP
        );

        INSERT INTO users VALUES
          (1, 'alice_j', 'pro', '2024-01-15'),
          (2, 'bob_s', 'free', '2024-02-20'),
          (3, 'clara_c', 'pro', '2024-03-10'),
          (4, 'david_m', 'enterprise', '2024-04-05'),
          (5, 'elena_r', 'free', '2024-05-12'),
          (6, 'frank_l', 'pro', '2024-06-01');

        INSERT INTO sessions VALUES
          (1, 1, '2025-01-10 09:00:00', 420, 'desktop'),
          (2, 1, '2025-01-11 14:30:00', 180, 'mobile'),
          (3, 2, '2025-01-10 11:00:00', 90, 'mobile'),
          (4, 3, '2025-01-12 16:00:00', 600, 'desktop'),
          (5, 4, '2025-01-12 10:15:00', 1200, 'desktop'),
          (6, 5, '2025-01-13 08:45:00', 60, 'tablet'),
          (7, 6, '2025-01-13 19:00:00', 300, 'mobile'),
          (8, 3, '2025-01-14 12:00:00', 450, 'desktop');

        INSERT INTO events VALUES
          (1, 1, 1, 'page_view', '{"page": "/dashboard"}', '2025-01-10 09:00:05'),
          (2, 1, 1, 'click', '{"button": "export"}', '2025-01-10 09:02:10'),
          (3, 1, 1, 'query_run', '{"engine": "sqlite"}', '2025-01-10 09:05:00'),
          (4, 2, 3, 'page_view', '{"page": "/pricing"}', '2025-01-10 11:00:10'),
          (5, 2, 3, 'signup_start', '{}', '2025-01-10 11:01:00'),
          (6, 3, 4, 'page_view', '{"page": "/editor"}', '2025-01-12 16:00:20'),
          (7, 3, 4, 'query_run', '{"engine": "duckdb"}', '2025-01-12 16:05:00'),
          (8, 3, 4, 'query_run', '{"engine": "duckdb"}', '2025-01-12 16:08:00'),
          (9, 4, 5, 'page_view', '{"page": "/admin"}', '2025-01-12 10:15:30'),
          (10, 4, 5, 'export', '{"format": "csv"}', '2025-01-12 10:20:00'),
          (11, 5, 6, 'page_view', '{"page": "/home"}', '2025-01-13 08:45:10'),
          (12, 6, 7, 'page_view', '{"page": "/editor"}', '2025-01-13 19:00:15'),
          (13, 6, 7, 'query_run', '{"engine": "postgresql"}', '2025-01-13 19:03:00'),
          (14, 3, 8, 'query_run', '{"engine": "mysql"}', '2025-01-14 12:10:00'),
          (15, 1, 2, 'page_view', '{"page": "/history"}', '2025-01-11 14:30:20');
      `;

      conn.exec(sql, (execErr) => {
        if (execErr) {
          conn.close(() => db.close(() => reject(execErr)));
          return;
        }
        conn.close(() => {
          db.close((closeErr) => {
            if (closeErr) reject(closeErr);
            else {
              console.log(`  ✓ DuckDB sample → ${dbPath}`);
              resolve();
            }
          });
        });
      });
    });
  });
}

async function main() {
  console.log('\nSeeding sample databases...');
  ensureDir();
  seedSqlite();
  await seedDuckdb();
  console.log('Done.\n');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
