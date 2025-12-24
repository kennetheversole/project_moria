import { eq, sum, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import { developers, requests, payouts, platformSweeps } from "./db/schema";
import { createAlbyService } from "./services/alby";
import type { Env } from "./types";

const MIN_PAYOUT_SATS = 100;

export async function handleScheduled(env: Env): Promise<void> {
  const db = getDb(env.DB, env.DATABASE_URL, env.HYPERDRIVE);
  if (!db) {
    console.log("Database not configured, skipping scheduled task");
    return;
  }

  const alby = createAlbyService(env.ALBY_API_KEY, true);

  console.log("Running scheduled payout job...");

  // 1. Process platform fee sweep
  await sweepPlatformFees(db, alby, env.PLATFORM_LIGHTNING_ADDRESS);

  // 2. Process developer auto-payouts
  await processDevPayouts(db, alby);

  console.log("Scheduled payout job completed");
}

async function sweepPlatformFees(
  db: ReturnType<typeof getDb>,
  alby: ReturnType<typeof createAlbyService>,
  platformAddress: string | undefined
): Promise<void> {
  if (!platformAddress) {
    console.log("PLATFORM_LIGHTNING_ADDRESS not set, skipping platform sweep");
    return;
  }

  try {
    // Sum total platform fees from requests
    const totalFeesResult = await db
      .select({ total: sum(requests.platformFeeSats) })
      .from(requests);
    const totalFees = Number(totalFeesResult[0]?.total || 0);

    // Sum already swept amounts
    const sweptResult = await db
      .select({ total: sum(platformSweeps.amountSats) })
      .from(platformSweeps)
      .where(eq(platformSweeps.status, "completed"));
    const totalSwept = Number(sweptResult[0]?.total || 0);

    const pendingFees = totalFees - totalSwept;

    console.log(`Platform fees - Total: ${totalFees}, Swept: ${totalSwept}, Pending: ${pendingFees}`);

    if (pendingFees >= MIN_PAYOUT_SATS) {
      console.log(`Sweeping ${pendingFees} sats to platform address...`);

      const sweepId = nanoid();

      // Create pending sweep record
      await db.insert(platformSweeps).values({
        id: sweepId,
        amountSats: pendingFees,
        lightningAddress: platformAddress,
        status: "pending",
      });

      try {
        // Send payment
        const payment = await alby.payToLightningAddress(
          platformAddress,
          pendingFees,
          "Moria platform fees"
        );

        // Mark as completed
        await db
          .update(platformSweeps)
          .set({
            status: "completed",
            paymentHash: payment.payment_hash,
            completedAt: new Date(),
          })
          .where(eq(platformSweeps.id, sweepId));

        console.log(`Platform sweep completed: ${pendingFees} sats, hash: ${payment.payment_hash}`);
      } catch (payErr) {
        // Mark as failed
        await db
          .update(platformSweeps)
          .set({ status: "failed" })
          .where(eq(platformSweeps.id, sweepId));

        console.error("Platform sweep failed:", payErr);
      }
    }
  } catch (err) {
    console.error("Error in sweepPlatformFees:", err);
  }
}

async function processDevPayouts(
  db: ReturnType<typeof getDb>,
  alby: ReturnType<typeof createAlbyService>
): Promise<void> {
  try {
    // Find developers with balance >= MIN_PAYOUT_SATS and a lightning address set
    const eligibleDevs = await db
      .select()
      .from(developers)
      .where(
        sql`${developers.balanceSats} >= ${MIN_PAYOUT_SATS} AND ${developers.lightningAddress} IS NOT NULL`
      );

    console.log(`Found ${eligibleDevs.length} developers eligible for auto-payout`);

    for (const dev of eligibleDevs) {
      if (!dev.lightningAddress) continue;

      const amountSats = dev.balanceSats;
      const payoutId = nanoid();

      console.log(`Processing auto-payout for dev ${dev.id.slice(0, 8)}...: ${amountSats} sats`);

      try {
        // Deduct balance first
        await db
          .update(developers)
          .set({
            balanceSats: 0,
            updatedAt: new Date(),
          })
          .where(eq(developers.id, dev.id));

        // Create payout record
        await db.insert(payouts).values({
          id: payoutId,
          developerId: dev.id,
          amountSats,
          lightningAddress: dev.lightningAddress,
          status: "pending",
          isAutoPayout: true,
        });

        // Send payment
        await alby.payToLightningAddress(
          dev.lightningAddress,
          amountSats,
          "Moria auto-payout"
        );

        // Mark as completed
        await db
          .update(payouts)
          .set({
            status: "completed",
            completedAt: new Date(),
          })
          .where(eq(payouts.id, payoutId));

        console.log(`Auto-payout completed for dev ${dev.id.slice(0, 8)}...: ${amountSats} sats`);
      } catch (payErr) {
        // Refund on failure
        await db
          .update(developers)
          .set({
            balanceSats: amountSats,
            updatedAt: new Date(),
          })
          .where(eq(developers.id, dev.id));

        await db
          .update(payouts)
          .set({ status: "failed" })
          .where(eq(payouts.id, payoutId));

        console.error(`Auto-payout failed for dev ${dev.id.slice(0, 8)}...:`, payErr);
      }
    }
  } catch (err) {
    console.error("Error in processDevPayouts:", err);
  }
}
