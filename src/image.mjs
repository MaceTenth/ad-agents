// Composes the image prompt from three layers (prompts/image-prompt.md) and draws it
// through the configured provider. draw(prompt, aspect) returns JPEG bytes.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from './env.mjs';

const OPENAI_SIZES = { square: '1024x1024', portrait: '1024x1536', landscape: '1536x1024' };
const GEMINI_RATIOS = { square: '1:1', portrait: '2:3', landscape: '3:2' };
const SHAPE = { square: 'Square', portrait: 'Vertical', landscape: 'Wide' };

export function brandLayer() {
  const f = join(ROOT, 'prompts/image-brand-layer.txt');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
}

export function composePrompt(image) {
  const shape = SHAPE[image.aspect] ?? 'Square';
  const avoid = (image.avoid ?? []).map((s) => String(s).trim()).filter(Boolean);
  const avoidLine = avoid.length ? ` Do not include: ${avoid.join(', ')}.` : '';
  const text = String(image.text_in_image ?? '').trim();
  const format = text
    ? `${shape} composition with the subject centred and a little room at the edges for cropping. Render this text once, exactly as written, large and clearly legible: "${text}". No other text, letters, numbers, logos or watermarks.${avoidLine}`
    : `${shape} composition with the subject centred and a little room at the edges for cropping. No text, letters, numbers, logos or watermarks anywhere in the image.${avoidLine}`;
  return [brandLayer(), String(image.scene ?? '').trim(), format].filter(Boolean).join('\n\n');
}

async function drawOpenAI(prompt, aspect) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.imageModel, prompt, size: OPENAI_SIZES[aspect] ?? OPENAI_SIZES.square, quality: config.imageQuality, output_format: 'jpeg', n: 1 }),
    signal: AbortSignal.timeout(180_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`openai images ${res.status}: ${JSON.stringify(json).slice(0, 200)}`); e.status = res.status; throw e; }
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('openai images: no b64_json in response');
  return { bytes: Buffer.from(b64, 'base64'), usage: json.usage ?? null };
}

async function drawGemini(prompt, aspect) {
  // Port of the Nano Banana adapter in prompts/image-prompt.md. Less tested than the OpenAI adapter.
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.imageModel, input: prompt, response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: GEMINI_RATIOS[aspect] ?? '1:1', image_size: '1K' } }),
    signal: AbortSignal.timeout(180_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`gemini images ${res.status}: ${JSON.stringify(json).slice(0, 200)}`); e.status = res.status; throw e; }
  const b64 = json.output_image?.data;
  if (!b64) throw new Error('gemini images: no output_image.data in response');
  return { bytes: Buffer.from(b64, 'base64'), usage: null };
}

// A 1x1 white JPEG, for tests.
const MOCK_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

/** @returns {Promise<{bytes: Buffer, usage: object|null}>} */
export async function draw(prompt, aspect) {
  switch (config.imageProvider) {
    case 'openai': return drawOpenAI(prompt, aspect);
    case 'gemini': return drawGemini(prompt, aspect);
    case 'mock': return { bytes: MOCK_JPEG, usage: null };
    default: throw new Error(`unknown IMAGE_PROVIDER "${config.imageProvider}" (openai | gemini | mock)`);
  }
}
