import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { users, developers, type User, type Developer } from "../db/schema";
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

// Generate a secure API key
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "mk_" + Array.from(bytes)
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

// Authenticate users via API key - returns user or error
export async function authenticateUser(
  c: Context,
  db: Database
): Promise<AuthResult<User>> {
  const apiKey = c.req.header("X-API-Key") || c.req.query("api_key");

  if (!apiKey) {
    return { success: false, error: "API key required", status: 401 };
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.apiKey, apiKey))
    .limit(1);

  if (user.length === 0) {
    return { success: false, error: "Invalid API key", status: 401 };
  }

  return { success: true, data: user[0] };
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
export function apiKeyAuth(db: Database) {
  return async (c: Context, next: () => Promise<void>) => {
    const result = await authenticateUser(c, db);
    if (!result.success) {
      return c.json({ success: false, error: result.error }, result.status as 401);
    }
    c.set("user", result.data);
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
