// Admin login: one username and password, set on the server as ADMIN_USER and ADMIN_PASSWORD.
// Logging in sets a signed cookie for 12 hours, so nothing secret ever sits in a link.
// Changing ADMIN_PASSWORD logs everyone out. The same file is used by Ask the Panel and the lucky draw.

const crypto = require('node:crypto');

const USER = (process.env.ADMIN_USER || '').trim().toLowerCase();
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const ready = USER !== '' && PASSWORD !== '';
const COOKIE = 'wsti_admin';
const LIFETIME_S = 12 * 60 * 60;
const SECRET = crypto.createHash('sha256').update(`wsti-admin\n${USER}\n${PASSWORD}`).digest();
// Wrong guesses: 20 per 10 minutes from one address (a venue often shares one Wi-Fi address).
const TRIES = { max: 20, windowMs: 10 * 60_000 };

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');

function json(res, status, body, cookie) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}
function address(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
function cookie(req, value, maxAge) {
  const https = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
}

function isAdmin(req) {
  if (!ready) return false;
  const pair = String(req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  const [expires, mac] = (pair ? pair.slice(COOKIE.length + 1) : '').split('.');
  if (!expires || !mac || !(Number(expires) > Date.now())) return false;
  const want = sign(expires);
  return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want));
}

const misses = new Map();
function locked(addr) {
  const now = Date.now();
  const recent = (misses.get(addr) || []).filter((t) => now - t < TRIES.windowMs);
  misses.set(addr, recent);
  return recent.length >= TRIES.max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of misses) if (!list.some((t) => now - t < TRIES.windowMs)) misses.delete(k);
}, 5 * 60_000).unref();

async function login(req, res) {
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
  if (!ready) return json(res, 503, { error: 'The admin login is not set up yet. Add ADMIN_USER and ADMIN_PASSWORD on Railway.' });
  const addr = address(req);
  if (locked(addr)) return json(res, 429, { error: 'Too many wrong tries. Please wait 10 minutes.' });
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2000) return json(res, 413, { error: 'Too large' }); }
  let body = {};
  try { body = JSON.parse(raw || '{}'); } catch (e) {}
  // Check both, always, so a wrong username takes as long as a wrong password.
  const ok = same(String(body.user || '').trim().toLowerCase(), USER) & same(String(body.password || ''), PASSWORD);
  if (!ok) {
    misses.get(addr).push(Date.now());
    return json(res, 401, { error: 'Wrong username or password.' });
  }
  const expires = String(Date.now() + LIFETIME_S * 1000);
  return json(res, 200, { ok: true }, cookie(req, `${expires}.${sign(expires)}`, LIFETIME_S));
}
function logout(req, res) {
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
  return json(res, 200, { ok: true }, cookie(req, '', 0));
}
function session(req, res) {
  return json(res, 200, { admin: isAdmin(req), ready });
}

module.exports = { ready, isAdmin, routes: { '/api/login': login, '/api/logout': logout, '/api/session': session } };
