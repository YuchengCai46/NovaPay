
import { initDB, getConfig, setConfig, queryUser, queryUserByEmail } from './db.js';
import { ok, fail, json, getBody, getCookies, auditLog, setCookie, clearCookie, requireUser } from './helpers.js';
import { encodeJwt, decodeJwt, verifySecret, hashSecret, genUuid, genUserId, aesEncrypt, aesDecrypt, sha256Hex } from './crypto.js';

// ==================== ROUTES ====================
export const onRequest = async (context) => {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      }});
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.DB;
    
    // Init DB on first request
    if (!env._init) {
      await initDB(db);
      env._init = true;
    }
    
    // Health check
    if (path === '/health') {
      return ok({ status: 'ok' });
    }
    
    // ==================== AUTH ROUTES ====================
    if (path.startsWith('/api/auth/')) {
      return handleAuth(request, db, env);
    }
    
    // ==================== ACCOUNTS ROUTES ====================
    if (path.startsWith('/api/accounts')) {
      return handleAccounts(request, db, env);
    }
    
    // ==================== CARDS ROUTES ====================
    if (path.startsWith('/api/cards')) {
      return handleCards(request, db, env);
    }
    
    // ==================== TRANSACTIONS ROUTES ====================
    if (path.startsWith('/api/transactions')) {
      return handleTransactions(request, db, env);
    }
    
    // ==================== SUBSCRIPTIONS ROUTES ====================
    if (path.startsWith('/api/subscriptions')) {
      return handleSubscriptions(request, db, env);
    }
    
    // ==================== GIFT CARDS ROUTES ====================
    if (path.startsWith('/api/giftcards')) {
      return handleGiftCards(request, db, env);
    }
    
    // ==================== FOREX ROUTES ====================
    if (path.startsWith('/api/forex')) {
      return handleForex(request, db, env);
    }
    
    // ==================== ESCROW ROUTES ====================
    if (path.startsWith('/api/escrow')) {
      return handleEscrow(request, db, env);
    }
    
    // ==================== SUGGESTIONS ROUTES ====================
    if (path.startsWith('/api/suggestions')) {
      return handleSuggestions(request, db, env);
    }
    if (path.startsWith('/api/admin/suggestions')) {
      return handleAdminSuggestions(request, db, env);
    }
    
    // ==================== CANCELLATION ROUTES ====================
    if (path.startsWith('/api/cancellations')) {
      return handleCancellations(request, db, env);
    }
    if (path.startsWith('/api/admin/cancellations')) {
      return handleAdminCancellations(request, db, env);
    }
    
    // ==================== ADMIN ROUTES ====================
    if (path.startsWith('/api/admin/')) {
      return handleAdmin(request, db, env);
    }
    
    // Frontend SPA
    if (path === '/' || path === '/admin' || path.startsWith('/js/') || path.startsWith('/css/') || path === '/favicon.ico') {
      return serveFrontend(request, url, env);
    }
    
    return fail('Not found', 404);
  }
};

// ==================== AUTH HANDLER ====================
async function handleAuth(request, db, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (path === '/api/auth/register' && request.method === 'POST') {
    return authRegister(request, db);
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    return authLogin(request, db);
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const resp = ok({ message: 'Logged out' });
    await clearCookie(resp, 'access_token');
    return resp;
  }
  if (path === '/api/auth/refresh' && request.method === 'POST') {
    return authRefresh(request, db);
  }
  if (path === '/api/auth/me' && request.method === 'GET') {
    const user = await requireUser(request, db);
    if (!user) return fail('Not authenticated', 401);
    const accounts = await db.prepare(`SELECT id, name, type, currency FROM accounts WHERE user_id = ?`).all(user.id);
    return ok({ user: userToPublic(user), accounts: accounts.results, settings: user.settings ? JSON.parse(user.settings) : {} });
  }
  if (path === '/api/auth/messages' && request.method === 'GET') {
    const user = await requireUser(request, db);
    if (!user) return fail('Not authenticated', 401);
    const box = user.message_box ? JSON.parse(user.message_box) : [];
    return ok({ messages: box });
  }
  if (path.startsWith('/api/auth/messages/') && request.method === 'PUT') {
    const mid = parseInt(path.split('/').pop());
    const user = await requireUser(request, db);
    if (!user) return fail('Not authenticated', 401);
    const box = user.message_box ? JSON.parse(user.message_box) : [];
    if (0 <= mid && mid < box.length) box[mid].read = true;
    await db.prepare(`UPDATE users SET message_box = ? WHERE id = ?`).bind(JSON.stringify(box), user.id).run();
    return ok({ message: 'ok' });
  }
  if (path === '/api/auth/devices' && request.method === 'GET') {
    const user = await requireUser(request, db);
    if (!user) return fail('Not authenticated', 401);
    return ok({ current_device: user.last_login_device, current_ip: user.last_login_ip });
  }
  if (path === '/api/auth/session' && request.method === 'DELETE') {
    const user = await requireUser(request, db);
    if (!user) return fail('Not authenticated', 401);
    const s = user.settings ? JSON.parse(user.settings) : {};
    s.session_version = (s.session_version || 0) + 1;
    await db.prepare(`UPDATE users SET settings = ? WHERE id = ?`).bind(JSON.stringify(s), user.id).run();
    return ok({ message: 'All devices signed out' });
  }
  return fail('Not found', 404);
}

