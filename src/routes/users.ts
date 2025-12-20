import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { users, topups, type Topup } from "../db/schema";
import { requireDb } from "../db";
import { generateApiKey, authenticateUser } from "../middleware/auth";
import { createAlbyService } from "../services/alby";
import type { Env, Variables } from "../types";
import {
  UserRegisterRequestSchema,
  UserRegisterResponseSchema,
  UserProfileResponseSchema,
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

// Register user route
const registerUserRoute = createRoute({
  method: "post",
  path: "/register",
  tags: ["Users"],
  summary: "Register a new user",
  description: "Create a new user account and receive an API key for accessing gateways.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: UserRegisterRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "User registered successfully",
      content: {
        "application/json": {
          schema: UserRegisterResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request or email already registered",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(registerUserRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
  const { email } = c.req.valid("json");

  // Check if email already exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return c.json({ success: false as const, error: "Email already registered" }, 400);
  }

  const id = nanoid();
  const apiKey = generateApiKey();

  await db.insert(users).values({
    id,
    email,
    apiKey,
  });

  return c.json({
    id,
    email,
    apiKey,
    balanceSats: 0,
  }, 200);
});

// Get user profile route
const getUserProfileRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Users"],
  summary: "Get user profile",
  description: "Get the authenticated user's profile and balance.",
  security: [{ apiKeyAuth: [] }],
  responses: {
    200: {
      description: "User profile",
      content: {
        "application/json": {
          schema: UserProfileResponseSchema,
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

app.openapi(getUserProfileRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateUser(c, db);
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const user = auth.data;

  return c.json({
    id: user.id,
    email: user.email,
    balanceSats: user.balanceSats,
    createdAt: user.createdAt.toISOString(),
  }, 200);
});

// Create topup route
const createTopupRoute = createRoute({
  method: "post",
  path: "/topup",
  tags: ["Users"],
  summary: "Create a top-up invoice",
  description: "Create a Lightning invoice to add funds to your account.",
  security: [{ apiKeyAuth: [] }],
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
      description: "Unauthorized",
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

  const auth = await authenticateUser(c, db);
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const user = auth.data;
  const { amountSats } = c.req.valid("json");

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
      topupId,
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
  tags: ["Users"],
  summary: "Check top-up status",
  description: "Check the payment status of a top-up invoice.",
  security: [{ apiKeyAuth: [] }],
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

  const auth = await authenticateUser(c, db);
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const user = auth.data;
  const { id: topupId } = c.req.valid("param");

  const topup = await db
    .select()
    .from(topups)
    .where(eq(topups.id, topupId))
    .limit(1);

  if (topup.length === 0 || topup[0].userId !== user.id) {
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

        // Credit user balance
        await db
          .update(users)
          .set({
            balanceSats: user.balanceSats + topup[0].amountSats,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        return c.json({
          id: topup[0].id,
          amountSats: topup[0].amountSats,
          status: "paid" as const,
          paidAt: new Date().toISOString(),
          newBalance: user.balanceSats + topup[0].amountSats,
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
  tags: ["Users"],
  summary: "List top-ups",
  description: "Get a list of all your top-up transactions.",
  security: [{ apiKeyAuth: [] }],
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

  const auth = await authenticateUser(c, db);
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const user = auth.data;

  const userTopups = await db
    .select()
    .from(topups)
    .where(eq(topups.userId, user.id));

  return c.json(
    userTopups.map((t: Topup) => ({
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
