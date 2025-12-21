import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { sessions, developers, type Session, type Developer } from "../db/schema";
import type { Database } from "../db";

// Simple password hashing (for demo - use bcrypt/argon2 in production)
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  const computedHash = await hashPassword(password);
  return computedHash === hash;
}

// Generate a secure session key
export function generateSessionKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "sk_" + Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Simple JWT-like token (for demo - use proper JWT in production)
export async function generateToken(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 86400000 })); // 24h expiry
  const signature = await signData(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

export async function verifyToken(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  try {
    const [header, body, signature] = token.split(".");
    const expectedSig = await signData(`${header}.${body}`, secret);
    if (signature !== expectedSig) return null;

    const payload = JSON.parse(atob(body));
    if (payload.exp < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

async function signData(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
