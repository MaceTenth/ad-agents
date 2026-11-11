// Live run of the ad pipeline without the web server: a real Managed Agents session
// (web research on Opus) and a real image from the configured provider. Writes the result
// under test-output/. Costs well under a dollar. Run from the project root with .env present:
//   npm run test:ad-live -- "מודעה ליום שישי: חלות, 2 ב-30, פלורנטין"
import { mkdirSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const { brandSheet, facts, kickoff, replyMessage } = await import('../src/ads.mjs');
const driver = await import('../src/agent.mjs');
const { composeCaption } = await import('../src/brief.mjs');
const { composePrompt, draw } = await import('../src/image.mjs');

const request = process.argv[2] || 'מודעה ליום שישי: חלות, 2 ב-30, פלורנטין';
const reply = process.argv[3] || '';
mkdirSync('test-output', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const ctx = { brandSheet: brandSheet(), facts: facts(), request };
console.log('request:', request);
const t0 = Date.now();
const sessionId = await driver.createSession({ title: `live test: ${request.slice(0, 50)}`, metadata: { test: 'ad-live' } });
console.log('session:', sessionId, driver.consoleUrl(sessionId));

const turn = await driver.runTurn({ sessionId, text: kickoff(request, ctx), ctx });
console.log(`turn done in ${((Date.now() - t0) / 1000).toFixed(0)}s: stop=${turn.stop} rejections=${turn.rejections} brief=${turn.brief ? 'yes' : 'no'}`);
if (turn.problems.length) console.log('last problems:', turn.problems);
console.log('agent text:', turn.text);
if (!turn.brief) { console.log('no brief accepted; stopping'); process.exit(1); }

console.log('\n--- brief ---'); console.log(JSON.stringify(turn.brief, null, 2));
console.log('\n--- caption ---'); console.log(composeCaption(turn.brief));
const prompt = composePrompt(turn.brief.image);
console.log('\n--- image prompt ---'); console.log(prompt);

const t1 = Date.now();
const { bytes, usage } = await draw(prompt, turn.brief.image.aspect);
const file = `test-output/ad-${stamp}.jpg`;
writeFileSync(file, bytes);
writeFileSync(`test-output/ad-${stamp}.json`, JSON.stringify({ request, sessionId, turn, prompt, imageUsage: usage }, null, 2));
console.log(`\nimage: ${file} (${bytes.length} bytes, ${((Date.now() - t1) / 1000).toFixed(0)}s)`);

if (reply) {
  const t2 = Date.now();
  const r = await driver.runTurn({ sessionId, text: replyMessage(reply), ctx: { ...ctx, request: `${request}\n${reply}` } });
  console.log(`\nrevision "${reply}" in ${((Date.now() - t2) / 1000).toFixed(0)}s: brief=${r.brief ? 'yes' : 'no'} redraw=${r.brief?.redraw_image}`);
  if (r.brief) console.log(composeCaption(r.brief));
}
const usage2 = await driver.getUsage(sessionId);
console.log('\nsession usage:', usage2);
