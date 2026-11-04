// Serves the page and keeps the panel questions on the server. No dependencies.
//
// Questions live in QUESTIONS_FILE (a Railway volume at /data in production).
// Anyone can send a question and see the one on screen. Seeing the whole list,
// or choosing what goes on screen, needs HOST_KEY, which the host link carries as ?key=.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const KEY = process.env.HOST_KEY || '';
const FILE = process.env.QUESTIONS_FILE || path.join(ROOT, 'data', 'questions.json');
const MAX_TEXT = 280;
const MAX_NAME = 30;
const MAX_QUESTIONS = 2000;
// One phone may send five questions a minute. A whole venue often shares one
// Wi-Fi address, so the per-address cap is only there to stop a flood.
const LIMITS = { device: 5, address: 120, windowMs: 60_000 };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
const PUBLIC = new Set(['index.html', 'festi-logo.svg']);

let state = load();

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { open: s.open !== false, current: s.current || null, questions: Array.isArray(s.questions) ? s.questions : [] };
  } catch (e) { return { open: true, current: null, questions: [] }; }
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, FILE);
}

const tidy = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const hits = new Map();
function limited(key, max) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < LIMITS.windowMs);
  const over = recent.length >= max;
  if (!over) recent.push(now);
  hits.set(key, recent);
  return over;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) if (!list.some((t) => now - t < LIMITS.windowMs)) hits.delete(k);
}, 5 * 60_000).unref();

// What everyone may see: the question on screen, if any.
function publicView() {
  const q = state.questions.find((x) => x.id === state.current);
  return { open: state.open, count: state.questions.length, current: q ? { id: q.id, text: q.text, name: q.name } : null };
}
// What the host sees: every question, without the device id.
function hostView() {
  return {
    open: state.open,
    current: state.current,
    questions: state.questions.map(({ id, text, name, at, status, askedAt }) => ({ id, text, name, at, status, askedAt })),
  };
}

function keyOk(req) {
  const given = Buffer.from(String(req.headers['x-host-key'] || ''));
  const want = Buffer.from(KEY);
  return KEY !== '' && given.length === want.length && crypto.timingSafeEqual(given, want);
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4000) throw Object.assign(new Error('Too large'), { status: 413 });
  }
  try { return JSON.parse(raw || '{}'); } catch (e) { throw Object.assign(new Error('Expected JSON'), { status: 400 }); }
}
function address(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

async function ask(req, res) {
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
  if (!state.open) return json(res, 423, { error: 'Questions are closed for now.' });
  const body = await readBody(req);
  const text = tidy(body.text, MAX_TEXT);
  const name = tidy(body.name, MAX_NAME);
  if (text.length < 3) return json(res, 400, { error: 'Please write your question first.' });
  if (state.questions.length >= MAX_QUESTIONS) return json(res, 503, { error: 'The question box is full.' });
  const device = tidy(req.headers['x-device'], 40) || 'unknown';
  if (limited('a:' + address(req), LIMITS.address) || limited('d:' + device, LIMITS.device)) {
    return json(res, 429, { error: 'That is a lot of questions at once. Please try again in a minute.' });
  }
  // A double tap sends the same question twice: keep one.
  if (state.questions.some((q) => q.device === device && q.text.toLowerCase() === text.toLowerCase())) return json(res, 200, { ok: true });
  state.questions.push({ id: crypto.randomBytes(4).toString('hex'), text, name, at: new Date().toISOString(), status: 'waiting', device });
  save();
  return json(res, 201, { ok: true });
}

async function host(req, res) {
  if (!keyOk(req)) return json(res, 403, { error: 'Wrong or missing key' });
  if (req.method === 'GET') return json(res, 200, hostView());
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, POST' }); return res.end(); }
  const { action, id, open } = await readBody(req);
  const q = state.questions.find((x) => x.id === id);
  if (['show', 'skip', 'restore'].includes(action) && !q) return json(res, 404, { error: 'No such question' });
  if (action === 'show') { state.current = q.id; q.status = 'asked'; q.askedAt = new Date().toISOString(); }
  else if (action === 'hide') state.current = null;
  else if (action === 'skip' || action === 'restore') {
    q.status = action === 'skip' ? 'skipped' : 'waiting';
    if (state.current === q.id) state.current = null;
  }
  else if (action === 'open') state.open = Boolean(open);
  else if (action === 'reset') { state.questions = []; state.current = null; }
  else return json(res, 400, { error: 'Unknown action' });
  save();
  return json(res, 200, hostView());
}

const ROUTES = { '/api/current': (req, res) => json(res, 200, publicView()), '/api/questions': ask, '/api/host': host };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = ROUTES[url.pathname];
  if (route) {
    return void Promise.resolve(route(req, res)).catch((e) => json(res, e.status || 500, { error: e.status ? e.message : 'Server error' }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!PUBLIC.has(name)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  fs.readFile(path.join(ROOT, name), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}).listen(PORT, () => console.log(`Panel questions on port ${PORT}; questions file ${FILE}; key ${KEY ? 'set' : 'NOT set'}`));
