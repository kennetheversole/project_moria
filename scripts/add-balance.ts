import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".dev.vars" });

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });

const email = process.argv[2] || "user@test.com";
const amount = parseInt(process.argv[3] || "1000");

async function addBalance() {
  const result = await sql`
    UPDATE users
    SET balance_sats = balance_sats + ${amount}
    WHERE email = ${email}
    RETURNING id, email, balance_sats
  `;

  if (result.length === 0) {
    console.log("User not found:", email);
  } else {
    console.log(`Added ${amount} sats to ${email}`);
    console.log("New balance:", result[0].balance_sats, "sats");
  }

  await sql.end();
}

addBalance();
