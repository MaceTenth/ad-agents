// Checks an ad brief the researcher agent submitted. Returns the exact text that goes back
// to the agent as the tool result: "accepted", or "rejected" plus one line per problem that
// names the field, what is wrong and what would be right (prompts/kickoff-message.md).
const LIMITS = { headline: 40, cta: 60, caption: 600, notes: 200, textInImageWords: 5, sceneMin: 40, sceneMax: 120, sources: 5 };
const ASPECTS = new Set(['square', 'portrait', 'landscape']);
const HEBREW = /[֐-׿]/;
const PRICE = /₪\s?\d[\d,.]*|\d[\d,.]*\s?₪|\d[\d,.]*\s?ש["״]?ח|\d[\d,.]*\s?(?:nis|shekels?)/gi;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const str = (v) => (typeof v === 'string' ? v : '');
const words = (s) => norm(s).split(' ').filter(Boolean);

/** The hashtag the brand sheet marks as "Always", if any (e.g. Always `#המאפייהשלדנה`). */
export function requiredHashtag(brandSheet) {
  return /Always\s+`(#[^`\s]+)`/.exec(brandSheet ?? '')?.[1] ?? null;
}

/**
 * @param brief  the submit_ad_brief tool input
 * @param ctx    { facts, request, brandSheet }: the text blocks the agent was given
 * @returns {{ ok: boolean, problems: string[], result: string }}
 */
export function validateBrief(brief, ctx) {
  const p = [];
  const b = brief && typeof brief === 'object' ? brief : {};
  const copy = b.copy && typeof b.copy === 'object' ? b.copy : {};
  const image = b.image && typeof b.image === 'object' ? b.image : {};
  const requestHasHebrew = HEBREW.test(ctx.request ?? '');

  // language
  const lang = str(b.language).toLowerCase();
  if (!/^[a-z]{2}$/.test(lang)) p.push('language must be a two-letter code such as he or en.');
  else if (requestHasHebrew && lang !== 'he') p.push(`language is "${lang}" but the owner wrote in Hebrew. Use he and write the copy in Hebrew.`);
  else if (!requestHasHebrew && lang === 'he') p.push('language is "he" but the owner did not write in Hebrew. Match the language of the request.');

  if (!norm(b.angle)) p.push('angle is empty. State the one idea this ad is built on, in one sentence.');

  // copy
  const headline = str(copy.headline), caption = str(copy.caption), cta = str(copy.cta);
  if (!norm(headline)) p.push('copy.headline is empty.');
  else if (headline.length > LIMITS.headline) p.push(`copy.headline is ${headline.length} characters. The limit is ${LIMITS.headline}.`);
  if (!norm(caption)) p.push('copy.caption is empty.');
  else if (caption.length > LIMITS.caption) p.push(`copy.caption is ${caption.length} characters. The limit is ${LIMITS.caption}.`);
  if (!norm(cta)) p.push('copy.cta is empty.');
  else if (cta.length > LIMITS.cta) p.push(`copy.cta is ${cta.length} characters. The limit is ${LIMITS.cta}.`);
  if (requestHasHebrew && lang === 'he' && !HEBREW.test(headline + caption + cta)) p.push('The copy is not in Hebrew although language is he and the owner wrote in Hebrew.');

  const tags = Array.isArray(copy.hashtags) ? copy.hashtags.map(str).map(norm).filter(Boolean) : [];
  if (tags.length < 3 || tags.length > 6) p.push(`copy.hashtags has ${tags.length} items. Use 3 to 6 hashtags.`);
  const badTag = tags.find((t) => !t.startsWith('#') || /\s/.test(t));
  if (badTag) p.push(`copy.hashtags contains "${badTag}". Each hashtag starts with # and has no spaces.`);
  const must = requiredHashtag(ctx.brandSheet);
  if (must && !tags.includes(must)) p.push(`copy.hashtags must include ${must} (the brand sheet says it is always used).`);

  // facts
  const factsUsed = Array.isArray(b.facts_used) ? b.facts_used.map(str).map(norm).filter(Boolean) : [];
  const allowed = norm(`${ctx.facts ?? ''} ${ctx.request ?? ''}`);
  for (const f of factsUsed) {
    if (!allowed.includes(f)) p.push(`facts_used contains "${f}", which does not appear word for word in <facts> or <request>. Copy facts exactly from there.`);
  }
  const copyText = `${headline} ${caption} ${cta}`;
  const usedText = factsUsed.join(' ');
  for (const price of new Set((copyText.match(PRICE) ?? []).map(norm))) {
    if (!usedText.includes(price) && !norm(ctx.request ?? '').includes(price)) {
      p.push(`copy states "${price}", which is not in facts_used. Use only prices from <facts> or <request>, and list them in facts_used.`);
    }
  }

  // image
  const scene = str(image.scene);
  const sceneWords = scene.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0;
  if (!norm(scene)) p.push('image.scene is empty.');
  else if (HEBREW.test(scene)) p.push('image.scene is in Hebrew. Write the scene in English.');
  else if (sceneWords < LIMITS.sceneMin) p.push(`image.scene has ${sceneWords} words. Write 40 to 120 words in English.`);
  else if (sceneWords > LIMITS.sceneMax) p.push(`image.scene has ${sceneWords} words. The limit is ${LIMITS.sceneMax}.`);
  if (!ASPECTS.has(image.aspect)) p.push('image.aspect must be square, portrait or landscape.');
  const tii = str(image.text_in_image);
  if (words(tii).length > LIMITS.textInImageWords) p.push(`image.text_in_image has ${words(tii).length} words. The limit is ${LIMITS.textInImageWords}, or an empty string for no text.`);
  if (!Array.isArray(image.avoid)) p.push('image.avoid must be a list (empty if nothing to avoid).');

  // the rest
  if (Array.isArray(b.sources)) {
    if (b.sources.length > LIMITS.sources) p.push(`sources has ${b.sources.length} items. The limit is ${LIMITS.sources}.`);
    if (b.sources.some((s) => !s || typeof s.url !== 'string' || !/^https?:\/\//.test(s.url))) p.push('every sources entry needs a url starting with http(s).');
  } else p.push('sources must be a list (empty if none).');
  if (typeof b.redraw_image !== 'boolean') p.push('redraw_image must be true or false.');
  const notes = str(b.notes_for_owner);
  if (notes.length > LIMITS.notes) p.push(`notes_for_owner is ${notes.length} characters. The limit is ${LIMITS.notes}.`);

  const ok = p.length === 0;
  return { ok, problems: p, result: ok ? 'accepted' : `rejected\n${p.map((x) => `- ${x}`).join('\n')}` };
}

/** The post text: headline, caption, call to action, hashtags, trimmed to the limit (the caller passes it). */
export function composeCaption(brief, limit = 1024) {
  const c = brief.copy ?? {};
  const parts = [norm(c.headline), String(c.caption ?? '').trim(), norm(c.cta)];
  let tags = (c.hashtags ?? []).map(norm).filter(Boolean);
  const build = () => parts.filter(Boolean).concat(tags.length ? [tags.join(' ')] : []).join('\n\n');
  let text = build();
  while (text.length > limit && tags.length) { tags = tags.slice(0, -1); text = build(); }
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}
