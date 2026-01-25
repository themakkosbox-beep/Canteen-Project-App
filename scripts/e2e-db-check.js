#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { setupDatabase } = require('./setup-db');

const locateSqlJsFile = (fileName) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', fileName);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectFailure = (fn, message) => {
  let failed = false;
  try {
    fn();
  } catch (_error) {
    failed = true;
  }
  if (!failed) {
    throw new Error(message);
  }
};

async function main() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: locateSqlJsFile });

  const baseDir = (() => {
    const configured = process.env.CANTEEN_DATA_DIR && process.env.CANTEEN_DATA_DIR.trim();
    if (configured) {
      return configured.trim();
    }
    return path.join(os.tmpdir(), 'canteen-e2e-db-check');
  })();

  const dataDir = path.resolve(baseDir);
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'canteen-e2e.db');
  await setupDatabase({ dbPath });

  const db = new SQL.Database(fs.readFileSync(dbPath));

  try {
    const getColumns = (table) => {
      const stmt = db.prepare(`PRAGMA table_info(${table})`);
      const columns = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        columns.push(String(row.name));
      }
      stmt.free();
      return columns;
    };

    const transactionColumns = getColumns('transactions');
    assert(transactionColumns.includes('product_name'), 'Missing product_name column in transactions');
    assert(transactionColumns.includes('product_price'), 'Missing product_price column in transactions');

    const settingsColumns = getColumns('settings');
    assert(settingsColumns.includes('key'), 'Missing settings table');

    const schemaStmt = db.prepare("SELECT value FROM settings WHERE key = 'app_schema_version'");
    schemaStmt.step();
    const schemaRow = schemaStmt.getAsObject();
    schemaStmt.free();
    assert(schemaRow.value === '2', 'Schema version should be 2');

    expectFailure(
      () => db.run("INSERT INTO customers (customer_id, name, balance) VALUES ('12', 'Bad', 0)"),
      'Expected invalid customer_id to fail'
    );

    expectFailure(
      () => db.run("INSERT INTO products (product_id, name, price, active) VALUES ('BAD', 'Bad', 1.999, 1)"),
      'Expected invalid product price precision to fail'
    );

    db.run("INSERT INTO customers (customer_id, name, balance) VALUES ('2468', 'Test Customer', 10.5)");
    db.run("INSERT INTO products (product_id, name, price, active) VALUES ('TESTX', 'Test Product', 2.5, 1)");

    db.run(
      "INSERT INTO transactions (transaction_id, customer_id, type, amount, balance_after) VALUES ('TXN1', '2468', 'deposit', 5.25, 15.75)"
    );

    expectFailure(
      () =>
        db.run(
          "INSERT INTO transactions (transaction_id, customer_id, type, amount, balance_after) VALUES ('TXN2', '2468', 'purchase', 1.999, 13.751)"
        ),
      'Expected invalid transaction precision to fail'
    );

    db.run("UPDATE transactions SET voided = 1 WHERE transaction_id = 'TXN1'");

    const countStmt = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE voided = 1');
    countStmt.step();
    const countRow = countStmt.getAsObject();
    countStmt.free();
    assert(Number(countRow.count) === 1, 'Expected a voided transaction to exist');

    console.log(`OK: Database validation checks passed. Path: ${dbPath}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('ERROR: Database validation checks failed:', error);
  process.exit(1);
});
