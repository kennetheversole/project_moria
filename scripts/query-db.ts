import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".dev.vars" });

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });

async function query() {
  const developers = await sql`SELECT id, email, name, balance_sats, created_at FROM developers`;
  console.log("Developers:", developers);

  const users = await sql`SELECT id, email, api_key, balance_sats FROM users`;
  console.log("Users:", users);

  const gateways = await sql`SELECT id, name, target_url, price_per_request_sats FROM gateways`;
  console.log("Gateways:", gateways);

  const requests = await sql`SELECT id, gateway_id, user_id, cost_sats, dev_earnings_sats, platform_fee_sats, method, path FROM requests`;
  console.log("Requests:", requests);

  await sql.end();
}

query();
