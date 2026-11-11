// Managed Agents driver for the ad researcher. One session per ad job; a turn sends one
// user.message, answers submit_ad_brief calls with the validator's verdict, and returns
// when the session goes idle. The agent and environment are created with `ant apply`
// (agents/ad-researcher.md, environments/ad-research.yaml); their IDs come from
// claude-lock.json unless AD_AGENT_ID / AD_ENVIRONMENT_ID override them.
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from './env.mjs';
import { info, warn } from './log.mjs';
import { validateBrief } from './brief.mjs';

const client = new Anthropic();
const LOCK = join(ROOT, 'claude-lock.json');

function lock() {
  try { return existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : null; } catch { return null; }
}

export function resolveIds() {
  const l = lock();
  const agentId = config.adAgentId || l?.resources?.['./agents/ad-researcher.md']?.id;
  const envId = config.adEnvironmentId || l?.resources?.['./environments/ad-research.yaml']?.id;
  if (!agentId || !envId) {
    throw new Error('the agent is not created yet: run "npm run agents:apply" and commit claude-lock.json, or set AD_AGENT_ID and AD_ENVIRONMENT_ID');
  }
  return { agentId, envId, workspace: l?.origin?.workspace_id || 'default' };
}

export const consoleUrl = (sessionId) => `https://platform.claude.com/workspaces/${resolveIds().workspace}/sessions/${sessionId}`;

/** Create an idle session with a hard spend cap. The first user.message starts the work. */
export async function createSession({ title, metadata = {} }) {
  const { agentId, envId } = resolveIds();
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: envId,
    title,
    metadata,
    budget: { type: 'limit', max_list_cost: { amount: config.adSessionBudgetCents, currency: 'USD' } },
  });
  info(`ad session ${session.id} created: ${consoleUrl(session.id)}`);
  return session.id;
}

const sendEvents = (sessionId, events) => client.beta.sessions.events.send(sessionId, { events });

/**
 * Send one message into the session and run until the agent's turn ends.
 * Returns { brief, text, stop, rejections, problems }: brief is the accepted submit_ad_brief
 * input or null; text is everything the agent wrote this turn (a clarification when brief is null).
 */
export async function runTurn({ sessionId, text, ctx, maxRejections = config.maxRejections }) {
  // Stream first, then send: the stream only carries events emitted after it opened.
  const stream = await client.beta.sessions.events.stream(sessionId);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; stream.controller.abort(); }, config.adTurnTimeoutMs);

  const out = { brief: null, text: '', stop: null, rejections: 0, problems: [], error: null };
  const texts = [];
  try {
    await sendEvents(sessionId, [{ type: 'user.message', content: [{ type: 'text', text }] }]);
    loop: for await (const ev of stream) {
      switch (ev.type) {
        case 'agent.message':
          for (const b of ev.content ?? []) if (b.type === 'text' && b.text) texts.push(b.text);
          break;
        case 'agent.custom_tool_use': {
          let result;
          if (ev.name === 'submit_ad_brief') {
            const v = validateBrief(ev.input, ctx);
            if (v.ok) { out.brief = ev.input; result = v.result; }
            else {
              out.rejections += 1; out.problems = v.problems;
              result = out.rejections >= maxRejections
                ? `${v.result}\n\nThis was the last attempt. Do not call the tool again. Reply with one sentence, in the owner's language, saying what you could not resolve.`
                : v.result;
            }
            info(`ad session ${sessionId}: submit_ad_brief ${v.ok ? 'accepted' : `rejected (${v.problems.length} problems)`}`);
          } else {
            result = `Unknown tool ${ev.name}. Only submit_ad_brief exists.`;
          }
          await sendEvents(sessionId, [{ type: 'user.custom_tool_result', custom_tool_use_id: ev.id, content: [{ type: 'text', text: result }] }]);
          break;
        }
        case 'session.error':
          out.error = ev.error ?? ev;
          warn(`ad session ${sessionId} error:`, JSON.stringify(ev).slice(0, 300));
          break;
        case 'session.status_idle':
          if (ev.stop_reason?.type === 'requires_action') break; // waiting on our tool result
          out.stop = ev.stop_reason?.type ?? 'idle';
          break loop;
        case 'session.status_terminated':
          out.stop = 'terminated';
          break loop;
      }
    }
  } catch (e) {
    if (!timedOut) throw e;
  } finally {
    clearTimeout(timer);
    try { stream.controller.abort(); } catch { /* already closed */ }
  }

  if (timedOut) {
    await sendEvents(sessionId, [{ type: 'user.interrupt' }]).catch(() => {});
    throw new Error(`ad session ${sessionId}: no result within ${config.adTurnTimeoutMs / 1000}s, interrupted`);
  }
  if (out.stop === 'budget_reached') {
    throw new Error(`ad session ${sessionId}: spend cap reached (${Number(config.adSessionBudgetCents) / 100} USD)`);
  }
  if (out.stop === 'retries_exhausted' || out.stop === 'terminated') {
    throw new Error(`ad session ${sessionId}: ended with ${out.stop}${out.error ? `: ${JSON.stringify(out.error).slice(0, 200)}` : ''}`);
  }
  out.text = texts.join('\n').trim();
  return out;
}

/** Cumulative list cost of the session in cents, or null if unavailable. */
export async function getUsage(sessionId) {
  try {
    const s = await client.beta.sessions.retrieve(sessionId);
    return { listCostCents: s.usage?.list_cost?.amount ?? null, searches: s.usage?.server_tool_use?.web_search_requests ?? null };
  } catch { return null; }
}
