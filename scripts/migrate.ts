import { config } from "dotenv";
import postgres from "postgres";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

config({ path: ".dev.vars" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: "require" });

async function migrate() {
  console.log("Running migrations...");

  const migrationsDir = join(import.meta.dirname, "../drizzle");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    console.log(`Running migration: ${file}`);
    const content = readFileSync(join(migrationsDir, file), "utf-8");

    // Split by statement breakpoints
    const statements = content
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (let statement of statements) {
      try {
        // Remove explicit public schema references for PlanetScale compatibility
        statement = statement.replace(/"public"\./g, "");
        await sql.unsafe(statement);
      } catch (error: any) {
        // Ignore "already exists" errors
        if (
          error.message?.includes("already exists") ||
          error.message?.includes("duplicate key")
        ) {
          console.log(`  Skipping (already exists)`);
        } else {
          throw error;
        }
      }
    }
    console.log(`  Done`);
  }

  console.log("All migrations complete!");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
