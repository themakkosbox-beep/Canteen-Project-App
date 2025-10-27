import fs from 'fs';
import path from 'path';
import type { Database as SqlJsDatabase, SqlJsStatic, Statement } from 'sql.js';
import {
  Customer,
  Product,
  ProductOptionGroup,
  QuickKeySlot,
  Transaction,
  TransactionExportRow,
  TransactionLog,
} from '@/types/database';

const QUICK_KEY_SETTING_KEY = 'quick_keys';
const MAX_QUICK_KEYS = 5;

export interface BulkCustomerInput {
  customerId: string;
  name?: string;
  initialBalance?: number;
}

export interface BulkProductInput {
  productId?: string;
  name: string;
  price: number;
  barcode?: string;
  category?: string;
  active?: boolean;
  options?: ProductOptionGroup[];
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private readonly dbPath: string;
  private readonly sqlPromise: Promise<SqlJsStatic>;

  private constructor() {
    this.dbPath = path.join(process.cwd(), 'canteen.db');
    this.sqlPromise = this.loadSqlJs();
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
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.ensureColumn(db, 'products', 'options_json', 'TEXT');
  }

  private readSetting(db: SqlJsDatabase, key: string): string | null {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    stmt.bind([key]);
    const row = this.fetchOne<{ value: string | null }>(stmt);
    return row?.value ?? null;
  }

  private writeSetting(db: SqlJsDatabase, key: string, value: string | null): void {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    stmt.bind([key, value ?? null]);
    stmt.step();
    stmt.free();
  }

