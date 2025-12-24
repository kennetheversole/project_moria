import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".dev.vars" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: "require" });

async function migrate() {
  console.log("Adding platform_sweeps table and is_auto_payout column...");

  try {
    // Create platform_sweeps table
    await sql`
      CREATE TABLE IF NOT EXISTS platform_sweeps (
        id text PRIMARY KEY NOT NULL,
        amount_sats integer NOT NULL,
        lightning_address text NOT NULL,
        payment_hash text,
        status text DEFAULT 'pending' NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        completed_at timestamp
      )
    `;
    console.log("Created platform_sweeps table");
  } catch (error: any) {
    if (error.message?.includes("already exists")) {
      console.log("platform_sweeps table already exists");
    } else {
      throw error;
    }
  }

  try {
    // Add is_auto_payout column to payouts
    await sql`
      ALTER TABLE payouts ADD COLUMN IF NOT EXISTS is_auto_payout boolean DEFAULT false NOT NULL
    `;
    console.log("Added is_auto_payout column to payouts");
  } catch (error: any) {
    if (error.message?.includes("already exists") || error.message?.includes("duplicate column")) {
      console.log("is_auto_payout column already exists");
    } else {
      throw error;
    }
  }

  console.log("Migration complete!");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
