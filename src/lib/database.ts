import fs from 'fs';
import path from 'path';
import type { Database as SqlJsDatabase, SqlJsStatic, Statement } from 'sql.js';
import {
  Customer,
  Product,
  ProductOptionGroup,
  ProductOptionSelection,
  QuickKeySlot,
  Transaction,
  TransactionExportRow,
  TransactionLog,
  TransactionOptionSelection,
} from '@/types/database';

const QUICK_KEY_SETTING_KEY = 'quick_keys';
const MAX_QUICK_KEYS = 5;
const BACKUP_FOLDER_NAME = 'backups';
const BACKUP_META_FILE_NAME = 'backup-metadata.json';
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BACKUP_RETENTION_COUNT = 14; // keep the last 14 backups (roughly two weeks)
const BACKUP_RETENTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // drop anything older than 30 days

export interface BulkCustomerInput {
  customerId: string;
  name?: string;
  initialBalance?: number;
  discountPercent?: number;
  discountFlat?: number;
}

export interface BulkProductInput {
  productId?: string;
  name: string;
  price: number;
  barcode?: string;
  category?: string;
  active?: boolean;
  options?: ProductOptionGroup[];
  discountPercent?: number;
  discountFlat?: number;
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private static backupSchedulerInitialized = false;
  private static backupSchedulerHandle: NodeJS.Timeout | null = null;
  private static backupInProgress = false;
  private static lastBackupTimestamp: number | null = null;
  private readonly dbPath: string;
  private readonly backupDir: string;
  private readonly backupMetaPath: string;
  private readonly sqlPromise: Promise<SqlJsStatic>;