  private persist(db: SqlJsDatabase): void {
    const data = db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  private ensureColumn(
    db: SqlJsDatabase,
    table: string,
    column: string,
    definition: string
  ): void {
    const infoStmt = db.prepare(`PRAGMA table_info(${table});`);
    const columns = this.fetchAll<{ name: string }>(infoStmt).map((row) => row.name);
    if (!columns.includes(column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
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

  private normalizeProductOptions(
    options?: ProductOptionGroup[] | null
  ): ProductOptionGroup[] | undefined {
    if (!options) {
      return undefined;
    }

    const normalized: ProductOptionGroup[] = [];

    options.forEach((group, groupIndex) => {
      if (!group) {
        return;
      }

      const name = typeof group.name === 'string' ? group.name.trim() : '';
      if (!name) {
        return;
      }

      const choices = Array.isArray(group.choices)
        ? group.choices
            .map((choice, choiceIndex) => {
              if (!choice) {
                return null;
              }

              const label = typeof choice.label === 'string' ? choice.label.trim() : '';
              if (!label) {
                return null;
              }

              const normalizedId =
                typeof choice.id === 'string' && choice.id.trim().length > 0
                  ? choice.id.trim()
                  : `opt_${groupIndex}_${choiceIndex}_${Math.random().toString(36).slice(2, 6)}`;

              return {
                id: normalizedId,
                label,
              };
            })
            .filter((value): value is { id: string; label: string } => Boolean(value))
        : [];

      if (choices.length === 0) {
        return;
      }

      const normalizedId =
        typeof group.id === 'string' && group.id.trim().length > 0
          ? group.id.trim()
          : `grp_${groupIndex}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      normalized.push({
        id: normalizedId,
        name,
        required: Boolean(group.required),
        multiple: Boolean(group.multiple),
        choices,
      });
    });

    return normalized.length > 0 ? normalized : undefined;
  }

  private parseProductOptions(
    optionsJson?: string | null
  ): ProductOptionGroup[] | undefined {
    if (!optionsJson) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(optionsJson);
      if (!Array.isArray(parsed)) {
        return undefined;
      }
      return parsed as ProductOptionGroup[];
    } catch (error) {
      console.warn('Failed to parse product options JSON', error);
      return undefined;
    }
  }

  private hydrateProduct(raw: Product): Product {
    const options = this.parseProductOptions(raw.options_json ?? null);
    return {
      ...raw,
      options,
    };
  }

  private resolveSqlJsFile(file: string): string {
    const paths: string[] = [];
    const cwd = process.cwd();
    paths.push(path.join(cwd, 'node_modules', 'sql.js', 'dist', file));
    paths.push(path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file));

    const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
    if (electronProcess.resourcesPath) {
      paths.push(
        path.join(
          electronProcess.resourcesPath,
          '.next',
          'standalone',
          'node_modules',
          'sql.js',
          'dist',
          file
        )
      );
      paths.push(
        path.join(
          electronProcess.resourcesPath,
          'node_modules',
          'sql.js',
          'dist',
          file
        )
      );
    }

    const uniquePaths = paths.filter((candidate, index) => paths.indexOf(candidate) === index);
    for (const candidate of uniquePaths) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        continue;
      }
    }

    return path.join('node_modules', 'sql.js', 'dist', file);
  }

  private async loadSqlJs(): Promise<SqlJsStatic> {
    type SqlJsInit = (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;

    const dynamicRequire = eval('require') as (moduleId: string) => unknown;
    const sqlModule = dynamicRequire('sql.js/dist/sql-wasm.js');
    const initSqlJs: SqlJsInit =
      ((sqlModule as { default?: SqlJsInit }).default as SqlJsInit | undefined) ??
      ((sqlModule as unknown) as SqlJsInit);

    if (typeof initSqlJs !== 'function') {
      throw new Error('Failed to load sql.js initializer');
    }

    return initSqlJs({
      locateFile: (file: string) => this.resolveSqlJsFile(file),
    });
  }

  private generateProductId(): string {
    return `PRD_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  public async createCustomer(
    customerId: string,
    name?: string,
    initialBalance: number = 0
  ): Promise<Customer> {
    if (!/^[0-9]{4}$/.test(customerId)) {
      throw new Error('Customer ID must be exactly 4 digits');
    }

    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      throw new Error('Initial balance must be zero or a positive number');
    }

    return this.withDatabase((db) => {
      const existingStmt = db.prepare(
        'SELECT 1 FROM customers WHERE customer_id = ?'
      );
      existingStmt.bind([customerId]);
      const exists = existingStmt.step();
      existingStmt.free();

      if (exists) {
        throw new Error('Customer ID already exists');
      }

      const insertStmt = db.prepare(`
        INSERT INTO customers (customer_id, name, balance)
        VALUES (?, ?, ?)
      `);
      insertStmt.bind([customerId, name ?? null, initialBalance]);
      insertStmt.step();
      insertStmt.free();

      if (initialBalance > 0) {
        const transactionId = this.generateTransactionId();
        const transactionStmt = db.prepare(`
          INSERT INTO transactions (
            transaction_id,
            customer_id,
            type,
            amount,
            balance_after,
            note
          ) VALUES (?, ?, 'deposit', ?, ?, ?)
        `);
        transactionStmt.bind([
          transactionId,
          customerId,
          initialBalance,
          initialBalance,
          'Initial balance allocation',
        ]);
        transactionStmt.step();
        transactionStmt.free();
      }

      const selectStmt = db.prepare(
        'SELECT * FROM customers WHERE customer_id = ?'
      );
      selectStmt.bind([customerId]);
      const customer = this.fetchOne<Customer>(selectStmt);

      if (!customer) {
        throw new Error('Failed to create customer');
      }

      return customer;
    }, true);
  }

  public async listCustomers(
    search?: string,
    limit: number = 50
  ): Promise<Customer[]> {
    const normalizedLimit = Math.max(1, Math.min(limit, 200));
    const trimmedSearch = search?.trim();

    return this.withDatabase((db) => {
      if (trimmedSearch && trimmedSearch.length > 0) {
        const stmt = db.prepare(`
          SELECT *
          FROM customers
          WHERE customer_id LIKE ? OR name LIKE ?
          ORDER BY updated_at DESC
          LIMIT ?
        `);
        stmt.bind([
          `${trimmedSearch}%`,
          `%${trimmedSearch}%`,
          normalizedLimit,
        ]);
        return this.fetchAll<Customer>(stmt);
      }

      const stmt = db.prepare(`
        SELECT *
        FROM customers
        ORDER BY updated_at DESC
        LIMIT ?
      `);
      stmt.bind([normalizedLimit]);
      return this.fetchAll<Customer>(stmt);
    });
  }

  public async createProduct(options: {
    productId?: string;
    name: string;
    price: number;
    barcode?: string;
    category?: string;
    active?: boolean;
    options?: ProductOptionGroup[];
  }): Promise<Product> {
    const { productId, name, price, barcode, category, active = true } = options;
    const normalizedOptions = this.normalizeProductOptions(options.options ?? null);
    const optionsJson = normalizedOptions ? JSON.stringify(normalizedOptions) : null;

    if (!name || name.trim().length === 0) {
      throw new Error('Product name is required');
    }

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Product price must be a positive number');
    }

    const finalProductId = (productId ?? '').trim() || this.generateProductId();

    return this.withDatabase((db) => {
      const idStmt = db.prepare('SELECT 1 FROM products WHERE product_id = ?');
      idStmt.bind([finalProductId]);
      const idExists = idStmt.step();
      idStmt.free();

      if (idExists) {
        throw new Error('Product ID already exists');
      }

      if (barcode) {
        const barcodeStmt = db.prepare(
          'SELECT 1 FROM products WHERE barcode = ?'
        );
        barcodeStmt.bind([barcode]);
        const barcodeExists = barcodeStmt.step();
        barcodeStmt.free();

        if (barcodeExists) {
          throw new Error('Barcode already assigned to another product');
        }
      }

      const insertStmt = db.prepare(`
        INSERT INTO products (product_id, name, price, barcode, category, active, options_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.bind([
        finalProductId,
        name.trim(),
        price,
        barcode ?? null,
        category ?? null,
        active ? 1 : 0,
        optionsJson,
      ]);
      insertStmt.step();
      insertStmt.free();

      const selectStmt = db.prepare(
        'SELECT * FROM products WHERE product_id = ?'
      );
      selectStmt.bind([finalProductId]);
      const product = this.fetchOne<Product>(selectStmt);

      if (!product) {
        throw new Error('Failed to create product');
      }

      return this.hydrateProduct(product);
    }, true);
  }

  public async listProducts(
    includeInactive: boolean = false,
    limit: number = 100,
    search?: string,
    category?: string
  ): Promise<Product[]> {
    const normalizedLimit = Math.max(1, Math.min(limit, 500));
    const trimmedSearch = search?.trim();
    const trimmedCategory = category?.trim();

    return this.withDatabase((db) => {
      const conditions: string[] = [];
      const params: (string | number | null)[] = [];

      if (!includeInactive) {
        conditions.push('active = 1');
      }

      if (trimmedSearch && trimmedSearch.length > 0) {
        conditions.push(
          '(name LIKE ? OR product_id LIKE ? OR barcode LIKE ? OR category LIKE ?)' 
        );
  const likeValue = `%${trimmedSearch}%`;
  params.push(likeValue, likeValue, likeValue, likeValue);
      }

      if (trimmedCategory && trimmedCategory.length > 0) {
        conditions.push('category = ?');
        params.push(trimmedCategory);
      }

      let query = 'SELECT * FROM products';
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += includeInactive
        ? ' ORDER BY active DESC, name ASC'
        : ' ORDER BY name ASC';
      query += ' LIMIT ?';
      params.push(normalizedLimit);

      const stmt = db.prepare(query);
      stmt.bind(params);
      const rows = this.fetchAll<Product>(stmt);
      return rows.map((product) => this.hydrateProduct(product));
    });
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
      const product = this.fetchOne<Product>(stmt);
      return product ? this.hydrateProduct(product) : null;
    });
  }

  public async getProductById(
    productId: string,
    includeInactive: boolean = false
  ): Promise<Product | null> {
    return this.withDatabase((db) => {
      const stmt = includeInactive
        ? db.prepare('SELECT * FROM products WHERE product_id = ?')
        : db.prepare('SELECT * FROM products WHERE product_id = ? AND active = 1');
      stmt.bind([productId]);
      const product = this.fetchOne<Product>(stmt);
      return product ? this.hydrateProduct(product) : null;
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

  public async processPurchase(
    customerId: string,
    payload: { barcode?: string; productId?: string; note?: string }
  ) {
    return this.withDatabase((db) => {
      const { barcode, productId, note } = payload;

      if (!barcode && !productId) {
        throw new Error('Barcode or product ID is required');
      }

      const customerStmt = db.prepare(
        'SELECT * FROM customers WHERE customer_id = ?'
      );
      customerStmt.bind([customerId]);
      const customer = this.fetchOne<Customer>(customerStmt);
      if (!customer) {
        throw new Error('Customer not found');
      }

      let product: Product | null = null;
      if (barcode) {
        const productStmt = db.prepare(
          'SELECT * FROM products WHERE barcode = ? AND active = 1'
        );
        productStmt.bind([barcode]);
        const productRow = this.fetchOne<Product>(productStmt);
        product = productRow ? this.hydrateProduct(productRow) : null;
      } else if (productId) {
        const productStmt = db.prepare(
          'SELECT * FROM products WHERE product_id = ? AND active = 1'
        );
        productStmt.bind([productId]);
        const productRow = this.fetchOne<Product>(productStmt);
        product = productRow ? this.hydrateProduct(productRow) : null;
      }

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
          balance_after,
          note
        ) VALUES (?, ?, 'purchase', ?, ?, ?, ?)
      `);
      insertStmt.bind([
        transactionId,
        customerId,
        product.product_id,
        -product.price,
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
        product,
        oldBalance: customer.balance,
        newBalance,
      };
    }, true);
  }

  public async getQuickKeySlots(): Promise<QuickKeySlot[]> {
    return this.withDatabase((db) => {
      const rawValue = this.readSetting(db, QUICK_KEY_SETTING_KEY);
      let stored: Array<string | null> = [];

      if (rawValue) {
        try {
          const parsed = JSON.parse(rawValue);
          if (Array.isArray(parsed)) {
            stored = parsed
              .map((value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null))
              .slice(0, MAX_QUICK_KEYS);
          }
        } catch (error) {
          console.warn('Failed to parse quick key setting', error);
        }
      }

      while (stored.length < MAX_QUICK_KEYS) {
        stored.push(null);
      }

      if (stored.length > MAX_QUICK_KEYS) {
        stored = stored.slice(0, MAX_QUICK_KEYS);
      }

      const productIds = stored.filter((value): value is string => typeof value === 'string' && value.length > 0);
      let products: Product[] = [];

      if (productIds.length > 0) {
        const placeholders = productIds.map(() => '?').join(',');
        const stmt = db.prepare(`
          SELECT *
          FROM products
          WHERE product_id IN (${placeholders})
        `);
        stmt.bind(productIds);
        products = this.fetchAll<Product>(stmt).map((product) => this.hydrateProduct(product));
      }

      const productMap = new Map(products.map((product) => [product.product_id, product]));

      return stored.map((productId, index) => ({
        index,
        productId,
        product: productId ? productMap.get(productId) ?? null : null,
      }));
    });
  }

  public async setQuickKeyProductIds(productIds: Array<string | null | undefined>) {
    await this.withDatabase((db) => {
      const cleaned: Array<string | null> = [];

      productIds.forEach((value) => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          cleaned.push(trimmed.length > 0 ? trimmed : null);
        } else {
          cleaned.push(null);
        }
      });

      const uniqueOrdered: Array<string | null> = [];
      cleaned.forEach((value) => {
        if (value === null) {
          uniqueOrdered.push(null);
          return;
        }

        if (!uniqueOrdered.includes(value)) {
          uniqueOrdered.push(value);
        } else {
          uniqueOrdered.push(null);
        }
      });

      while (uniqueOrdered.length < MAX_QUICK_KEYS) {
        uniqueOrdered.push(null);
      }

      if (uniqueOrdered.length > MAX_QUICK_KEYS) {
        uniqueOrdered.length = MAX_QUICK_KEYS;
      }

      const candidateIds = uniqueOrdered.filter((value): value is string => Boolean(value));
      let validIds = new Set<string>();

      if (candidateIds.length > 0) {
        const placeholders = candidateIds.map(() => '?').join(',');
        const stmt = db.prepare(`
          SELECT product_id
          FROM products
          WHERE product_id IN (${placeholders})
        `);
        stmt.bind(candidateIds);
        const rows = this.fetchAll<{ product_id: string }>(stmt);
        validIds = new Set(rows.map((row) => row.product_id));
      }

      const normalized = uniqueOrdered.map((value) => (value && validIds.has(value) ? value : null));

      this.writeSetting(db, QUICK_KEY_SETTING_KEY, JSON.stringify(normalized));
    }, true);
  }

  public async listAllTransactions(): Promise<TransactionExportRow[]> {
    return this.withDatabase((db) => {
      const stmt = db.prepare(`
        SELECT
          t.transaction_id,
          t.timestamp,
          t.customer_id,
          c.name AS customer_name,
          t.type,
          t.product_id,
          p.name AS product_name,
          p.price AS product_price,
          t.amount,
          t.balance_after,
          t.note
        FROM transactions t
        LEFT JOIN customers c ON c.customer_id = t.customer_id
        LEFT JOIN products p ON p.product_id = t.product_id
        ORDER BY t.timestamp DESC, t.id DESC
      `);
      return this.fetchAll<TransactionExportRow>(stmt);
    });
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

  public async listProductCategories(): Promise<string[]> {
    return this.withDatabase((db) => {
      const stmt = db.prepare(`
        SELECT DISTINCT category
        FROM products
        WHERE category IS NOT NULL AND TRIM(category) <> ''
        ORDER BY category ASC
      `);
      const rows = this.fetchAll<{ category: string }>(stmt);
      return rows
        .map((row) => row.category)
        .filter((value): value is string => typeof value === 'string');
    });
  }

  public async deleteCustomers(customerIds: string[]) {
    const uniqueIds = Array.from(
      new Set(customerIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))
    );

    if (uniqueIds.length === 0) {
      return { removed: [] as string[], failed: [] as { customerId: string; error: string }[] };
    }

    return this.withDatabase((db) => {
      const removed: string[] = [];
      const failed: { customerId: string; error: string }[] = [];

      db.run('BEGIN TRANSACTION');
      try {
        for (const customerId of uniqueIds) {
          try {
            const transactionCheck = db.prepare(
              'SELECT COUNT(*) as total FROM transactions WHERE customer_id = ?'
            );
            transactionCheck.bind([customerId]);
            const countRow = transactionCheck.step()
              ? (transactionCheck.getAsObject() as { total?: number })
              : { total: 0 };
            transactionCheck.free();

            const transactionCount = typeof countRow.total === 'number' ? countRow.total : 0;
            if (transactionCount > 0) {
              failed.push({
                customerId,
                error: 'Customer has transaction history and cannot be deleted.',
              });
              continue;
            }

            const deleteStmt = db.prepare(
              'DELETE FROM customers WHERE customer_id = ?'
            );
            deleteStmt.bind([customerId]);
            deleteStmt.step();
            deleteStmt.free();

            const verifyStmt = db.prepare(
              'SELECT 1 FROM customers WHERE customer_id = ?'
            );
            verifyStmt.bind([customerId]);
            const stillExists = verifyStmt.step();
            verifyStmt.free();

            if (stillExists) {
              failed.push({
                customerId,
                error: 'Failed to delete customer.',
              });
            } else {
              removed.push(customerId);
            }
          } catch (error) {
            failed.push({
              customerId,
              error: error instanceof Error ? error.message : 'Failed to delete customer.',
            });
          }
        }

        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }

      return { removed, failed };
    }, true);
  }

  public async deleteProducts(productIds: string[]) {
    const uniqueIds = Array.from(
      new Set(productIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))
    );

    if (uniqueIds.length === 0) {
      return { removed: [] as string[], failed: [] as { productId: string; error: string }[] };
    }

    return this.withDatabase((db) => {
      const removed: string[] = [];
      const failed: { productId: string; error: string }[] = [];

      db.run('BEGIN TRANSACTION');
      try {
        for (const productId of uniqueIds) {
          try {
            const transactionCheck = db.prepare(
              'SELECT COUNT(*) as total FROM transactions WHERE product_id = ? AND product_id IS NOT NULL'
            );
            transactionCheck.bind([productId]);
            const countRow = transactionCheck.step()
              ? (transactionCheck.getAsObject() as { total?: number })
              : { total: 0 };
            transactionCheck.free();

            const transactionCount = typeof countRow.total === 'number' ? countRow.total : 0;
            if (transactionCount > 0) {
              failed.push({
                productId,
                error: 'Product has transaction history and cannot be deleted.',
              });
              continue;
            }

            const deleteStmt = db.prepare(
              'DELETE FROM products WHERE product_id = ?'
            );
            deleteStmt.bind([productId]);
            deleteStmt.step();
            deleteStmt.free();

            const verifyStmt = db.prepare(
              'SELECT 1 FROM products WHERE product_id = ?'
            );
            verifyStmt.bind([productId]);
            const stillExists = verifyStmt.step();
            verifyStmt.free();

            if (stillExists) {
              failed.push({
                productId,
                error: 'Failed to delete product.',
              });
            } else {
              removed.push(productId);
            }
          } catch (error) {
            failed.push({
              productId,
              error: error instanceof Error ? error.message : 'Failed to delete product.',
            });
          }
        }

        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }

      return { removed, failed };
    }, true);
  }

  public async updateProductsActiveStatus(productIds: string[], active: boolean) {
    const uniqueIds = Array.from(
      new Set(productIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))
    );

    if (uniqueIds.length === 0) {
      return { updated: [] as string[], failed: [] as { productId: string; error: string }[] };
    }

    return this.withDatabase((db) => {
      const updated: string[] = [];
      const failed: { productId: string; error: string }[] = [];

      db.run('BEGIN TRANSACTION');
      try {
        for (const productId of uniqueIds) {
          try {
            const existingStmt = db.prepare(
              'SELECT * FROM products WHERE product_id = ?'
            );
            existingStmt.bind([productId]);
            const existing = this.fetchOne<Product>(existingStmt);
            if (!existing) {
              failed.push({ productId, error: 'Product not found.' });
              continue;
            }

            const updateStmt = db.prepare(`
              UPDATE products
              SET active = ?, updated_at = datetime('now')
              WHERE product_id = ?
            `);
            updateStmt.bind([active ? 1 : 0, productId]);
            updateStmt.step();
            updateStmt.free();

            updated.push(productId);
          } catch (error) {
            failed.push({
              productId,
              error: error instanceof Error ? error.message : 'Failed to update product.',
            });
          }
        }

        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }

      return { updated, failed };
    }, true);
  }

  public async deleteTransaction(transactionId: string) {
    if (!transactionId) {
      throw new Error('Transaction ID is required');
    }

    return this.withDatabase((db) => {
      const transactionStmt = db.prepare(
        'SELECT * FROM transactions WHERE transaction_id = ?'
      );
      transactionStmt.bind([transactionId]);
      const transaction = this.fetchOne<Transaction>(transactionStmt);

      if (!transaction) {
        throw new Error('Transaction not found');
      }

      if (transaction.type !== 'purchase' && transaction.type !== 'deposit') {
        throw new Error('Only purchase or deposit transactions can be deleted');
      }

      const latestStmt = db.prepare(`
        SELECT transaction_id
        FROM transactions
        WHERE customer_id = ?
        ORDER BY timestamp DESC, id DESC
        LIMIT 1
      `);
      latestStmt.bind([transaction.customer_id]);
      const latest = this.fetchOne<{ transaction_id: string }>(latestStmt);
      if (!latest || latest.transaction_id !== transactionId) {
        throw new Error('Only the most recent transaction for the customer can be deleted');
      }

      const customerStmt = db.prepare(
        'SELECT * FROM customers WHERE customer_id = ?'
      );
      customerStmt.bind([transaction.customer_id]);
      const customer = this.fetchOne<Customer>(customerStmt);
      if (!customer) {
        throw new Error('Customer not found');
      }

      const newBalance = customer.balance - transaction.amount;

      const updateStmt = db.prepare(`
        UPDATE customers
        SET balance = ?, updated_at = datetime('now')
        WHERE customer_id = ?
      `);
      updateStmt.bind([newBalance, transaction.customer_id]);
      updateStmt.step();
      updateStmt.free();

      const deleteStmt = db.prepare(
        'DELETE FROM transactions WHERE transaction_id = ?'
      );
      deleteStmt.bind([transactionId]);
      deleteStmt.step();
      deleteStmt.free();

      return {
        transaction,
        customerId: transaction.customer_id,
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

  public async updateCustomer(
    customerId: string,
    updates: { name?: string }
  ): Promise<Customer> {
    const nextName = updates.name?.trim();
    if (!nextName) {
      throw new Error('Customer name is required');
    }

    return this.withDatabase((db) => {
      const existingStmt = db.prepare(
        'SELECT * FROM customers WHERE customer_id = ?'
      );
      existingStmt.bind([customerId]);
      const existing = this.fetchOne<Customer>(existingStmt);

      if (!existing) {
        throw new Error('Customer not found');
      }

      const updateStmt = db.prepare(`
        UPDATE customers
        SET name = ?, updated_at = datetime('now')
        WHERE customer_id = ?
      `);
      updateStmt.bind([nextName, customerId]);
      updateStmt.step();
      updateStmt.free();

      const selectStmt = db.prepare(
        'SELECT * FROM customers WHERE customer_id = ?'
      );
      selectStmt.bind([customerId]);
      const customer = this.fetchOne<Customer>(selectStmt);

      if (!customer) {
        throw new Error('Failed to update customer');
      }

      return customer;
    }, true);
  }

  public async updateProduct(
    productId: string,
    updates: {
      name?: string;
      price?: number;
      barcode?: string | null;
      category?: string | null;
      active?: boolean;
      options?: ProductOptionGroup[] | null;
    }
  ): Promise<Product> {
    return this.withDatabase((db) => {
      const existingStmt = db.prepare(
        'SELECT * FROM products WHERE product_id = ?'
      );
      existingStmt.bind([productId]);
      const existingRow = this.fetchOne<Product>(existingStmt);
      const existing = existingRow ? this.hydrateProduct(existingRow) : null;

      if (!existing) {
        throw new Error('Product not found');
      }

      const nextName = updates.name?.trim() ?? existing.name;
      if (!nextName) {
        throw new Error('Product name is required');
      }

      const nextPrice =
        updates.price !== undefined ? updates.price : existing.price;
      if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
        throw new Error('Product price must be a positive number');
      }

      const nextBarcode =
        updates.barcode === undefined
          ? existing.barcode ?? null
          : updates.barcode && updates.barcode.trim().length > 0
          ? updates.barcode.trim()
          : null;

      const nextCategory =
        updates.category === undefined
          ? existing.category ?? null
          : updates.category && updates.category.trim().length > 0
          ? updates.category.trim()
          : null;

      const nextActive =
        updates.active === undefined ? existing.active : updates.active;

      let nextOptionsJson = existing.options_json ?? null;
      let nextOptions = existing.options;
      if (updates.options !== undefined) {
        if (!updates.options || updates.options.length === 0) {
          nextOptionsJson = null;
          nextOptions = undefined;
        } else {
          const normalizedOptions = this.normalizeProductOptions(updates.options);
          nextOptionsJson = normalizedOptions ? JSON.stringify(normalizedOptions) : null;
          nextOptions = normalizedOptions;
        }
      }

      if (nextBarcode && nextBarcode !== existing.barcode) {
        const barcodeStmt = db.prepare(
          'SELECT 1 FROM products WHERE barcode = ? AND product_id <> ?'
        );
        barcodeStmt.bind([nextBarcode, productId]);
        const barcodeExists = barcodeStmt.step();
        barcodeStmt.free();
        if (barcodeExists) {
          throw new Error('Barcode already assigned to another product');
        }
      }

      const updateStmt = db.prepare(`
        UPDATE products
        SET name = ?, price = ?, barcode = ?, category = ?, active = ?, options_json = ?, updated_at = datetime('now')
        WHERE product_id = ?
      `);
      updateStmt.bind([
        nextName,
        nextPrice,
        nextBarcode,
        nextCategory,
        nextActive ? 1 : 0,
        nextOptionsJson,
        productId,
      ]);
      updateStmt.step();
      updateStmt.free();

      const selectStmt = db.prepare(
        'SELECT * FROM products WHERE product_id = ?'
      );
      selectStmt.bind([productId]);
      const productRow = this.fetchOne<Product>(selectStmt);

      if (!productRow) {
        throw new Error('Failed to update product');
      }

      const hydrated = this.hydrateProduct(productRow);
      return {
        ...hydrated,
        options: nextOptions ?? hydrated.options,
      };
    }, true);
  }

  public async bulkCreateCustomers(entries: BulkCustomerInput[]) {
    const created: Customer[] = [];
    const failed: { input: BulkCustomerInput; error: string }[] = [];

    for (const entry of entries) {
      try {
        const customer = await this.createCustomer(
          entry.customerId,
          entry.name,
          entry.initialBalance ?? 0
        );
        created.push(customer);
      } catch (error) {
        failed.push({
          input: entry,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { created, failed };
  }

  public async bulkCreateProducts(entries: BulkProductInput[]) {
    const created: Product[] = [];
    const failed: { input: BulkProductInput; error: string }[] = [];

    for (const entry of entries) {
      try {
        const product = await this.createProduct({
          productId: entry.productId,
          name: entry.name,
          price: entry.price,
          barcode: entry.barcode,
          category: entry.category,
          active: entry.active ?? true,
          options: entry.options,
        });
        created.push(product);
      } catch (error) {
        failed.push({
          input: entry,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { created, failed };
  }
}

export default DatabaseManager;