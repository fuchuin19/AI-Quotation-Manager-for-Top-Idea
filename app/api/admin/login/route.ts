// Verifies admin credentials server-side and, on success, sets a signed
// httpOnly session cookie. This is the ONLY place a login can succeed — the
// UI never decides who's an admin, it just reflects what this route (and
// /api/admin/me) say.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clearRateLimit, getClientKey, recordFailedAttempt, verifyLogin } from "@/lib/admin-auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

interface LoginRequestBody {
  username?: string;
  password?: string;
}

export async function POST(req: NextRequest) {
  try {
    let body: LoginRequestBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
    }

    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
    }

    const clientKey = getClientKey(req);
    const rateLimit = await checkRateLimit(clientKey);
    if (rateLimit.locked) {
      const minutes = Math.max(1, Math.ceil(rateLimit.retryAfterSeconds / 60));
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
        { status: 429 }
      );
    }

    const result = await verifyLogin(username, password);
    if (!result.ok) {
      await recordFailedAttempt(clientKey);
      return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
    }

    await clearRateLimit(clientKey);
    const token = createSessionToken(result.username);
    const res = NextResponse.json({ ok: true, username: result.username, usedMasterPassword: result.usedMasterPassword });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return res;
  } catch (err) {
    console.error("Unhandled error in /api/admin/login:", err);
    return NextResponse.json({ error: "Could not process the login. Try again." }, { status: 500 });
  }
}