async function authRegister(request, db) {
  const d = await getBody(request);
  const email = (d.email || '').toLowerCase().trim();
  const name = (d.name || '').trim();
  const password = d.password || '';
  const pin = d.pin || '';
  
  if (!email || !email.includes('@')) return fail('Invalid email');
  if (password.length < 8) return fail('Password too short');
  if (!pin || !/^\d{4,}$/.test(pin)) return fail('PIN must be numeric');
  
  const existing = await queryUserByEmail(db, email);
  if (existing) return fail('Email already registered', 409);
  
  const uid = genUserId();
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
  const passwordHash = await hashSecret(password);
  const pinHash = await hashSecret(pin);
  
  const accId = genUuid();
  await db.prepare(`INSERT INTO users (id, email, name, phone, id_number, dob, address, nationality, tax_jurisdiction, purpose, password_hash, pin_hash, salt, status, settings, message_box) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .bind(uid, email, name || 'NovaPay User', d.phone || null, d.id_number || null, d.dob || null, d.address || null, d.nationality || null, d.tax_jurisdiction || null, d.purpose || 'Personal', passwordHash, pinHash, salt, JSON.stringify({ session_version: 0 }), JSON.stringify([])).run();
  
  await db.prepare(`INSERT INTO accounts (id, user_id, name, type, currency) VALUES (?, ?, ?, 'main', ?)`).bind(accId, uid, 'Main Account', d.currency || 'USD').run();
  
  await auditLog(db, uid, 'register', uid, {}, 'success');
  
  const token = await encodeJwt({ sub: uid, svf: 0 });
  const resp = ok({ user: uid, account: accId, settings: { session_version: 0 } }, 'Registered');
  await setCookie(resp, 'access_token', token);
  return resp;
}

async function authLogin(request, db) {
  const d = await getBody(request);
  const identifier = (d.identifier || '').trim();
  const password = d.password || '';
  
  const user = await queryUserByEmail(db, identifier) || await queryUser(db, identifier);
  if (!user) return fail('Account not found', 401);
  
  const now = new Date();
  if (user.locked_until && new Date(user.locked_until) > now) {
    const remain = Math.ceil((new Date(user.locked_until) - now) / 60000);
    return fail(`Locked for ${remain} minutes`, 429);
  }
  
  const valid = await verifySecret(user.password_hash, password);
  if (!valid) {
    const failCount = (user.fail_count || 0) + 1;
    const maxAttempts = await getConfig(db, 'login_max_attempts', 5);
    if (failCount >= maxAttempts) {
      const duration = await getConfig(db, 'lock_duration_minutes', 15);
      await db.prepare(`UPDATE users SET fail_count = 0, locked_until = ? WHERE id = ?`).bind(new Date(Date.now() + duration * 60000).toISOString(), user.id).run();
    } else {
      await db.prepare(`UPDATE users SET fail_count = ? WHERE id = ?`).bind(failCount, user.id).run();
    }
    await auditLog(db, user.id, 'login', user.id, { status: 'failed' }, 'failed');
    return fail('Wrong password', 401);
  }
  
  await db.prepare(`UPDATE users SET fail_count = 0, locked_until = NULL, last_login_ip = ?, last_login_device = ? WHERE id = ?`).bind(identifier, request.headers.get('User-Agent') || '', user.id).run();

  const settings = user.settings ? JSON.parse(user.settings) : {};
  const token = await encodeJwt({ sub: user.id, svf: settings.session_version || 0 });
  const resp = ok({ user: user.id, two_fa_required: user.is_2fa_enabled, settings }, 'Logged in');
  await setCookie(resp, 'access_token', token);
  await auditLog(db, user.id, 'login', user.id, {}, 'success');
  return resp;
}

async function authRefresh(request, db) {
  const user = await requireUser(request, db);
  if (!user) return fail('Invalid session', 401);
  const settings = user.settings ? JSON.parse(user.settings) : {};
  const token = await encodeJwt({ sub: user.id, svf: settings.session_version || 0 });
  const resp = ok({}, 'Refreshed');
  await setCookie(resp, 'access_token', token);
  return resp;
}

function userToPublic(u) {
  return {
    id: u.id, email: u.email, name: u.name, phone: u.phone,
    nationality: u.nationality, tax_jurisdiction: u.tax_jurisdiction, purpose: u.purpose,
    status: u.status, created_at: u.created_at,
    credit_blacklist: toBool(u.credit_blacklist),
    is_2fa_enabled: toBool(u.is_2fa_enabled)
  };
}

// ==================== TRANSACTION HANDLER ====================
async function handleTransactions(request, db, env) {
  const url = new URL(request.url);
  const user = await requireUser(request, db);
  if (!user) return fail('Not authenticated', 401);
  if (user._blocked) return fail(user._blocked, 403);
  
  const path = url.pathname;
  const method = request.method;
  
  if (path === '/api/transactions/topup' && method === 'POST') {
    const d = await getBody(request);
    const c = await getOwnCard(db, user.id, d.card_id);
    if (!c || c.type !== 'debit') return fail('Invalid debit card', 404);
    const amount = parseFloat(d.amount) || 0;
    if (amount <= 0) return fail('Amount > 0');
    c.balance += amount;
    await db.prepare(`UPDATE cards SET balance = ?, last_used_at = ? WHERE id = ?`).bind(c.balance, nowMs(), c.id).run();
    await db.prepare(`INSERT INTO transactions (id, user_id, account_id, from_card_id, type, amount, balance_after, status, created_at, ip_address, user_agent) VALUES (?, ?, ?, ?, 'topup', ?, ?, 'completed', ?, ?, ?)`)
      .bind(genTxId(), user.id, c.account_id, c.id, amount, round(c.balance), nowMs(), request.headers.get('CF-Connecting-IP') || '', request.headers.get('User-Agent') || '').run();
    return ok({ balance: round(c.balance), tx_id: '' }, 'Topped up');
  }
  
  if (path === '/api/transactions/transfer' && method === 'POST') {
    const d = await getBody(request);
    const src = await getOwnCard(db, user.id, d.from_card_id);
    if (!src || src.type !== 'debit') return fail('Invalid source card', 404);
    if (src.status !== 'active') return fail('Card not active', 400);
    
    const amount = parseFloat(d.amount) || 0;
    if (amount <= 0) return fail('Amount > 0');
    
    const validPin = await verifySecret(user.pin_hash, d.pin);
    if (!validPin) return fail('Wrong PIN', 400);
    
    if (amount > src.single_transaction_limit) return fail('Limit exceeded', 400);
    
    const base = ((user.settings || {}).base_currency || 'CHF').toUpperCase();
    const feeRate = base === 'CHF' ? 0.003 : 0.005;
    const fee = round(amount * feeRate);
    const total = amount + fee;
    if (src.balance < total) return fail('Insufficient (incl. fee)', 400);
    
    const toNum = (d.to_card_number || '').replace(/\s/g, '');
    const dest = await db.prepare(`SELECT * FROM cards WHERE number = ?`).get(toNum);
    if (!dest) return fail('Destination card not found', 404);
    
    src.balance -= total;
    await db.prepare(`UPDATE cards SET balance = ?, last_used_at = ? WHERE id = ?`).bind(src.balance, nowMs(), src.id).run();
    
    if (dest.type === 'debit') {
      dest.balance += amount;
      await db.prepare(`UPDATE cards SET balance = ? WHERE id = ?`).bind(dest.balance, dest.id).run();
    } else if (dest.type === 'credit') {
      dest.credit_used = Math.max(0, (dest.credit_used || 0) - amount);
      await db.prepare(`UPDATE cards SET credit_used = ? WHERE id = ?`).bind(dest.credit_used, dest.id).run();
    }
    
    const txOut = genTxId();
    await db.prepare(`INSERT INTO transactions (id, user_id, account_id, from_card_id, to_card_id, type, amount, fee, balance_after, status, created_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, 'transfer_out', ?, ?, ?, 'completed', ?, ?, ?)`)
      .bind(txOut, user.id, src.account_id, src.id, dest.id, amount, fee, round(src.balance), nowMs(), request.headers.get('CF-Connecting-IP') || '', request.headers.get('User-Agent') || '').run();
    
    await db.prepare(`INSERT INTO transactions (id, user_id, account_id, from_card_id, to_card_id, type, amount, balance_after, status, created_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, 'transfer_in', ?, ?, 'completed', ?, ?, ?)`)
      .bind(genTxId(), dest.user_id || user.id, dest.account_id, src.id, dest.id, amount, round(dest.balance || 0), nowMs(), request.headers.get('CF-Connecting-IP') || '', request.headers.get('User-Agent') || '').run();
    
    if (amount > 5000) {
      await pushMessage(db, user.id, `【Security Alert】Large transfer $${amount.toFixed(2)} detected.`);
    }
    
    return ok({ tx_id: txOut, fee, balance: round(src.balance) }, 'Transferred');
  }
  
  if (path === '/api/transactions/history' && method === 'GET') {
    const page = parseInt(url.searchParams.get('page')) || 1;
    const per = parseInt(url.searchParams.get('per_page')) || 20;
    const offset = (page - 1) * per;
    const txs = await db.prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(user.id, per, offset);
    const total = await db.prepare(`SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ?`).get(user.id);
    const out = (txs.results || []).map(t => ({
      id: t.id, type: t.type, amount: round(t.amount), fee: round(t.fee),
      status: t.status, is_suspicious: toBool(t.is_suspicious), created_at: t.created_at, category: t.category
    }));
    return ok({ transactions: out, page, per_page: per, total: total.cnt });
  }
  
  return fail('Not found', 404);
}

// ==================== SUBSCRIPTIONS HANDLER ====================
async function handleSubscriptions(request, db, env) {
  const user = await requireUser(request, db);
  if (!user) return fail('Not authenticated', 401);
  if (user._blocked) return fail(user._blocked, 403);
  
  const path = new URL(request.url).pathname;
  const method = request.method;
  
  const SERVICE_CATALOG = [
    { brand: 'Netflix', plan_id: 'nf_std', plan_name: 'Standard', cycle: 'Monthly', amount: 15.99 },
    { brand: 'Spotify', plan_id: 'sp_prem', plan_name: 'Premium', cycle: 'Monthly', amount: 9.99 },
    { brand: 'Adobe', plan_id: 'ad_cc', plan_name: 'Creative Cloud', cycle: 'Yearly', amount: 599.88 },
    { brand: 'ChatGPT', plan_id: 'cg_plus', plan_name: 'Plus', cycle: 'Monthly', amount: 20.00 },
    { brand: 'iCloud', plan_id: 'ic_200', plan_name: '200GB', cycle: 'Monthly', amount: 2.99 },
  ];
  
  if (path === '/api/subscriptions/services' && method === 'GET') {
    return ok({ services: SERVICE_CATALOG });
  }
  
  if (path === '/api/subscriptions/bind-card' && method === 'POST') {
    const d = await getBody(request);
    const num = (d.card_number || '').replace(/\s/g, '');
    if (num.length < 13) return fail('Invalid card', 400);
    await db.prepare(`INSERT INTO bound_cards (user_id, card_number, masked, expiry, is_active) VALUES (?, ?, ?, ?, 1)`).bind(user.id, num, maskCard(num), d.expiry).run();
    return ok({ masked: maskCard(num) }, 'Card bound');
  }
  
  if (path === '/api/subscriptions/my-bound-cards' && method === 'GET') {
    const cards = await db.prepare(`SELECT * FROM bound_cards WHERE user_id = ? AND is_active = 1`).all(user.id);
    return ok({ cards: (cards.results || []).map(c => ({ id: c.id, masked: c.masked, expiry: c.expiry, last4: c.card_number.slice(-4) })) });
  }
  
  if (path === '/api/subscriptions/subscribe' && method === 'POST') {
    const d = await getBody(request);
    const svc = SERVICE_CATALOG.find(s => s.plan_id === d.plan_id);
    if (!svc) return fail('Plan not found', 404);
    
    const main = await db.prepare(`SELECT id FROM accounts WHERE user_id = ? AND type = 'main'`).get(user.id);
    if (!main) return fail('No main account');
    const pay = await db.prepare(`SELECT * FROM cards WHERE account_id = ? AND type = 'debit' AND status = 'active'`).get(main.id);
    if (!pay || pay.balance < svc.amount) return fail('Insufficient balance', 400);
    
    pay.balance -= svc.amount;
    await db.prepare(`UPDATE cards SET balance = ? WHERE id = ?`).bind(pay.balance, pay.id).run();
    
    const subId = 'SUB' + nowMs().replace(/[-\s:]/g, '');
    await db.prepare(`INSERT INTO subscriptions (id, user_id, brand, plan_id, plan_name, cycle, amount, bound_card_number, start_date, next_billing_date, status, auto_renew) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1)`).bind(subId, user.id, svc.brand, svc.plan_id, svc.plan_name, svc.cycle, svc.amount, pay.number, nowMs(), new Date(Date.now() + 30*86400000).toISOString()).run();
    
    await db.prepare(`INSERT INTO transactions (id, user_id, account_id, from_card_id, type, amount, balance_after, status, created_at) VALUES (?, ?, ?, ?, 'subscription', ?, ?, 'completed', ?)`).bind(genTxId(), user.id, pay.account_id, pay.id, svc.amount, round(pay.balance), nowMs()).run();
    
    return ok({ subscription: { id: subId, brand: svc.brand, status: 'active' } }, 'Subscribed');
  }
  
  if (path === '/api/subscriptions/my' && method === 'GET') {
    const subs = await db.prepare(`SELECT * FROM subscriptions WHERE user_id = ?`).all(user.id);
    return ok({ subscriptions: (subs.results || []).map(s => ({ id: s.id, brand: s.brand, plan_name: s.plan_name, cycle: s.cycle, amount: round(s.amount), status: s.status, auto_renew: toBool(s.auto_renew) })) });
  }
  
  if (path.match(/^\/api\/subscriptions\/[^\/]+$/) && method === 'DELETE') {
    const subId = path.split('/')[3];
    const sub = await db.prepare(`SELECT id FROM subscriptions WHERE id = ? AND user_id = ?`).get(subId, user.id);
    if (!sub) return fail('Not found', 404);
    await db.prepare(`UPDATE subscriptions SET status = 'canceled', auto_renew = 0 WHERE id = ?`).bind(subId).run();
    return ok({}, 'Canceled');
  }
  
  return fail('Not found', 404);
}

// ==================== GIFT CARDS HANDLER ====================
async function handleGiftCards(request, db, env) {
  const user = await requireUser(request, db);
  if (!user) return fail('Not authenticated', 401);
  if (user._blocked) return fail(user._blocked, 403);
  
  const path = new URL(request.url).pathname;
  const method = request.method;
  
  if (path === '/api/giftcards/buy' && method === 'POST') {
    const d = await getBody(request);
    const amount = parseFloat(d.amount) || 0;
    if (amount <= 0) return fail('Amount > 0');
    const feeRate = parseFloat(await getConfig(db, 'gift_card_fee_rate', 0.10));
    const fee = round(amount * feeRate);
    const main = await db.prepare(`SELECT id FROM accounts WHERE user_id = ? AND type = 'main'`).get(user.id);
    if (!main) return fail('No main account', 404);
    const pay = await db.prepare(`SELECT id, balance FROM cards WHERE account_id = ? AND type = 'debit' AND status = 'active'`).get(main.id);
    if (!pay || pay.balance < amount + fee) return fail('Insufficient balance');
    pay.balance -= (amount + fee);
    await db.prepare(`UPDATE cards SET balance = ? WHERE id = ?`).bind(pay.balance, pay.id).run();
    const code = genGiftCode();
    await db.prepare(`INSERT INTO giftcards (code, amount, status, owner_user_id) VALUES (?, ?, 'active', ?)`).bind(code, amount, user.id).run();
    await db.prepare(`INSERT INTO transactions (id, user_id, account_id, from_card_id, type, amount, balance_after, status, created_at) VALUES (?, ?, ?, ?, 'giftcard_buy', ?, ?, 'completed', ?)`).bind(genTxId(), user.id, pay.account_id, pay.id, amount + fee, round(pay.balance), nowMs()).run();
    return ok({ code, amount, fee }, 'Purchased');
  }
  
  if (path === '/api/giftcards/redeem' && method === 'POST') {
    const d = await getBody(request);
    const code = (d.code || '').toUpperCase().trim();
    const gc = await db.prepare(`SELECT * FROM giftcards WHERE code = ?`).get(code);
    if (!gc) return fail('Gift card not found', 404);
    if (gc.status !== 'active') return fail('Already used', 400);
    const c = await getOwnCard(db, user.id, d.card_id);
    if (!c || c.type !== 'debit') return fail('Invalid debit card', 404);
    c.balance += gc.amount;
    await db.prepare(`UPDATE cards SET balance = ? WHERE id = ?`).bind(c.balance, c.id).run();
    await db.prepare(`UPDATE giftcards SET status = 'used', redeemed_by_user_id = ?, redeemed_at = ? WHERE code = ?`).bind(user.id, nowMs(), code).run();
    await db.prepare(`INSERT INTO transactions (id, user_id, account_id, to_card_id, type, amount, balance_after, status, created_at) VALUES (?, ?, ?, ?, 'giftcard_redeem', ?, ?, 'completed', ?)`).bind(genTxId(), user.id, c.account_id, c.id, gc.amount, round(c.balance), nowMs()).run();
    return ok({ balance: round(c.balance) }, 'Redeemed');
  }
  
  if (path === '/api/giftcards/my' && method === 'GET') {
    const gcs = await db.prepare(`SELECT * FROM giftcards WHERE owner_user_id = ? ORDER BY created_at DESC`).all(user.id);
    return ok({ giftcards: (gcs.results || []).map(g => ({ code: g.code, amount: round(g.amount), status: g.status, created_at: g.created_at })) });
  }
  
  if (path === '/api/giftcards/verify' && method === 'POST') {
    const d = await getBody(request);
    const gc = await db.prepare(`SELECT status, amount FROM giftcards WHERE code = ?`).get((d.code || '').toUpperCase());
    if (!gc) return ok({ valid: false, reason: 'not_found' });
    return ok({ valid: gc.status === 'active', amount: gc.amount, status: gc.status });
  }
  
  return fail('Not found', 404);
}

// ==================== FOREX HANDLER ====================
async function handleForex(request, db, env) {
  const user = await requireUser(request, db);
  if (!user) return fail('Not authenticated', 401);
  if (user._blocked) return fail(user._blocked, 403);
  
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  
  const BASE_CURRENCIES = ['usd', 'eur', 'gbp', 'chf', 'jpy', 'cny', 'cad', 'aud', 'nzd', 'sgd', 'hkd', 'krw', 'inr', 'brl', 'rub', 'try', 'zarr', 'mxn', 'sek', 'nok', 'dkk', 'pln', 'thb', 'idr', 'myr', 'php', 'czk', 'huf', 'ils', 'clp', 'arg', 'cop', 'pen', '/vnd'];
  
  if (path === '/api/forex/currencies' && method === 'GET') {
    return ok({ currencies: BASE_CURRENCIES.map(c => ({ code: c.toUpperCase(), name: c })) });
  }
  
  if (path === '/api/forex/rates' && method === 'GET') {
    const base = (url.searchParams.get('base') || 'CHF').toUpperCase();
    const rates = {};
    for (const cur of BASE_CURRENCIES) {
      rates[cur.toUpperCase()] = cur === base.toLowerCase() ? 1.0 : 1 / getFallbackRate(cur.toLowerCase(), base.toLowerCase());
    }
    return ok({ base, rates, currencies: BASE_CURRENCIES.map(c => ({ code: c.toUpperCase(), name: c })) });
  }
  
  if (path === '/api/forex/history' && method === 'GET') {
    const from = (url.searchParams.get('from') || 'USD').toLowerCase();
    const to = (url.searchParams.get('to') || 'CHF').toLowerCase();
    const days = Math.min(180, Math.max(7, parseInt(url.searchParams.get('days')) || 30));
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const date = d.toISOString().slice(0, 10);
      const rate = from === to ? 1.0 : 1 / getFallbackRate(to, from);
      series.push({ date, rate });
    }
    return ok({ from: from.toUpperCase(), to: to.toUpperCase(), days, series });
  }
  
  if (path === '/api/forex/deposit' && method === 'POST') {
    const d = await getBody(request);
    const cardId = d.card_id;
    const fromC = (d.from_currency || 'USD').toUpperCase();
    const amount = parseFloat(d.amount) || 0;
    if (amount <= 0) return fail('Amount > 0');
    if (fromC === 'USD') return fail('Unsupported: use base currency');
    
    const c = await getOwnCard(db, user.id, cardId);
    if (!c || c.type !== 'debit') return fail('Invalid debit card', 404);
    
    const base = ((user.settings || {}).base_currency || 'CHF').toUpperCase();
    const rate = fromC === base ? 1 : 1 / getFallbackRate(base.toLowerCase(), fromC.toLowerCase());
    const baseAmount = amount * rate;
    const depositFee = await getConfig(db, 'forex_deposit_fee', 0.05);
    const feeAmt = round(baseAmount * depositFee);
    const credited = round(baseAmount - feeAmt);
    
    c.balance += credited;
    await db.prepare(`UPDATE cards SET balance = ?, last_used_at = ? WHERE id = ?`).bind(c.balance, nowMs(), c.id).run();
    
    await db.prepare(`INSERT INTO transactions (id, user_id, account_id, from_card_id, type, amount, fee, balance_after, status, created_at, note) VALUES (?, ?, ?, ?, 'forex_deposit', ?, ?, ?, 'completed', ?, ?)`)
      .bind(genTxId(), user.id, c.account_id, c.id, amount, feeAmt, round(c.balance), nowMs(), `${fromC}→${base}`).run();
    
    return ok({ balance: round(c.balance), credited, fee: feeAmt, rate, base, from_currency: fromC }, 'Deposited');
  }
  
  if (path === '/api/forex/withdraw' && method === 'POST') {
    const d = await getBody(request);
    const cardId = d.card_id;
    const toC = (d.to_currency || 'USD').toUpperCase();
    const amount = parseFloat(d.amount) || 0;
    if (amount <= 0) return fail('Amount > 0');
    if (toC === 'USD') return fail('Unsupported: use base currency');
    
    const c = await getOwnCard(db, user.id, cardId);
    if (!c || c.type !== 'debit') return fail('Invalid debit card', 404);
    
    const base = ((user.settings || {}).base_currency || 'CHF').toUpperCase();
    const rate = toC === base ? 1 : getFallbackRate(base.toLowerCase(), toC.toLowerCase());
    const withdrawFee = await getConfig(db, 'forex_withdraw_fee', 0.03);
    const feeAmt = round(amount * withdrawFee);
    const total = amount + feeAmt;
    
    if (c.balance < total) return fail('Insufficient balance');
    c.balance -= total;
    await db.prepare(`UPDATE cards SET balance = ?, last_used_at = ? WHERE id = ?`).bind(c.balance, nowMs(), c.id).run();
    
    const sent = round(amount * rate);
    await db.prepare(`INSERT INTO transactions (id, user_id, account_id, from_card_id, type, amount, fee, balance_after, status, created_at, note) VALUES (?, ?, ?, ?, 'forex_withdraw', ?, ?, ?, 'completed', ?, ?)`)
      .bind(genTxId(), user.id, c.account_id, c.id, amount, feeAmt, round(c.balance), nowMs(), `${base}→${toC}`).run();
    
    return ok({ balance: round(c.balance), sent, fee: feeAmt, rate, base, to_currency: toC }, 'Withdrawn');
  }
  
  return fail('Not found', 404);
}

function getFallbackRate(from, to) {
  const rates = {
    usd: { eur: 0.92, gbp: 0.79, chf: 0.88, jpy: 149.50, cny: 7.24, cad: 1.36, aud: 1.53, nzd: 1.67, sgd: 1.34, hkd: 7.82, krw: 1320, inr: 83.12, brl: 4.97, rub: 89.50, try: 28.50, zarr: 18.75, mxn: 17.12, sek: 10.45, nok: 10.52, dkk: 6.87, pln: 3.98, thb: 35.25, idr: 15650, myr: 4.68, php: 55.85, czk: 22.45, huf: 350.50, ils: 3.65, clp: 890, arg: 350, cop: 3950, pen: 3.72 },
    eur: { usd: 1.09, gbp: 0.86, chf: 0.96, jpy: 162.50, cny: 7.87, cad: 1.48, aud: 1.66, nzd: 1.82, sgd: 1.46, hkd: 8.52, krw: 1435, inr: 90.45, brl: 5.41, rub: 97.50, try: 31.10, zarr: 20.42, mxn: 18.66, sek: 11.37, nok: 11.44, dkk: 7.45, pln: 4.32, thb: 38.32, idr: 17030, myr: 5.09, php: 60.75, czk: 24.42, huf: 381.00, ils: 3.97, clp: 971, arg: 381, cop: 4298, pen: 4.05 },
    gbp: { usd: 1.27, eur: 1.16, chf: 1.12, jpy: 189.20, cny: 9.16, cad: 1.72, aud: 1.93, nzd: 2.12, sgd: 1.70, hkd: 9.91, krw: 1670, inr: 105.20, brl: 6.30, rub: 113.40, try: 36.10, zarr: 23.70, mxn: 21.68, sek: 13.21, nok: 13.29, dkk: 8.68, pln: 5.03, thb: 44.60, idr: 19800, myr: 5.92, php: 70.67, czk: 28.40, huf: 443.50, ils: 4.62, clp: 1130, arg: 443, cop: 5000, pen: 4.71 },
    chf: { usd: 1.14, eur: 1.04, gbp: 0.89, jpy: 170.00, cny: 8.23, cad: 1.55, aud: 1.74, nzd: 1.90, sgd: 1.52, hkd: 8.91, krw: 1502, inr: 94.67, brl: 5.67, rub: 102.00, try: 32.50, zarr: 21.32, mxn: 19.51, sek: 11.89, nok: 11.96, dkk: 7.81, pln: 4.52, thb: 40.08, idr: 17810, myr: 5.33, php: 63.62, czk: 25.59, huf: 399.40, ils: 4.16, clp: 1016, arg: 399, cop: 4499, pen: 4.24 }
  };
  return rates[from]?.[to] || 1;
}

// ==================== ESCROW HANDLER ====================
async function handleEscrow(request, db, env) {
  const user = await requireUser(request, db);
  if (!user) return fail('Not authenticated', 401);
  if (user._blocked) return fail(user._blocked, 403);
  
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const POOL_LIMITS = { CHF: 50000, USD: 50000 };
  
  if (path === '/api/escrow/pool' && method === 'GET') {
    const pools = await db.prepare(`SELECT * FROM escrow_pools WHERE user_id = ?`).all(user.id);
    const base = ((user.settings || {}).base_currency || 'CHF').toUpperCase();
    const out = {};
    for (const p of pools.results || []) out[p.currency] = { balance: round(p.balance), limit: p.limit_per_currency };
    for (const [cur, limit] of Object.entries(POOL_LIMITS)) {
      if (!out[cur]) out[cur] = { balance: 0, limit };
    }
    return ok({ pools: out });
  }
  
  if (path === '/api/escrow/deposit' && method === 'POST') {
    const d = await getBody(request);
    const amount = parseFloat(d.amount) || 0;
    const target = (d.target_currency || '').toUpperCase() || ((user.settings || {}).base_currency || 'CHF').toUpperCase();
    if (amount <= 0) return fail('Amount > 0');
    if (!POOL_LIMITS[target]) return fail('Unsupported currency');
    
    const fee = amount * 0.08;
    const credited = amount - fee;
    const pool = await db.prepare(`SELECT id, balance FROM escrow_pools WHERE user_id = ? AND currency = ?`).get(user.id, target);
    const existing = pool?.balance || 0;
    if (existing + credited > POOL_LIMITS[target]) return fail('Exceeds pool limit');
    
    if (pool) {
      await db.prepare(`UPDATE escrow_pools SET balance = balance + ? WHERE id = ?`).bind(credited, pool.id).run();
    } else {
      await db.prepare(`INSERT INTO escrow_pools (user_id, currency, balance) VALUES (?, ?, ?)`).bind(user.id, target, credited).run();
    }
    return ok({ currency: target, credited: round(credited), fee: round(fee), pool_balance: round(existing + credited), limit: POOL_LIMITS[target] }, 'Deposited');
  }
  
  if (path === '/api/escrow/withdraw' && method === 'POST') {
    const d = await getBody(request);
    const amount = parseFloat(d.amount) || 0;
    const target = (d.target_currency || '').toUpperCase() || ((user.settings || {}).base_currency || 'CHF').toUpperCase();
    if (amount <= 0) return fail('Amount > 0');
    if (!POOL_LIMITS[target]) return fail('Unsupported currency');
    
    const pool = await db.prepare(`SELECT id, balance FROM escrow_pools WHERE user_id = ? AND currency = ?`).get(user.id, target);
    if (!pool || pool.balance < amount) return fail('Insufficient escrow balance');
    
    const fee = amount * 0.05;
    const net = amount - fee;
    await db.prepare(`UPDATE escrow_pools SET balance = balance - ? WHERE id = ?`).bind(amount, pool.id).run();
    
    return ok({ currency: target, sent: round(net), fee: round(fee), pool_balance: round(pool.balance - amount) }, 'Withdrawn');
  }
  
  return fail('Not found', 404);
}

// ==================== SUGGESTIONS HANDLER ====================
async function handleSuggestions(request, db, env) {
  const user = await requireUser(request, db);
  if (!user) return fail('Not authenticated', 401);
  if (user._blocked) return fail(user._blocked, 403);
  
  const path = new URL(request.url).pathname;
  const method = request.method;
  
  if (path === '/api/suggestions' && method === 'POST') {
    const d = await getBody(request);
    const content = (d.content || '').trim();
    if (!content) return fail('Content required');
    const encrypted = await aesEncrypt(content);
    const digest = await sha256Hex(content);
    await db.prepare(`INSERT INTO suggestions (user_id, is_anonymous, content, content_encrypted, content_hash, status) VALUES (?, ?, ?, ?, ?, 'pending')`).bind(user.id, d.anonymous ? 1 : 0, content, encrypted, digest).run();
    return ok({ status: 'pending' }, 'Submitted');
  }
  
  if (path === '/api/suggestions/my' && method === 'GET') {
    const sugs = await db.prepare(`SELECT id, is_anonymous, preview, status, admin_action, submitted_at FROM (SELECT id, is_anonymous, substr(content, 1, 30) as preview, status, admin_action, submitted_at FROM suggestions WHERE user_id = ? ORDER BY submitted_at DESC) ORDER BY submitted_at DESC`).all(user.id);
    return ok({ suggestions: (sugs.results || []).map(s => ({ id: s.id, is_anonymous: toBool(s.is_anonymous), preview: s.preview, status: s.status, admin_action: s.admin_action, submitted_at: s.submitted_at })) });
  }
  
  return fail('Not found', 404);
}

async function handleAdminSuggestions(request, db, env) {
  const admin = await requireAdmin(request, db);
  if (!admin) return fail('Admin required', 403);
  
  const path = new URL(request.url).pathname;
  const method = request.method;
  
  if (path === '/api/admin/suggestions' && method === 'GET') {
    const sugs = await db.prepare(`SELECT * FROM suggestions ORDER BY submitted_at DESC LIMIT 100`).all();
    return ok({ suggestions: (sugs.results || []).map(s => ({ id: s.id, submitted_at: s.submitted_at, is_anonymous: toBool(s.is_anonymous), status: s.status, admin_action: s.admin_action })) });
  }
  
  if (path.match(/^\/api\/admin\/suggestions\/\d+\/archive$/) && method === 'POST') {
    const sugId = parseInt(path.split('/')[4]);
    await db.prepare(`UPDATE suggestions SET status = 'archived', admin_action = 'archive', reviewed_by = ? WHERE id = ?`).bind(admin, sugId).run();
    return ok({}, 'Archived');
  }
  
  if (path.match(/^\/api\/admin\/suggestions\/\d+$/) && method === 'DELETE') {
    const sugId = parseInt(path.split('/')[4]);
    await db.prepare(`DELETE FROM suggestions WHERE id = ?`).run(sugId);
    return ok({}, 'Deleted');
  }
  
  return fail('Not found', 404);
}

// ==================== CANCELLATION HANDLERS ====================
async function handleCancellations(request, db, env) {
  const user = await requireUser(request, db);
  if (!user) return fail('Not authenticated', 401);
  if (user._blocked) return fail(user._blocked, 403);
  
  const path = new URL(request.url).pathname;
  const method = request.method;
  
  if (path === '/api/cancellations' && method === 'POST') {
    const d = await getBody(request);
    const reason = (d.reason || '').trim();
    if (!reason) return fail('Reason required');
    const encrypted = await aesEncrypt(reason);
    const digest = await sha256Hex(reason);
    await db.prepare(`INSERT INTO account_cancellations (user_id, reason, reason_encrypted, reason_hash, status) VALUES (?, ?, ?, ?, 'pending')`).bind(user.id, reason, encrypted, digest).run();
    return ok({ status: 'pending' }, 'Submitted');
  }
  
  if (path === '/api/cancellations/my' && method === 'GET') {
    const reqs = await db.prepare(`SELECT * FROM account_cancellations WHERE user_id = ? ORDER BY submitted_at DESC`).all(user.id);
    return ok({ requests: (reqs.results || []).map(r => ({ id: r.id, reason_preview: (r.reason || '').slice(0, 40), status: r.status, admin_action: r.admin_action, submitted_at: r.submitted_at })) });
  }
  
  if (path.match(/^\/api\/cancellations\/\d+\/cancel$/) && method === 'POST') {
    const reqId = parseInt(path.split('/')[3]);
    await db.prepare(`UPDATE account_cancellations SET status = 'cancelled', admin_action = 'cancelled_by_user' WHERE id = ? AND user_id = ?`).bind(reqId, user.id).run();
    return ok({}, 'Cancelled');
  }
  
  return fail('Not found', 404);
}

async function handleAdminCancellations(request, db, env) {
  const admin = await requireAdmin(request, db);
  if (!admin) return fail('Admin required', 403);
  
  const path = new URL(request.url).pathname;
  const method = request.method;
  
  if (path === '/api/admin/cancellations' && method === 'GET') {
    const reqs = await db.prepare(`SELECT * FROM account_cancellations ORDER BY submitted_at DESC LIMIT 100`).all();
    return ok({ requests: (reqs.results || []).map(r => ({ id: r.id, user_id: r.user_id, status: r.status, admin_action: r.admin_action, submitted_at: r.submitted_at })) });
  }
  
  if (path.match(/^\/api\/admin\/cancellations\/\d+\/approve$/) && method === 'POST') {
    const reqId = parseInt(path.split('/')[4]);
    const r = await db.prepare(`SELECT * FROM account_cancellations WHERE id = ?`).get(reqId);
    if (!r || r.status !== 'pending') return fail('Invalid request', 400);
    
    // Transfer card balances to escrow
    const base = 'CHF';
    const accounts = await db.prepare(`SELECT id FROM accounts WHERE user_id = ?`).all(r.user_id);
    for (const acc of accounts.results || []) {
      const cards = await db.prepare(`SELECT id, balance FROM cards WHERE account_id = ? AND type = 'debit' AND balance > 0`).all(acc.id);
      for (const card of cards.results || []) {
        let pool = await db.prepare(`SELECT id, balance FROM escrow_pools WHERE user_id = ? AND currency = ?`).get(r.user_id, base);
        if (pool) {
          await db.prepare(`UPDATE escrow_pools SET balance = balance + ? WHERE id = ?`).bind(card.balance, pool.id).run();
        } else {
          await db.prepare(`INSERT INTO escrow_pools (user_id, currency, balance) VALUES (?, ?, ?)`).bind(r.user_id, base, card.balance).run();
        }
        await db.prepare(`UPDATE cards SET balance = 0, status = 'canceled' WHERE id = ?`).bind(card.id).run();
      }
    }
    
    await db.prepare(`UPDATE users SET status = 'closed' WHERE id = ?`).bind(r.user_id).run();
    await db.prepare(`UPDATE account_cancellations SET status = 'approved', admin_action = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`).bind((r.admin_note || '') + ` [Approved by ${admin}]`, admin, nowMs(), reqId).run();
    
    return ok({}, 'Account closed');
  }
  
  if (path.match(/^\/api\/admin\/cancellations\/\d+\/reject$/) && method === 'POST') {
    const reqId = parseInt(path.split('/')[4]);
    const d = await getBody(request);
    await db.prepare(`UPDATE account_cancellations SET status = 'rejected', admin_action = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`).bind(d.note || '', admin, nowMs(), reqId).run();
    return ok({}, 'Rejected');
  }
  
  return fail('Not found', 404);
}

// ==================== ADMIN HANDLER ====================
async function handleAdmin(request, db, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  
  if (path === '/api/admin/login' && method === 'POST') {
    const d = await getBody(request);
    const username = (d.username || '').trim();
    const password = d.password || '';
    if (!process.env?.ADMIN_PASSWORD_HASH) return fail('Admin not configured', 500);
    if (username !== ADMIN_USERNAME || !(await verifySecret(process.env.ADMIN_PASSWORD_HASH, password))) {
      return fail('Invalid credentials', 401);
    }
    const token = await encodeJwt({ sub: ADMIN_USERNAME, role: 'admin' });
    const resp = ok({}, 'Logged in');
    await setCookie(resp, 'admin_token', token);
    return resp;
  }
  
  if (path === '/api/admin/logout' && method === 'POST') {
    const resp = ok({}, 'Logged out');
    await clearCookie(resp, 'admin_token');
    return resp;
  }
  
  const admin = await requireAdmin(request, db);
  if (!admin) return fail('Admin required', 403);
  
  // Dashboard
  if (path === '/api/admin/dashboard' && method === 'GET') {
    const totalUsers = (await db.prepare(`SELECT COUNT(*) as cnt FROM users`).get()).cnt;
    const activeUsers = (await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE status = 'active'`).get()).cnt;
    const bannedUsers = (await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE status IN ('suspended', 'blacklisted', 'closed')`).get()).cnt;
    const totalCards = (await db.prepare(`SELECT COUNT(*) as cnt FROM cards`).get()).cnt;
    const frozenCards = (await db.prepare(`SELECT COUNT(*) as cnt FROM cards WHERE status = 'frozen'`).get()).cnt;
    const today = new Date().toISOString().slice(0, 10);
    const txToday = await db.prepare(`SELECT SUM(amount) as sum FROM transactions WHERE created_at LIKE ?`).all(`${today}%`);
    return ok({
      total_users: totalUsers, active_users: activeUsers, banned_users: bannedUsers,
      total_cards: totalCards, frozen_cards: frozenCards,
      tx_today: round(txToday.sum || 0)
    });
  }
  
  // Users
  if (path === '/api/admin/users' && method === 'GET') {
    const users = await db.prepare(`SELECT id, email, name, status, created_at, credit_blacklist FROM users ORDER BY created_at DESC`).all();
    return ok({ users: users.results?.map(u => ({ ...u, credit_blacklist: toBool(u.credit_blacklist) })) || [] });
  }
  
  if (path.match(/^\/api\/admin\/users\/[^\/]+\/ban$/) && method === 'POST') {
    const uid = path.split('/')[4];
    await db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(uid);
    return ok({}, 'Banned');
  }
  
  if (path.match(/^\/api\/admin\/users\/[^\/]+\/unban$/) && method === 'POST') {
    const uid = path.split('/')[4];
    await db.prepare(`UPDATE users SET status = 'active' WHERE id = ?`).run(uid);
    return ok({}, 'Unbanned');
  }
  
  if (path.match(/^\/api\/admin\/users\/[^\/]+\/blacklist$/) && method === 'POST') {
    const uid = path.split('/')[4];
    await db.prepare(`UPDATE users SET credit_blacklist = 1 WHERE id = ?`).run(uid);
    return ok({}, 'Blacklisted');
  }
  
  if (path.match(/^\/api\/admin\/users\/[^\/]+\/unblacklist$/) && method === 'POST') {
    const uid = path.split('/')[4];
    await db.prepare(`UPDATE users SET credit_blacklist = 0 WHERE id = ?`).run(uid);
    return ok({}, 'Unblacklisted');
  }
  
  if (path.match(/^\/api\/admin\/users\/[^\/]+$/) && method === 'DELETE') {
    const uid = path.split('/')[4];
    const confirm = (await getBody(request)).confirm;
    if (!confirm) return fail('Confirmation required', 400);
    await db.prepare(`DELETE FROM users WHERE id = ?`).run(uid);
    return ok({}, 'User deleted');
  }
  
  // Cards
  if (path === '/api/admin/cards' && method === 'GET') {
    const cards = await db.prepare(`SELECT * FROM cards ORDER BY issued_at DESC LIMIT 100`).all();
    return ok({ cards: (cards.results || []).map(c => ({
      id: c.id, number_masked: maskCard(c.number), type: c.type, network: c.network,
      level: c.level, status: c.status, balance: round(c.balance), credit_limit: round(c.credit_limit),
      credit_used: round(c.credit_used), issued_at: c.issued_at
    })) });
  }
  
  if (path.match(/^\/api\/admin\/cards\/\d+\/freeze$/) && method === 'POST') {
    const cardId = parseInt(path.split('/')[4]);
    await db.prepare(`UPDATE cards SET status = 'frozen' WHERE id = ?`).run(cardId);
    return ok({}, 'Frozen');
  }
  
  if (path.match(/^\/api\/admin\/cards\/\d+\/unfreeze$/) && method === 'POST') {
    const cardId = parseInt(path.split('/')[4]);
    await db.prepare(`UPDATE cards SET status = 'active' WHERE id = ?`).run(cardId);
    return ok({}, 'Unfrozen');
  }
  
  if (path.match(/^\/api\/admin\/cards\/\d+\/cancel$/) && method === 'POST') {
    const cardId = parseInt(path.split('/')[4]);
    await db.prepare(`UPDATE cards SET status = 'canceled' WHERE id = ?`).run(cardId);
    return ok({}, 'Canceled');
  }
  
  if (path.match(/^\/api\/admin\/cards\/\d+\/restore$/) && method === 'POST') {
    const cardId = parseInt(path.split('/')[4]);
    await db.prepare(`UPDATE cards SET status = 'active' WHERE id = ? AND status = 'canceled'`).run(cardId);
    return ok({}, 'Restored');
  }
  
  // Config
  if (path === '/api/admin/config' && method === 'GET') {
    return ok({ config: await getAllConfigs(db) });
  }
  
  if (path === '/api/admin/config' && method === 'PUT') {
    const d = await getBody(request);
    for (const [key, value] of Object.entries(d)) {
      await setConfig(db, key, value, admin);
    }
    return ok({}, 'Config updated');
  }
  
  return fail('Not found', 404);
}

// ==================== UTILITY FUNCTIONS ====================
function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function maskCard(number) {
  if (!number || number.length < 4) return '****';
  return '**** **** **** ' + number.slice(-4);
}

async function getOwnCard(db, userId, cardId) {
  return await db.prepare(`
    SELECT c.*, a.user_id FROM cards c
    JOIN accounts a ON c.account_id = a.id
    WHERE c.id = ? AND a.user_id = ?
  `).get(cardId, userId);
}

function generateCardNumber(length = 16, network = 'NovaPay') {
  const binRanges = {
    'Visa': ['4'],
    'MasterCard': ['51', '52', '53', '54', '55', '2221', '2222', '2223', '2224', '2225', '2226', '2227', '2228', '2229', '223', '224', '225', '226', '227', '228', '229', '23', '24', '25', '26', '270', '271', '272', '2720'],
    'AmericanExpress': ['34', '37'],
    'NovaPay': ['4', '5', '6', '9']
  };
  const prefixList = binRanges[network] || binRanges['NovaPay'];
  const prefix = prefixList[Math.floor(Math.random() * prefixList.length)];
  const prefixLen = prefix.length;
  const bodyLen = length - prefixLen - 1;
  let body = '';
  for (let i = 0; i < bodyLen; i++) body += Math.floor(Math.random() * 10);
  let partial = prefix + body;
  let total = 0;
  const flipParity = (partial.length % 2 === 1);
  for (let i = 0; i < partial.length; i++) {
    const d = parseInt(partial[i]);
    let pos = partial.length - 1 - i;
    if (flipParity) pos = 15 - pos;
    if (pos % 2 === 1) {
      const doubled = d * 2;
      total += doubled > 9 ? doubled - 9 : doubled;
    } else {
      total += d;
    }
  }
  const check = (10 - (total % 10)) % 10;
  return partial + check;
}

function buildCardResp(c) {
  return {
    id: c.id, number_masked: maskCard(c.number), type: c.type, network: c.network,
    level: c.level, expiry: c.expiry, status: c.status, theme: c.theme,
    balance: round(c.balance), credit_limit: round(c.credit_limit),
    credit_used: round(c.credit_used), daily_limit: c.daily_limit,
    single_transaction_limit: c.single_transaction_limit, issued_at: c.issued_at
  };
}

async function serveFrontend(request, url, env) {
  // For SPA routing, return index.html
  if (url.pathname === '/' || url.pathname === '/admin' ||
      url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') ||
      url.pathname === '/favicon.ico') {
    // Return a simple placeholder - frontend should be served from Pages
    return new Response('Please use https://novapay-bank-simulator.pages.dev for the frontend', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  return new Response('Not found', { status: 404 });
}
