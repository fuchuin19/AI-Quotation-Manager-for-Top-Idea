// Admin login/credential logic. No database — the one admin account lives
// as a small JSON file on R2 (config/admin.json), same storage the rest of
// the app already uses for the catalogue. See lib/session.ts for the cookie
// itself and app/api/admin/* for the routes that call into this.
import { createHash, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { r2GetJson, r2PutJson } from "./r2-client";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "./session";

const ADMIN_CONFIG_KEY = "config/admin.json";
const RATE_LIMIT_KEY = "config/login-attempts.json";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface AdminConfig {
  username: string;
  passwordHash: string;
}

interface RateLimitEntry {
  count: number;
  lockedUntil: number | null;
  lastAttempt: number;
}
type RateLimitStore = Record<string, RateLimitEntry>;

// Constant-time string compare regardless of input length — hash first so
// timingSafeEqual (which requires equal-length buffers) always has them.
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

function masterPassword(): string {
  return process.env.ADMIN_PASSWORD || "";
}

/** Reads the session cookie off a request and verifies it. Every admin route calls this first. */
export function getAdminSession(req: NextRequest): SessionPayload | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export function getClientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/* ============================ rate limiting ============================ */

function pruneStore(store: RateLimitStore, now: number): void {
  for (const key of Object.keys(store)) {
    const e = store[key];
    if (now - e.lastAttempt > PRUNE_AFTER_MS && (!e.lockedUntil || e.lockedUntil < now)) {
      delete store[key];
    }
  }
}

export async function checkRateLimit(clientKey: string): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const store = (await r2GetJson<RateLimitStore>(RATE_LIMIT_KEY)) || {};
  const entry = store[clientKey];
  if (entry?.lockedUntil && entry.lockedUntil > Date.now()) {
    return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export async function recordFailedAttempt(clientKey: string): Promise<void> {
  const store = (await r2GetJson<RateLimitStore>(RATE_LIMIT_KEY)) || {};
  const now = Date.now();
  const existing = store[clientKey];
  // Only a lockout that was actually SET and has since passed counts as a
  // clean slate (locks out 5-in-a-row, not "instant relock forever" after
  // the timeout). `lockedUntil: null` just means "not locked yet" — that
  // must keep accumulating, not reset the count on every single failure.
  const wasLockedAndExpired = existing?.lockedUntil != null && existing.lockedUntil <= now;
  const newCount = (wasLockedAndExpired ? 0 : existing?.count ?? 0) + 1;
  store[clientKey] = {
    count: newCount,
    lockedUntil: newCount >= MAX_ATTEMPTS ? now + LOCKOUT_MS : null,
    lastAttempt: now,
  };
  pruneStore(store, now);
  await r2PutJson(RATE_LIMIT_KEY, store);
}

export async function clearRateLimit(clientKey: string): Promise<void> {
  const store = (await r2GetJson<RateLimitStore>(RATE_LIMIT_KEY)) || {};
  if (!(clientKey in store)) return;
  delete store[clientKey];
  await r2PutJson(RATE_LIMIT_KEY, store);
}

/* ============================ credentials ============================ */

export type LoginResult = { ok: true; username: string; usedMasterPassword: boolean } | { ok: false };

/**
 * Accepts a login if EITHER the stored credentials match OR the password
 * matches ADMIN_PASSWORD with any username (the recovery path — see
 * CLAUDE.md). The very first successful master-password login, when no
 * config/admin.json exists yet, seeds it with username "ktooi" so there's a
 * real account going forward.
 */
export async function verifyLogin(username: string, password: string): Promise<LoginResult> {
  const master = masterPassword();
  const usedMaster = master.length > 0 && safeEqual(password, master);

  const config = await r2GetJson<AdminConfig>(ADMIN_CONFIG_KEY);
  let storedMatch = false;
  if (config && safeEqual(username, config.username)) {
    storedMatch = await bcrypt.compare(password, config.passwordHash);
  }

  if (!storedMatch && !usedMaster) return { ok: false };

  if (!config && usedMaster) {
    const passwordHash = await bcrypt.hash(master, 10);
    await r2PutJson(ADMIN_CONFIG_KEY, { username: "ktooi", passwordHash });
  }

  return {
    ok: true,
    // Report the real account's username whenever one exists, even if THIS
    // particular login only succeeded via the master password with some
    // other typed-in username — "ktooi" is only a fallback for the
    // brand-new-install case where there's no real account yet at all.
    username: config ? config.username : "ktooi",
    // Only worth mentioning when the real account credentials DIDN'T match —
    // if his actual password happens to equal ADMIN_PASSWORD too, that's
    // just a normal login, not a "you used the recovery password" moment.
    usedMasterPassword: usedMaster && !storedMatch,
  };
}

export type ChangeCredentialsResult = { ok: true } | { ok: false; error: string };

export async function changeCredentials(
  currentPassword: string,
  newUsername: string,
  newPassword: string
): Promise<ChangeCredentialsResult> {
  const trimmedUsername = newUsername.trim();
  if (!trimmedUsername) return { ok: false, error: "Username can't be empty." };
  if (newPassword.length < 4) return { ok: false, error: "Password must be at least 4 characters." };

  const master = masterPassword();
  const usedMaster = master.length > 0 && safeEqual(currentPassword, master);
  const config = await r2GetJson<AdminConfig>(ADMIN_CONFIG_KEY);
  const storedMatch = !!config && (await bcrypt.compare(currentPassword, config.passwordHash));

  if (!storedMatch && !usedMaster) return { ok: false, error: "Current password is incorrect." };

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await r2PutJson(ADMIN_CONFIG_KEY, { username: trimmedUsername, passwordHash });
  return { ok: true };
}
