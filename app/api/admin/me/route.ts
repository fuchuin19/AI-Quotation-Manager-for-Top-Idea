// The client can't read an httpOnly cookie, so this is how the UI learns
// whether it should show "Login as admin" or the "Admin" badge — the
// session verification itself still happens server-side, same as every
// other admin route.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const session = getAdminSession(req);
  if (!session) return NextResponse.json({ loggedIn: false });
  return NextResponse.json({ loggedIn: true, username: session.username });
}
