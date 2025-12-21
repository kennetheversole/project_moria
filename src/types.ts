import type { Database } from "./db";
import type { Developer, Session } from "./db/schema";

// Hyperdrive binding type
interface Hyperdrive {
  connectionString: string;
}

// Helper to require env vars
export function requireEnv(env: Env, key: keyof Env): string {
  const value = env[key];
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

// Environment bindings for Cloudflare Workers
export interface Env {
  // D1 SQLite database (local dev)
  DB?: D1Database;
  // Hyperdrive for PlanetScale Postgres
  HYPERDRIVE?: Hyperdrive;
  // Neon PostgreSQL (fallback)
  DATABASE_URL?: string;
  ALBY_API_KEY?: string;
  JWT_SECRET?: string;
  PLATFORM_FEE_PERCENT?: string; // defaults to 2
  CORS_ORIGIN?: string; // defaults to "*", set to your domain in prod
}

// Hono context variables
export interface Variables {
  session: Session;
  developer: Developer;
}

// Extended context with database
export interface AppContext {
  db: Database | null;
  env: Env;
}

// Alby API types
export interface AlbyInvoice {
  payment_hash: string;
  payment_request: string;
  expires_at: string;
  amount: number;
  description: string;
}

export interface AlbyInvoiceResponse {
  payment_hash: string;
  payment_request: string;
  expires_at: string;
  settled: boolean;
}

export interface AlbyPaymentResponse {
  payment_hash: string;
  preimage: string;
  fee: number;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
