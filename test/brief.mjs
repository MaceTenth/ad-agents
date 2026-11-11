// Unit tests for the brief validator and caption composer. Run: npm run test:brief
import { validateBrief, composeCaption, requiredHashtag } from '../src/brief.mjs';
import { composePrompt } from '../src/image.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

const brandSheet = '## Hashtags\n\nAlways `#המאפייהשלדנה`, plus up to five that fit the post.';
const facts = 'Today: Wednesday 2026-11-11. Time zone: Asia/Jerusalem.\nBranch: Tel Aviv - Florentin\nProducts and prices: Challah ₪18, Babka ₪42.';
const request = 'מודעה ליום שישי: חלות, 2 ב-30, פלורנטין';
const ctx = { brandSheet, facts, request };
const scene = 'Two braided challah loaves, golden with sesame seeds, resting on a floured wooden counter beside a folded linen cloth. Soft window light from the left, a little steam rising from the nearer loaf, a bakery shelf out of focus behind. Low three-quarter angle, close, so the loaves fill the frame.';
const good = () => ({
  language: 'he', angle: 'Friday challah.',
  copy: { headline: 'חלות ליום שישי', caption: 'חלות קלועות ביד, 2 ב-30 בפלורנטין. בואו.', cta: 'יום שישי בפלורנטין', hashtags: ['#המאפייהשלדנה', '#חלה', '#פלורנטין'] },
  image: { scene, aspect: 'square', text_in_image: '', avoid: [] },
  facts_used: ['Challah ₪18'], sources: [], redraw_image: true, notes_for_owner: '',
});

check('requiredHashtag parsed from brand sheet', requiredHashtag(brandSheet) === '#המאפייהשלדנה');
check('a good brief is accepted', validateBrief(good(), ctx).result === 'accepted');

let b = good(); b.copy.caption = 'שתי חלות ב-₪25 בפלורנטין';
let v = validateBrief(b, ctx);
check('unlisted price is rejected and named', !v.ok && v.problems.some((p) => p.includes('₪25')), v.problems[0]);

b = good(); b.copy.caption = 'חלות 2 ב-30 בפלורנטין';
check('a price that appears in the request passes', validateBrief(b, ctx).ok);

b = good(); b.facts_used = ['Challah ₪19'];
v = validateBrief(b, ctx);
check('facts_used not found word for word is rejected', !v.ok && /facts_used contains "Challah ₪19"/.test(v.problems.join(' ')));

b = good(); b.copy.headline = 'א'.repeat(41);
check('headline over 40 chars is rejected', /copy.headline is 41 characters/.test(validateBrief(b, ctx).result));

b = good(); b.image.scene = 'חלות על השולחן';
check('Hebrew scene is rejected', /image.scene is in Hebrew/.test(validateBrief(b, ctx).result));

b = good(); b.image.scene = 'Two challah loaves on a counter.';
check('scene under 40 words is rejected', /image.scene has 6 words/.test(validateBrief(b, ctx).result));

b = good(); b.copy.hashtags = ['#חלה', '#פלורנטין', '#שישי'];
check('missing required hashtag is rejected', /must include #המאפייהשלדנה/.test(validateBrief(b, ctx).result));

b = good(); b.copy.hashtags = ['#חלה', 'פלורנטין', '#המאפייהשלדנה'];
check('hashtag without # is rejected', /contains "פלורנטין"/.test(validateBrief(b, ctx).result));

b = good(); b.language = 'en';
check('language mismatch with a Hebrew request is rejected', /owner wrote in Hebrew/.test(validateBrief(b, ctx).result));

b = good(); b.image.text_in_image = 'one two three four five six';
check('text_in_image over 5 words is rejected', /text_in_image has 6 words/.test(validateBrief(b, ctx).result));

b = good(); b.image.aspect = 'wide';
check('bad aspect is rejected', /image.aspect must be/.test(validateBrief(b, ctx).result));

v = validateBrief({}, ctx);
check('empty brief lists many problems in the rejected format', !v.ok && v.result.startsWith('rejected\n- ') && v.problems.length >= 8, `${v.problems.length} problems`);

const cap = composeCaption(good());
check('caption joins headline, text, cta and hashtags', cap.startsWith('חלות ליום שישי\n\n') && cap.endsWith('#המאפייהשלדנה #חלה #פלורנטין'));
b = good(); b.copy.caption = 'x'.repeat(600); b.copy.hashtags = ['#a'.repeat(1), '#b', '#c', '#dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'];
check('caption never exceeds 1024 chars', composeCaption(b).length <= 1024, `${composeCaption(b).length}`);

const prompt = composePrompt({ scene, aspect: 'portrait', text_in_image: '', avoid: ['faces', 'logos'] });
check('image prompt has brand, scene and format layers', /neighbourhood bakery/.test(prompt) && prompt.includes(scene) && /Vertical composition/.test(prompt) && /No text, letters/.test(prompt) && /Do not include: faces, logos\./.test(prompt));
const prompt2 = composePrompt({ scene, aspect: 'square', text_in_image: 'שבת שלום', avoid: [] });
check('text_in_image switches the format layer', /Render this text once, exactly as written, large and clearly legible: "שבת שלום"/.test(prompt2) && !/Do not include/.test(prompt2));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
