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
  console.log("=== Platform Sweeps ===");
  const sweeps = await sql`SELECT * FROM platform_sweeps ORDER BY created_at DESC LIMIT 5`;
  console.log(sweeps.length ? sweeps : "No sweeps yet");

  console.log("\n=== Auto Payouts ===");
  const payouts = await sql`SELECT * FROM payouts WHERE is_auto_payout = true ORDER BY created_at DESC LIMIT 5`;
  console.log(payouts.length ? payouts : "No auto payouts yet");

  console.log("\n=== Platform Fees Total ===");
  const fees = await sql`SELECT SUM(platform_fee_sats) as total FROM requests`;
  console.log("Total platform fees collected:", fees[0]?.total || 0, "sats");

  console.log("\n=== Eligible Developers for Auto-Payout ===");
  const devs = await sql`SELECT id, balance_sats, lightning_address FROM developers WHERE balance_sats >= 100 AND lightning_address IS NOT NULL`;
  console.log(devs.length ? devs : "No eligible developers");

  await sql.end();
}

check().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