  private constructor() {
    const dataRoot = process.env.CANTEEN_DATA_DIR && process.env.CANTEEN_DATA_DIR.trim().length > 0
      ? process.env.CANTEEN_DATA_DIR.trim()
      : process.cwd();
    try {
      fs.mkdirSync(dataRoot, { recursive: true });
    } catch (error) {
      console.warn('Failed to ensure data directory', error);
    }
    this.dbPath = path.join(dataRoot, 'canteen.db');
    this.backupDir = path.join(dataRoot, BACKUP_FOLDER_NAME);
    this.backupMetaPath = path.join(this.backupDir, BACKUP_META_FILE_NAME);
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
    } catch (error) {
      console.warn('Failed to ensure backup directory', error);
    }
    if (!fs.existsSync(this.dbPath)) {
      const bundledDb = path.join(process.cwd(), 'canteen.db');
      try {
        if (fs.existsSync(bundledDb)) {
          fs.copyFileSync(bundledDb, this.dbPath);
        }
      } catch (error) {
        console.warn('Failed to copy bundled database to writable directory', error);
      }
    }
    this.sqlPromise = this.loadSqlJs();
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      const initialized = new DatabaseManager();
      DatabaseManager.instance = initialized;
      initialized.initializeBackgroundTasks();
    }
    return DatabaseManager.instance;
  }

  private initializeBackgroundTasks(): void {
    if (DatabaseManager.backupSchedulerInitialized) {
      return;
    }

    DatabaseManager.backupSchedulerInitialized = true;
    this.loadBackupMetadata();

    // Kick off an initial backup asynchronously so startup requests are not blocked.
    void this.performScheduledBackup(false);
    this.scheduleAutomaticBackups();

    process.once('exit', () => {
      if (DatabaseManager.backupSchedulerHandle) {
        clearInterval(DatabaseManager.backupSchedulerHandle);
        DatabaseManager.backupSchedulerHandle = null;
      }
    });
  }

  private scheduleAutomaticBackups(): void {
    if (DatabaseManager.backupSchedulerHandle) {
      return;
    }

    const runner = () => {
      void this.performScheduledBackup(false);
    };

    DatabaseManager.backupSchedulerHandle = setInterval(runner, BACKUP_INTERVAL_MS);
    if (typeof DatabaseManager.backupSchedulerHandle.unref === 'function') {
      DatabaseManager.backupSchedulerHandle.unref();
    }
  }

  private loadBackupMetadata(): void {
    try {
      const raw = fs.readFileSync(this.backupMetaPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.lastBackupAt === 'string') {
        const timestamp = Date.parse(parsed.lastBackupAt);
        if (!Number.isNaN(timestamp)) {
          DatabaseManager.lastBackupTimestamp = timestamp;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.warn('Failed to read backup metadata', error);
      }
    }
  }

  private writeBackupMetadata(timestamp: Date): void {
    const payload = {
      lastBackupAt: timestamp.toISOString(),
    };

    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      fs.writeFileSync(this.backupMetaPath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (error) {
      console.warn('Failed to persist backup metadata', error);
    }
  }

  private async performScheduledBackup(force: boolean): Promise<void> {
    if (DatabaseManager.backupInProgress) {
      return;
    }

    const lastBackup = DatabaseManager.lastBackupTimestamp;
    const now = Date.now();
    if (!force && lastBackup && now - lastBackup < BACKUP_INTERVAL_MS * 0.9) {
      return;
    }

    DatabaseManager.backupInProgress = true;

    try {
      const timestamp = new Date();
      const fileName = `canteen-${this.formatBackupTimestamp(timestamp)}.db`;
      const destination = path.join(this.backupDir, fileName);

      await this.backup(destination);

      DatabaseManager.lastBackupTimestamp = timestamp.getTime();
      this.writeBackupMetadata(timestamp);
      this.enforceBackupRetention();
    } catch (error) {
      console.error('Automatic database backup failed', error);
    } finally {
      DatabaseManager.backupInProgress = false;
    }
  }

  private enforceBackupRetention(): void {
    let entries: Array<{ path: string; createdAt: number }>; // ensure scope typed
    try {
      entries = fs
        .readdirSync(this.backupDir)
        .filter((entry) => entry.toLowerCase().endsWith('.db'))
        .map((entry) => {
          const fullPath = path.join(this.backupDir, entry);
          try {
            const stats = fs.statSync(fullPath);
            const createdAt = stats.birthtimeMs || stats.mtimeMs || 0;
            return { path: fullPath, createdAt };
          } catch (error) {
            console.warn('Failed to inspect backup file', fullPath, error);
            return null;
          }
        })
        .filter((value): value is { path: string; createdAt: number } => Boolean(value))
        .sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      console.warn('Failed to enumerate backup files for retention', error);
      return;
    }

    entries.forEach((entry, index) => {
      const tooMany = index >= BACKUP_RETENTION_COUNT;
      const tooOld = Date.now() - entry.createdAt > BACKUP_RETENTION_MAX_AGE_MS;
      if (!tooMany && !tooOld) {
        return;
      }

      try {
        fs.unlinkSync(entry.path);
      } catch (error) {
        console.warn('Failed to remove outdated backup', entry.path, error);
      }
    });
  }

  private formatBackupTimestamp(date: Date): string {
    const pad = (value: number) => value.toString().padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
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
        discount_percent REAL DEFAULT 0,
        discount_flat REAL DEFAULT 0,
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
        options_json TEXT,
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
        options_json TEXT,
        voided BOOLEAN DEFAULT 0,
        voided_at DATETIME,
        void_note TEXT,
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
  this.ensureColumn(db, 'products', 'discount_percent', 'REAL DEFAULT 0');
  this.ensureColumn(db, 'products', 'discount_flat', 'REAL DEFAULT 0');
    this.ensureColumn(db, 'customers', 'discount_percent', 'REAL DEFAULT 0');
    this.ensureColumn(db, 'customers', 'discount_flat', 'REAL DEFAULT 0');
    this.ensureColumn(db, 'transactions', 'options_json', 'TEXT');
    this.ensureColumn(db, 'transactions', 'voided', 'BOOLEAN DEFAULT 0');
    this.ensureColumn(db, 'transactions', 'voided_at', 'DATETIME');
    this.ensureColumn(db, 'transactions', 'void_note', 'TEXT');
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

              const priceDeltaRaw = (choice as { priceDelta?: unknown }).priceDelta;
              const priceDelta =
                typeof priceDeltaRaw === 'number' && Number.isFinite(priceDeltaRaw)
                  ? priceDeltaRaw
                  : 0;

              return {
                id: normalizedId,
                label,
                priceDelta,
              };
            })
            .filter((value): value is { id: string; label: string; priceDelta: number } =>
              Boolean(value)
            )
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
      const sanitized: ProductOptionGroup[] = [];

      parsed.forEach((group) => {
        if (!group || typeof group !== 'object') {
          return;
        }

        const name = typeof (group as { name?: unknown }).name === 'string'
          ? (group as { name: string }).name
          : '';
        if (!name.trim()) {
          return;
        }

        const groupId = typeof (group as { id?: unknown }).id === 'string'
          ? (group as { id: string }).id
          : `grp_${Math.random().toString(36).slice(2, 10)}`;

        const required = Boolean((group as { required?: unknown }).required);
        const multiple = Boolean((group as { multiple?: unknown }).multiple);

        const choicesSource = Array.isArray((group as { choices?: unknown }).choices)
          ? ((group as { choices: unknown[] }).choices)
          : [];

        const sanitizedChoices = choicesSource
          .map((choice) => {
            if (!choice || typeof choice !== 'object') {
              return null;
            }

            const label = typeof (choice as { label?: unknown }).label === 'string'
              ? (choice as { label: string }).label.trim()
              : '';
            if (!label) {
              return null;
            }

            const id = typeof (choice as { id?: unknown }).id === 'string'
              ? (choice as { id: string }).id
              : `opt_${Math.random().toString(36).slice(2, 10)}`;

            const rawDelta = (choice as { priceDelta?: unknown }).priceDelta;
            const priceDelta =
              typeof rawDelta === 'number' && Number.isFinite(rawDelta) ? rawDelta : 0;

            return {
              id,
              label,
              priceDelta,
            };
          })
          .filter((value): value is { id: string; label: string; priceDelta: number } =>
            Boolean(value)
          );

        if (sanitizedChoices.length === 0) {
          return;
        }

        sanitized.push({
          id: groupId,
          name: name.trim(),
          required,
          multiple,
          choices: sanitizedChoices,
        });
      });

      return sanitized.length > 0 ? sanitized : undefined;
    } catch (error) {
      console.warn('Failed to parse product options JSON', error);
      return undefined;
    }
  }

  private hydrateProduct(raw: Product): Product {
    const options = this.parseProductOptions(raw.options_json ?? null);
    const discountPercent =
      typeof (raw as { discount_percent?: unknown }).discount_percent === 'number'
        ? (raw as { discount_percent: number }).discount_percent
        : 0;
    const discountFlat =
      typeof (raw as { discount_flat?: unknown }).discount_flat === 'number'
        ? (raw as { discount_flat: number }).discount_flat
        : 0;
    return {
      ...raw,
      discount_percent: discountPercent,
      discount_flat: discountFlat,
      options,
    };
  }

  private hydrateCustomer(raw: Customer): Customer {
    const discountPercent =
      typeof (raw as { discount_percent?: unknown }).discount_percent === 'number'
        ? (raw as { discount_percent: number }).discount_percent
        : 0;
    const discountFlat =
      typeof (raw as { discount_flat?: unknown }).discount_flat === 'number'
        ? (raw as { discount_flat: number }).discount_flat
        : 0;

    return {
      ...raw,
      discount_percent: discountPercent,
      discount_flat: discountFlat,
    };
  }

  private normalizeOptionSelections(
    product: Product,
    selections?: ProductOptionSelection[] | null
  ): { selections: TransactionOptionSelection[]; totalDelta: number } {
    const optionGroups = Array.isArray(product.options) ? product.options : [];
    if (optionGroups.length === 0 || !Array.isArray(selections) || selections.length === 0) {
      return { selections: [], totalDelta: 0 };
    }

    const groupById = new Map<string, ProductOptionGroup>();
    optionGroups.forEach((group) => {
      groupById.set(group.id, group);
    });

    const normalizedChoicesByGroup = new Map<string, string[]>();

    selections.forEach((selection) => {
      if (!selection || typeof selection.groupId !== 'string') {
        return;
      }

      const trimmedGroupId = selection.groupId.trim();
      if (!trimmedGroupId) {
        return;
      }

      const group = groupById.get(trimmedGroupId);
      if (!group) {
        console.warn('Ignoring option selection for unknown group', trimmedGroupId);
        return;
      }

      const choiceIds = Array.isArray(selection.choiceIds) ? selection.choiceIds : [];
      const normalized: string[] = [];
      const seen = new Set<string>();

      for (const rawChoiceId of choiceIds) {
        if (typeof rawChoiceId !== 'string') {
          continue;
        }
        const trimmedChoiceId = rawChoiceId.trim();
        if (!trimmedChoiceId || seen.has(trimmedChoiceId)) {
          continue;
        }

        const choiceExists = group.choices.some((choice) => choice.id === trimmedChoiceId);
        if (!choiceExists) {
          continue;
        }

        normalized.push(trimmedChoiceId);
        seen.add(trimmedChoiceId);

        if (!group.multiple) {
          break;
        }
      }

      normalizedChoicesByGroup.set(group.id, normalized);
    });

    const selectionsSnapshot: TransactionOptionSelection[] = [];
    let totalDelta = 0;

    optionGroups.forEach((group) => {
      const selectedIds = normalizedChoicesByGroup.get(group.id) ?? [];

      if (group.required && selectedIds.length === 0) {
        throw new Error(`Selection required for "${group.name}"`);
      }

      if (selectedIds.length === 0) {
        return;
      }

      const resolvedChoices = selectedIds
        .map((choiceId) => group.choices.find((choice) => choice.id === choiceId))
        .filter((choice): choice is ProductOptionGroup['choices'][number] => Boolean(choice))
        .map((choice) => ({
          id: choice.id,
          label: choice.label,
          priceDelta:
            typeof choice.priceDelta === 'number' && Number.isFinite(choice.priceDelta)
              ? choice.priceDelta
              : 0,
        }));

      const groupDelta = resolvedChoices.reduce((sum, choice) => sum + choice.priceDelta, 0);

      if (group.required && resolvedChoices.length === 0) {
        throw new Error(`Selection required for "${group.name}"`);
      }

      if (resolvedChoices.length === 0) {
        return;
      }

      totalDelta += groupDelta;

      selectionsSnapshot.push({
        groupId: group.id,
        groupName: group.name,
        multiple: group.multiple,
        required: group.required,
        choices: resolvedChoices,
        delta: groupDelta,
      });
    });

    return { selections: selectionsSnapshot, totalDelta };
  }

  private roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private applyDiscount(value: number, percent?: number, flat?: number): number {
    let result = value;

    if (typeof percent === 'number' && Number.isFinite(percent) && percent > 0) {
      const boundedPercent = Math.min(100, Math.max(0, percent));
      result = this.roundCurrency(result - result * (boundedPercent / 100));
    }

    if (typeof flat === 'number' && Number.isFinite(flat) && flat > 0) {
      result = this.roundCurrency(result - flat);
    }

    return result < 0 ? 0 : result;
  }

  private parseTransactionOptions(
    optionsJson?: string | null
  ): TransactionOptionSelection[] | undefined {
    if (!optionsJson) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(optionsJson);
      if (!Array.isArray(parsed)) {
        return undefined;
      }

      const sanitized: TransactionOptionSelection[] = [];

      parsed.forEach((group) => {
        if (!group || typeof group !== 'object') {
          return;
        }

        const groupId = typeof (group as { groupId?: unknown }).groupId === 'string'
          ? (group as { groupId: string }).groupId
          : '';
        const groupName = typeof (group as { groupName?: unknown }).groupName === 'string'
          ? (group as { groupName: string }).groupName
          : '';

        if (!groupId || !groupName) {
          return;
        }

        const multiple = Boolean((group as { multiple?: unknown }).multiple);
        const required = Boolean((group as { required?: unknown }).required);
        const deltaRaw = (group as { delta?: unknown }).delta;
        const delta =
          typeof deltaRaw === 'number' && Number.isFinite(deltaRaw)
            ? deltaRaw
            : 0;

        const choicesSource = Array.isArray((group as { choices?: unknown }).choices)
          ? ((group as { choices: unknown[] }).choices)
          : [];

        const choices = choicesSource
          .map((choice) => {
            if (!choice || typeof choice !== 'object') {
              return null;
            }

            const id = typeof (choice as { id?: unknown }).id === 'string'
              ? (choice as { id: string }).id
              : '';
            const label = typeof (choice as { label?: unknown }).label === 'string'
              ? (choice as { label: string }).label
              : '';
            if (!id || !label) {
              return null;
            }

            const priceDeltaRaw = (choice as { priceDelta?: unknown }).priceDelta;
            const priceDelta =
              typeof priceDeltaRaw === 'number' && Number.isFinite(priceDeltaRaw)
                ? priceDeltaRaw
                : 0;

            return { id, label, priceDelta };
          })
          .filter((choice): choice is { id: string; label: string; priceDelta: number } =>
            Boolean(choice)
          );

        if (choices.length === 0) {
          return;
        }

        sanitized.push({
          groupId,
          groupName,
          multiple,
          required,
          delta,
          choices,
        });
      });

      return sanitized.length > 0 ? sanitized : undefined;
    } catch (error) {
      console.warn('Failed to parse transaction options JSON', error);
      return undefined;
    }
  }

  private hydrateTransaction(raw: Transaction): Transaction {
    const voided = Boolean((raw as { voided?: unknown }).voided);
    const options = this.parseTransactionOptions(raw.options_json ?? null);

    const rawVoidedAt = (raw as { voided_at?: unknown }).voided_at;
    const voidedAt = typeof rawVoidedAt === 'string' ? rawVoidedAt : null;

    const rawVoidNote = (raw as { void_note?: unknown }).void_note;
    const voidNote = typeof rawVoidNote === 'string' ? rawVoidNote : null;

    return {
      ...raw,
      voided,
      options_json: raw.options_json ?? null,
      voided_at: voidedAt,
      void_note: voidNote,
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
    initialBalance: number = 0,
    discountPercent: number = 0,
    discountFlat: number = 0
  ): Promise<Customer> {
    if (!/^[0-9]{4}$/.test(customerId)) {
      throw new Error('Customer ID must be exactly 4 digits');
    }

    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      throw new Error('Initial balance must be zero or a positive number');
    }

    const normalizedPercent =
      Number.isFinite(discountPercent) && discountPercent > 0
        ? Math.min(100, Math.max(0, discountPercent))
        : 0;
    const normalizedFlat =
      Number.isFinite(discountFlat) && discountFlat > 0 ? Math.max(0, discountFlat) : 0;

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
        INSERT INTO customers (customer_id, name, balance, discount_percent, discount_flat)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertStmt.bind([
        customerId,
        name ?? null,
        initialBalance,
        normalizedPercent,
        normalizedFlat,
      ]);
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
      const customerRow = this.fetchOne<Customer>(selectStmt);

      if (!customerRow) {
        throw new Error('Failed to create customer');
      }

      return this.hydrateCustomer(customerRow);
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
        return this.fetchAll<Customer>(stmt).map((customer) => this.hydrateCustomer(customer));
      }

      const stmt = db.prepare(`
        SELECT *
        FROM customers
        ORDER BY updated_at DESC
        LIMIT ?
      `);
      stmt.bind([normalizedLimit]);
      return this.fetchAll<Customer>(stmt).map((customer) => this.hydrateCustomer(customer));
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
    discountPercent?: number;
    discountFlat?: number;
  }): Promise<Product> {
    const {
      productId,
      name,
      price,
      barcode,
      category,
      active = true,
      discountPercent = 0,
      discountFlat = 0,
    } = options;
    const normalizedOptions = this.normalizeProductOptions(options.options ?? null);
    const optionsJson = normalizedOptions ? JSON.stringify(normalizedOptions) : null;

    if (!name || name.trim().length === 0) {
      throw new Error('Product name is required');
    }

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Product price must be a positive number');
    }

    const finalProductId = (productId ?? '').trim() || this.generateProductId();

    const normalizedDiscountPercent =
      Number.isFinite(discountPercent) && discountPercent > 0
        ? Math.min(100, Math.max(0, discountPercent))
        : 0;
    const normalizedDiscountFlat =
      Number.isFinite(discountFlat) && discountFlat > 0 ? Math.max(0, discountFlat) : 0;

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
        INSERT INTO products (product_id, name, price, barcode, category, active, options_json, discount_percent, discount_flat)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.bind([
        finalProductId,
        name.trim(),
        price,
        barcode ?? null,
        category ?? null,
        active ? 1 : 0,
        optionsJson,
        normalizedDiscountPercent,
        normalizedDiscountFlat,
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
      const customer = this.fetchOne<Customer>(stmt);
      return customer ? this.hydrateCustomer(customer) : null;
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
      const rows = this.fetchAll<TransactionLog>(stmt);
      return rows.map((row) => ({
        ...this.hydrateTransaction(row),
        product_name: row.product_name,
      }));
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
    payload: {
      barcode?: string;
      productId?: string;
      note?: string;
      selectedOptions?: ProductOptionSelection[] | null;
    }
  ) {
    return this.withDatabase((db) => {
      const { barcode, productId, note, selectedOptions } = payload;

      if (!barcode && !productId) {
        throw new Error('Barcode or product ID is required');
      }

      const customerStmt = db.prepare(
        'SELECT * FROM customers WHERE customer_id = ?'
      );
      customerStmt.bind([customerId]);
      const customerRow = this.fetchOne<Customer>(customerStmt);
      if (!customerRow) {
        throw new Error('Customer not found');
      }
      const customer = this.hydrateCustomer(customerRow);

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

      const { selections: optionSelections, totalDelta } = this.normalizeOptionSelections(
        product,
        selectedOptions
      );

      const currentBalance = this.roundCurrency(customer.balance);
      const basePrice = this.roundCurrency(product.price);
      const optionsDelta = this.roundCurrency(totalDelta);
      const optionAdjustedPrice = this.roundCurrency(basePrice + optionsDelta);

      let finalPrice = optionAdjustedPrice;
      finalPrice = this.applyDiscount(finalPrice, product.discount_percent, product.discount_flat);
      finalPrice = this.applyDiscount(finalPrice, customer.discount_percent, customer.discount_flat);
      finalPrice = this.roundCurrency(finalPrice);

      if (currentBalance + 0.00001 < finalPrice) {
        throw new Error('Insufficient balance');
      }

      let amount = finalPrice === 0 ? 0 : this.roundCurrency(-finalPrice);
      if (Object.is(amount, -0)) {
        amount = 0;
      }

      let newBalance = this.roundCurrency(currentBalance + amount);
      if (newBalance < 0 && newBalance > -0.01) {
        newBalance = 0;
      }
      if (newBalance < 0) {
        throw new Error('Insufficient balance');
      }

      const selectionJson = optionSelections.length > 0 ? JSON.stringify(optionSelections) : null;

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
          note,
          options_json
        ) VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?)
      `);
      insertStmt.bind([
        transactionId,
        customerId,
        product.product_id,
        amount,
        newBalance,
        note ?? null,
        selectionJson,
      ]);
      insertStmt.step();
      insertStmt.free();

      const selectTransaction = db.prepare(
        'SELECT * FROM transactions WHERE transaction_id = ?'
      );
      selectTransaction.bind([transactionId]);
      const transactionRow = this.fetchOne<Transaction>(selectTransaction);
      if (!transactionRow) {
        throw new Error('Failed to record transaction');
      }

      const transaction = this.hydrateTransaction(transactionRow);

      return {
        transaction,
        product,
        optionSelections,
        chargedAmount: finalPrice,
        oldBalance: currentBalance,
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
      const transactionRow = this.fetchOne<Transaction>(selectTransaction);
      if (!transactionRow) {
        throw new Error('Failed to record transaction');
      }

      const transaction = this.hydrateTransaction(transactionRow);

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
      const transactionRow = this.fetchOne<Transaction>(selectTransaction);
      if (!transactionRow) {
        throw new Error('Failed to record transaction');
      }

      const transaction = this.hydrateTransaction(transactionRow);

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
      const transactionRow = this.fetchOne<Transaction>(transactionStmt);

      if (!transactionRow) {
        throw new Error('Transaction not found');
      }

      const transaction = this.hydrateTransaction(transactionRow);

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

      const currentBalance = this.roundCurrency(customer.balance);
      const amount = this.roundCurrency(transaction.amount);
      let newBalance = this.roundCurrency(currentBalance - amount);
      if (newBalance < 0 && newBalance > -0.01) {
        newBalance = 0;
      }

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

      return this.hydrateCustomer(customer);
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
      discountPercent?: number | null;
      discountFlat?: number | null;
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

      const nextDiscountPercentRaw = updates.discountPercent;
      const nextDiscountFlatRaw = updates.discountFlat;

      const nextDiscountPercent =
        nextDiscountPercentRaw === undefined
          ? existing.discount_percent ?? 0
          : nextDiscountPercentRaw === null
          ? 0
          : typeof nextDiscountPercentRaw === 'number' && Number.isFinite(nextDiscountPercentRaw)
          ? Math.min(100, Math.max(0, nextDiscountPercentRaw))
          : 0;

      const nextDiscountFlat =
        nextDiscountFlatRaw === undefined
          ? existing.discount_flat ?? 0
          : nextDiscountFlatRaw === null
          ? 0
          : typeof nextDiscountFlatRaw === 'number' && Number.isFinite(nextDiscountFlatRaw)
          ? Math.max(0, nextDiscountFlatRaw)
          : 0;

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
        SET name = ?, price = ?, barcode = ?, category = ?, active = ?, options_json = ?, discount_percent = ?, discount_flat = ?, updated_at = datetime('now')
        WHERE product_id = ?
      `);
      updateStmt.bind([
        nextName,
        nextPrice,
        nextBarcode,
        nextCategory,
        nextActive ? 1 : 0,
        nextOptionsJson,
        nextDiscountPercent,
        nextDiscountFlat,
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
          entry.initialBalance ?? 0,
          entry.discountPercent ?? 0,
          entry.discountFlat ?? 0
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
          discountPercent: entry.discountPercent,
          discountFlat: entry.discountFlat,
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