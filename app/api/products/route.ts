// Passes catalog/products.json through from R2 so the front end can load the
// whole catalogue once and search it offline. Cached for 60s at the fetch
// and CDN layer — long enough to avoid hammering R2, short enough that
// re-running the import script shows up within a minute or two.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const base = process.env.R2_PUBLIC_URL;
    if (!base) {
      console.error('R2_PUBLIC_URL is not set.');
      return NextResponse.json({ error: 'The catalogue is not configured yet.' }, { status: 500 });
    }

    const res = await fetch(`${base.replace(/\/+$/, '')}/catalog/products.json`, {
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      console.error(`Catalog fetch failed with status ${res.status}`);
      return NextResponse.json({ error: 'Could not load the catalogue right now.' }, { status: 502 });
    }

    const products = await res.json();
    return NextResponse.json(products, {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('Unhandled error in /api/products:', err);
    return NextResponse.json({ error: 'Could not load the catalogue right now.' }, { status: 500 });
  }
}
