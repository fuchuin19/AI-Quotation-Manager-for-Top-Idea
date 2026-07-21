// Hand-rolled signed session cookie — deliberately not a JWT library or an
// auth framework. It's one HMAC-signed JSON blob: no server-side session
// store to keep in sync, nothing else to run when the phone is offline.
//
// `role` is baked into the payload now even though it's always "admin"
// today — every place that checks a session checks `role`, not just
// "cookie present and valid". If staff logins get added later, this is the
// one field that needs a second value; nothing here needs a rewrite.
import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "qb_admin_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type Role = "admin";

export interface SessionPayload {
  username: string;
  role: Role;
  iat: number;
  exp: number;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not configured.");
  return s;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

export function createSessionToken(username: string, role: Role = "admin"): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { username, role, iat: now, exp: now + SESSION_MAX_AGE_SECONDS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verifies signature and expiry. Returns null for anything malformed, tampered, or expired. */
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payloadB64 || !sig) return null;

  const expectedSig = sign(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (payload.role !== "admin") return null;
  return payload;
}
