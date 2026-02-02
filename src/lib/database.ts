import crypto from 'crypto';
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
  TransactionStatsSummary,
  AppFeatureFlags,
  AppSettingsPayload,
  CustomerTypeDefinition,
  ShiftDefinition,
  BackupStatus,
  BackupResult,
} from '@/types/database';

const QUICK_KEY_SETTING_KEY = 'quick_keys';
const MAX_QUICK_KEYS = 6;
const BACKUP_FOLDER_NAME = 'backups';
const BACKUP_META_FILE_NAME = 'backup-metadata.json';
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BACKUP_RETENTION_COUNT = 14; // keep the last 14 backups (roughly two weeks)
const BACKUP_RETENTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // drop anything older than 30 days
const APP_BRAND_NAME_KEY = 'app_brand_name';
const APP_ADMIN_CODE_KEY = 'app_admin_code';
const APP_GLOBAL_DISCOUNT_PERCENT_KEY = 'app_global_discount_percent';
const APP_GLOBAL_DISCOUNT_FLAT_KEY = 'app_global_discount_flat';
const APP_SCHEMA_VERSION_KEY = 'app_schema_version';
const CUSTOMER_TYPES_SETTING_KEY = 'customer_types_v1';
const APP_FEATURE_FLAGS_KEY = 'app_feature_flags_v1';
const APP_SHIFT_DEFINITIONS_KEY = 'app_shift_definitions_v1';
const APP_ACTIVE_SHIFT_KEY = 'app_active_shift_v1';
const APP_PRINTER_STATIONS_KEY = 'app_printer_stations_v1';

const DEFAULT_FEATURE_FLAGS: AppFeatureFlags = {
  offlineStatus: true,
  dailyCloseout: true,
  inventoryAlerts: true,
  refundFlow: true,
  activityLog: true,
  backupReminders: true,
  customerQr: true,
};
const DEFAULT_SHIFTS: ShiftDefinition[] = [
  { id: 'breakfast', label: 'Breakfast', startTime: '07:00', endTime: '10:30' },
  { id: 'lunch', label: 'Lunch', startTime: '11:00', endTime: '14:00' },
  { id: 'dinner', label: 'Dinner', startTime: '17:00', endTime: '20:00' },
];
const DEFAULT_PRINTER_STATIONS = ['Kitchen', 'Snack Bar', 'Grill'];
const SCHEMA_VERSION = 2;
const ADMIN_CODE_HASH_ITERATIONS = 120000;
const ADMIN_CODE_HASH_SALT_BYTES = 16;
const ADMIN_CODE_HASH_DIGEST = 'sha256';
const TRANSACTION_STATS_CACHE_TTL_MS = 30 * 1000;

const DEFAULT_CUSTOMER_TYPES: CustomerTypeDefinition[] = [
  { id: 'camper', label: 'Camper', discount_percent: 0, discount_flat: 0 },
  { id: 'staff', label: 'Staff', discount_percent: 0, discount_flat: 0 },
  { id: 'guest', label: 'Guest', discount_percent: 0, discount_flat: 0 },
];

const getAdminCodePepper = (): string => process.env.CANTEEN_ADMIN_PEPPER ?? '';

const hashAdminCodeLegacy = (code: string): string =>
  `sha256:${crypto.createHash('sha256').update(code).digest('hex')}`;

const hashAdminCode = (code: string, salt?: Buffer): string => {
  const normalized = code.trim();
  const pepper = getAdminCodePepper();
  const saltBuffer = salt ?? crypto.randomBytes(ADMIN_CODE_HASH_SALT_BYTES);
  const derived = crypto.pbkdf2Sync(
    `${normalized}${pepper}`,
    saltBuffer,
    ADMIN_CODE_HASH_ITERATIONS,
    32,
    ADMIN_CODE_HASH_DIGEST
  );
  return `pbkdf2:${ADMIN_CODE_HASH_ITERATIONS}:${saltBuffer.toString('hex')}:${derived.toString('hex')}`;
};

const parsePbkdf2Hash = (
  storedHash: string
): { iterations: number; salt: Buffer; hash: Buffer } | null => {
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    return null;
  }

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return null;
  }

  const saltHex = parts[2];
  const hashHex = parts[3];
  if (!saltHex || !hashHex) {
    return null;
  }

  return {
    iterations,
    salt: Buffer.from(saltHex, 'hex'),
    hash: Buffer.from(hashHex, 'hex'),
  };
};

const sanitizeBrandName = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 60);
};

const clampPercent = (value: unknown): number => {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return 0;
  }
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(parsed * 100) / 100));
};

const clampCurrency = (value: unknown): number => {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return 0;
  }
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.round(parsed * 100) / 100);
};

const normalizeTypeId = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  if (!normalized) {
    return `type-${crypto.randomBytes(3).toString('hex')}`;
  }
  return normalized.slice(0, 32);
};

const clampDiscountValue = (value: unknown, isPercent: boolean): number => {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return 0;
  }
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  if (isPercent) {
    return Math.max(0, Math.min(100, Math.round(parsed * 100) / 100));
  }
  return Math.max(0, Math.round(parsed * 100) / 100);
};

