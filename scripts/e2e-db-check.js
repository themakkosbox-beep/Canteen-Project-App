#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: (fileName) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', fileName),
  });

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
  const startBuffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  const db = startBuffer ? new SQL.Database(startBuffer) : new SQL.Database();

  try {
    db.run(
      'CREATE TABLE IF NOT EXISTS healthcheck (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    );

    const insertStmt = db.prepare('INSERT INTO healthcheck (note) VALUES (?)');
    insertStmt.bind([`packaging-check-${new Date().toISOString()}`]);
    insertStmt.step();
    insertStmt.free();

    const exported = db.export();
    fs.writeFileSync(dbPath, Buffer.from(exported));

    const verifyDb = new SQL.Database(fs.readFileSync(dbPath));
    const verifyStmt = verifyDb.prepare('SELECT COUNT(*) AS count FROM healthcheck');
    verifyStmt.step();
    const result = verifyStmt.getAsObject();
    verifyStmt.free();
    verifyDb.close();

    const recordCount = typeof result.count === 'number' ? result.count : Number(result.count ?? 0);
    console.log(`✅ Database write check passed. healthcheck rows: ${recordCount}. Path: ${dbPath}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('❌ Database write check failed:', error);
  process.exit(1);
});
