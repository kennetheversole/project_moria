import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import postgres from "postgres";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Use `any` for the database type since we support multiple drivers
// The Drizzle API is the same for all at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;

// Hyperdrive binding type
interface Hyperdrive {
  connectionString: string;
}

// Get database - prefers Hyperdrive > D1 > DATABASE_URL
export function getDb(
  d1?: D1Database,
  databaseUrl?: string,
  hyperdrive?: Hyperdrive
): Database | null {
  // Prefer Hyperdrive for PlanetScale (uses postgres.js driver)
  if (hyperdrive) {
    const sql = postgres(hyperdrive.connectionString);
    return drizzlePostgres(sql, { schema });
  }

  // Fall back to D1 for local development
  if (d1) {
    return drizzleD1(d1);
  }

  // Fall back to DATABASE_URL with Neon driver (for scripts)
  if (databaseUrl) {
    const sql = neon(databaseUrl);
    return drizzleNeon(sql, { schema });
  }

  return null;
}

// Helper to ensure DB is available or throw
export function requireDb(
  d1?: D1Database,
  databaseUrl?: string,
  hyperdrive?: Hyperdrive
): Database {
  const db = getDb(d1, databaseUrl, hyperdrive);
  if (!db) {
    throw new Error("Database not configured. Set DATABASE_URL or configure D1/Hyperdrive binding.");
  }
  return db;
}

export { schema };