const doesAdminCodeMatch = (storedHash: string | null, candidate: string): boolean => {
  if (!storedHash || !candidate) {
    return false;
  }

  const trimmedHash = storedHash.trim();
  const pbkdf2 = parsePbkdf2Hash(trimmedHash);
  if (pbkdf2) {
    const pepper = getAdminCodePepper();
    const candidateHash = crypto.pbkdf2Sync(
      `${candidate.trim()}${pepper}`,
      pbkdf2.salt,
      pbkdf2.iterations,
      pbkdf2.hash.length,
      ADMIN_CODE_HASH_DIGEST
    );
    if (candidateHash.length !== pbkdf2.hash.length) {
      return false;
    }
    return crypto.timingSafeEqual(candidateHash, pbkdf2.hash);
  }

  const normalized = trimmedHash.startsWith('sha256:') ? trimmedHash : hashAdminCodeLegacy(trimmedHash);
  const candidateHash = hashAdminCodeLegacy(candidate.trim());
  const storedBuffer = Buffer.from(normalized, 'utf8');
  const candidateBuffer = Buffer.from(candidateHash, 'utf8');
  if (storedBuffer.length !== candidateBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(storedBuffer, candidateBuffer);
};

const shouldUpgradeAdminHash = (storedHash: string): boolean =>
  !storedHash.trim().startsWith('pbkdf2:');

export interface BulkCustomerInput {
  customerId: string;
  name: string;
  initialBalance?: number;
  discountPercent?: number;
  discountFlat?: number;
  typeId?: string | null;
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
  availableShiftIds?: string[] | null;
  printerStation?: string | null;
  autoPrint?: boolean;
}

interface CustomerTypeInput {
  id?: string;
  label: string;
  discountPercent?: number;
  discountFlat?: number;
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private static backupSchedulerInitialized = false;
  private static backupSchedulerHandle: NodeJS.Timeout | null = null;
  private static backupInProgress = false;
  private static lastBackupTimestamp: number | null = null;
  private static lastBackupFileName: string | null = null;
  private static lastRestoreTimestamp: number | null = null;
  private static transactionStatsCache: { value: TransactionStatsSummary; cachedAt: number } | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly dataRoot: string;
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
    this.dataRoot = dataRoot;
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
      if (parsed && typeof parsed.lastBackupFile === 'string') {
        DatabaseManager.lastBackupFileName = parsed.lastBackupFile;
      }
      if (parsed && typeof parsed.lastRestoreAt === 'string') {
        const timestamp = Date.parse(parsed.lastRestoreAt);
        if (!Number.isNaN(timestamp)) {
          DatabaseManager.lastRestoreTimestamp = timestamp;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.warn('Failed to read backup metadata', error);
      }
    }
  }

  private writeBackupMetadata(options: {
    lastBackupAt?: Date | null;
    lastBackupFile?: string | null;
    lastRestoreAt?: Date | null;
  }): void {
    const payload = {
      lastBackupAt: options.lastBackupAt
        ? options.lastBackupAt.toISOString()
        : DatabaseManager.lastBackupTimestamp
        ? new Date(DatabaseManager.lastBackupTimestamp).toISOString()
        : null,
      lastBackupFile:
        options.lastBackupFile ??
        DatabaseManager.lastBackupFileName ??
        null,
      lastRestoreAt: options.lastRestoreAt
        ? options.lastRestoreAt.toISOString()
        : DatabaseManager.lastRestoreTimestamp
        ? new Date(DatabaseManager.lastRestoreTimestamp).toISOString()
        : null,
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
      DatabaseManager.lastBackupFileName = fileName;
      this.writeBackupMetadata({ lastBackupAt: timestamp, lastBackupFile: fileName });
      this.enforceBackupRetention();
    } catch (error) {
      console.error('Automatic database backup failed', error);
    } finally {
      DatabaseManager.backupInProgress = false;
    }
  }

  public async getBackupStatus(): Promise<BackupStatus> {
    return {
      dataDirectory: this.dataRoot,
      dbPath: this.dbPath,
      backupDirectory: this.backupDir,
      lastBackupAt: DatabaseManager.lastBackupTimestamp
        ? new Date(DatabaseManager.lastBackupTimestamp).toISOString()
        : null,
      lastBackupFile: DatabaseManager.lastBackupFileName,
      lastRestoreAt: DatabaseManager.lastRestoreTimestamp
        ? new Date(DatabaseManager.lastRestoreTimestamp).toISOString()
        : null,
    };
  }

  public async createBackup(): Promise<BackupResult> {
    if (DatabaseManager.backupInProgress) {
      throw new Error('Backup already in progress');
    }

    DatabaseManager.backupInProgress = true;
    try {
      const timestamp = new Date();
      const fileName = `canteen-${this.formatBackupTimestamp(timestamp)}.db`;
      const destination = path.join(this.backupDir, fileName);

      fs.mkdirSync(this.backupDir, { recursive: true });
      await this.backup(destination);

      const stats = fs.statSync(destination);
      DatabaseManager.lastBackupTimestamp = timestamp.getTime();
      DatabaseManager.lastBackupFileName = fileName;
      this.writeBackupMetadata({ lastBackupAt: timestamp, lastBackupFile: fileName });
      this.enforceBackupRetention();

      return {
        fileName,
        createdAt: timestamp.toISOString(),
        size: stats.size,
      };
    } finally {
      DatabaseManager.backupInProgress = false;
    }
  }

  public async restoreBackupFromPath(backupPath: string): Promise<void> {
    if (!backupPath || backupPath.trim().length === 0) {
      throw new Error('Backup path is required');
    }

    const resolvedPath = path.resolve(backupPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('Backup file not found');
    }

    if (DatabaseManager.backupInProgress) {
      throw new Error('Backup already in progress');
    }

    await this.queueOperation(async () => {
      DatabaseManager.backupInProgress = true;
      try {
        fs.mkdirSync(this.backupDir, { recursive: true });
        const timestamp = new Date();
        const preRestoreName = `pre-restore-${this.formatBackupTimestamp(timestamp)}.db`;
        const preRestorePath = path.join(this.backupDir, preRestoreName);

        if (fs.existsSync(this.dbPath)) {
          fs.copyFileSync(this.dbPath, preRestorePath);
        }

        const tempPath = `${this.dbPath}.restore`;
        fs.copyFileSync(resolvedPath, tempPath);
        fs.renameSync(tempPath, this.dbPath);

        DatabaseManager.lastBackupTimestamp = timestamp.getTime();
        DatabaseManager.lastBackupFileName = preRestoreName;
        DatabaseManager.lastRestoreTimestamp = timestamp.getTime();
        this.writeBackupMetadata({
          lastBackupAt: timestamp,
          lastBackupFile: preRestoreName,
          lastRestoreAt: timestamp,
        });
        this.invalidateTransactionStatsCache();
      } finally {
        DatabaseManager.backupInProgress = false;
      }
    });
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

  private async queueOperation<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release: (() => void) | null = null;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.operationQueue = previous.then(
      () => next,
      () => next
    );

    await previous;
    try {
      return await fn();
    } finally {
      release?.();
    }
  }

  private async withDatabase<T>(
    fn: (db: SqlJsDatabase) => T | Promise<T>,
    persist: boolean = false
  ): Promise<T> {
    return this.queueOperation(async () => {
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
    });
  }

  private ensureSchema(db: SqlJsDatabase): void {
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

    this.ensureColumn(db, 'products', 'options_json', 'TEXT');
    this.ensureColumn(db, 'products', 'discount_percent', 'REAL DEFAULT 0');
    this.ensureColumn(db, 'products', 'discount_flat', 'REAL DEFAULT 0');
    this.ensureColumn(db, 'products', 'available_shifts', 'TEXT');
    this.ensureColumn(db, 'products', 'printer_station', 'TEXT');
    this.ensureColumn(db, 'products', 'auto_print', 'BOOLEAN DEFAULT 0');
    this.ensureColumn(db, 'customers', 'discount_percent', 'REAL DEFAULT 0');
    this.ensureColumn(db, 'customers', 'discount_flat', 'REAL DEFAULT 0');
    this.ensureColumn(db, 'customers', 'type_id', 'TEXT');
    this.ensureColumn(db, 'transactions', 'product_name', 'TEXT');
    this.ensureColumn(db, 'transactions', 'product_price', 'REAL');
    this.ensureColumn(db, 'transactions', 'options_json', 'TEXT');
    this.ensureColumn(db, 'transactions', 'voided', 'BOOLEAN DEFAULT 0');
    this.ensureColumn(db, 'transactions', 'voided_at', 'DATETIME');
    this.ensureColumn(db, 'transactions', 'void_note', 'TEXT');
    this.ensureColumn(db, 'transactions', 'edit_parent_transaction_id', 'TEXT');

    this.ensureIndexes(db);
    this.ensureValidationTriggers(db);
    this.ensureSchemaVersion(db);
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

  private normalizeCustomerTypeEntries(entries?: CustomerTypeInput[] | null): CustomerTypeDefinition[] {
    const list = Array.isArray(entries) ? entries : [];
    const normalized: CustomerTypeDefinition[] = [];
    const used = new Set<string>();

    list.forEach((entry) => {
      if (!entry || typeof entry.label !== 'string') {
        return;
      }

      const label = entry.label.trim();
      if (!label) {
        return;
      }

      const preferredId = typeof entry.id === 'string' && entry.id.trim().length > 0
        ? normalizeTypeId(entry.id.trim())
        : normalizeTypeId(label);

      let slug = preferredId;
      let counter = 1;
      while (used.has(slug)) {
        slug = `${preferredId}-${counter}`.slice(0, 32);
        counter += 1;
      }
      used.add(slug);

      normalized.push({
        id: slug,
        label,
        discount_percent: clampDiscountValue(entry.discountPercent, true),
        discount_flat: clampDiscountValue(entry.discountFlat, false),
      });
    });

    if (normalized.length === 0) {
      return DEFAULT_CUSTOMER_TYPES;
    }

    return normalized;
  }

  private readCustomerTypesSetting(db: SqlJsDatabase): CustomerTypeDefinition[] {
    const raw = this.readSetting(db, CUSTOMER_TYPES_SETTING_KEY);
    if (!raw) {
      this.writeSetting(db, CUSTOMER_TYPES_SETTING_KEY, JSON.stringify(DEFAULT_CUSTOMER_TYPES));
      return DEFAULT_CUSTOMER_TYPES;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid type payload');
      }

      const entries: CustomerTypeInput[] = parsed.map((item) => ({
        id: typeof item?.id === 'string' ? item.id : undefined,
        label: typeof item?.label === 'string' ? item.label : '',
        discountPercent: typeof item?.discount_percent === 'number' ? item.discount_percent : undefined,
        discountFlat: typeof item?.discount_flat === 'number' ? item.discount_flat : undefined,
      }));

      return this.normalizeCustomerTypeEntries(entries);
    } catch (error) {
      console.warn('Failed to parse customer types setting', error);
      this.writeSetting(db, CUSTOMER_TYPES_SETTING_KEY, JSON.stringify(DEFAULT_CUSTOMER_TYPES));
      return DEFAULT_CUSTOMER_TYPES;
    }
  }

  private writeCustomerTypesSetting(db: SqlJsDatabase, types: CustomerTypeDefinition[]): void {
    const payload = types.map((type) => ({
      id: type.id,
      label: type.label,
      discount_percent: clampDiscountValue(type.discount_percent, true),
      discount_flat: clampDiscountValue(type.discount_flat, false),
    }));

    this.writeSetting(db, CUSTOMER_TYPES_SETTING_KEY, JSON.stringify(payload));
  }

  private getCustomerTypeMap(db: SqlJsDatabase): Map<string, CustomerTypeDefinition> {
    const types = this.readCustomerTypesSetting(db);
    return new Map(types.map((type) => [type.id, type]));
  }

  public async getCustomerTypes(): Promise<CustomerTypeDefinition[]> {
    return this.withDatabase((db) => this.readCustomerTypesSetting(db));
  }

  public async saveCustomerTypes(entries: CustomerTypeInput[]): Promise<CustomerTypeDefinition[]> {
    return this.withDatabase((db) => {
      const normalized = this.normalizeCustomerTypeEntries(entries);
      this.writeCustomerTypesSetting(db, normalized);
      return normalized;
    }, true);
  }

  private readGlobalDiscount(db: SqlJsDatabase): { percent: number; flat: number } {
    const storedPercent = this.readSetting(db, APP_GLOBAL_DISCOUNT_PERCENT_KEY);
    const storedFlat = this.readSetting(db, APP_GLOBAL_DISCOUNT_FLAT_KEY);
    return {
      percent: clampPercent(storedPercent ? Number(storedPercent) : storedPercent),
      flat: clampCurrency(storedFlat ? Number(storedFlat) : storedFlat),
    };
  }

  private readFeatureFlags(db: SqlJsDatabase): AppFeatureFlags {
    const raw = this.readSetting(db, APP_FEATURE_FLAGS_KEY);
    if (!raw) {
      this.writeSetting(db, APP_FEATURE_FLAGS_KEY, JSON.stringify(DEFAULT_FEATURE_FLAGS));
      return DEFAULT_FEATURE_FLAGS;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<AppFeatureFlags> | null;
      return {
        ...DEFAULT_FEATURE_FLAGS,
        ...(parsed ?? {}),
      };
    } catch (error) {
      console.warn('Failed to parse feature flags, resetting to defaults.', error);
      this.writeSetting(db, APP_FEATURE_FLAGS_KEY, JSON.stringify(DEFAULT_FEATURE_FLAGS));
      return DEFAULT_FEATURE_FLAGS;
    }
  }

  private readShiftDefinitions(db: SqlJsDatabase): ShiftDefinition[] {
    const raw = this.readSetting(db, APP_SHIFT_DEFINITIONS_KEY);
    if (!raw) {
      this.writeSetting(db, APP_SHIFT_DEFINITIONS_KEY, JSON.stringify(DEFAULT_SHIFTS));
      return DEFAULT_SHIFTS;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid shift definition payload');
      }
      const normalized = parsed
        .map((entry) => ({
          id: typeof entry?.id === 'string' ? entry.id.trim() : '',
          label: typeof entry?.label === 'string' ? entry.label.trim() : '',
          startTime: typeof entry?.startTime === 'string' ? entry.startTime.trim() : '',
          endTime: typeof entry?.endTime === 'string' ? entry.endTime.trim() : '',
        }))
        .filter((entry) => entry.id && entry.label && entry.startTime && entry.endTime);
      if (normalized.length === 0) {
        throw new Error('No shifts defined');
      }
      return normalized;
    } catch (error) {
      console.warn('Failed to parse shift definitions, resetting to defaults.', error);
      this.writeSetting(db, APP_SHIFT_DEFINITIONS_KEY, JSON.stringify(DEFAULT_SHIFTS));
      return DEFAULT_SHIFTS;
    }
  }

  private readActiveShiftId(db: SqlJsDatabase, shifts: ShiftDefinition[]): string | null {
    const raw = this.readSetting(db, APP_ACTIVE_SHIFT_KEY);
    if (!raw) {
      return shifts[0]?.id ?? null;
    }
    const trimmed = raw.trim();
    return shifts.some((shift) => shift.id === trimmed) ? trimmed : shifts[0]?.id ?? null;
  }

  private readPrinterStations(db: SqlJsDatabase): string[] {
    const raw = this.readSetting(db, APP_PRINTER_STATIONS_KEY);
    if (!raw) {
      this.writeSetting(db, APP_PRINTER_STATIONS_KEY, JSON.stringify(DEFAULT_PRINTER_STATIONS));
      return DEFAULT_PRINTER_STATIONS;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid printer station payload');
      }
      const normalized = parsed
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
      return normalized.length > 0 ? normalized : DEFAULT_PRINTER_STATIONS;
    } catch (error) {
      console.warn('Failed to parse printer stations, resetting to defaults.', error);
      this.writeSetting(db, APP_PRINTER_STATIONS_KEY, JSON.stringify(DEFAULT_PRINTER_STATIONS));
      return DEFAULT_PRINTER_STATIONS;
    }
  }
  public async getAppSettings(): Promise<AppSettingsPayload> {
    return this.withDatabase((db) => {
      const storedBrand = this.readSetting(db, APP_BRAND_NAME_KEY);
      const normalizedBrand = sanitizeBrandName(storedBrand) ?? 'Camp Canteen POS';
      const adminCodeHash = this.readSetting(db, APP_ADMIN_CODE_KEY);
      const globalDiscount = this.readGlobalDiscount(db);
      const featureFlags = this.readFeatureFlags(db);
      const shifts = this.readShiftDefinitions(db);
      const activeShiftId = this.readActiveShiftId(db, shifts);
      const printerStations = this.readPrinterStations(db);
      return {
        brandName: normalizedBrand,
        adminCodeSet: Boolean(adminCodeHash && adminCodeHash.trim().length > 0),
        globalDiscountPercent: globalDiscount.percent,
        globalDiscountFlat: globalDiscount.flat,
        featureFlags,
        shifts,
        activeShiftId,
        printerStations,
      };
    });
  }

  private async getAdminCodeHash(): Promise<string | null> {
    return this.withDatabase((db) => {
      const hash = this.readSetting(db, APP_ADMIN_CODE_KEY);
      return hash && hash.trim().length > 0 ? hash.trim() : null;
    });
  }

  public async verifyAdminAccessCode(candidate: string): Promise<boolean> {
    const stored = await this.getAdminCodeHash();
    if (!stored) {
      return true;
    }
    const verified = doesAdminCodeMatch(stored, candidate);
    if (verified && shouldUpgradeAdminHash(stored)) {
      await this.withDatabase((db) => {
        this.writeSetting(db, APP_ADMIN_CODE_KEY, hashAdminCode(candidate));
      }, true);
    }
    return verified;
  }

  public async updateAppSettings(options: {
    brandName?: string | null;
    adminCode?: string | null;
    clearAdminCode?: boolean;
    globalDiscountPercent?: number | null;
    globalDiscountFlat?: number | null;
    featureFlags?: Partial<AppFeatureFlags> | null;
    shifts?: ShiftDefinition[] | null;
    activeShiftId?: string | null;
    printerStations?: string[] | null;
  }): Promise<AppSettingsPayload> {
    const nextBrand = sanitizeBrandName(options.brandName);
    const wantsClear = Boolean(options.clearAdminCode);
    const nextCode = typeof options.adminCode === 'string' ? options.adminCode.trim() : null;
    const nextPercent =
      options.globalDiscountPercent === null
        ? null
        : clampPercent(options.globalDiscountPercent);
    const nextFlat =
      options.globalDiscountFlat === null
        ? null
        : clampCurrency(options.globalDiscountFlat);

    return this.withDatabase((db) => {
      if (nextBrand !== null) {
        this.writeSetting(db, APP_BRAND_NAME_KEY, nextBrand);
      } else if (options.brandName === '') {
        this.writeSetting(db, APP_BRAND_NAME_KEY, null);
      }

      if (wantsClear) {
        this.writeSetting(db, APP_ADMIN_CODE_KEY, null);
      } else if (nextCode) {
        this.writeSetting(db, APP_ADMIN_CODE_KEY, hashAdminCode(nextCode));
      }

      if (options.globalDiscountPercent !== undefined) {
        this.writeSetting(
          db,
          APP_GLOBAL_DISCOUNT_PERCENT_KEY,
          nextPercent === null ? null : String(nextPercent)
        );
      }

      if (options.globalDiscountFlat !== undefined) {
        this.writeSetting(
          db,
          APP_GLOBAL_DISCOUNT_FLAT_KEY,
          nextFlat === null ? null : String(nextFlat)
        );
      }

      if (options.featureFlags) {
        const currentFlags = this.readFeatureFlags(db);
        const mergedFlags: AppFeatureFlags = {
          ...currentFlags,
          ...options.featureFlags,
        };
        this.writeSetting(db, APP_FEATURE_FLAGS_KEY, JSON.stringify(mergedFlags));
      }

      if (Array.isArray(options.shifts)) {
        const normalized = options.shifts
          .map((shift) => ({
            id: typeof shift.id === 'string' ? shift.id.trim() : '',
            label: typeof shift.label === 'string' ? shift.label.trim() : '',
            startTime: typeof shift.startTime === 'string' ? shift.startTime.trim() : '',
            endTime: typeof shift.endTime === 'string' ? shift.endTime.trim() : '',
          }))
          .filter((shift) => shift.id && shift.label && shift.startTime && shift.endTime);
        if (normalized.length > 0) {
          this.writeSetting(db, APP_SHIFT_DEFINITIONS_KEY, JSON.stringify(normalized));
        }
      }

      if (options.activeShiftId !== undefined) {
        const raw = typeof options.activeShiftId === 'string' ? options.activeShiftId.trim() : '';
        this.writeSetting(db, APP_ACTIVE_SHIFT_KEY, raw ? raw : null);
      }

      if (Array.isArray(options.printerStations)) {
        const normalizedStations = options.printerStations
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter((entry) => entry.length > 0);
        this.writeSetting(
          db,
          APP_PRINTER_STATIONS_KEY,
          JSON.stringify(normalizedStations.length > 0 ? normalizedStations : DEFAULT_PRINTER_STATIONS)
        );
      }

      const updatedBrand = sanitizeBrandName(this.readSetting(db, APP_BRAND_NAME_KEY)) ?? 'Camp Canteen POS';
      const adminCodeHash = this.readSetting(db, APP_ADMIN_CODE_KEY);
      const globalDiscount = this.readGlobalDiscount(db);
      const featureFlags = this.readFeatureFlags(db);
      const shifts = this.readShiftDefinitions(db);
      const activeShiftId = this.readActiveShiftId(db, shifts);
      const printerStations = this.readPrinterStations(db);

      return {
        brandName: updatedBrand,
        adminCodeSet: Boolean(adminCodeHash && adminCodeHash.trim().length > 0),
        globalDiscountPercent: globalDiscount.percent,
        globalDiscountFlat: globalDiscount.flat,
        featureFlags,
        shifts,
        activeShiftId,
        printerStations,
      };
    }, true);
  }

  private persist(db: SqlJsDatabase): void {
    const data = db.export();
    const tempPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tempPath, Buffer.from(data));
    try {
      fs.renameSync(tempPath, this.dbPath);
    } catch (error) {
      console.warn('Atomic database rename failed, falling back to copy.', error);
      fs.copyFileSync(tempPath, this.dbPath);
      fs.unlinkSync(tempPath);
    }
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

  private ensureIndexes(db: SqlJsDatabase): void {
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_customer_id ON customers (customer_id);
      CREATE INDEX IF NOT EXISTS idx_product_barcode ON products (barcode);
      CREATE INDEX IF NOT EXISTS idx_product_category ON products (category);
      CREATE INDEX IF NOT EXISTS idx_product_active ON products (active);
      CREATE INDEX IF NOT EXISTS idx_transaction_customer ON transactions (customer_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_timestamp ON transactions (timestamp);
      CREATE INDEX IF NOT EXISTS idx_transaction_id ON transactions (transaction_id);
    `);
  }

  private ensureValidationTriggers(db: SqlJsDatabase): void {
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
  }

  private ensureSchemaVersion(db: SqlJsDatabase): void {
    const stored = this.readSetting(db, APP_SCHEMA_VERSION_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : 0;
    if (!Number.isFinite(parsed) || parsed < SCHEMA_VERSION) {
      this.writeSetting(db, APP_SCHEMA_VERSION_KEY, String(SCHEMA_VERSION));
    }
  }

  private invalidateTransactionStatsCache(): void {
    DatabaseManager.transactionStatsCache = null;
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
    const availableShiftsRaw = (raw as { available_shifts?: unknown }).available_shifts;
    let available_shift_ids: string[] | null = null;
    if (typeof availableShiftsRaw === 'string' && availableShiftsRaw.trim().length > 0) {
      try {
        const parsed = JSON.parse(availableShiftsRaw);
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter((entry) => entry.length > 0);
          available_shift_ids = normalized.length > 0 ? normalized : null;
        }
      } catch (error) {
        console.warn('Failed to parse available shifts for product', error);
      }
    }
    const printer_station =
      typeof (raw as { printer_station?: unknown }).printer_station === 'string'
        ? ((raw as { printer_station: string }).printer_station || null)
        : null;
    const auto_print = Boolean((raw as { auto_print?: unknown }).auto_print);
    return {
      ...raw,
      discount_percent: discountPercent,
      discount_flat: discountFlat,
      options,
      available_shift_ids,
      printer_station,
      auto_print,
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
    const typeIdRaw = (raw as { type_id?: unknown }).type_id;
    const typeId = typeof typeIdRaw === 'string' && typeIdRaw.trim().length > 0 ? typeIdRaw.trim() : null;

    return {
      ...raw,
      discount_percent: discountPercent,
      discount_flat: discountFlat,
      type_id: typeId,
      type_label: null,
      type_discount_percent: 0,
      type_discount_flat: 0,
    };
  }

  private decorateCustomerWithType(
    customer: Customer,
    typeMap: Map<string, CustomerTypeDefinition>
  ): Customer {
    const typeId = customer.type_id && customer.type_id.trim().length > 0 ? customer.type_id.trim() : null;
    if (!typeId) {
      return {
        ...customer,
        type_id: null,
        type_label: null,
        type_discount_percent: 0,
        type_discount_flat: 0,
      };
    }

    const definition = typeMap.get(typeId);
    if (!definition) {
      return {
        ...customer,
        type_id: typeId,
        type_label: null,
        type_discount_percent: 0,
        type_discount_flat: 0,
      };
    }

    return {
      ...customer,
      type_id: typeId,
      type_label: definition.label,
      type_discount_percent: definition.discount_percent,
      type_discount_flat: definition.discount_flat,
    };
  }

  private normalizeOptionSelections(
    product: Product,
    selections?: ProductOptionSelection[] | null
  ): { selections: TransactionOptionSelection[]; totalDelta: number } {
    const optionGroups = Array.isArray(product.options) ? product.options : [];
    if (optionGroups.length === 0) {
      return { selections: [], totalDelta: 0 };
    }

    const groupById = new Map<string, ProductOptionGroup>();
    optionGroups.forEach((group) => {
      groupById.set(group.id, group);
    });

    const normalizedChoicesByGroup = new Map<string, string[]>();

    const selectionList = Array.isArray(selections) ? selections : [];

    selectionList.forEach((selection) => {
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

    const rawEditParent = (raw as { edit_parent_transaction_id?: unknown }).edit_parent_transaction_id;
    const editParentId = typeof rawEditParent === 'string' ? rawEditParent : null;

    return {
      ...raw,
      voided,
      options_json: raw.options_json ?? null,
      voided_at: voidedAt,
      void_note: voidNote,
      options,
      edit_parent_transaction_id: editParentId,
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
    name: string,
    initialBalance: number = 0,
    discountPercent: number = 0,
    discountFlat: number = 0,
    typeId?: string | null
  ): Promise<Customer> {
    if (!/^[0-9]{4}$/.test(customerId)) {
      throw new Error('Customer ID must be exactly 4 digits');
    }

    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Customer name is required');
    }

    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      throw new Error('Initial balance must be zero or a positive number');
    }

    const normalizedName = name.trim();
    const normalizedPercent =
      Number.isFinite(discountPercent) && discountPercent > 0
        ? Math.min(100, Math.max(0, discountPercent))
        : 0;
    const normalizedFlat =
      Number.isFinite(discountFlat) && discountFlat > 0 ? Math.max(0, discountFlat) : 0;
    const normalizedBalance = this.roundCurrency(initialBalance);

    return this.withDatabase((db) => {
      db.run('BEGIN TRANSACTION');
      try {
        const typeMap = this.getCustomerTypeMap(db);
        const normalizedTypeId =
          typeof typeId === 'string' && typeId.trim().length > 0 ? typeId.trim() : null;
        const storedTypeId = normalizedTypeId && typeMap.has(normalizedTypeId) ? normalizedTypeId : null;
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
          INSERT INTO customers (customer_id, name, balance, discount_percent, discount_flat, type_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        insertStmt.bind([
          customerId,
          normalizedName,
          normalizedBalance,
          normalizedPercent,
          normalizedFlat,
          storedTypeId,
        ]);
        insertStmt.step();
        insertStmt.free();

        if (normalizedBalance > 0) {
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
            normalizedBalance,
            normalizedBalance,
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

        const result = this.decorateCustomerWithType(this.hydrateCustomer(customerRow), typeMap);
        db.run('COMMIT');
        this.invalidateTransactionStatsCache();
        return result;
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    }, true);
  }

  public async listCustomers(
    search?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Customer[]> {
    const normalizedLimit = Math.max(1, Math.min(limit, 200));
    const normalizedOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    const trimmedSearch = search?.trim();

    return this.withDatabase((db) => {
      const typeMap = this.getCustomerTypeMap(db);
      if (trimmedSearch && trimmedSearch.length > 0) {
        const stmt = db.prepare(`
          SELECT *
          FROM customers
          WHERE customer_id LIKE ? OR name LIKE ?
          ORDER BY updated_at DESC
          LIMIT ? OFFSET ?
        `);
        stmt.bind([
          `${trimmedSearch}%`,
          `%${trimmedSearch}%`,
          normalizedLimit,
          normalizedOffset,
        ]);
        return this.fetchAll<Customer>(stmt)
          .map((customer) => this.hydrateCustomer(customer))
          .map((customer) => this.decorateCustomerWithType(customer, typeMap));
      }

      const stmt = db.prepare(`
        SELECT *
        FROM customers
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `);
      stmt.bind([normalizedLimit, normalizedOffset]);
      return this.fetchAll<Customer>(stmt)
        .map((customer) => this.hydrateCustomer(customer))
        .map((customer) => this.decorateCustomerWithType(customer, typeMap));
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
    availableShiftIds?: string[] | null;
    printerStation?: string | null;
    autoPrint?: boolean;
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
    const normalizedShiftIds = Array.isArray(options.availableShiftIds)
      ? options.availableShiftIds
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0)
      : [];
    const availableShiftsJson = normalizedShiftIds.length > 0 ? JSON.stringify(normalizedShiftIds) : null;
    const normalizedPrinterStation =
      typeof options.printerStation === 'string' && options.printerStation.trim().length > 0
        ? options.printerStation.trim()
        : null;
    const normalizedAutoPrint = Boolean(options.autoPrint);

    if (!name || name.trim().length === 0) {
      throw new Error('Product name is required');
    }

    const normalizedPrice = this.roundCurrency(Number(price));
    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
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
        INSERT INTO products (
          product_id,
          name,
          price,
          barcode,
          category,
          active,
          options_json,
          discount_percent,
          discount_flat,
          available_shifts,
          printer_station,
          auto_print
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.bind([
        finalProductId,
        name.trim(),
        normalizedPrice,
        barcode ?? null,
        category ?? null,
        active ? 1 : 0,
        optionsJson,
        normalizedDiscountPercent,
        normalizedDiscountFlat,
        availableShiftsJson,
        normalizedPrinterStation,
        normalizedAutoPrint ? 1 : 0,
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
    category?: string,
    offset: number = 0
  ): Promise<Product[]> {
    const normalizedLimit = Math.max(1, Math.min(limit, 500));
    const normalizedOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
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
      query += ' LIMIT ? OFFSET ?';
      params.push(normalizedLimit, normalizedOffset);

      const stmt = db.prepare(query);
      stmt.bind(params);
      const rows = this.fetchAll<Product>(stmt);
      return rows.map((product) => this.hydrateProduct(product));
    });
  }

  public async getCustomerById(customerId: string): Promise<Customer | null> {
    return this.withDatabase((db) => {
      const typeMap = this.getCustomerTypeMap(db);
      const stmt = db.prepare('SELECT * FROM customers WHERE customer_id = ?');
      stmt.bind([customerId]);
      const customer = this.fetchOne<Customer>(stmt);
      return customer ? this.decorateCustomerWithType(this.hydrateCustomer(customer), typeMap) : null;
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
        ORDER BY t.timestamp DESC, t.id DESC
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

  public async getTransactionStatsSummary(): Promise<TransactionStatsSummary> {
    const cached = DatabaseManager.transactionStatsCache;
    if (cached && Date.now() - cached.cachedAt < TRANSACTION_STATS_CACHE_TTL_MS) {
      return cached.value;
    }

    const summary = await this.withDatabase((db) => {
      const stmt = db.prepare(`
        SELECT
          SUM(CASE WHEN COALESCE(voided, 0) <> 1 THEN 1 ELSE 0 END) AS total_transactions,
          SUM(CASE WHEN COALESCE(voided, 0) <> 1 AND type = 'deposit' THEN 1 ELSE 0 END) AS total_deposits,
          SUM(CASE WHEN COALESCE(voided, 0) <> 1 AND type = 'withdrawal' THEN 1 ELSE 0 END) AS total_withdrawals,
          SUM(CASE WHEN COALESCE(voided, 0) <> 1 AND type = 'purchase' THEN 1 ELSE 0 END) AS total_purchases,
          SUM(CASE WHEN COALESCE(voided, 0) <> 1 AND type = 'adjustment' THEN 1 ELSE 0 END) AS total_adjustments,
          SUM(CASE WHEN COALESCE(voided, 0) <> 1 AND type = 'deposit' THEN amount ELSE 0 END) AS sum_deposits,
          SUM(CASE WHEN COALESCE(voided, 0) <> 1 AND type = 'withdrawal' THEN ABS(amount) ELSE 0 END) AS sum_withdrawals,
          SUM(CASE WHEN COALESCE(voided, 0) <> 1 AND type = 'purchase' THEN ABS(amount) ELSE 0 END) AS sum_purchases,
          SUM(CASE WHEN COALESCE(voided, 0) <> 1 AND type = 'adjustment' THEN ABS(amount) ELSE 0 END) AS sum_adjustments,
          SUM(CASE WHEN COALESCE(voided, 0) = 1 THEN 1 ELSE 0 END) AS voided_transactions,
          MAX(CASE WHEN COALESCE(voided, 0) <> 1 THEN timestamp ELSE NULL END) AS last_transaction_at
        FROM transactions
      `);

      const row = this.fetchOne<{
        total_transactions: number | null;
        total_deposits: number | null;
        total_withdrawals: number | null;
        total_purchases: number | null;
        total_adjustments: number | null;
        sum_deposits: number | null;
        sum_withdrawals: number | null;
        sum_purchases: number | null;
        sum_adjustments: number | null;
        voided_transactions: number | null;
        last_transaction_at: string | null;
      }>(stmt) ?? {
        total_transactions: 0,
        total_deposits: 0,
        total_withdrawals: 0,
        total_purchases: 0,
        total_adjustments: 0,
        sum_deposits: 0,
        sum_withdrawals: 0,
        sum_purchases: 0,
        sum_adjustments: 0,
        voided_transactions: 0,
        last_transaction_at: null,
      };

      const toNumber = (value: number | null | undefined) =>
        typeof value === 'number' && Number.isFinite(value) ? value : 0;

      return {
        totalTransactions: toNumber(row.total_transactions),
        totalDeposits: toNumber(row.total_deposits),
        totalWithdrawals: toNumber(row.total_withdrawals),
        totalPurchases: toNumber(row.total_purchases),
        totalAdjustments: toNumber(row.total_adjustments),
        totalAmountDeposits: toNumber(row.sum_deposits),
        totalAmountWithdrawals: toNumber(row.sum_withdrawals),
        totalAmountPurchases: toNumber(row.sum_purchases),
        totalAmountAdjustments: toNumber(row.sum_adjustments),
        voidedTransactions: toNumber(row.voided_transactions),
        lastTransactionAt: typeof row.last_transaction_at === 'string' ? row.last_transaction_at : null,
      };
    });

    DatabaseManager.transactionStatsCache = { value: summary, cachedAt: Date.now() };
    return summary;
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
      db.run('BEGIN TRANSACTION');
      try {
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
        const typeMap = this.getCustomerTypeMap(db);
        const customer = this.decorateCustomerWithType(this.hydrateCustomer(customerRow), typeMap);

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

        const globalDiscount = this.readGlobalDiscount(db);

        const currentBalance = this.roundCurrency(customer.balance);
        const basePrice = this.roundCurrency(product.price);
        const optionsDelta = this.roundCurrency(totalDelta);
        const optionAdjustedPrice = this.roundCurrency(basePrice + optionsDelta);

        let finalPrice = optionAdjustedPrice;
        finalPrice = this.applyDiscount(finalPrice, globalDiscount.percent, globalDiscount.flat);
        finalPrice = this.applyDiscount(finalPrice, product.discount_percent, product.discount_flat);
        finalPrice = this.applyDiscount(finalPrice, customer.discount_percent, customer.discount_flat);
        finalPrice = this.applyDiscount(finalPrice, customer.type_discount_percent, customer.type_discount_flat);
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
            product_name,
            product_price,
            amount,
            balance_after,
            note,
            options_json
          ) VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?, ?, ?)
        `);
        insertStmt.bind([
          transactionId,
          customerId,
          product.product_id,
          product.name,
          basePrice,
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

        db.run('COMMIT');
        this.invalidateTransactionStatsCache();

        return {
          transaction,
          product,
          optionSelections,
          chargedAmount: finalPrice,
          oldBalance: currentBalance,
          newBalance,
        };
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    }, true);
  }

  public async updateExistingPurchaseTransaction(
    transactionId: string,
    payload: {
      customerId: string;
      productId: string;
      note?: string;
      selectedOptions?: ProductOptionSelection[] | null;
    }
  ): Promise<{
    transaction: Transaction;
    product: Product;
    optionSelections: TransactionOptionSelection[];
    chargedAmount: number;
    oldTransactionId: string;
    voidedTransaction: Transaction;
    balanceAfter: number;
  }> {
    return this.withDatabase((db) => {
      db.run('BEGIN TRANSACTION');
      try {
        const normalizedTransactionId = typeof transactionId === 'string' ? transactionId.trim() : '';
        const normalizedCustomerId = typeof payload.customerId === 'string' ? payload.customerId.trim() : '';
        const normalizedProductId = typeof payload.productId === 'string' ? payload.productId.trim() : '';

        if (!normalizedTransactionId) {
          throw new Error('Transaction ID is required');
        }

        if (!/^[0-9]{4}$/.test(normalizedCustomerId)) {
          throw new Error('Customer ID must be exactly 4 digits');
        }

        if (!normalizedProductId) {
          throw new Error('Product ID is required');
        }

        const typeMap = this.getCustomerTypeMap(db);

        const transactionStmt = db.prepare('SELECT * FROM transactions WHERE transaction_id = ?');
        transactionStmt.bind([normalizedTransactionId]);
        const transactionRow = this.fetchOne<Transaction>(transactionStmt);

        if (!transactionRow) {
          throw new Error('Transaction not found');
        }

        const originalTransaction = this.hydrateTransaction(transactionRow);

        if (originalTransaction.type !== 'purchase') {
          throw new Error('Only purchase transactions can be edited');
        }

        if (originalTransaction.voided) {
          throw new Error('This transaction was already voided');
        }

        if (originalTransaction.customer_id !== normalizedCustomerId) {
          throw new Error('Transaction does not belong to the provided customer');
        }

        const customerStmt = db.prepare('SELECT * FROM customers WHERE customer_id = ?');
        customerStmt.bind([normalizedCustomerId]);
        const customerRow = this.fetchOne<Customer>(customerStmt);

        if (!customerRow) {
          throw new Error('Customer not found');
        }

        const customer = this.decorateCustomerWithType(this.hydrateCustomer(customerRow), typeMap);

        const productStmt = db.prepare(
          'SELECT * FROM products WHERE product_id = ? AND active = 1'
        );
        productStmt.bind([normalizedProductId]);
        const productRow = this.fetchOne<Product>(productStmt);

        if (!productRow) {
          throw new Error('Product not found or inactive');
        }

        const product = this.hydrateProduct(productRow);

        const { selections: optionSelections, totalDelta } = this.normalizeOptionSelections(
          product,
          payload.selectedOptions
        );

        const globalDiscount = this.readGlobalDiscount(db);
        const basePrice = this.roundCurrency(product.price);
        const optionsDelta = this.roundCurrency(totalDelta);
        const optionAdjustedPrice = this.roundCurrency(basePrice + optionsDelta);

        let finalPrice = optionAdjustedPrice;
        finalPrice = this.applyDiscount(finalPrice, globalDiscount.percent, globalDiscount.flat);
        finalPrice = this.applyDiscount(finalPrice, product.discount_percent, product.discount_flat);
        finalPrice = this.applyDiscount(finalPrice, customer.discount_percent, customer.discount_flat);
        finalPrice = this.applyDiscount(finalPrice, customer.type_discount_percent, customer.type_discount_flat);
        finalPrice = this.roundCurrency(finalPrice);

        const originalAmount = this.roundCurrency(originalTransaction.amount);
        if (originalAmount > 0) {
          throw new Error('This purchase amount cannot be edited');
        }

        const originalCharge = this.roundCurrency(Math.abs(originalAmount));

        const normalizedNote =
          typeof payload.note === 'string'
            ? payload.note.trim().length > 0
              ? payload.note.trim()
              : null
            : originalTransaction.note ?? null;

        const selectionJson = optionSelections.length > 0 ? JSON.stringify(optionSelections) : null;
        const existingOptionsJson = originalTransaction.options_json ?? null;

        const noOptionChange = existingOptionsJson === selectionJson;
        const sameProduct = (originalTransaction.product_id ?? null) === product.product_id;
        const sameCharge = Math.abs(originalCharge - finalPrice) < 0.005;
        const sameNote = (originalTransaction.note ?? null) === normalizedNote;

        if (sameProduct && noOptionChange && sameCharge && sameNote) {
          throw new Error('No changes detected for this purchase');
        }

        const currentBalance = this.roundCurrency(customer.balance);
        const refundedBalance = this.roundCurrency(currentBalance - originalAmount);

        if (refundedBalance + 0.00001 < finalPrice) {
          throw new Error('Insufficient balance for the updated purchase');
        }

        let newAmount = finalPrice === 0 ? 0 : this.roundCurrency(-finalPrice);
        if (Object.is(newAmount, -0)) {
          newAmount = 0;
        }

        let newBalance = this.roundCurrency(refundedBalance + newAmount);
        if (newBalance < 0 && newBalance > -0.01) {
          newBalance = 0;
        }

        if (newBalance < 0) {
          throw new Error('Insufficient balance for the updated purchase');
        }

        const replacementTransactionId = this.generateTransactionId();

        const updateCustomerStmt = db.prepare(`
          UPDATE customers
          SET balance = ?, updated_at = datetime('now')
          WHERE customer_id = ?
        `);
        updateCustomerStmt.bind([newBalance, normalizedCustomerId]);
        updateCustomerStmt.step();
        updateCustomerStmt.free();

        const voidNote = `Superseded by edit ${replacementTransactionId}`;
        const voidStmt = db.prepare(`
          UPDATE transactions
          SET voided = 1,
              voided_at = datetime('now'),
              void_note = ?
          WHERE transaction_id = ?
        `);
        voidStmt.bind([voidNote, normalizedTransactionId]);
        voidStmt.step();
        voidStmt.free();

        const insertStmt = db.prepare(`
          INSERT INTO transactions (
            transaction_id,
            customer_id,
            type,
            product_id,
            product_name,
            product_price,
            amount,
            balance_after,
            note,
            options_json,
            edit_parent_transaction_id
          ) VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertStmt.bind([
          replacementTransactionId,
          normalizedCustomerId,
          product.product_id,
          product.name,
          basePrice,
          newAmount,
          newBalance,
          normalizedNote,
          selectionJson,
          normalizedTransactionId,
        ]);
        insertStmt.step();
        insertStmt.free();

        const selectNewStmt = db.prepare('SELECT * FROM transactions WHERE transaction_id = ?');
        selectNewStmt.bind([replacementTransactionId]);
        const newTransactionRow = this.fetchOne<Transaction>(selectNewStmt);

        if (!newTransactionRow) {
          throw new Error('Failed to record updated transaction');
        }

        const newTransaction = this.hydrateTransaction(newTransactionRow);

        const selectVoidedStmt = db.prepare('SELECT * FROM transactions WHERE transaction_id = ?');
        selectVoidedStmt.bind([normalizedTransactionId]);
        const voidedRow = this.fetchOne<Transaction>(selectVoidedStmt);

        const voidedTransaction = voidedRow ? this.hydrateTransaction(voidedRow) : {
          ...originalTransaction,
          voided: true,
          void_note: voidNote,
          voided_at: new Date().toISOString(),
        };

        db.run('COMMIT');
        this.invalidateTransactionStatsCache();

        return {
          transaction: newTransaction,
          product,
          optionSelections,
          chargedAmount: finalPrice,
          oldTransactionId: normalizedTransactionId,
          voidedTransaction,
          balanceAfter: newBalance,
        };
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    }, true);
  }

  public async updateBalanceDeltaTransaction(
    transactionId: string,
    payload: {
      customerId: string;
      amount: number;
      note?: string;
    }
  ): Promise<{
    transaction: Transaction;
    voidedTransaction: Transaction;
    balanceAfter: number;
    oldTransactionId: string;
  }> {
    return this.withDatabase((db) => {
      db.run('BEGIN TRANSACTION');
      try {
        const normalizedTransactionId = typeof transactionId === 'string' ? transactionId.trim() : '';
        if (!normalizedTransactionId) {
          throw new Error('Transaction ID is required');
        }

        const amountInput = typeof payload.amount === 'number' ? payload.amount : Number.NaN;
        if (!Number.isFinite(amountInput)) {
          throw new Error('Amount must be numeric');
        }

        const transactionStmt = db.prepare('SELECT * FROM transactions WHERE transaction_id = ?');
        transactionStmt.bind([normalizedTransactionId]);
        const transactionRow = this.fetchOne<Transaction>(transactionStmt);

        if (!transactionRow) {
          throw new Error('Transaction not found');
        }

        const transaction = this.hydrateTransaction(transactionRow);

        if (transaction.voided) {
          throw new Error('This transaction was already voided');
        }

        if (transaction.type !== 'deposit' && transaction.type !== 'adjustment') {
          throw new Error('Only deposits or adjustments can be edited here');
        }

        const normalizedCustomerId = typeof payload.customerId === 'string' ? payload.customerId.trim() : '';
        if (!/^[0-9]{4}$/.test(normalizedCustomerId)) {
          throw new Error('Customer ID must match original transaction');
        }

        if (transaction.customer_id !== normalizedCustomerId) {
          throw new Error('Transaction does not belong to this customer');
        }

        const nextAmount = this.roundCurrency(amountInput);
        if (transaction.type === 'deposit' && nextAmount <= 0) {
          throw new Error('Deposits must be a positive amount');
        }
        if (transaction.type === 'adjustment' && nextAmount === 0) {
          throw new Error('Adjustment amount cannot be zero');
        }

        const originalAmount = this.roundCurrency(transaction.amount);
        if (Math.abs(originalAmount - nextAmount) < 0.005 && (transaction.note ?? '') === (payload.note ?? '')) {
          throw new Error('No changes detected for this entry');
        }

        const customerStmt = db.prepare('SELECT * FROM customers WHERE customer_id = ?');
        customerStmt.bind([normalizedCustomerId]);
        const customerRow = this.fetchOne<Customer>(customerStmt);

        if (!customerRow) {
          throw new Error('Customer not found');
        }

        const customer = this.hydrateCustomer(customerRow);
        const currentBalance = this.roundCurrency(customer.balance);
        const preBalance = this.roundCurrency(currentBalance - originalAmount);

        let newBalance = this.roundCurrency(preBalance + nextAmount);
        if (newBalance < 0 && newBalance > -0.01) {
          newBalance = 0;
        }

        if (newBalance < 0) {
          throw new Error('Resulting balance would be negative');
        }

        const replacementTransactionId = this.generateTransactionId();
        const normalizedNote = typeof payload.note === 'string' && payload.note.trim().length > 0 ? payload.note.trim() : null;

        const updateCustomerStmt = db.prepare(`
          UPDATE customers
          SET balance = ?, updated_at = datetime('now')
          WHERE customer_id = ?
        `);
        updateCustomerStmt.bind([newBalance, normalizedCustomerId]);
        updateCustomerStmt.step();
        updateCustomerStmt.free();

        const voidNote = `Superseded by edit ${replacementTransactionId}`;
        const voidStmt = db.prepare(`
          UPDATE transactions
          SET voided = 1,
              voided_at = datetime('now'),
              void_note = ?
          WHERE transaction_id = ?
        `);
        voidStmt.bind([voidNote, normalizedTransactionId]);
        voidStmt.step();
        voidStmt.free();

        const insertStmt = db.prepare(`
          INSERT INTO transactions (
            transaction_id,
            customer_id,
            type,
            amount,
            balance_after,
            note,
            edit_parent_transaction_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        insertStmt.bind([
          replacementTransactionId,
          normalizedCustomerId,
          transaction.type,
          nextAmount,
          newBalance,
          normalizedNote,
          normalizedTransactionId,
        ]);
        insertStmt.step();
        insertStmt.free();

        const selectNewStmt = db.prepare('SELECT * FROM transactions WHERE transaction_id = ?');
        selectNewStmt.bind([replacementTransactionId]);
        const newTransactionRow = this.fetchOne<Transaction>(selectNewStmt);

        if (!newTransactionRow) {
          throw new Error('Failed to record updated transaction');
        }

        const newTransaction = this.hydrateTransaction(newTransactionRow);

        const selectOldStmt = db.prepare('SELECT * FROM transactions WHERE transaction_id = ?');
        selectOldStmt.bind([normalizedTransactionId]);
        const oldRow = this.fetchOne<Transaction>(selectOldStmt);
        const voidedTransaction = oldRow
          ? this.hydrateTransaction(oldRow)
          : { ...transaction, voided: true, void_note: voidNote, voided_at: new Date().toISOString() };

        db.run('COMMIT');
        this.invalidateTransactionStatsCache();

        return {
          transaction: newTransaction,
          voidedTransaction,
          balanceAfter: newBalance,
          oldTransactionId: normalizedTransactionId,
        };
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    }, true);
  }

  private getQuickKeySettingKey(shiftId?: string | null): string {
    const trimmed = typeof shiftId === 'string' ? shiftId.trim() : '';
    return trimmed ? `${QUICK_KEY_SETTING_KEY}_${trimmed}` : QUICK_KEY_SETTING_KEY;
  }

  public async getQuickKeySlots(shiftId?: string | null): Promise<QuickKeySlot[]> {
    return this.withDatabase((db) => {
      const rawValue = this.readSetting(db, this.getQuickKeySettingKey(shiftId));
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

  public async setQuickKeyProductIds(
    productIds: Array<string | null | undefined>,
    shiftId?: string | null
  ) {
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

      this.writeSetting(db, this.getQuickKeySettingKey(shiftId), JSON.stringify(normalized));
    }, true);
  }

  public async listAllTransactions(limit?: number, offset?: number): Promise<TransactionExportRow[]> {
    return this.withDatabase((db) => {
      let normalizedLimit =
        typeof limit === 'number' && Number.isFinite(limit)
          ? Math.max(1, Math.min(limit, 500))
          : null;
      const normalizedOffset =
        typeof offset === 'number' && Number.isFinite(offset) ? Math.max(0, offset) : 0;
      if (normalizedLimit === null && normalizedOffset > 0) {
        normalizedLimit = 500;
      }

      let query = `
        SELECT
          t.transaction_id,
          t.timestamp,
          t.customer_id,
          c.name AS customer_name,
          t.type,
          t.product_id,
          COALESCE(t.product_name, p.name) AS product_name,
          COALESCE(t.product_price, p.price) AS product_price,
          t.amount,
          t.balance_after,
          t.note,
          t.voided,
          t.void_note,
          t.options_json,
          t.staff_id,
          t.edit_parent_transaction_id
        FROM transactions t
        LEFT JOIN customers c ON c.customer_id = t.customer_id
        LEFT JOIN products p ON p.product_id = t.product_id
        ORDER BY t.timestamp DESC, t.id DESC
      `;

      const params: Array<number> = [];
      if (normalizedLimit !== null) {
        query += normalizedOffset > 0 ? ' LIMIT ? OFFSET ?' : ' LIMIT ?';
        params.push(normalizedLimit);
        if (normalizedOffset > 0) {
          params.push(normalizedOffset);
        }
      }

      const stmt = db.prepare(query);
      if (params.length > 0) {
        stmt.bind(params);
      }
      const rows = this.fetchAll<TransactionExportRow & { voided?: number; options_json?: string | null }>(stmt);
      return rows.map((row) => ({
        ...row,
        voided: Boolean(row.voided),
        void_note: row.void_note ?? null,
        options_json: row.options_json ?? null,
        options: this.parseTransactionOptions(row.options_json ?? null),
        staff_id: row.staff_id ?? null,
      }));
    });
  }

  public async getTransactionCount(): Promise<number> {
    return this.withDatabase((db) => {
      const stmt = db.prepare('SELECT COUNT(*) AS count FROM transactions');
      const row = this.fetchOne<{ count?: number }>(stmt);
      const count = row?.count;
      return typeof count === 'number' && Number.isFinite(count) ? count : 0;
    });
  }

  public async processDeposit(
    customerId: string,
    amount: number,
    note?: string
  ) {
    return this.withDatabase((db) => {
      db.run('BEGIN TRANSACTION');
      try {
        if (!/^[0-9]{4}$/.test(customerId)) {
          throw new Error('Customer ID must be exactly 4 digits');
        }

        const normalizedAmount = this.roundCurrency(Number(amount));
        if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
          throw new Error('Deposit amount must be a positive number');
        }

        const customerStmt = db.prepare(
          'SELECT * FROM customers WHERE customer_id = ?'
        );
        customerStmt.bind([customerId]);
        const customer = this.fetchOne<Customer>(customerStmt);
        if (!customer) {
          throw new Error('Customer not found');
        }

        const currentBalance = this.roundCurrency(customer.balance);
        let newBalance = this.roundCurrency(currentBalance + normalizedAmount);
        if (newBalance < 0 && newBalance > -0.01) {
          newBalance = 0;
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
          ) VALUES (?, ?, 'deposit', ?, ?, ?)
        `);
        insertStmt.bind([
          transactionId,
          customerId,
          normalizedAmount,
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

        db.run('COMMIT');
        this.invalidateTransactionStatsCache();

        return {
          transaction,
          oldBalance: currentBalance,
          newBalance,
        };
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    }, true);
  }

  public async processAdjustment(
    customerId: string,
    amount: number,
    note?: string
  ) {
    return this.withDatabase((db) => {
      db.run('BEGIN TRANSACTION');
      try {
        if (!/^[0-9]{4}$/.test(customerId)) {
          throw new Error('Customer ID must be exactly 4 digits');
        }

        const normalizedAmount = this.roundCurrency(Number(amount));
        if (!Number.isFinite(normalizedAmount) || normalizedAmount === 0) {
          throw new Error('Adjustment amount must be a non-zero number');
        }

        const customerStmt = db.prepare(
          'SELECT * FROM customers WHERE customer_id = ?'
        );
        customerStmt.bind([customerId]);
        const customer = this.fetchOne<Customer>(customerStmt);
        if (!customer) {
          throw new Error('Customer not found');
        }

        const currentBalance = this.roundCurrency(customer.balance);
        let newBalance = this.roundCurrency(currentBalance + normalizedAmount);
        if (newBalance < 0 && Math.abs(normalizedAmount) > 50) {
          throw new Error('Adjustment would result in very negative balance');
        }

        if (newBalance < 0 && newBalance > -0.01) {
          newBalance = 0;
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
          normalizedAmount,
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

        db.run('COMMIT');
        this.invalidateTransactionStatsCache();

        return {
          transaction,
          oldBalance: currentBalance,
          newBalance,
        };
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
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

  public async deleteTransaction(transactionId: string, note?: string) {
    if (!transactionId) {
      throw new Error('Transaction ID is required');
    }

    return this.withDatabase((db) => {
      db.run('BEGIN TRANSACTION');
      try {
        const transactionStmt = db.prepare(
          'SELECT * FROM transactions WHERE transaction_id = ?'
        );
        transactionStmt.bind([transactionId]);
        const transactionRow = this.fetchOne<Transaction>(transactionStmt);

        if (!transactionRow) {
          throw new Error('Transaction not found');
        }

        const transaction = this.hydrateTransaction(transactionRow);

        if (transaction.voided) {
          throw new Error('Transaction is already voided');
        }

        if (transaction.type !== 'purchase' && transaction.type !== 'deposit') {
          throw new Error('Only purchase or deposit transactions can be deleted');
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

        const voidNote = note?.trim() && note.trim().length > 0 ? note.trim() : 'Voided manually';
        const voidStmt = db.prepare(`
          UPDATE transactions
          SET voided = 1,
              voided_at = datetime('now'),
              void_note = ?
          WHERE transaction_id = ?
        `);
        voidStmt.bind([voidNote, transactionId]);
        voidStmt.step();
        voidStmt.free();

        const refreshedStmt = db.prepare('SELECT * FROM transactions WHERE transaction_id = ?');
        refreshedStmt.bind([transactionId]);
        const refreshedRow = this.fetchOne<Transaction>(refreshedStmt);

        const updatedTransaction = refreshedRow
          ? this.hydrateTransaction(refreshedRow)
          : { ...transaction, voided: true, void_note: voidNote, voided_at: new Date().toISOString() };

        db.run('COMMIT');
        this.invalidateTransactionStatsCache();

        return {
          transaction: updatedTransaction,
          customerId: transaction.customer_id,
          newBalance,
        };
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    }, true);
  }

  public async unvoidTransaction(transactionId: string, note?: string) {
    if (!transactionId) {
      throw new Error('Transaction ID is required');
    }

    return this.withDatabase((db) => {
      db.run('BEGIN TRANSACTION');
      try {
        const transactionStmt = db.prepare(
          'SELECT * FROM transactions WHERE transaction_id = ?'
        );
        transactionStmt.bind([transactionId]);
        const transactionRow = this.fetchOne<Transaction>(transactionStmt);

        if (!transactionRow) {
          throw new Error('Transaction not found');
        }

        const transaction = this.hydrateTransaction(transactionRow);

        if (!transaction.voided) {
          throw new Error('This transaction is not voided');
        }

        if (transaction.type !== 'purchase' && transaction.type !== 'deposit') {
          throw new Error('Only purchase or deposit transactions can be unvoided');
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
        let newBalance = this.roundCurrency(currentBalance + amount);
        if (newBalance < 0 && newBalance > -0.01) {
          newBalance = 0;
        }

        if (newBalance < 0) {
          throw new Error('Insufficient balance to restore this transaction');
        }

        const updateCustomerStmt = db.prepare(`
          UPDATE customers
          SET balance = ?, updated_at = datetime('now')
          WHERE customer_id = ?
        `);
        updateCustomerStmt.bind([newBalance, transaction.customer_id]);
        updateCustomerStmt.step();
        updateCustomerStmt.free();

        const unvoidNote = note?.trim() && note.trim().length > 0 ? note.trim() : null;
        const unvoidStmt = db.prepare(`
          UPDATE transactions
          SET voided = 0,
              voided_at = NULL,
              void_note = ?
          WHERE transaction_id = ?
        `);
        unvoidStmt.bind([unvoidNote, transactionId]);
        unvoidStmt.step();
        unvoidStmt.free();

        const refreshedStmt = db.prepare('SELECT * FROM transactions WHERE transaction_id = ?');
        refreshedStmt.bind([transactionId]);
        const refreshedRow = this.fetchOne<Transaction>(refreshedStmt);

        const updatedTransaction = refreshedRow
          ? this.hydrateTransaction(refreshedRow)
          : { ...transaction, voided: false, void_note: unvoidNote, voided_at: null };

        db.run('COMMIT');
        this.invalidateTransactionStatsCache();

        return {
          transaction: updatedTransaction,
          customerId: transaction.customer_id,
          newBalance,
        };
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
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
    updates: { name?: string; discountPercent?: number | null; discountFlat?: number | null; typeId?: string | null }
  ): Promise<Customer> {
    return this.withDatabase((db) => {
      const typeMap = this.getCustomerTypeMap(db);
      const existingStmt = db.prepare(
        'SELECT * FROM customers WHERE customer_id = ?'
      );
      existingStmt.bind([customerId]);
      const existingRow = this.fetchOne<Customer>(existingStmt);

      if (!existingRow) {
        throw new Error('Customer not found');
      }

      const existing = this.hydrateCustomer(existingRow);

      const nextName =
        updates.name === undefined ? existing.name?.trim() ?? '' : updates.name.trim();
      if (!nextName) {
        throw new Error('Customer name is required');
      }

      const nextDiscountPercent =
        updates.discountPercent === undefined
          ? existing.discount_percent ?? 0
          : clampDiscountValue(updates.discountPercent, true);

      const nextDiscountFlat =
        updates.discountFlat === undefined
          ? existing.discount_flat ?? 0
          : clampDiscountValue(updates.discountFlat, false);

      const requestedTypeId =
        updates.typeId === undefined
          ? existing.type_id ?? null
          : updates.typeId && updates.typeId.trim().length > 0
          ? updates.typeId.trim()
          : null;
      const storedTypeId = requestedTypeId && typeMap.has(requestedTypeId) ? requestedTypeId : null;

      const updateStmt = db.prepare(`
        UPDATE customers
        SET name = ?, discount_percent = ?, discount_flat = ?, type_id = ?, updated_at = datetime('now')
        WHERE customer_id = ?
      `);
      updateStmt.bind([nextName, nextDiscountPercent, nextDiscountFlat, storedTypeId, customerId]);
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

      return this.decorateCustomerWithType(this.hydrateCustomer(customer), typeMap);
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
      availableShiftIds?: string[] | null;
      printerStation?: string | null;
      autoPrint?: boolean | null;
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

      const rawPrice =
        updates.price !== undefined ? updates.price : existing.price;
      const nextPrice = this.roundCurrency(Number(rawPrice));
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

      const nextShiftIdsRaw =
        updates.availableShiftIds === undefined
          ? existing.available_shift_ids ?? null
          : updates.availableShiftIds === null
          ? null
          : updates.availableShiftIds
              .map((value) => (typeof value === 'string' ? value.trim() : ''))
              .filter((value) => value.length > 0);
      const nextShiftIdsJson =
        nextShiftIdsRaw && nextShiftIdsRaw.length > 0
          ? JSON.stringify(nextShiftIdsRaw)
          : null;

      const nextPrinterStation =
        updates.printerStation === undefined
          ? existing.printer_station ?? null
          : updates.printerStation && updates.printerStation.trim().length > 0
          ? updates.printerStation.trim()
          : null;

      const nextAutoPrint =
        updates.autoPrint === undefined
          ? Boolean(existing.auto_print)
          : updates.autoPrint === null
          ? false
          : Boolean(updates.autoPrint);

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
        SET name = ?, price = ?, barcode = ?, category = ?, active = ?, options_json = ?, discount_percent = ?, discount_flat = ?, available_shifts = ?, printer_station = ?, auto_print = ?, updated_at = datetime('now')
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
        nextShiftIdsJson,
        nextPrinterStation,
        nextAutoPrint ? 1 : 0,
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
          entry.discountFlat ?? 0,
          entry.typeId ?? null
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
          availableShiftIds: (entry as { availableShiftIds?: string[] | null }).availableShiftIds,
          printerStation: (entry as { printerStation?: string | null }).printerStation ?? null,
          autoPrint: (entry as { autoPrint?: boolean }).autoPrint ?? false,
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
