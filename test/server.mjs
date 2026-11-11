// Offline end-to-end test of the web service: the real server, a fake agent driver (no Anthropic
// calls) and a mock image provider (no OpenAI calls). Run: npm run test:server  (no network, no cost)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORK = mkdtempSync(join(tmpdir(), 'ad-agents-'));
const FAKE_LOG = join(WORK, 'fake.jsonl');
const PORT = 3102;
const PASSWORD = 'test-password-123';
const BASE = `http://localhost:${PORT}`;
const env = {
  ...process.env, PORT: String(PORT), APP_PASSWORD: PASSWORD, AD_AGENT_DRIVER: 'fake', IMAGE_PROVIDER: 'mock',
  FAKE_AGENT_LOG: FAKE_LOG, FAKE_AGENT_DELAY_MS: '300', MAX_RUNS_PER_DAY: '7', MAX_PARALLEL_RUNS: '2', DATA_DIR: '',
};

const procs = [];
function start(extraEnv = {}) {
  const p = spawn('node', [join(ROOT, 'src/server.mjs')], { cwd: WORK, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.log = () => out;
  p.done = new Promise((r) => p.on('exit', (code) => r(code)));
  return p;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = (pw = PASSWORD) => ({ authorization: 'Basic ' + Buffer.from(`student:${pw}`).toString('base64') });
const get = (path, headers = auth()) => fetch(BASE + path, { headers });
const post = (path, body, headers = auth()) => fetch(BASE + path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function until(id, pred = (j) => j.status !== 'working') {
  for (let i = 0; i < 60; i++) { const j = await (await get(`/api/ads/${id}`)).json(); if (pred(j)) return j; await sleep(150); }
  throw new Error(`job ${id} did not finish`);
}
const fake = () => (existsSync(FAKE_LOG) ? readFileSync(FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const results = [];
const check = (name, ok, detail = '') => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

try {
  // Without a password the server refuses to start.
  const nopw = start({ APP_PASSWORD: '', PORT: String(PORT + 1) });
  check('refuses to start without APP_PASSWORD', (await nopw.done) === 1 && /APP_PASSWORD is not set/.test(nopw.log()));

  const server = start();
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/health`); break; } catch { await sleep(150); } }

  // Health and password
  check('GET /health needs no password', (await fetch(`${BASE}/health`)).status === 200);
  const page = await fetch(`${BASE}/`);
  check('GET / serves the page (with its login form) without a password', page.status === 200 && /id="login-form"/.test(await page.text()));
  check('the page is served with a Content Security Policy', /default-src 'self'/.test(page.headers.get('content-security-policy') ?? ''));
  check('GET /app.js serves the script', (await fetch(`${BASE}/app.js`)).headers.get('content-type')?.startsWith('text/javascript'));
  const anon = await fetch(`${BASE}/api/ads`);
  check('the API without a password is 401, with no browser login box', anon.status === 401 && !anon.headers.get('www-authenticate'));
  check('a wrong password is 401', (await get('/api/info', auth('nope'))).status === 401);
  check('a password with non-Latin characters is handled', (await get('/api/info', { authorization: 'Basic ' + Buffer.from('x:סיסמה').toString('base64') })).status === 401);
  const infoRes = await (await get('/api/info')).json();
  check('GET /api/info names the brand from the brand sheet', infoRes.brand === "Dana's Bakery" && infoRes.imageProvider === 'mock', JSON.stringify(infoRes));

  // Validation
  check('an empty request is 400', (await post('/api/ads', { request: '  ' })).status === 400);
  check('a non-JSON body is 400', (await fetch(`${BASE}/api/ads`, { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: 'nope' })).status === 400);
  check('an unknown id is 404', (await get('/api/ads/ad_zzzzzzzz_000000')).status === 404);
  check('a path-traversal id is 404', (await get('/api/ads/..%2F..%2Fetc%2Fpasswd/image')).status === 404);

  // A new ad: 202, then a draft with a picture (run 1)
  const created = await post('/api/ads', { request: 'מודעה ליום שישי: חלות, 2 ב-30, פלורנטין' });
  const a = await created.json();
  check('POST /api/ads answers 202 with status working', created.status === 202 && a.status === 'working' && /^ad_/.test(a.id));
  check('a second change while it runs is 409', (await post(`/api/ads/${a.id}/reply`, { text: 'קצר יותר' })).status === 409);
  const draft = await until(a.id);
  check('the job ends as a draft with copy and one picture', draft.status === 'draft' && draft.brief?.copy?.headline && draft.image?.count === 1, draft.status);
  check('the caption joins headline, text, call to action and hashtags', draft.caption.startsWith(draft.brief.copy.headline) && draft.caption.includes('#המאפייהשלדנה'));
  const kick = fake().find((e) => e.op === 'turn');
  check('the kickoff carries brand sheet, facts with today\'s date, and the request', /<brand_sheet>/.test(kick?.text) && /<facts>\nToday: /.test(kick?.text) && /<request>\nמודעה ליום שישי/.test(kick?.text));
  const img = await get(draft.image.url);
  const bytes = Buffer.from(await img.arrayBuffer());
  check('the picture is served as a JPEG', img.status === 200 && img.headers.get('content-type') === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8);
  check('the picture needs the password too', (await fetch(BASE + draft.image.url)).status === 401);

  // A copy-only revision keeps the picture (run 2)
  check('a revision answers 202', (await post(`/api/ads/${a.id}/reply`, { text: 'קצר יותר' })).status === 202);
  const shorter = await until(a.id);
  check('a copy-only revision keeps the same picture', shorter.status === 'draft' && shorter.image.count === 1 && shorter.brief.copy.headline === 'חלות ליום שישי');
  check('the revision went into the same session as a <reply>', fake().filter((e) => e.op === 'turn' && e.sessionId === kick.sessionId).at(-1)?.text.startsWith('<reply>\nקצר יותר'));

  // "New picture" draws again (run 3)
  await post(`/api/ads/${a.id}/reply`, { text: '', redraw: true });
  const redrawn = await until(a.id);
  check('"new picture" draws a second picture', redrawn.image.count === 2 && /n=2$/.test(redrawn.image.url));
  check('picture 1 is still available', (await get(`/api/ads/${a.id}/image?n=1`)).status === 200);

  // The agent asks a question instead of submitting (run 4)
  const q = await (await post('/api/ads', { request: '[NOBRIEF] משהו' })).json();
  const asked = await until(q.id);
  check('a question from the agent shows as needs_input', asked.status === 'needs_input' && asked.agentText.length > 0 && !asked.brief);

  // A rejected brief is fixed in the same run (run 5)
  const r = await (await post('/api/ads', { request: '[BADPRICE] מודעה ליום שישי: חלות, 2 ב-30, פלורנטין' })).json();
  const fixed = await until(r.id);
  check('a brief rejected by the checks is fixed and counted', fixed.status === 'draft' && fixed.rejections === 1);
  check('the rejection named the unlisted price', fake().some((e) => e.op === 'rejected' && e.problems.some((p) => /₪25/.test(p))));

  // List
  const list = await (await get('/api/ads')).json();
  check('GET /api/ads lists the ads, newest first', list.ads.length === 3 && list.ads[0].id === r.id);

  // Limits: two parallel runs at most, seven runs a day
  const p1 = await (await post('/api/ads', { request: 'מודעה לבבקה' })).json();               // run 6
  const p2 = await (await post('/api/ads', { request: 'מודעה לקרואסון' })).json();             // run 7
  const third = await post('/api/ads', { request: 'מודעה לרוגלך' });
  check('a third parallel run is refused with 429', third.status === 429, String(third.status));
  await until(p1.id); await until(p2.id);
  const overDaily = await post('/api/ads', { request: 'מודעה לקפה' });
  check('the daily run limit is enforced with 429', overDaily.status === 429 && /MAX_RUNS_PER_DAY/.test((await overDaily.json()).error));

  // Restart
  server.kill('SIGTERM');
  check('clean shutdown on SIGTERM', (await server.done) === 0);
  const again = start();
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/health`); break; } catch { await sleep(150); } }
  const files = JSON.parse(readFileSync(join(WORK, 'data/ads', `${a.id}.json`), 'utf8'));
  check('jobs survive a restart on disk', files.status === 'draft' && files.images.length === 2);
  again.kill('SIGTERM');
  await again.done;
} catch (e) {
  console.error('test runner error:', e);
  results.push(false);
} finally {
  for (const p of procs) if (p.exitCode === null) p.kill();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed  (work dir: ${WORK})`);
process.exit(failed ? 1 : 0);
