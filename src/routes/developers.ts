import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { developers, gateways, payouts } from "../db/schema";
import { requireDb } from "../db";
import {
  hashPassword,
  verifyPassword,
  generateToken,
  authenticateDeveloper,
} from "../middleware/auth";
import { createAlbyService } from "../services/alby";
import { requireEnv, type Env, type Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Register a new developer
app.post("/register", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
  const { email, password, name, lightningAddress } = await c.req.json();

  if (!email || !password) {
    return c.json({ success: false, error: "Email and password required" }, 400);
  }

  // Check if email already exists
  const existing = await db
    .select()
    .from(developers)
    .where(eq(developers.email, email))
    .limit(1);

  if (existing.length > 0) {
    return c.json({ success: false, error: "Email already registered" }, 400);
  }

  const id = nanoid();
  const passwordHash = await hashPassword(password);

  await db.insert(developers).values({
    id,
    email,
    passwordHash,
    name,
    lightningAddress,
  });

  const token = await generateToken(
    { developerId: id },
    requireEnv(c.env, "JWT_SECRET")
  );

  return c.json({
    success: true,
    data: { id, email, name, token },
  });
});

// Login
app.post("/login", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
  const { email, password } = await c.req.json();

  if (!email || !password) {
    return c.json({ success: false, error: "Email and password required" }, 400);
  }

  const developer = await db
    .select()
    .from(developers)
    .where(eq(developers.email, email))
    .limit(1);

  if (developer.length === 0) {
    return c.json({ success: false, error: "Invalid credentials" }, 401);
  }

  const valid = await verifyPassword(password, developer[0].passwordHash);
  if (!valid) {
    return c.json({ success: false, error: "Invalid credentials" }, 401);
  }

  const token = await generateToken(
    { developerId: developer[0].id },
    requireEnv(c.env, "JWT_SECRET")
  );

  return c.json({
    success: true,
    data: {
      id: developer[0].id,
      email: developer[0].email,
      name: developer[0].name,
      token,
    },
  });
});

// Get developer profile (authenticated)
app.get("/me", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const developer = auth.data;

  // Get gateway count
  const devGateways = await db
    .select()
    .from(gateways)
    .where(eq(gateways.developerId, developer.id));

  return c.json({
    success: true,
    data: {
      id: developer.id,
      email: developer.email,
      name: developer.name,
      lightningAddress: developer.lightningAddress,
      balanceSats: developer.balanceSats,
      gatewayCount: devGateways.length,
      createdAt: developer.createdAt,
    },
  });
});

// Update developer profile
app.patch("/me", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const developer = auth.data;
  const { name, lightningAddress } = await c.req.json();

  await db
    .update(developers)
    .set({
      name: name ?? developer.name,
      lightningAddress: lightningAddress ?? developer.lightningAddress,
      updatedAt: new Date(),
    })
    .where(eq(developers.id, developer.id));

  return c.json({
    success: true,
    data: { message: "Profile updated" },
  });
});

// Request payout
app.post("/payout", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const developer = auth.data;
  const { amountSats } = await c.req.json();

  if (!developer.lightningAddress) {
    return c.json(
      { success: false, error: "Set a Lightning address first" },
      400
    );
  }

  if (!amountSats || amountSats < 1) {
    return c.json({ success: false, error: "Invalid amount" }, 400);
  }

  if (amountSats > developer.balanceSats) {
    return c.json({ success: false, error: "Insufficient balance" }, 400);
  }

  const alby = createAlbyService(c.env.ALBY_API_KEY);
  const payoutId = nanoid();

  try {
    // Deduct from balance first
    await db
      .update(developers)
      .set({
        balanceSats: developer.balanceSats - amountSats,
        updatedAt: new Date(),
      })
      .where(eq(developers.id, developer.id));

    // Create payout record
    await db.insert(payouts).values({
      id: payoutId,
      developerId: developer.id,
      amountSats,
      lightningAddress: developer.lightningAddress,
      status: "pending",
    });

    // Send payment
    const payment = await alby.payToLightningAddress(
      developer.lightningAddress,
      amountSats,
      `Payout from API Gateway`
    );

    // Mark as completed
    await db
      .update(payouts)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(payouts.id, payoutId));

    return c.json({
      success: true,
      data: {
        payoutId,
        amountSats,
        paymentHash: payment.payment_hash,
        newBalance: developer.balanceSats - amountSats,
      },
    });
  } catch (error) {
    // Refund on failure
    await db
      .update(developers)
      .set({
        balanceSats: developer.balanceSats,
        updatedAt: new Date(),
      })
      .where(eq(developers.id, developer.id));

    await db
      .update(payouts)
      .set({ status: "failed" })
      .where(eq(payouts.id, payoutId));

    return c.json(
      {
        success: false,
        error: `Payout failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      500
    );
  }
});

export default app;
