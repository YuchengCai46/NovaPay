// NovaPay V6.0 — Crypto utilities for Cloudflare Worker

let _jwtSecret = null;
let _aesKeyBytes = null;

export function setEnvSecrets(secretKey, aesKey) {
  _jwtSecret = secretKey || 'novapay-jwt-secret-change-in-production!';
  if (aesKey && aesKey.length >= 32) {
    _aesKeyBytes = new TextEncoder().encode(aesKey.slice(0, 32));
  }
}

async function getJwtSecret() {
  // Try to get from global env if available
  if (typeof globalThis !== 'undefined' && globalThis.env && globalThis.env.JWT_SECRET_KEY) {
    return globalThis.env.JWT_SECRET_KEY;
  }
  if (_jwtSecret) return _jwtSecret;
  return 'd7bbd897f4b41ac9da4f670492a8d6f8';
}

async function getAesKey() {
  const raw = _aesKeyBytes || 'c4902d50f71fe95acf32301ade5c3630';
  let keyBytes;
  if (raw.length >= 32) {
    keyBytes = new TextEncoder().encode(raw.slice(0, 32));
  } else if (raw.length > 0) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    keyBytes = new Uint8Array(hash);
  } else {
    keyBytes = new TextEncoder().encode('c4902d50f71fe95acf32301ade5c3630');
  }
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function aesEncrypt(plaintext) {
  if (!plaintext) return '';
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const ctBytes = new Uint8Array(ciphertext);
  const combined = new Uint8Array(12 + ctBytes.length);
  combined.set(iv);
  combined.set(ctBytes, 12);
  return btoa(String.fromCharCode(...combined));
}

export async function aesDecrypt(tokenB64) {
  if (!tokenB64) return '';
  const raw = atob(tokenB64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const key = await getAesKey();
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(decrypted);
}

export async function hashSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 60000, hash: 'SHA-256' }, key, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2_sha256$60000$${saltHex}$${hashHex}`;
}

export async function verifySecret(hashStr, secret) {
  if (!hashStr || !secret) return false;
  try {
    const parts = hashStr.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
    const [, , saltHex, expectedHashHex] = parts;
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 60000, hash: 'SHA-256' }, key, 256
    );
    const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex === expectedHashHex;
  } catch (e) {
    return false;
  }
}

export async function sha256Hex(content) {
  const msgUint8 = new TextEncoder().encode(content || '');
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function encodeJwt(payload) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=$/g, '');
  const now = Math.floor(Date.now() / 1000);
  const claim = btoa(JSON.stringify({ ...payload, iat: now, exp: now + 3600 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=$/g, '');
  const sigInput = `${header}.${claim}`;
  const secretKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(await getJwtSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', secretKey, new TextEncoder().encode(sigInput));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=$/g, '');
  return `${sigInput}.${sig}`;
}

export async function decodeJwt(token) {
  try {
    const [header, claim, sig] = token.split('.');
    if (!header || !claim || !sig) return null;
    // Convert base64url to base64 for atob (add padding)
    const b64url = s => {
      s = s.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      return s;
    };
    const payload = JSON.parse(atob(b64url(claim)));
    const sigInput = `${header}.${claim}`;
    const sigBytes = Uint8Array.from(atob(b64url(sig)), c => c.charCodeAt(0));
    const secretKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(await getJwtSecret()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const verified = await crypto.subtle.verify('HMAC', secretKey, sigBytes, new TextEncoder().encode(sigInput));
    if (!verified) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

export function nowMs() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').slice(0, 23);
}

export function genUuid() {
  return crypto.randomUUID();
}

export function genTxId() {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return 'TX' + ts + rand;
}

export function genGiftCode() {
  const chars = '0123456789';
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')).join('-');
}

export function genUserId() {
  return 'NP' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
}
