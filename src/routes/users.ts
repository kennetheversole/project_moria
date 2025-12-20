import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { users, topups, type Topup } from "../db/schema";
import { requireDb } from "../db";
import { generateApiKey, authenticateUser } from "../middleware/auth";
import { createAlbyService } from "../services/alby";
import type { Env, Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Register a new user (gets API key)
app.post("/register", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
  const { email } = await c.req.json();

  if (!email) {
    return c.json({ success: false, error: "Email required" }, 400);
  }

  // Check if email already exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return c.json({ success: false, error: "Email already registered" }, 400);
  }

  const id = nanoid();
  const apiKey = generateApiKey();

  await db.insert(users).values({
    id,
    email,
    apiKey,
  });

  return c.json({
    success: true,
    data: {
      id,
      email,
      apiKey,
      balanceSats: 0,
    },
  });
});

// Get user profile (via API key)
app.get("/me", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateUser(c, db);
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const user = auth.data;

  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      balanceSats: user.balanceSats,
      createdAt: user.createdAt,
    },
  });
});

// Create a top-up invoice
app.post("/topup", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateUser(c, db);
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const user = auth.data;
  const { amountSats } = await c.req.json();

  if (!amountSats || amountSats < 100) {
    return c.json(
      { success: false, error: "Minimum top-up is 100 sats" },
      400
    );
  }

  const alby = createAlbyService(c.env.ALBY_API_KEY);

  try {
    const invoice = await alby.createInvoice(
      amountSats,
      `API Gateway top-up for ${user.email}`
    );

    const topupId = nanoid();

    await db.insert(topups).values({
      id: topupId,
      userId: user.id,
      amountSats,
      paymentHash: invoice.payment_hash,
      status: "pending",
    });

    return c.json({
      success: true,
      data: {
        topupId,
        amountSats,
        paymentRequest: invoice.payment_request,
        paymentHash: invoice.payment_hash,
        expiresAt: invoice.expires_at,
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: `Failed to create invoice: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      500
    );
  }
});

// Check top-up status
app.get("/topup/:id", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateUser(c, db);
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const user = auth.data;
  const topupId = c.req.param("id");

  const topup = await db
    .select()
    .from(topups)
    .where(eq(topups.id, topupId))
    .limit(1);

  if (topup.length === 0 || topup[0].userId !== user.id) {
    return c.json({ success: false, error: "Top-up not found" }, 404);
  }

  // If already paid, return status
  if (topup[0].status === "paid") {
    return c.json({
      success: true,
      data: {
        id: topup[0].id,
        amountSats: topup[0].amountSats,
        status: "paid",
        paidAt: topup[0].paidAt,
      },
    });
  }

  // Check with Alby if pending
  if (topup[0].status === "pending" && topup[0].paymentHash) {
    const alby = createAlbyService(c.env.ALBY_API_KEY);

    try {
      const invoice = await alby.getInvoice(topup[0].paymentHash);

      if (invoice.settled) {
        // Update topup status
        await db
          .update(topups)
          .set({
            status: "paid",
            paidAt: new Date(),
          })
          .where(eq(topups.id, topupId));

        // Credit user balance
        await db
          .update(users)
          .set({
            balanceSats: user.balanceSats + topup[0].amountSats,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        return c.json({
          success: true,
          data: {
            id: topup[0].id,
            amountSats: topup[0].amountSats,
            status: "paid",
            paidAt: new Date(),
            newBalance: user.balanceSats + topup[0].amountSats,
          },
        });
      }
    } catch (error) {
      // Log error but continue
      console.error("Error checking invoice:", error);
    }
  }

  return c.json({
    success: true,
    data: {
      id: topup[0].id,
      amountSats: topup[0].amountSats,
      status: topup[0].status,
    },
  });
});

// List user's top-ups
app.get("/topups", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateUser(c, db);
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const user = auth.data;

  const userTopups = await db
    .select()
    .from(topups)
    .where(eq(topups.userId, user.id));

  return c.json({
    success: true,
    data: userTopups.map((t: Topup) => ({
      id: t.id,
      amountSats: t.amountSats,
      status: t.status,
      createdAt: t.createdAt,
      paidAt: t.paidAt,
    })),
  });
});

export default app;
