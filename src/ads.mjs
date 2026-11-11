// Ad jobs. One Managed Agents session per job. A job starts from a request, runs in the background,
// and ends as a draft (brief + picture), a question from the agent, or a failure. Revisions go into
// the same session, so the agent remembers the brand sheet, the facts and its last brief.
// State on disk: <DATA_DIR>/ads/<id>.json, with the pictures next to it.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { config, ROOT } from './env.mjs';
import { info, warn } from './log.mjs';
import { composeCaption } from './brief.mjs';
import { composePrompt, draw } from './image.mjs';

const driver = config.adAgentDriver === 'fake' ? await import('./agent-fake.mjs') : await import('./agent.mjs');

export const ADS_DIR = join(config.dataDir, 'ads');
mkdirSync(ADS_DIR, { recursive: true });

/** Sent into the session when the "new picture" box is ticked. */
export const REDRAW_TEXT = 'New picture, please: draw a new picture for the same ad (set redraw_image to true). Keep the copy unless it has to change.';
const CAPTION_LIMIT = 2200; // Instagram's caption limit; the copy itself is far shorter

/** An error the API returns as-is, with its HTTP status. */
export class UserError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- the kickoff message (prompts/kickoff-message.md) ----------
const read = (rel) => { const f = join(ROOT, rel); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };
const stripNotes = (md) => md.split('\n').filter((l) => !l.trimStart().startsWith('>')).join('\n').trim();

export const brandSheet = () => stripNotes(read('prompts/brand-sheet.md'));
export const brandName = () => /^#\s*Brand sheet:\s*(.+)$/m.exec(read('prompts/brand-sheet.md'))?.[1]?.trim() ?? '';

/** prompts/facts.md below its "---" line, after a line with today's date in the configured time zone. */
export function facts() {
  const raw = read('prompts/facts.md');
  const i = raw.indexOf('\n---');
  const body = (i >= 0 ? raw.slice(i + 4) : raw).trim();
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, weekday: 'long' }).format(now);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(now);
  return `Today: ${weekday} ${ymd}. Time zone: ${config.timezone}.\n${body}`;
}
export const kickoff = (request, ctx) => `<brand_sheet>\n${ctx.brandSheet}\n</brand_sheet>\n\n<facts>\n${ctx.facts}\n</facts>\n\n<request>\n${request}\n</request>`;
export const replyMessage = (text) => `<reply>\n${text}\n</reply>`;

// ---------- storage ----------
const ID = /^ad_[a-z0-9]{6,12}_[a-f0-9]{6}$/;
export const validId = (id) => ID.test(String(id ?? ''));
const jobFile = (id) => join(ADS_DIR, `${id}.json`);
const saveJob = (job) => { job.updatedAt = new Date().toISOString(); writeFileSync(jobFile(job.id), JSON.stringify(job, null, 2)); };

export function loadJob(id) {
  if (!validId(id) || !existsSync(jobFile(id))) return null;
  try { return JSON.parse(readFileSync(jobFile(id), 'utf8')); } catch { return null; }
}

/** Path of picture n (1-based) of a job, or its latest picture; null if there is none. */
export function imagePath(job, n) {
  const img = n ? job?.images?.[n - 1] : job?.images?.at(-1);
  if (!img || !/^ad_[a-z0-9_]+\.jpg$/.test(img.file)) return null;
  const p = join(ADS_DIR, img.file);
  return existsSync(p) ? p : null;
}

