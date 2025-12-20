import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".dev.vars" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: "require" });

async function check() {
  console.log("Checking database connection...");

  // Check current user and search path
  const user = await sql`SELECT current_user, current_schema, session_user`;
  console.log("Current user info:", user);

  // List available schemas
  const schemas = await sql`SELECT schema_name FROM information_schema.schemata`;
  console.log("Available schemas:", schemas.map(s => s.schema_name));

  // Check if we can create a simple table
  try {
    await sql`CREATE TABLE IF NOT EXISTS test_connection (id int)`;
    console.log("Can create tables in default schema");
    await sql`DROP TABLE test_connection`;
  } catch (error: any) {
    console.log("Cannot create tables:", error.message);
  }

  await sql.end();
}

check().catch((err) => {
  console.error("Check failed:", err);
  process.exit(1);
});
