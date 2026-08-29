-- NovaPay V6.0 — D1 Schema (SQLite syntax)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    id_number TEXT,
    dob DATE,
    address TEXT,
    nationality TEXT,
    tax_jurisdiction TEXT,
    purpose TEXT DEFAULT 'Personal',
    password_hash TEXT NOT NULL,
    pin_hash TEXT,
    salt TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    locked_until TEXT,
    fail_count INTEGER DEFAULT 0,
    pin_fail_count INTEGER DEFAULT 0,
    credit_blacklist INTEGER DEFAULT 0,
    is_2fa_enabled INTEGER DEFAULT 0,
    totp_secret TEXT,
    last_login_ip TEXT,
    last_login_device TEXT,
    settings TEXT DEFAULT '{}',
    message_box TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    type TEXT DEFAULT 'main',
    currency TEXT DEFAULT 'USD',
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    is_active INTEGER DEFAULT 1,
    alias TEXT,
    sub_account_fee_paid INTEGER DEFAULT 0
);

CREATE INDEX idx_accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    type TEXT NOT NULL,
    network TEXT DEFAULT 'NovaPay',
    level TEXT DEFAULT 'Standard',
    expiry TEXT DEFAULT 'ETERNAL',
    cvv_hash TEXT,
    cvv_encrypted TEXT,
    status TEXT DEFAULT 'active',
    balance REAL DEFAULT 0.0,
    credit_limit REAL DEFAULT 0.0,
    credit_used REAL DEFAULT 0.0,
    credit_due_date DATE,
    theme TEXT DEFAULT 'default',
    daily_limit REAL DEFAULT 10000.0,
    single_transaction_limit REAL DEFAULT 5000.0,
    wrong_cvv_count INTEGER DEFAULT 0,
    issued_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used_at TEXT,
    is_virtual INTEGER DEFAULT 0,
    parent_card_id INTEGER REFERENCES cards(id)
);

CREATE INDEX idx_cards_number ON cards(number);
CREATE INDEX idx_cards_account ON cards(account_id);
CREATE INDEX idx_cards_status ON cards(status);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    account_id TEXT REFERENCES accounts(id),
    from_card_id INTEGER REFERENCES cards(id),
    to_card_id INTEGER REFERENCES cards(id),
    type TEXT,
    amount REAL DEFAULT 0.0,
    fee REAL DEFAULT 0.0,
    balance_after REAL DEFAULT 0.0,
    note TEXT,
    category TEXT,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ip_address TEXT,
    user_agent TEXT,
    is_suspicious INTEGER DEFAULT 0,
    encrypted_note TEXT
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created ON transactions(created_at);

CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    brand TEXT NOT NULL,
    plan_id TEXT,
    plan_name TEXT,
    cycle TEXT DEFAULT 'Monthly',
    amount REAL DEFAULT 0.0,
    bound_card_number TEXT,
    start_date TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    next_billing_date TEXT,
    status TEXT DEFAULT 'active',
    auto_renew INTEGER DEFAULT 1,
    billing_status TEXT DEFAULT 'charged'
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS giftcards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    amount REAL DEFAULT 0.0,
    status TEXT DEFAULT 'active',
    owner_user_id TEXT REFERENCES users(id),
    redeemed_by_user_id TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    redeemed_at TEXT
);

CREATE TABLE IF NOT EXISTS bound_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    card_number TEXT NOT NULL,
    masked TEXT,
    expiry TEXT,
    is_active INTEGER DEFAULT 1
);

CREATE INDEX idx_bound_cards_user ON bound_cards(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT,
    target TEXT,
    details TEXT DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    status TEXT DEFAULT 'success',
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS system_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT REFERENCES users(id),
    is_anonymous INTEGER DEFAULT 0,
    content TEXT,
    content_encrypted TEXT,
    content_hash TEXT,
    submitted_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    status TEXT DEFAULT 'pending',
    admin_action TEXT,
    admin_note TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT,
    is_deanonymized INTEGER DEFAULT 0,
    deanonymized_at TEXT,
    deanonymized_by TEXT,
    deanonymize_reason TEXT
);

CREATE INDEX idx_suggestions_user ON suggestions(user_id);
CREATE INDEX idx_suggestions_submitted ON suggestions(submitted_at);

CREATE TABLE IF NOT EXISTS escrow_pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    currency TEXT NOT NULL DEFAULT 'USD',
    balance REAL DEFAULT 0.0,
    limit_per_currency REAL DEFAULT 50000.0,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(user_id, currency)
);

CREATE INDEX idx_escrow_user ON escrow_pools(user_id);

CREATE TABLE IF NOT EXISTS account_cancellations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    reason TEXT,
    reason_encrypted TEXT,
    reason_hash TEXT,
    submitted_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    admin_action TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT
);

CREATE INDEX idx_cancellations_user ON account_cancellations(user_id);
CREATE INDEX idx_cancellations_status ON account_cancellations(status);
