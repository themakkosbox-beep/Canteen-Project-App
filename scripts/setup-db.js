const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

// Database setup script
async function setupDatabase() {
  console.log('Setting up Camp Canteen database...');

  const dbPath = path.join(__dirname, '..', 'canteen.db');
  const locateFile = (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file);
  const SQL = await initSqlJs({ locateFile });

  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  // Enable foreign keys and create schema
  db.run(`PRAGMA foreign_keys = ON;`);

  console.log('Creating tables...');
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT UNIQUE NOT NULL,
      name TEXT,
      balance REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      barcode TEXT UNIQUE,
      category TEXT,
      active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('purchase', 'deposit', 'withdrawal', 'adjustment')),
      product_id TEXT,
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      note TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      staff_id TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
      FOREIGN KEY (product_id) REFERENCES products (product_id)
    );
  `);

  console.log('Creating indexes...');
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_customer_id ON customers (customer_id);
    CREATE INDEX IF NOT EXISTS idx_product_barcode ON products (barcode);
    CREATE INDEX IF NOT EXISTS idx_transaction_customer ON transactions (customer_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_timestamp ON transactions (timestamp);
  `);

  console.log('Adding sample data...');

  const insertCustomer = db.prepare(`
    INSERT OR IGNORE INTO customers (customer_id, name, balance)
    VALUES (?, ?, ?)
  `);
  [['1234', 'Alice Johnson', 25.0], ['5678', 'Bob Smith', 30.0], ['9012', 'Charlie Brown', 15.5]].forEach((entry) => {
    insertCustomer.run(entry);
  });
  insertCustomer.free();

  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products (product_id, name, price, barcode, category)
    VALUES (?, ?, ?, ?, ?)
  `);
  const products = [
    ['SNCK001', 'Snickers Bar', 2.5, '012345678901', 'Candy'],
    ['SNCK002', 'Kit Kat', 2.25, '012345678902', 'Candy'],
    ['DRINK001', 'Gatorade Blue', 3.0, '012345678903', 'Drinks'],
    ['DRINK002', 'Coca Cola', 2.75, '012345678904', 'Drinks'],
    ['DRINK003', 'Red Bull', 4.5, '012345678905', 'Energy Drinks'],
    ['CHIP001', 'Doritos Nacho', 3.25, '012345678906', 'Chips'],
    ['CHIP002', 'Pringles Original', 3.5, '012345678907', 'Chips'],
    ['SNCK003', 'Granola Bar', 2.0, '012345678908', 'Healthy']
  ];
  products.forEach((product) => insertProduct.run(product));
  insertProduct.free();

  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));

  console.log('Database setup complete!');
  console.log(`Database created at: ${dbPath}`);

  db.close();
}

if (require.main === module) {
  setupDatabase().catch((error) => {
    console.error('Database setup failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { setupDatabase };