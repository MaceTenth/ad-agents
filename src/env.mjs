// Settings. Locally they come from ./.env (copied from .env.example, ignored by git). On Railway or
// DigitalOcean there is no .env: the platform injects the same names as service variables.
// A variable that is already set always wins over the file.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (existsSync('.env')) {
  try { process.loadEnvFile('.env'); } catch (e) { console.warn('[env] could not load .env:', e.message); }
}

/** The project folder: agents/, prompts/, public/ and claude-lock.json are read from here. */
export const ROOT = resolve(import.meta.dirname, '..');

const num = (name, fallback) => {
  const v = Number(process.env[name] || fallback);
  return Number.isFinite(v) ? v : fallback;
};

export const config = {
  port: num('PORT', 3000),
  // Everything except /health needs this password (HTTP Basic auth, any user name).
  appPassword: process.env.APP_PASSWORD || '',
  // Jobs and pictures. Relative to the folder the server starts in; mount a volume here in the cloud.
  dataDir: resolve(process.env.DATA_DIR || 'data'),
  timezone: process.env.TIMEZONE || 'Asia/Jerusalem',
  // Managed Agents IDs. Empty = read them from claude-lock.json (written by `npm run agents:apply`).
  adAgentId: process.env.AD_AGENT_ID || '',
  adEnvironmentId: process.env.AD_ENVIRONMENT_ID || '',
  adAgentDriver: process.env.AD_AGENT_DRIVER || 'managed', // managed | fake (tests)
  adTurnTimeoutMs: num('AD_TURN_TIMEOUT_SECONDS', 420) * 1000,
  adSessionBudgetCents: String(num('AD_SESSION_BUDGET_CENTS', 300)),
  // The course rule: at most three rejected briefs per run, then the agent stops and explains.
  maxRejections: num('MAX_REJECTIONS', 3),
  // Agent runs (new ads + revisions) allowed per rolling 24 hours, and at the same time. Cost control.
  maxRunsPerDay: num('MAX_RUNS_PER_DAY', 30),
  maxParallelRuns: num('MAX_PARALLEL_RUNS', 2),
  imageProvider: process.env.IMAGE_PROVIDER || 'openai', // openai | gemini | mock (tests)
  imageModel: process.env.IMAGE_MODEL || (process.env.IMAGE_PROVIDER === 'gemini' ? 'gemini-nano-banana-2.1' : 'gpt-image-2.6-sunburst'),
  imageQuality: process.env.IMAGE_QUALITY || 'medium',
};

/** Problems that stop the server from starting, and ones that only stop ads from working. */
export function checkConfig() {
  const fatal = [];
  const warnings = [];
  if (!config.appPassword) fatal.push('APP_PASSWORD is not set. Choose a long password: anyone with the URL could otherwise spend your API credit.');
  else if (config.appPassword.length < 12) warnings.push('APP_PASSWORD is shorter than 12 characters. Use a longer one.');
  if (config.adAgentDriver === 'managed' && !process.env.ANTHROPIC_API_KEY) warnings.push('ANTHROPIC_API_KEY is not set: the research agent cannot run.');
  if (config.imageProvider === 'openai' && !process.env.OPENAI_API_KEY) warnings.push('OPENAI_API_KEY is not set: pictures cannot be drawn.');
  if (config.imageProvider === 'gemini' && !process.env.GEMINI_API_KEY) warnings.push('GEMINI_API_KEY is not set: pictures cannot be drawn.');
  return { fatal, warnings };
}
