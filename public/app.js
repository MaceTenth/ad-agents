// The page: log in, start an ad, poll it until the agent is done, show the draft, send revisions.
// Everything the agent or the web wrote is set with textContent, never as HTML.
// The password is kept for this browser tab only (sessionStorage) and sent with every API call.
const $ = (id) => document.getElementById(id);
const LABEL = { working: 'working', draft: 'draft', needs_input: 'question', failed: 'failed' };
const KEY = 'ad-agents-password';
let password = '';
let current = null;
let pollTimer = null;
let shownImage = { url: null, blob: null };

const store = {
  get() { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } },
  set(v) { try { sessionStorage.setItem(KEY, v); } catch { /* private mode: kept in memory only */ } },
  clear() { try { sessionStorage.removeItem(KEY); } catch { /* nothing stored */ } },
};
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const authHeader = () => ({ authorization: `Basic ${b64(`page:${password}`)}` });
// location.origin never carries a user:password, so this also works when the page was opened as https://user:pass@host/
const at = (path) => new URL(path, location.origin);

class LoggedOut extends Error {}

async function api(path, options = {}) {
  const res = await fetch(at(path), { ...options, headers: { 'content-type': 'application/json', ...authHeader() } });
  if (res.status === 401) { logout('Wrong password, or it was changed. Log in again.'); throw new LoggedOut('Not logged in.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
const show = (el, on) => { el.hidden = !on; };
const setError = (el, msg) => { el.textContent = msg || ''; show(el, Boolean(msg)); };

// ---------- login ----------
function showApp(on) {
  show($('app'), on);
  show($('logout'), on);
  show($('login'), !on);
  if (!on) $('password').focus();
}

function logout(message = '') {
  clearTimeout(pollTimer);
  password = '';
  store.clear();
  setError($('login-error'), message);
  showApp(false);
}

async function start() {
  await loadInfo();
  showApp(true);
  loadHistory().catch(() => {});
  if (location.hash.length > 1) open(location.hash.slice(1));
}

$('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  password = $('password').value;
  setError($('login-error'), '');
  try {
    await start();
    store.set(password);
    $('password').value = '';
  } catch (e) {
    if (!(e instanceof LoggedOut)) setError($('login-error'), e.message);
  }
});
$('logout').addEventListener('click', () => logout());

// ---------- data ----------
async function loadInfo() {
  const i = await api('/api/info');
  $('info').textContent = `${i.brand ? `Brand: ${i.brand} · ` : ''}pictures: ${i.imageProvider} (${i.imageModel})`;
  $('usage').textContent = `${i.usage.runs} of ${i.usage.limit} agent runs used in the last 24 hours`;
}

async function loadHistory() {
  const { ads } = await api('/api/ads');
  const list = $('history');
  list.replaceChildren();
  if (!ads.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No ads yet.';
    list.append(li);
    return;
  }
  for (const ad of ads) {
    const button = document.createElement('button');
    const title = document.createElement('span');
    title.dir = 'auto';
    title.textContent = ad.headline || ad.request;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = LABEL[ad.status] ?? ad.status;
    const when = document.createElement('span');
    when.className = 'muted';
    when.textContent = ` · ${new Date(ad.createdAt).toLocaleString()}`;
    button.append(title, badge, when);
    button.addEventListener('click', () => open(ad.id));
    const li = document.createElement('li');
    li.append(button);
    list.append(li);
  }
}

/** Pictures need the password too, so they are fetched with it and shown from a local blob URL. */
async function showImage(job) {
  if (!job.image || shownImage.url === job.image.url) return;
  const res = await fetch(at(job.image.url), { headers: authHeader() });
  if (!res.ok) return;
  const blob = URL.createObjectURL(await res.blob());
  if (shownImage.blob) URL.revokeObjectURL(shownImage.blob);
  shownImage = { url: job.image.url, blob };
  $('picture').src = blob;
  $('download').href = blob;
  $('download').download = `${job.id}_${job.image.count}.jpg`;
}

// ---------- rendering ----------
function renderStatus(job) {
  const st = $('status');
  st.replaceChildren();
  if (job.status === 'working') {
    const spin = document.createElement('span');
    spin.className = 'spinner';
    st.append(spin, document.createTextNode(job.brief ? 'Revising… usually under a minute.' : 'The agent is researching and writing… about a minute.'));
  } else if (job.status === 'draft') {
    st.textContent = job.rejections ? `Draft ready (the checks sent ${job.rejections} brief${job.rejections > 1 ? 's' : ''} back first)` : 'Draft ready';
  } else if (job.status === 'needs_input') {
    st.textContent = 'The agent needs an answer';
  } else {
    st.textContent = 'Failed';
  }
}

function renderDraft(job) {
  const b = job.brief;
  show($('draft'), Boolean(b));
  if (!b) return;
  showImage(job).catch(() => {});
  $('headline').textContent = b.copy?.headline ?? '';
  $('caption').textContent = b.copy?.caption ?? '';
  $('cta').textContent = b.copy?.cta ?? '';
  $('tags').textContent = (b.copy?.hashtags ?? []).join(' ');
  $('angle').textContent = b.angle || '—';
  $('notes').textContent = b.notes_for_owner || '—';
  $('facts').textContent = (b.facts_used ?? []).join(' · ') || '—';
  const sources = $('sources');
  sources.replaceChildren();
  for (const s of b.sources ?? []) {
    const li = document.createElement('li');
    li.dir = 'auto';
    if (/^https?:\/\//i.test(s.url)) {
      const a = document.createElement('a');
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = s.note || s.url;
      li.append(a);
    } else {
      li.textContent = s.note || s.url;
    }
    sources.append(li);
  }
  if (!sources.children.length) sources.textContent = '—';
}

function render(job) {
  show($('job'), true);
  $('request-echo').textContent = [job.request, ...job.replies.map((r) => `→ ${r.text}`)].join('\n');
  renderStatus(job);
  const question = job.status === 'needs_input' ? job.agentText : '';
  $('question').textContent = question;
  show($('question'), Boolean(question));
  setError($('job-error'), job.status === 'failed' ? job.error : '');
  renderDraft(job);
  show($('revise'), job.status !== 'working');
  $('reply-label').textContent = job.status === 'needs_input' ? 'Your answer' : 'Ask for a change';
  $('send').disabled = job.status === 'working';
  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(job.caption); $('copied').textContent = 'Copied'; }
    catch { $('copied').textContent = 'Select the text and copy it by hand'; }
    setTimeout(() => { $('copied').textContent = ''; }, 2500);
  };
}

