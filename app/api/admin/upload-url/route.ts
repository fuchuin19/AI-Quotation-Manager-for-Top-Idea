// Also doubles as the "does this image already exist" check the browser
// needs while building the pre-upload summary — R2's public bucket URL
// doesn't send CORS headers, so a client-side fetch() against it can't read
// a HEAD response at all. Routing the check through this same-origin route
// (which already needs real R2 credentials to presign anyway) sidesteps
// that without adding a third endpoint beyond the two specified.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { r2ObjectExists, r2PresignedPutUrl } from "@/lib/r2-client";

// Matches exactly what lib/catalog-import/image-browser.js produces:
// products/<16-hex-char-hash>-<photo|dim>.<ext>
const KEY_PATTERN = /^products\/[a-f0-9]{16}-(photo|dim)\.[a-z0-9]+$/;
const EXPIRES_IN_SECONDS = 600;

interface UploadUrlBody {
  key?: string;
  contentType?: string;
}

export async function POST(req: NextRequest) {
  const session = getAdminSession(req);
  if (!session) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  try {
    let body: UploadUrlBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
    }

    const key = String(body.key || "");
    const contentType = String(body.contentType || "");
    if (!KEY_PATTERN.test(key)) {
      return NextResponse.json({ error: "Invalid object key." }, { status: 400 });
    }
    if (!contentType) {
      return NextResponse.json({ error: "contentType is required." }, { status: 400 });
    }

    const exists = await r2ObjectExists(key);
    if (exists) return NextResponse.json({ exists: true });

    const uploadUrl = await r2PresignedPutUrl(key, contentType, EXPIRES_IN_SECONDS);
    return NextResponse.json({ exists: false, uploadUrl, expiresIn: EXPIRES_IN_SECONDS });
  } catch (err) {
    console.error("Unhandled error in /api/admin/upload-url:", err);
    return NextResponse.json({ error: "Could not prepare the upload. Try again." }, { status: 500 });
  }
}
