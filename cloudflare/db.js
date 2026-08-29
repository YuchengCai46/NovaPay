// NovaPay V6.0 — D1 Database helpers

const DEFAULT_CONFIGS = {
  transfer_fee_rate: 0.008,
  debit_card_issue_fee: 300,
  credit_card_issue_fee_base: 80,
  sub_account_fee: 300,
  unfreeze_fee: 100,
  renew_fee: 50,
  gift_card_fee_rate: 0.10,
  daily_transfer_limit: 5000,
  pin_max_attempts: 5,
  login_max_attempts: 5,
  lock_duration_minutes: 15,
  credit_grace_days: 30,
  credit_overdue_suspend_days: 7,
  geo_block_enabled: false
};

export async function initDB(db) {
  // Migration: add IBAN/SWIFT columns if missing (for existing databases)
  try {
    await db.prepare(`ALTER TABLE accounts ADD COLUMN iban TEXT`).run();
  } catch (e) { /* column may already exist */ }
  try {
    await db.prepare(`ALTER TABLE accounts ADD COLUMN swift_code TEXT`).run();
  } catch (e) { /* column may already exist */ }
  try {
    await db.prepare(`ALTER TABLE accounts ADD COLUMN iban_generated_at TEXT`).run();
  } catch (e) { /* column may already exist */ }
  try {
    await db.prepare(`ALTER TABLE accounts ADD COLUMN country_code TEXT DEFAULT 'CH'`).run();
  } catch (e) { /* column may already exist */ }
  try {
    await db.prepare(`ALTER TABLE transactions ADD COLUMN category TEXT`).run();
  } catch (e) { /* column may already exist */ }
  try {
    await db.prepare(`ALTER TABLE transactions ADD COLUMN is_suspicious INTEGER DEFAULT 0`).run();
  } catch (e) { /* column may already exist */ }

  const stmt = await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      phone TEXT, id_number TEXT, dob DATE, address TEXT, nationality TEXT,
      tax_jurisdiction TEXT, purpose TEXT DEFAULT 'Personal',
      password_hash TEXT NOT NULL, pin_hash TEXT, salt TEXT,
      status TEXT DEFAULT 'active', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      locked_until TEXT, fail_count INTEGER DEFAULT 0, pin_fail_count INTEGER DEFAULT 0,
      credit_blacklist INTEGER DEFAULT 0, is_2fa_enabled INTEGER DEFAULT 0,
      totp_secret TEXT, last_login_ip TEXT, last_login_device TEXT,
      settings TEXT DEFAULT '{}', message_box TEXT DEFAULT '[]'
    )
  `);
  await stmt.run();
  await createTables(db);
  await seedConfigs(db);
}

async function createTables(db) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
      type TEXT DEFAULT 'main', currency TEXT DEFAULT 'USD',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      is_active INTEGER DEFAULT 1, alias TEXT, sub_account_fee_paid INTEGER DEFAULT 0,
      iban TEXT UNIQUE, swift_code TEXT, iban_generated_at TEXT,
      country_code TEXT DEFAULT 'CH'
    )`,
    `CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE,
      account_id TEXT NOT NULL, type TEXT NOT NULL, network TEXT DEFAULT 'NovaPay',
      level TEXT DEFAULT 'Standard', expiry TEXT DEFAULT 'ETERNAL',
      cvv_hash TEXT, cvv_encrypted TEXT, status TEXT DEFAULT 'active',
      balance REAL DEFAULT 0.0, credit_limit REAL DEFAULT 0.0, credit_used REAL DEFAULT 0.0,
      credit_due_date DATE, theme TEXT DEFAULT 'default',
      daily_limit REAL DEFAULT 10000.0, single_transaction_limit REAL DEFAULT 5000.0,
      wrong_cvv_count INTEGER DEFAULT 0, issued_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      last_used_at TEXT, is_virtual INTEGER DEFAULT 0, parent_card_id INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, user_id TEXT, account_id TEXT, from_card_id INTEGER,
      to_card_id INTEGER, type TEXT, amount REAL DEFAULT 0.0, fee REAL DEFAULT 0.0,
      balance_after REAL DEFAULT 0.0, note TEXT, category TEXT,
      status TEXT DEFAULT 'completed', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      ip_address TEXT, user_agent TEXT, is_suspicious INTEGER DEFAULT 0, encrypted_note TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, brand TEXT NOT NULL,
      plan_id TEXT, plan_name TEXT, cycle TEXT DEFAULT 'Monthly',
      amount REAL DEFAULT 0.0, bound_card_number TEXT,
      start_date TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      next_billing_date TEXT, status TEXT DEFAULT 'active', auto_renew INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS giftcards (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
      amount REAL DEFAULT 0.0, status TEXT DEFAULT 'active',
      owner_user_id TEXT, redeemed_by_user_id TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), redeemed_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS bound_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
      card_number TEXT NOT NULL, masked TEXT, expiry TEXT, is_active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT, target TEXT,
      details TEXT DEFAULT '{}', ip_address TEXT, user_agent TEXT,
      status TEXT DEFAULT 'success', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS system_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, value TEXT,
      description TEXT, updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_by TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, is_anonymous INTEGER DEFAULT 0,
      content TEXT, content_encrypted TEXT, content_hash TEXT,
      submitted_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      status TEXT DEFAULT 'pending', admin_action TEXT, admin_note TEXT,
      reviewed_at TEXT, reviewed_by TEXT, is_deanonymized INTEGER DEFAULT 0,
      deanonymized_at TEXT, deanonymized_by TEXT, deanonymize_reason TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS escrow_pools (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD', balance REAL DEFAULT 0.0,
      limit_per_currency REAL DEFAULT 50000.0,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(user_id, currency)
    )`,
    `CREATE TABLE IF NOT EXISTS account_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
      reason TEXT, reason_encrypted TEXT, reason_hash TEXT,
      submitted_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      status TEXT DEFAULT 'pending', admin_note TEXT, admin_action TEXT,
      reviewed_at TEXT, reviewed_by TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS kyc_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
      document_type TEXT NOT NULL, document_url TEXT NOT NULL,
      status TEXT DEFAULT 'pending', submitted_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      reviewed_at TEXT, reviewed_by TEXT, rejection_reason TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS fraud_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
      alert_type TEXT NOT NULL, description TEXT,
      related_tx_id TEXT, amount REAL, currency TEXT,
      resolved INTEGER DEFAULT 0, resolved_at TEXT, resolved_by TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )`
  ];
  for (const sql of tables) await db.prepare(sql).run();
  
  // Indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
    'CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)',
    'CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_accounts_iban ON accounts(iban)',
    'CREATE INDEX IF NOT EXISTS idx_cards_number ON cards(number)',
    'CREATE INDEX IF NOT EXISTS idx_cards_account ON cards(account_id)',
    'CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status)',
    'CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_escrow_user ON escrow_pools(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_documents(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_fraud_user ON fraud_alerts(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_fraud_resolved ON fraud_alerts(resolved, created_at)'
  ];
  for (const sql of indexes) await db.prepare(sql).run();
}