async function open(id) {
  clearTimeout(pollTimer);
  if (current !== id) shownImage = { url: null, blob: shownImage.blob };
  current = id;
  history.replaceState(null, '', `#${id}`);
  try {
    const job = await api(`/api/ads/${encodeURIComponent(id)}`);
    if (current !== id) return;
    render(job);
    if (job.status === 'working') pollTimer = setTimeout(() => open(id), 3000);
    else { loadHistory().catch(() => {}); loadInfo().catch(() => {}); }
  } catch (e) {
    if (e instanceof LoggedOut) return;
    setError($('job-error'), e.message);
    show($('job'), true);
  }
}

// ---------- actions ----------
$('create').addEventListener('click', async () => {
  setError($('create-error'), '');
  $('create').disabled = true;
  try {
    const job = await api('/api/ads', { method: 'POST', body: JSON.stringify({ request: $('request').value }) });
    $('reply').value = '';
    await open(job.id);
    loadHistory().catch(() => {});
  } catch (e) {
    if (!(e instanceof LoggedOut)) setError($('create-error'), e.message);
  } finally {
    $('create').disabled = false;
  }
});

$('send').addEventListener('click', async () => {
  if (!current) return;
  setError($('reply-error'), '');
  $('send').disabled = true;
  try {
    await api(`/api/ads/${encodeURIComponent(current)}/reply`, { method: 'POST', body: JSON.stringify({ text: $('reply').value, redraw: $('redraw').checked }) });
    $('reply').value = '';
    $('redraw').checked = false;
    await open(current);
  } catch (e) {
    if (!(e instanceof LoggedOut)) setError($('reply-error'), e.message);
    $('send').disabled = false;
  }
});

// ---------- boot ----------
password = store.get();
if (password) start().catch(() => { if (password) logout(); });
else showApp(false);
