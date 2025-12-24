import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { sessions, topups, type Topup } from "../db/schema";
import { requireDb } from "../db";
import { generateSessionKey, authenticateSession } from "../middleware/auth";
import { createAlbyService } from "../services/alby";
import type { Env, Variables } from "../types";
import {
  SessionResponseSchema,
  TopupRequestSchema,
  TopupResponseSchema,
  TopupIdParamSchema,
  TopupStatusResponseSchema,
  TopupListItemSchema,
  ErrorResponseSchema,
} from "../schemas";
import { z } from "@hono/zod-openapi";

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: result.error.format() }, 400);
    }
  },
});

// Get session balance route
const getSessionRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Sessions"],
  summary: "Get session balance",
  description: "Get the current session's balance.",
  security: [{ sessionKeyAuth: [] }],
  responses: {
    200: {
      description: "Session info",
      content: {
        "application/json": {
          schema: SessionResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(getSessionRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateSession(c, db);
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const session = auth.data;

  return c.json({
    sessionKey: session.sessionKey,
    balanceSats: session.balanceSats,
    createdAt: session.createdAt.toISOString(),
  }, 200);
});

// Create topup route - creates session if needed
const createTopupRoute = createRoute({
  method: "post",
  path: "/topup",
  tags: ["Sessions"],
  summary: "Create a top-up invoice",
  description: "Create a Lightning invoice to add funds. If no sessionKey is provided, a new session will be created.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: TopupRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Invoice created",
      content: {
        "application/json": {
          schema: TopupResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid amount",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: "Invalid session key",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Failed to create invoice",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(createTopupRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
  const { amountSats, sessionKey: providedSessionKey } = c.req.valid("json");

  let sessionId: string;
  let sessionKey: string;

  if (providedSessionKey) {
    // Validate existing session
    const existingSession = await db
      .select()
      .from(sessions)
      .where(eq(sessions.sessionKey, providedSessionKey))
      .limit(1);

    if (existingSession.length === 0) {
      return c.json({ success: false as const, error: "Invalid session key" }, 401);
    }

    sessionId = existingSession[0].id;
    sessionKey = providedSessionKey;
  } else {
    // Create new session
    sessionId = nanoid();
    sessionKey = generateSessionKey();

    await db.insert(sessions).values({
      id: sessionId,
      sessionKey,
    });
  }

  const alby = createAlbyService(c.env.ALBY_API_KEY);

  try {
    const invoice = await alby.createInvoice(
      amountSats,
      `Moria top-up: ${sessionId.slice(0, 8)}`
    );

    const topupId = nanoid();

    await db.insert(topups).values({
      id: topupId,
      sessionId,
      amountSats,
      paymentHash: invoice.payment_hash,
      status: "pending",
    });

    return c.json({
      topupId,
      sessionKey,
      amountSats,
      paymentRequest: invoice.payment_request,
      paymentHash: invoice.payment_hash,
      expiresAt: invoice.expires_at,
    }, 200);
  } catch (error) {
    return c.json(
      {
        success: false as const,
        error: `Failed to create invoice: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      500
    );
  }
});

// Get topup status route
const getTopupStatusRoute = createRoute({
  method: "get",
  path: "/topup/{id}",
  tags: ["Sessions"],
  summary: "Check top-up status",
  description: "Check the payment status of a top-up invoice.",
  security: [{ sessionKeyAuth: [] }],
  request: {
    params: TopupIdParamSchema,
  },
  responses: {
    200: {
      description: "Top-up status",
      content: {
        "application/json": {
          schema: TopupStatusResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Top-up not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(getTopupStatusRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateSession(c, db);
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const session = auth.data;
  const { id: topupId } = c.req.valid("param");

  const topup = await db
    .select()
    .from(topups)
    .where(eq(topups.id, topupId))
    .limit(1);

  if (topup.length === 0 || topup[0].sessionId !== session.id) {
    return c.json({ success: false as const, error: "Top-up not found" }, 404);
  }

  // If already paid, return status
  if (topup[0].status === "paid") {
    return c.json({
      id: topup[0].id,
      amountSats: topup[0].amountSats,
      status: "paid" as const,
      paidAt: topup[0].paidAt?.toISOString() ?? null,
    }, 200);
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

        // Credit session balance
        await db
          .update(sessions)
          .set({
            balanceSats: session.balanceSats + topup[0].amountSats,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, session.id));

        return c.json({
          id: topup[0].id,
          amountSats: topup[0].amountSats,
          status: "paid" as const,
          paidAt: new Date().toISOString(),
          newBalance: session.balanceSats + topup[0].amountSats,
        }, 200);
      }
    } catch (error) {
      // Log error but continue
      console.error("Error checking invoice:", error);
    }
  }

  return c.json({
    id: topup[0].id,
    amountSats: topup[0].amountSats,
    status: topup[0].status as "pending" | "paid" | "expired",
  }, 200);
});

// List topups route
const listTopupsRoute = createRoute({
  method: "get",
  path: "/topups",
  tags: ["Sessions"],
  summary: "List top-ups",
  description: "Get a list of all your top-up transactions.",
  security: [{ sessionKeyAuth: [] }],
  responses: {
    200: {
      description: "List of top-ups",
      content: {
        "application/json": {
          schema: z.array(TopupListItemSchema),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(listTopupsRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateSession(c, db);
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const session = auth.data;

  const sessionTopups = await db
    .select()
    .from(topups)
    .where(eq(topups.sessionId, session.id));

  return c.json(
    sessionTopups.map((t: Topup) => ({
      id: t.id,
      amountSats: t.amountSats,
      status: t.status as "pending" | "paid" | "expired",
      createdAt: t.createdAt.toISOString(),
      paidAt: t.paidAt?.toISOString() ?? null,
    })),
    200
  );
});

export default app;
