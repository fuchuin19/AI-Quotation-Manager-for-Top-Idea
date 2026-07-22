// Writes the final catalog/products.json. Called only after every image
// upload the browser identified as needed has succeeded — see
// components/admin/CatalogUpdateCard.tsx. The body is just the product
// array (sku/desc/price/image URLs, no binary data), comfortably under
// Vercel's 4.5MB request limit even at ~2,000+ products.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { r2PutJson } from "@/lib/r2-client";
import type { Product } from "@/lib/catalog";

interface SaveCatalogBody {
  products?: unknown;
}

function isValidProduct(p: unknown): p is Product {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.sku === "string" &&
    typeof o.brand === "string" &&
    typeof o.desc === "string" &&
    (o.price === null || typeof o.price === "number") &&
    typeof o.priceMissing === "boolean" &&
    Array.isArray(o.images) &&
    Array.isArray(o.dimensions) &&
    // Optional: older catalogue entries saved before these fields existed
    // pass through unchanged (see diff.js's unchangedSkus/removedSkus), so
    // they must not be required — only type-checked when present.
    (o.descImages === undefined || Array.isArray(o.descImages)) &&
    (o.descImageSizes === undefined || Array.isArray(o.descImageSizes)) &&
    (o.imageSizes === undefined || Array.isArray(o.imageSizes)) &&
    (o.dimensionSizes === undefined || Array.isArray(o.dimensionSizes))
  );
}

export async function POST(req: NextRequest) {
  const session = getAdminSession(req);
  if (!session) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  try {
    let body: SaveCatalogBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
    }

    if (!Array.isArray(body.products) || body.products.length === 0) {
      return NextResponse.json({ error: "products must be a non-empty array." }, { status: 400 });
    }
    if (!body.products.every(isValidProduct)) {
      return NextResponse.json({ error: "One or more products are malformed — nothing was saved." }, { status: 400 });
    }

    await r2PutJson("catalog/products.json", body.products);
    return NextResponse.json({ ok: true, count: body.products.length });
  } catch (err) {
    console.error("Unhandled error in /api/admin/save-catalog:", err);
    return NextResponse.json({ error: "Could not save the catalogue. Nothing was changed — try again." }, { status: 500 });
  }
}