/** What the API shows about a job. */
export function publicJob(job) {
  const b = job.brief;
  const img = job.images?.at(-1);
  return {
    id: job.id,
    status: job.status, // working | draft | needs_input | failed
    request: job.request,
    replies: job.replies ?? [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    agentText: job.agentText ?? '',
    error: job.error ?? null,
    brief: b ? { language: b.language, angle: b.angle, copy: b.copy, image: b.image, facts_used: b.facts_used, sources: b.sources, notes_for_owner: b.notes_for_owner } : null,
    caption: job.caption ?? '',
    image: img ? { url: `/api/ads/${job.id}/image?n=${job.images.length}`, count: job.images.length, aspect: img.aspect } : null,
    rejections: (job.turns ?? []).reduce((n, t) => n + (t.rejections ?? 0), 0),
    usage: job.usage ?? null,
  };
}

export function listJobs(limit = 30) {
  return readdirSync(ADS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => loadJob(f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit)
    .map((j) => ({ id: j.id, status: j.status, request: j.request.slice(0, 120), headline: j.brief?.copy?.headline ?? '', createdAt: j.createdAt }));
}

// A restart in the middle of a run leaves a job marked "working" forever. Mark those as failed.
for (const f of readdirSync(ADS_DIR).filter((x) => x.endsWith('.json'))) {
  const job = loadJob(f.slice(0, -5));
  if (job?.status === 'working') { job.status = 'failed'; job.error = 'The server restarted during this run. Send the change again.'; saveJob(job); }
}

// ---------- limits ----------
const running = new Set();   // job ids with an agent run in progress
const runTimes = [];         // start times of runs in the last 24 hours (resets on restart)

function admit(jobId) {
  if (running.has(jobId)) throw new UserError(409, 'This ad is still being worked on. Wait for the draft.');
  if (running.size >= config.maxParallelRuns) throw new UserError(429, `${running.size} ads are being made right now. Try again in a minute.`);
  const now = Date.now();
  while (runTimes.length && now - runTimes[0] > 86_400_000) runTimes.shift();
  if (runTimes.length >= config.maxRunsPerDay) throw new UserError(429, `The daily limit of ${config.maxRunsPerDay} agent runs is reached (MAX_RUNS_PER_DAY).`);
  runTimes.push(now);
}
export const usageToday = () => ({ runs: runTimes.filter((t) => Date.now() - t < 86_400_000).length, limit: config.maxRunsPerDay, running: running.size });

function cleanText(text, what) {
  const t = String(text ?? '').trim();
  if (!t) throw new UserError(400, `Write ${what}.`);
  if (t.length > 2000) throw new UserError(400, 'That is too long: 2,000 characters at most.');
  return t;
}

// ---------- the flow ----------
export function createJob(request) {
  const text = cleanText(request, 'what the ad is for');
  const id = `ad_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  admit(id);
  const job = { id, request: text, replies: [], status: 'working', createdAt: new Date().toISOString(), sessionId: null, brief: null, caption: '', images: [], agentText: '', error: null, turns: [] };
  saveJob(job);
  info(`${id}: new ad: ${text.replace(/\s+/g, ' ').slice(0, 100)}`);
  run(job, async () => {
    job.sessionId = await driver.createSession({ title: `Ad: ${text.slice(0, 60)}`, metadata: { job: id } });
    saveJob(job);
    info(`${id}: session ${job.sessionId} ${driver.consoleUrl(job.sessionId)}`);
    const ctx = { brandSheet: brandSheet(), facts: facts(), request: text };
    await agentTurn(job, kickoff(text, ctx), ctx, true);
  });
  return publicJob(job);
}

export function replyToJob(id, text, { redraw = false } = {}) {
  const job = loadJob(id);
  if (!job) throw new UserError(404, 'No ad with that id.');
  if (!job.sessionId) throw new UserError(409, 'This ad never reached the agent. Start a new one.');
  const typed = String(text ?? '').trim();
  const message = cleanText(redraw ? [typed, REDRAW_TEXT].filter(Boolean).join('\n\n') : typed, 'what to change');
  admit(id);
  job.replies.push({ at: new Date().toISOString(), text: message });
  job.status = 'working'; job.error = null;
  saveJob(job);
  info(`${id}: revision: ${message.replace(/\s+/g, ' ').slice(0, 100)}`);
  // Facts the owner states in a reply count as facts for the validator, like the original request.
  const ctx = { brandSheet: brandSheet(), facts: facts(), request: [job.request, ...job.replies.map((r) => r.text)].join('\n') };
  run(job, () => agentTurn(job, replyMessage(message), ctx, false, redraw));
  return publicJob(job);
}

function run(job, fn) {
  running.add(job.id);
  fn()
    .catch((e) => {
      warn(`${job.id}: failed: ${e?.message ?? e}`);
      job.status = 'failed';
      job.error = String(e?.message ?? e).slice(0, 300);
      saveJob(job);
    })
    .finally(() => running.delete(job.id));
}

async function agentTurn(job, message, ctx, first, forceRedraw = false) {
  const t0 = Date.now();
  const turn = await driver.runTurn({ sessionId: job.sessionId, text: message, ctx });
  job.turns.push({ at: new Date().toISOString(), first, ms: Date.now() - t0, rejections: turn.rejections, problems: turn.problems, agentText: turn.text, accepted: Boolean(turn.brief) });
  job.agentText = turn.text;
  const usage = await driver.getUsage(job.sessionId);
  if (usage) job.usage = usage;

  if (!turn.brief) {
    // The agent asked a question, or could not produce a valid brief: show its words and wait for a reply.
    job.status = 'needs_input';
    saveJob(job);
    info(`${job.id}: the agent needs more input`);
    return;
  }

  job.brief = turn.brief;
  job.caption = composeCaption(turn.brief, CAPTION_LIMIT);
  if (first || forceRedraw || turn.brief.redraw_image === true || !job.images.length) {
    const prompt = composePrompt(turn.brief.image);
    const t1 = Date.now();
    const { bytes, usage: imageUsage } = await draw(prompt, turn.brief.image.aspect);
    const file = `${job.id}_${job.images.length + 1}.jpg`;
    writeFileSync(join(ADS_DIR, file), bytes);
    job.images.push({ file, aspect: turn.brief.image.aspect, prompt, bytes: bytes.length, drawMs: Date.now() - t1, usage: imageUsage ?? null });
    info(`${job.id}: picture ${job.images.length} drawn (${bytes.length} bytes, ${Date.now() - t1} ms)`);
  }
  job.status = 'draft';
  saveJob(job);
  info(`${job.id}: draft ready (${Date.now() - t0} ms)`);
}
