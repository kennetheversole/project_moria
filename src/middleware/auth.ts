import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { sessions, developers, type Session, type Developer } from "../db/schema";
import type { Database } from "../db";
import { verifyEvent, type Event } from "nostr-tools";
import jwt from "@tsndr/cloudflare-worker-jwt";

// JWT configuration
const JWT_ALGORITHM = "HS256";
const JWT_EXPIRY_SECONDS = 86400; // 24 hours

// Nostr auth configuration
const NOSTR_TIMESTAMP_WINDOW_SECONDS = 15; // Reduced from 60s for security
const CHALLENGE_TTL_MS = 60000; // Challenges valid for 60 seconds
const CHALLENGE_PREFIX = "moria_";

// TODO: Move challenge store to Cloudflare KV or Durable Objects for distributed workers
// Currently in-memory which doesn't work across worker isolates in production
// In-memory challenge store (for single instance - use KV for distributed)
// Maps challenge -> { createdAt, used }
const challengeStore = new Map<string, { createdAt: number; used: boolean }>();

// Flag to enable/disable challenge validation (disabled until KV storage is implemented)
const ENFORCE_CHALLENGE_VALIDATION = false;

// Cleanup old challenges periodically (called on each challenge generation)
function cleanupChallenges(): void {
  const now = Date.now();
  for (const [challenge, data] of challengeStore.entries()) {
    if (now - data.createdAt > CHALLENGE_TTL_MS * 2) {
      challengeStore.delete(challenge);
    }
  }
}

// Generate a cryptographically secure challenge
export function generateChallenge(): string {
  // Cleanup old challenges occasionally
  if (Math.random() < 0.1) {
    cleanupChallenges();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const randomPart = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const timestamp = Date.now();
  const challenge = `${CHALLENGE_PREFIX}${randomPart}_${timestamp}`;

  // Store challenge
  challengeStore.set(challenge, { createdAt: timestamp, used: false });

  return challenge;
}

// Validate and consume a challenge (returns true if valid and unused)
export function validateChallenge(challenge: string): { valid: boolean; error?: string } {
  // Check format
  if (!challenge.startsWith(CHALLENGE_PREFIX)) {
    return { valid: false, error: "Invalid challenge format" };
  }

  const stored = challengeStore.get(challenge);

  // Check if challenge exists
  if (!stored) {
    return { valid: false, error: "Challenge not found or expired" };
  }

  // Check if already used (prevent replay)
  if (stored.used) {
    return { valid: false, error: "Challenge already used" };
  }

  // Check if expired
  if (Date.now() - stored.createdAt > CHALLENGE_TTL_MS) {
    challengeStore.delete(challenge);
    return { valid: false, error: "Challenge expired" };
  }

  // Mark as used
  stored.used = true;

  return { valid: true };
}

// Generate a secure session key
export function generateSessionKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "sk_" + Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Generate a secure JWT token using standard library
export async function generateToken(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await jwt.sign(
    {
      ...payload,
      iat: now,
      exp: now + JWT_EXPIRY_SECONDS,
    },
    secret,
    { algorithm: JWT_ALGORITHM }
  );
}

// Verify JWT token with proper validation
export async function verifyToken(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  try {
    // Verify signature and expiry - returns decoded token or undefined
    const decoded = await jwt.verify(token, secret, { algorithm: JWT_ALGORITHM });
    if (!decoded || !decoded.payload) return null;

    return decoded.payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Extract challenge from event tags
function extractChallengeFromEvent(event: Event): string | null {
  for (const tag of event.tags) {
    if (tag[0] === "challenge" && tag[1]) {
      return tag[1];
    }
  }
  return null;
}

// Verify a Nostr signed event for authentication
// The client signs an event with kind 27235 (NIP-98) or kind 22242 (custom auth)
// Requires a valid server-issued challenge in the tags
export function verifyNostrAuth(
  signedEvent: Event,
  options: { requireChallenge?: boolean } = { requireChallenge: true }
): { valid: boolean; pubkey?: string; error?: string } {
  try {
    // Verify event signature
    const isValid = verifyEvent(signedEvent);
    if (!isValid) {
      return { valid: false, error: "Invalid signature" };
    }

    // Check event kind (27235 = NIP-98 HTTP Auth, 22242 = NIP-42 style auth)
    if (signedEvent.kind !== 27235 && signedEvent.kind !== 22242) {
      return { valid: false, error: "Invalid event kind" };
    }

    // Check timestamp is within reduced window (15 seconds)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - signedEvent.created_at) > NOSTR_TIMESTAMP_WINDOW_SECONDS) {
      return { valid: false, error: "Event expired (timestamp outside allowed window)" };
    }

    // Validate server-issued challenge if required and enforcement is enabled
    // Note: Challenge enforcement is disabled until KV storage is implemented for distributed workers
    if (ENFORCE_CHALLENGE_VALIDATION && options.requireChallenge !== false) {
      const challenge = extractChallengeFromEvent(signedEvent);

      if (!challenge) {
        return { valid: false, error: "Missing challenge tag. Fetch a challenge from /api/developers/challenge first." };
      }

      const challengeResult = validateChallenge(challenge);
      if (!challengeResult.valid) {
        return { valid: false, error: challengeResult.error };
      }
    }

    return { valid: true, pubkey: signedEvent.pubkey };
  } catch (error) {
    console.error("verifyNostrAuth error:", error);
    return { valid: false, error: error instanceof Error ? error.message : "Verification failed" };
  }
}

// Validate a hex pubkey (32 bytes = 64 hex chars)
export function isValidPubkey(pubkey: string): boolean {
  return /^[0-9a-f]{64}$/i.test(pubkey);
}

// Auth result type
export type AuthResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number };

// Authenticate sessions via session key - returns session or error
export async function authenticateSession(
  c: Context,
  db: Database
): Promise<AuthResult<Session>> {
  const sessionKey = c.req.header("X-Session-Key") || c.req.query("session_key");

  if (!sessionKey) {
    return { success: false, error: "Session key required", status: 401 };
  }

  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionKey, sessionKey))
    .limit(1);

  if (session.length === 0) {
    return { success: false, error: "Invalid session key", status: 401 };
  }

  return { success: true, data: session[0] };
}

// Authenticate developers via Bearer token - returns developer or error
export async function authenticateDeveloper(
  c: Context,
  db: Database,
  jwtSecret: string
): Promise<AuthResult<Developer>> {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return { success: false, error: "Authorization required", status: 401 };
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token, jwtSecret);

  if (!payload || !payload.developerId) {
    return { success: false, error: "Invalid or expired token", status: 401 };
  }

  const developer = await db
    .select()
    .from(developers)
    .where(eq(developers.id, payload.developerId as string))
    .limit(1);

  if (developer.length === 0) {
    return { success: false, error: "Developer not found", status: 401 };
  }

  return { success: true, data: developer[0] };
}

// Legacy middleware exports for compatibility (kept but deprecated)
export function sessionKeyAuth(db: Database) {
  return async (c: Context, next: () => Promise<void>) => {
    const result = await authenticateSession(c, db);
    if (!result.success) {
      return c.json({ success: false, error: result.error }, result.status as 401);
    }
    c.set("session", result.data);
    await next();
  };
}

export function developerAuth(db: Database, jwtSecret: string) {
  return async (c: Context, next: () => Promise<void>) => {
    const result = await authenticateDeveloper(c, db, jwtSecret);
    if (!result.success) {
      return c.json({ success: false, error: result.error }, result.status as 401);
    }
    c.set("developer", result.data);
    await next();
  };
}
