// Reads a SKU off a photographed price tag via Gemini, then looks it up in
// the catalogue. Runs server-side only — the Gemini key never reaches the
// browser, and this can't run on Edge because it uses sharp for resizing.
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { getCatalog, findProduct } from '@/lib/catalog';

// gemini-2.5-flash-lite is no longer issued to new API keys/projects as of
// this writing (confirmed live: Google returns 404 NOT_FOUND for it on a new
// key), so this uses the newer free-tier Flash-Lite model instead.
const MODEL = 'gemini-3.1-flash-lite';

const MAX_BYTES = 4 * 1024 * 1024;

const PROMPT = `This is a photo of a sanitaryware showroom price tag.

Read the PRODUCT CODE / SKU from the tag. It is usually the most prominent code line, positioned above the product name. It may be all digits (e.g. 27222000) or alphanumeric with dashes (e.g. FFAS1M01-101500BF, LS-5500TZ).

The tag may be laminated with glare, and may be photographed at an angle. Read it carefully anyway.

If several tags are visible, use ONLY the tag that is largest and most centred in the frame. Ignore tags at the edges.

Respond with ONLY raw JSON, no markdown and no backticks:
{"sku":"<code exactly as printed, or empty string>","name":"<product name line, or empty>","price":"<printed price digits only, or empty>"}`;

interface ParsedTag {
  sku?: string;
  name?: string;
  price?: string;
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

async function readImage(req: NextRequest): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('image');
    if (!(file instanceof File)) return null;
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) return null;
    return { buffer, mimeType: file.type || 'image/jpeg' };
  }

  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null);
    const raw: string | undefined = body?.image;
    if (!raw) return null;
    const dataUrlMatch = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(raw);
    if (dataUrlMatch) {
      return { buffer: Buffer.from(dataUrlMatch[2], 'base64'), mimeType: dataUrlMatch[1] };
    }
    return { buffer: Buffer.from(raw, 'base64'), mimeType: body?.mimeType || 'image/jpeg' };
  }

  return null;
}

// iPhone camera photos regularly land north of 4MB — shrink until it's under
// the cap so the request is faster and burns less of the free-tier quota.
async function resizeUnderLimit(buffer: Buffer): Promise<Buffer> {
  let width = 1600;
  let quality = 80;
  let out = buffer;
  for (let attempt = 0; attempt < 5; attempt++) {
    out = await sharp(buffer).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
    if (out.length <= MAX_BYTES) return out;
    width = Math.round(width * 0.75);
    quality = Math.max(50, quality - 10);
  }
  return out;
}

function isRateLimitError(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string } | undefined;
  if (!e) return false;
  if (e.status === 429 || e.code === 429) return true;
  return typeof e.message === 'string' && /429|RESOURCE_EXHAUSTED|rate limit/i.test(e.message);
}

export async function POST(req: NextRequest) {
  try {
    const image = await readImage(req);
    if (!image) {
      return NextResponse.json(
        {
          error:
            'No image was found in the request. Send it as multipart/form-data with a field named "image", or as JSON with a base64 "image" field.',
        },
        { status: 400 }
      );
    }

    let buffer = image.buffer;
    let mimeType = image.mimeType;
    if (buffer.length > MAX_BYTES) {
      try {
        buffer = await resizeUnderLimit(buffer);
        mimeType = 'image/jpeg';
      } catch (err) {
        console.error('Failed to resize image:', err);
        return NextResponse.json({ error: 'That photo could not be processed. Try taking it again.' }, { status: 400 });
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set.');
      return NextResponse.json(
        { error: 'The scanner is not configured yet (missing API key). Type the code in manually for now.' },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    let responseText: string;
    try {
      const result = await ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: 'user',
            parts: [{ text: PROMPT }, { inlineData: { mimeType, data: buffer.toString('base64') } }],
          },
        ],
        config: {
          responseMimeType: 'application/json',
        },
      });
      responseText = result.text ?? '';
    } catch (err) {
      if (isRateLimitError(err)) {
        return NextResponse.json(
          { error: "Too many scans right now — wait a few seconds and try again." },
          { status: 429 }
        );
      }
      console.error('Gemini request failed:', err);
      return NextResponse.json(
        { error: 'Could not read that tag right now. Try again, or type the code in manually.' },
        { status: 502 }
      );
    }

    const cleaned = stripFences(responseText);
    let parsed: ParsedTag;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error('Gemini returned non-JSON:', responseText, err);
      return NextResponse.json(
        { error: 'Could not make sense of that tag. Try a clearer photo, or type the code in manually.' },
        { status: 502 }
      );
    }

    const rawSku = (parsed.sku ?? '').trim();
    const guessName = (parsed.name ?? '').trim();
    const guessPrice = (parsed.price ?? '').trim();

    if (!rawSku) {
      return NextResponse.json({ found: false, rawSku: '', guessName, guessPrice });
    }

    try {
      await getCatalog();
    } catch (err) {
      console.error('Catalog fetch failed:', err);
      return NextResponse.json(
        { error: 'Read the code but could not reach the product catalogue. Try again in a moment.' },
        { status: 502 }
      );
    }

    const product = findProduct(rawSku);
    if (product) {
      return NextResponse.json({ found: true, product, rawSku });
    }

    return NextResponse.json({ found: false, rawSku, guessName, guessPrice });
  } catch (err) {
    console.error('Unhandled error in /api/scan:', err);
    return NextResponse.json({ error: 'Something went wrong reading that tag. Try again.' }, { status: 500 });
  }
}
