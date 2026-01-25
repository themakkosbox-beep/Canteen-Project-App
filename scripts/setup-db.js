const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

// Database setup script
async function setupDatabase(options = {}) {
  console.log('Setting up Camp Canteen database...');

  const resolvedDbPath = options.dbPath
    ? path.resolve(String(options.dbPath))
    : path.join(__dirname, '..', 'canteen.db');
  const dbPath = resolvedDbPath;
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
      customer_id TEXT UNIQUE NOT NULL CHECK (customer_id GLOB '[0-9][0-9][0-9][0-9]'),
      name TEXT,
      balance REAL NOT NULL DEFAULT 0 CHECK (abs(round(balance * 100) - balance * 100) < 0.00001),
      discount_percent REAL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
      discount_flat REAL DEFAULT 0 CHECK (discount_flat >= 0),
      type_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL CHECK (price >= 0 AND abs(round(price * 100) - price * 100) < 0.00001),
      barcode TEXT UNIQUE,
      category TEXT,
      active BOOLEAN DEFAULT 1,
      options_json TEXT,
      discount_percent REAL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
      discount_flat REAL DEFAULT 0 CHECK (discount_flat >= 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('purchase', 'deposit', 'withdrawal', 'adjustment')),
      product_id TEXT,
      product_name TEXT,
      product_price REAL CHECK (product_price IS NULL OR (product_price >= 0 AND abs(round(product_price * 100) - product_price * 100) < 0.00001)),
      amount REAL NOT NULL CHECK (abs(round(amount * 100) - amount * 100) < 0.00001),
      balance_after REAL NOT NULL CHECK (abs(round(balance_after * 100) - balance_after * 100) < 0.00001),
      note TEXT,
      options_json TEXT,
      voided BOOLEAN DEFAULT 0,
      voided_at DATETIME,
      void_note TEXT,
      edit_parent_transaction_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      staff_id TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
      FOREIGN KEY (product_id) REFERENCES products (product_id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('Creating indexes...');
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_customer_id ON customers (customer_id);
    CREATE INDEX IF NOT EXISTS idx_product_barcode ON products (barcode);
    CREATE INDEX IF NOT EXISTS idx_product_category ON products (category);
    CREATE INDEX IF NOT EXISTS idx_product_active ON products (active);
    CREATE INDEX IF NOT EXISTS idx_transaction_customer ON transactions (customer_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_timestamp ON transactions (timestamp);
    CREATE INDEX IF NOT EXISTS idx_transaction_id ON transactions (transaction_id);
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS validate_customers_insert
    BEFORE INSERT ON customers
    BEGIN
      SELECT CASE
        WHEN NEW.customer_id IS NULL OR NEW.customer_id NOT GLOB '[0-9][0-9][0-9][0-9]'
        THEN RAISE(ABORT, 'customer_id must be 4 digits')
      END;
      SELECT CASE
        WHEN NEW.discount_percent IS NOT NULL AND (NEW.discount_percent < 0 OR NEW.discount_percent > 100)
        THEN RAISE(ABORT, 'discount_percent out of range')
      END;
      SELECT CASE
        WHEN NEW.discount_flat IS NOT NULL AND NEW.discount_flat < 0
        THEN RAISE(ABORT, 'discount_flat must be >= 0')
      END;
      SELECT CASE
        WHEN NEW.balance IS NOT NULL AND abs(round(NEW.balance * 100) - NEW.balance * 100) > 0.0001
        THEN RAISE(ABORT, 'balance must have at most 2 decimals')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS validate_customers_update
    BEFORE UPDATE ON customers
    BEGIN
      SELECT CASE
        WHEN NEW.customer_id IS NULL OR NEW.customer_id NOT GLOB '[0-9][0-9][0-9][0-9]'
        THEN RAISE(ABORT, 'customer_id must be 4 digits')
      END;
      SELECT CASE
        WHEN NEW.discount_percent IS NOT NULL AND (NEW.discount_percent < 0 OR NEW.discount_percent > 100)
        THEN RAISE(ABORT, 'discount_percent out of range')
      END;
      SELECT CASE
        WHEN NEW.discount_flat IS NOT NULL AND NEW.discount_flat < 0
        THEN RAISE(ABORT, 'discount_flat must be >= 0')
      END;
      SELECT CASE
        WHEN NEW.balance IS NOT NULL AND abs(round(NEW.balance * 100) - NEW.balance * 100) > 0.0001
        THEN RAISE(ABORT, 'balance must have at most 2 decimals')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS validate_products_insert
    BEFORE INSERT ON products
    BEGIN
      SELECT CASE
        WHEN NEW.price IS NULL OR NEW.price < 0
        THEN RAISE(ABORT, 'price must be >= 0')
      END;
      SELECT CASE
        WHEN NEW.price IS NOT NULL AND abs(round(NEW.price * 100) - NEW.price * 100) > 0.0001
        THEN RAISE(ABORT, 'price must have at most 2 decimals')
      END;
      SELECT CASE
        WHEN NEW.discount_percent IS NOT NULL AND (NEW.discount_percent < 0 OR NEW.discount_percent > 100)
        THEN RAISE(ABORT, 'discount_percent out of range')
      END;
      SELECT CASE
        WHEN NEW.discount_flat IS NOT NULL AND NEW.discount_flat < 0
        THEN RAISE(ABORT, 'discount_flat must be >= 0')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS validate_products_update
    BEFORE UPDATE ON products
    BEGIN
      SELECT CASE
        WHEN NEW.price IS NULL OR NEW.price < 0
        THEN RAISE(ABORT, 'price must be >= 0')
      END;
      SELECT CASE
        WHEN NEW.price IS NOT NULL AND abs(round(NEW.price * 100) - NEW.price * 100) > 0.0001
        THEN RAISE(ABORT, 'price must have at most 2 decimals')
      END;
      SELECT CASE
        WHEN NEW.discount_percent IS NOT NULL AND (NEW.discount_percent < 0 OR NEW.discount_percent > 100)
        THEN RAISE(ABORT, 'discount_percent out of range')
      END;
      SELECT CASE
        WHEN NEW.discount_flat IS NOT NULL AND NEW.discount_flat < 0
        THEN RAISE(ABORT, 'discount_flat must be >= 0')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS validate_transactions_insert
    BEFORE INSERT ON transactions
    BEGIN
      SELECT CASE
        WHEN NEW.amount IS NULL OR abs(round(NEW.amount * 100) - NEW.amount * 100) > 0.0001
        THEN RAISE(ABORT, 'amount must have at most 2 decimals')
      END;
      SELECT CASE
        WHEN NEW.balance_after IS NULL OR abs(round(NEW.balance_after * 100) - NEW.balance_after * 100) > 0.0001
        THEN RAISE(ABORT, 'balance_after must have at most 2 decimals')
      END;
      SELECT CASE
        WHEN NEW.product_price IS NOT NULL AND (NEW.product_price < 0 OR abs(round(NEW.product_price * 100) - NEW.product_price * 100) > 0.0001)
        THEN RAISE(ABORT, 'product_price must be >= 0 with 2 decimals')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS validate_transactions_update
    BEFORE UPDATE ON transactions
    BEGIN
      SELECT CASE
        WHEN NEW.amount IS NULL OR abs(round(NEW.amount * 100) - NEW.amount * 100) > 0.0001
        THEN RAISE(ABORT, 'amount must have at most 2 decimals')
      END;
      SELECT CASE
        WHEN NEW.balance_after IS NULL OR abs(round(NEW.balance_after * 100) - NEW.balance_after * 100) > 0.0001
        THEN RAISE(ABORT, 'balance_after must have at most 2 decimals')
      END;
      SELECT CASE
        WHEN NEW.product_price IS NOT NULL AND (NEW.product_price < 0 OR abs(round(NEW.product_price * 100) - NEW.product_price * 100) > 0.0001)
        THEN RAISE(ABORT, 'product_price must be >= 0 with 2 decimals')
      END;
    END;
  `);

  db.run(`
    INSERT OR REPLACE INTO settings (key, value, updated_at)
    VALUES ('app_schema_version', '2', datetime('now'))
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
