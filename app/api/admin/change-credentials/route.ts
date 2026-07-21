// Requires an already-valid session — this changes the account that
// session belongs to, not a way to create one. Every field, including the
// current-password re-check, is verified here, never trusted from the client.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { changeCredentials, getAdminSession } from "@/lib/admin-auth";
import { SESSION_COOKIE } from "@/lib/session";

interface ChangeCredentialsBody {
  currentPassword?: string;
  newUsername?: string;
  newPassword?: string;
}

export async function POST(req: NextRequest) {
  const session = getAdminSession(req);
  if (!session) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  try {
    let body: ChangeCredentialsBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
    }

    const currentPassword = String(body.currentPassword || "");
    const newUsername = String(body.newUsername || "");
    const newPassword = String(body.newPassword || "");
    if (!currentPassword || !newUsername || !newPassword) {
      return NextResponse.json({ error: "All fields are required." }, { status: 400 });
    }

    const result = await changeCredentials(currentPassword, newUsername, newPassword);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Credentials changed — log out and require a fresh login, per spec.
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("Unhandled error in /api/admin/change-credentials:", err);
    return NextResponse.json({ error: "Could not update credentials. Try again." }, { status: 500 });
  }
}
