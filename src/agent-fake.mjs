// Test double for agent.mjs (AD_AGENT_DRIVER=fake). Same exports, no network. Every turn is
// appended to the file named by FAKE_AGENT_LOG so tests can assert what the agent was sent.
// Markers in the owner text steer it: [NOBRIEF] answers with a question and no brief,
// [BADPRICE] submits a brief with an unlisted price first (one rejection), [REDRAW] or
// "new picture" sets redraw_image on a reply. FAKE_AGENT_DELAY_MS slows every turn down.
import { appendFileSync } from 'node:fs';
import { validateBrief } from './brief.mjs';

const sessions = new Map();
let n = 0;
const log = (entry) => { if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify(entry) + '\n'); };

const SCENE = 'Two braided challah loaves, golden and glossy with sesame seeds, resting side by side on a floured wooden counter. A linen cloth is folded under one end. Soft light comes from a window on the left and catches a little steam rising from the nearer loaf. Behind them, out of focus, a bakery shelf and a paper bag ready to go. Shot from a low three-quarter angle, close, so the loaves fill most of the frame.';

function makeBrief({ redraw, bad, short }) {
  return {
    language: 'he',
    angle: 'Friday morning is challah morning in Florentin.',
    copy: {
      headline: short ? 'חלות ליום שישי' : 'חלות טריות ליום שישי',
      caption: bad ? 'שתי חלות ב-₪25 בפלורנטין, רק השבוע' : short ? 'חלות קלועות ביד, 2 ב-30. בואו.' : 'חלות קלועות ביד, יוצאות מהתנור מהבוקר. 2 ב-30 בסניף פלורנטין. בואו לקחת לשולחן של שישי.',
      cta: 'יום שישי, פלורנטין, מ-07:00',
      hashtags: ['#המאפייהשלדנה', '#חלה', '#פלורנטין'],
    },
    image: { scene: SCENE, aspect: 'square', text_in_image: '', avoid: ['faces', 'logos'] },
    facts_used: ['Challah ₪18'],
    sources: [],
    redraw_image: redraw,
    notes_for_owner: short ? '' : 'הנחתי שהמבצע הוא לסניף פלורנטין בלבד.',
  };
}

export function resolveIds() { return { agentId: 'agent_fake', envId: 'env_fake', workspace: 'default' }; }
export const consoleUrl = (id) => `fake://${id}`;

export async function createSession({ title }) {
  const id = `sesn_fake_${++n}`;
  sessions.set(id, { briefs: 0, title });
  log({ op: 'create', sessionId: id, title });
  return id;
}

export async function runTurn({ sessionId, text, ctx }) {
  const delay = Number(process.env.FAKE_AGENT_DELAY_MS || 0);
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const s = sessions.get(sessionId) ?? { briefs: 0 };
  log({ op: 'turn', sessionId, text, factsHead: ctx.facts.slice(0, 60) });
  if (/\[NOBRIEF\]/.test(text)) return { brief: null, text: 'על איזה מוצר המודעה?', stop: 'end_turn', rejections: 0, problems: [], error: null };
  const isReply = text.startsWith('<reply>');
  const redraw = !isReply || /\[REDRAW\]|תמונה אחרת|new picture/i.test(text);
  const short = isReply && /קצר/.test(text);
  let rejections = 0;
  let brief = makeBrief({ redraw, bad: /\[BADPRICE\]/.test(text) && s.briefs === 0, short });
  let v = validateBrief(brief, ctx);
  if (!v.ok) { rejections = 1; log({ op: 'rejected', sessionId, problems: v.problems }); brief = makeBrief({ redraw, bad: false, short }); v = validateBrief(brief, ctx); }
  s.briefs += 1;
  return { brief: v.ok ? brief : null, text: v.ok ? 'המודעה על חלות ליום שישי בפלורנטין.' : v.result, stop: 'end_turn', rejections, problems: v.problems, error: null };
}

export async function getUsage() { return null; }