async function seedConfigs(db) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO system_configs (key, value) VALUES (?, ?)`);
  for (const [key, value] of Object.entries(DEFAULT_CONFIGS)) {
    await stmt.bind(key, JSON.stringify(value)).run();
  }
}

export async function getConfig(db, key, defaultVal) {
  const row = await db.prepare(`SELECT value FROM system_configs WHERE key = ?`).bind(key).first();
  return row ? JSON.parse(row.value) : defaultVal;
}

export async function setConfig(db, key, value, admin) {
  await db.prepare(`INSERT INTO system_configs (key, value, updated_by) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by`)
    .bind(key, JSON.stringify(value), admin).run();
}

export async function getAllConfigs(db) {
  const rows = await db.prepare(`SELECT key, value FROM system_configs`).all();
  const out = { ...DEFAULT_CONFIGS };
  for (const r of rows.results || []) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

export async function queryUser(db, userId) {
  return await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first();
}

export async function queryUserByEmail(db, email) {
  return await db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email.toLowerCase()).first();
}

// Retry user lookup with exponential backoff to handle D1 async replication lag
export async function queryUserByEmailWithRetry(db, email, maxRetries = 5) {
  const lowerEmail = email.toLowerCase().trim();
  for (let i = 0; i < maxRetries; i++) {
    const user = await queryUserByEmail(db, lowerEmail);
    if (user) return user;
    // Exponential backoff: 100ms, 200ms, 400ms, 800ms
    await new Promise(resolve => setTimeout(resolve, 100 * (2 ** i)));
  }
  return null;
}
