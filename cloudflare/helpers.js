// NovaPay V6.0 — Helper utilities

export function ok(data, message, status = 200) {
  return new Response(JSON.stringify({ success: true, data, message: message || '' }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function fail(message, status = 400) {
  return new Response(JSON.stringify({ success: false, data: null, message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function getCookies(request) {
  const cookies = {};
  const header = request.headers.get('Cookie') || '';
  header.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  });
  return cookies;
}

export async function getBody(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('json')) return {};
  try {
    return await request.json();
  } catch { return {}; }
}

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

export function handleCors(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  return null;
}

export async function getUserToken(request) {
  const cookies = await getCookies(request);
  const token = cookies.access_token;
  if (!token) return null;
  const { decodeJwt } = await import('./crypto.js');
  return await decodeJwt(token);
}

export async function getAdminToken(request) {
  const cookies = await getCookies(request);
  const token = cookies.admin_token;
  if (!token) return null;
  const { decodeJwt } = await import('./crypto.js');
  const payload = await decodeJwt(token);
  return payload && payload.role === 'admin' ? payload.sub : null;
}

export function toBool(val) {
  return val === 1 || val === true || val === 'true';
}

export function isoDate(dateStr) {
  if (!dateStr) return null;
  try { return new Date(dateStr).toISOString(); } catch { return dateStr; }
}

export async function auditLog(db, userId, action, target, details = {}, status = 'success') {
  await db.prepare(`INSERT INTO audit_logs (user_id, action, target, details, ip_address, user_agent, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(userId, action, target, JSON.stringify(details), '', '', status).run();
}

export async function setCookie(response, name, value, options = {}) {
  const cookieOptions = [
    name + '=' + value,
    'Path=/',
    'SameSite=Lax',
    'Max-Age=' + (options.maxAge || 86400),
  ];
  if (options.httpOnly) cookieOptions.push('HttpOnly');
  response.headers.set('Set-Cookie', cookieOptions.join('; '));
  return response;
}

export async function clearCookie(response, name) {
  response.headers.set('Set-Cookie', name + '=; Path=/; Max-Age=0; SameSite=Lax');
  return response;
}

export async function requireUser(request, db) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
      || (await getCookies(request))?.access_token;
    if (!token) return null;
    const { decodeJwt } = await import('./crypto.js');
    const payload = await decodeJwt(token);
    if (!payload || !payload.sub) return null;
    const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(payload.sub).first();
    return user || null;
  } catch (error) {
    return null;
  }
}

export async function requireAdmin(request, db) {
  try {
    const cookies = await getCookies(request);
    const token = cookies.admin_token;
    if (!token) return null;
    const { decodeJwt } = await import('./crypto.js');
    const payload = await decodeJwt(token);
    if (!payload || payload.role !== 'admin') return null;
    return payload.sub;
  } catch (error) {
    return null;
  }
}
