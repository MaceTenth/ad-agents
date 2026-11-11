// Prints a DigitalOcean App Platform spec (JSON) for this app, filled with the variables from
// .env (or the shell). Secrets are marked SECRET, so App Platform stores them encrypted.
// Nothing is written to disk: pipe the output straight into doctl.
//   node scripts/do-app-spec.mjs <github-user>/<repo> | doctl apps create --spec -
//   node scripts/do-app-spec.mjs <github-user>/<repo> | doctl apps update <app-id> --spec -
// Options: --region fra (default) · --branch main (default) · --name my-app
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const repo = args.find((a) => /^[\w.-]+\/[\w.-]+$/.test(a));
if (!repo) {
  console.error('usage: node scripts/do-app-spec.mjs <github-user>/<repo> [--region fra] [--branch main] [--name my-app]');
  process.exit(2);
}
const name = (opt('name') || repo.split('/')[1]).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^[^a-z]+/, '').slice(0, 32).replace(/-+$/, '') || 'ad-agents';

const SECRET = new Set(['APP_PASSWORD', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']);
const KEYS = [
  'APP_PASSWORD', 'ANTHROPIC_API_KEY', 'AD_AGENT_ID', 'AD_ENVIRONMENT_ID', 'AD_SESSION_BUDGET_CENTS', 'AD_TURN_TIMEOUT_SECONDS',
  'MAX_REJECTIONS', 'MAX_RUNS_PER_DAY', 'MAX_PARALLEL_RUNS', 'TIMEZONE',
  'IMAGE_PROVIDER', 'IMAGE_MODEL', 'IMAGE_QUALITY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
];
const envs = KEYS.filter((k) => process.env[k]).map((key) => ({ key, value: process.env[key], scope: 'RUN_TIME', type: SECRET.has(key) ? 'SECRET' : 'GENERAL' }));
for (const k of ['APP_PASSWORD', 'ANTHROPIC_API_KEY']) {
  if (!process.env[k]) console.error(`warning: ${k} is not set; ${k === 'APP_PASSWORD' ? 'the app will not start' : 'the agent cannot run'} without it`);
}

const spec = {
  name,
  region: opt('region', 'fra'),
  services: [{
    name: 'web',
    github: { repo, branch: opt('branch', 'main'), deploy_on_push: true },
    dockerfile_path: 'Dockerfile',
    http_port: 3000,
    instance_count: 1, // one instance: running jobs and the daily limit live in this process
    instance_size_slug: 'basic-xxs', // the smallest size, 512 MB; the default in DigitalOcean's app spec reference
    health_check: { http_path: '/health' },
    envs,
  }],
};
process.stdout.write(JSON.stringify(spec, null, 2) + '\n');
