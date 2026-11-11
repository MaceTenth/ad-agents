// The ad agents' web service: one page and a small JSON API. The API needs the password.
//
//   GET  /health                          no password; the platform's health check
//   GET  /  and  /app.js                  the web page, no password (it holds nothing secret and asks for the password)
//   GET  /api/info                        brand name, image provider, today's usage
//   GET  /api/ads                         recent ads
//   POST /api/ads            {request}    start an ad: 202 and the job, status "working"
//   GET  /api/ads/:id                     one ad; poll until status is no longer "working"
//   POST /api/ads/:id/reply  {text, redraw}  a revision, in the same agent session
//   GET  /api/ads/:id/image[?n=2]         the picture (the latest one without n)
//
// Password: every /api call carries HTTP Basic auth with any user name and APP_PASSWORD as the password.
// The page asks for it once and sends it itself; with curl use -u any:$APP_PASSWORD. No WWW-Authenticate
// header is sent, so browsers never pop up their own login box.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { config, checkConfig, ROOT } from './env.mjs';
import { info, warn } from './log.mjs';
import { createJob, replyToJob, loadJob, listJobs, publicJob, imagePath, validId, usageToday, brandName, UserError } from './ads.mjs';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};

const digest = (s) => createHash('sha256').update(String(s)).digest();
const passwordDigest = digest(config.appPassword);

/** HTTP Basic auth: any user name, the password must equal APP_PASSWORD. */
export function authorized(header) {
  if (!config.appPassword) return false;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(String(header ?? ''));
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  return timingSafeEqual(digest(password), passwordDigest);
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'cache-control': 'no-store', ...(isJson ? { 'content-type': 'application/json; charset=utf-8' } : {}), ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readJson(req, limit = 20_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > limit) { reject(new UserError(413, 'Request body too large.')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new UserError(400, 'The body must be JSON.')); } });
    req.on('error', reject);
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/health') return send(res, 200, 'ok', { 'content-type': 'text/plain' });

  if (req.method === 'GET' && STATIC[path]) {
    const [file, type] = STATIC[path];
    return send(res, 200, readFileSync(join(ROOT, 'public', file)), { 'content-type': type });
  }

  if (!authorized(req.headers.authorization)) return send(res, 401, { error: 'Wrong or missing password.' });

  if (path === '/api/info' && req.method === 'GET') {
    return send(res, 200, { brand: brandName(), imageProvider: config.imageProvider, imageModel: config.imageModel, usage: usageToday() });
  }

  if (path === '/api/ads') {
    if (req.method === 'GET') return send(res, 200, { ads: listJobs() });
    if (req.method === 'POST') {
      const body = await readJson(req);
      return send(res, 202, createJob(body.request));
    }
    return send(res, 405, { error: 'Use GET or POST.' });
  }

  const m = /^\/api\/ads\/([^/]+)(\/reply|\/image)?$/.exec(path);
  if (m) {
    const [, id, action] = m;
    if (!validId(id)) return send(res, 404, { error: 'No ad with that id.' });
    if (!action && req.method === 'GET') {
      const job = loadJob(id);
      return job ? send(res, 200, publicJob(job)) : send(res, 404, { error: 'No ad with that id.' });
    }
    if (action === '/reply' && req.method === 'POST') {
      const body = await readJson(req);
      return send(res, 202, replyToJob(id, body.text, { redraw: body.redraw === true }));
    }
    if (action === '/image' && req.method === 'GET') {
      const n = url.searchParams.has('n') ? Number(url.searchParams.get('n')) : 0;
      const file = Number.isInteger(n) && n >= 0 ? imagePath(loadJob(id), n) : null;
      if (!file) return send(res, 404, { error: 'No picture.' });
      return send(res, 200, readFileSync(file), { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', 'content-disposition': `inline; filename="${id}${n ? `_${n}` : ''}.jpg"` });
    }
  }
  return send(res, 404, { error: 'Not found.' });
}

export function createApp() {
  return createServer((req, res) => {
    route(req, res).catch((e) => {
      if (e instanceof UserError) return send(res, e.status, { error: e.message });
      warn(`${req.method} ${req.url} failed:`, e?.message ?? e);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong on the server. See the server log.' });
    });
  });
}

const isMain = (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) {
  const { fatal, warnings } = checkConfig();
  for (const w of warnings) warn(`[config] ${w}`);
  if (fatal.length) { for (const f of fatal) console.error(`[config] ${f}`); process.exit(1); }
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
  createApp().listen(config.port, () => {
    info(`ad agents listening on http://localhost:${config.port}  (data: ${config.dataDir}, images: ${config.imageProvider})`);
  });
}
