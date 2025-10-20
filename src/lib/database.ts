import fs from 'fs';
import path from 'path';
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic, Statement } from 'sql.js';
import { Customer, Product, Transaction, TransactionLog } from '@/types/database';

class DatabaseManager {
  private static instance: DatabaseManager;
  private readonly dbPath: string;
  private readonly sqlPromise: Promise<SqlJsStatic>;

  private constructor() {
    this.dbPath = path.join(process.cwd(), 'canteen.db');
    this.sqlPromise = initSqlJs({
      locateFile: (file) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private async withDatabase<T>(
    fn: (db: SqlJsDatabase) => T | Promise<T>,
    persist: boolean = false
  ): Promise<T> {
    const SQL = await this.sqlPromise;
    const dbExists = fs.existsSync(this.dbPath);
    const database = dbExists
      ? new SQL.Database(fs.readFileSync(this.dbPath))
      : new SQL.Database();

    database.run('PRAGMA foreign_keys = ON;');
    this.ensureSchema(database);

    try {
      const result = await fn(database);
      if (persist || !dbExists) {
        this.persist(database);
      }
      return result;
    } finally {
      database.close();
    }
  }

  private ensureSchema(db: SqlJsDatabase): void {
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
      CREATE INDEX IF NOT EXISTS idx_customer_id ON customers (customer_id);
      CREATE INDEX IF NOT EXISTS idx_product_barcode ON products (barcode);
      CREATE INDEX IF NOT EXISTS idx_transaction_customer ON transactions (customer_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_timestamp ON transactions (timestamp);
    `);
  }

  private persist(db: SqlJsDatabase): void {
    const data = db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  private fetchOne<T>(stmt: Statement): T | null {
    try {
      if (!stmt.step()) {
        return null;
      }
      return stmt.getAsObject() as unknown as T;
    } finally {
      stmt.free();
    }
  }

  private fetchAll<T>(stmt: Statement): T[] {
    const rows: T[] = [];
    try {
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as unknown as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private generateTransactionId(): string {
    return `TXN_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  public async getCustomerById(customerId: string): Promise<Customer | null> {
    return this.withDatabase((db) => {
      const stmt = db.prepare('SELECT * FROM customers WHERE customer_id = ?');
      stmt.bind([customerId]);
      return this.fetchOne<Customer>(stmt);
    });
  }

  public async getCustomerTransactions(
    customerId: string,
    limit: number = 10
  ): Promise<TransactionLog[]> {
    return this.withDatabase((db) => {
      const stmt = db.prepare(`
        SELECT t.*, p.name as product_name
        FROM transactions t
        LEFT JOIN products p ON t.product_id = p.product_id
        WHERE t.customer_id = ?
        ORDER BY t.timestamp DESC
        LIMIT ?
      `);
      stmt.bind([customerId, limit]);
      return this.fetchAll<TransactionLog>(stmt);
    });
  }

  public async getProductByBarcode(barcode: string): Promise<Product | null> {
    return this.withDatabase((db) => {
      const stmt = db.prepare(
        'SELECT * FROM products WHERE barcode = ? AND active = 1'
      );
      stmt.bind([barcode]);
      return this.fetchOne<Product>(stmt);
    });
  }

  public async updateCustomerBalance(
    customerId: string,
    newBalance: number
  ): Promise<void> {
    await this.withDatabase((db) => {
      const stmt = db.prepare(`
        UPDATE customers
        SET balance = ?, updated_at = datetime('now')
        WHERE customer_id = ?
      `);
      stmt.bind([newBalance, customerId]);
      stmt.step();
    }, true);
  }

  public async processPurchase(customerId: string, barcode: string) {
    return this.withDatabase((db) => {
      const customerStmt = db.prepare(
        'SELECT * FROM customers WHERE customer_id = ?'
      );
      customerStmt.bind([customerId]);
      const customer = this.fetchOne<Customer>(customerStmt);
      if (!customer) {
        throw new Error('Customer not found');
      }

      const productStmt = db.prepare(
        'SELECT * FROM products WHERE barcode = ? AND active = 1'
      );
      productStmt.bind([barcode]);
      const product = this.fetchOne<Product>(productStmt);
      if (!product) {
        throw new Error('Product not found or inactive');
      }

      if (customer.balance < product.price) {
        throw new Error('Insufficient balance');
      }

      const newBalance = customer.balance - product.price;

      const updateStmt = db.prepare(`
        UPDATE customers
        SET balance = ?, updated_at = datetime('now')
        WHERE customer_id = ?
      `);
      updateStmt.bind([newBalance, customerId]);
      updateStmt.step();
      updateStmt.free();

      const transactionId = this.generateTransactionId();
      const insertStmt = db.prepare(`
        INSERT INTO transactions (
          transaction_id,
          customer_id,
          type,
          product_id,
          amount,
          balance_after
        ) VALUES (?, ?, 'purchase', ?, ?, ?)
      `);
      insertStmt.bind([
        transactionId,
        customerId,
        product.product_id,
        -product.price,
        newBalance,
      ]);
      insertStmt.step();
      insertStmt.free();

      const selectTransaction = db.prepare(
        'SELECT * FROM transactions WHERE transaction_id = ?'
      );
      selectTransaction.bind([transactionId]);
      const transaction = this.fetchOne<Transaction>(selectTransaction);
      if (!transaction) {
        throw new Error('Failed to record transaction');
      }

      return {
        transaction,
        product,
        oldBalance: customer.balance,
        newBalance,
      };
    }, true);
  }

  public async processDeposit(
    customerId: string,
    amount: number,
    note?: string
  ) {
    return this.withDatabase((db) => {
      const customerStmt = db.prepare(
        'SELECT * FROM customers WHERE customer_id = ?'
      );
      customerStmt.bind([customerId]);
      const customer = this.fetchOne<Customer>(customerStmt);
      if (!customer) {
        throw new Error('Customer not found');
      }

      const newBalance = customer.balance + amount;

      const updateStmt = db.prepare(`
        UPDATE customers
        SET balance = ?, updated_at = datetime('now')
        WHERE customer_id = ?
      `);
      updateStmt.bind([newBalance, customerId]);
      updateStmt.step();
      updateStmt.free();

      const transactionId = this.generateTransactionId();
      const insertStmt = db.prepare(`
        INSERT INTO transactions (
          transaction_id,
          customer_id,
          type,
          amount,
          balance_after,
          note
        ) VALUES (?, ?, 'deposit', ?, ?, ?)
      `);
      insertStmt.bind([
        transactionId,
        customerId,
        amount,
        newBalance,
        note ?? null,
      ]);
      insertStmt.step();
      insertStmt.free();

      const selectTransaction = db.prepare(
        'SELECT * FROM transactions WHERE transaction_id = ?'
      );
      selectTransaction.bind([transactionId]);
      const transaction = this.fetchOne<Transaction>(selectTransaction);
      if (!transaction) {
        throw new Error('Failed to record transaction');
      }

      return {
        transaction,
        oldBalance: customer.balance,
        newBalance,
      };
    }, true);
  }

  public async processAdjustment(
    customerId: string,
    amount: number,
    note?: string
  ) {
    return this.withDatabase((db) => {
      const customerStmt = db.prepare(
        'SELECT * FROM customers WHERE customer_id = ?'
      );
      customerStmt.bind([customerId]);
      const customer = this.fetchOne<Customer>(customerStmt);
      if (!customer) {
        throw new Error('Customer not found');
      }

      const newBalance = customer.balance + amount;
      if (newBalance < 0 && Math.abs(amount) > 50) {
        throw new Error('Adjustment would result in very negative balance');
      }

      const updateStmt = db.prepare(`
        UPDATE customers
        SET balance = ?, updated_at = datetime('now')
        WHERE customer_id = ?
      `);
      updateStmt.bind([newBalance, customerId]);
      updateStmt.step();
      updateStmt.free();

      const transactionId = this.generateTransactionId();
      const insertStmt = db.prepare(`
        INSERT INTO transactions (
          transaction_id,
          customer_id,
          type,
          amount,
          balance_after,
          note
        ) VALUES (?, ?, 'adjustment', ?, ?, ?)
      `);
      insertStmt.bind([
        transactionId,
        customerId,
        amount,
        newBalance,
        note ?? null,
      ]);
      insertStmt.step();
      insertStmt.free();

      const selectTransaction = db.prepare(
        'SELECT * FROM transactions WHERE transaction_id = ?'
      );
      selectTransaction.bind([transactionId]);
      const transaction = this.fetchOne<Transaction>(selectTransaction);
      if (!transaction) {
        throw new Error('Failed to record transaction');
      }

      return {
        transaction,
        oldBalance: customer.balance,
        newBalance,
      };
    }, true);
  }

  public async backup(backupPath: string): Promise<void> {
    return this.withDatabase((db) => {
      this.persist(db);
      fs.copyFileSync(this.dbPath, backupPath);
    });
  }
}

export default DatabaseManager;