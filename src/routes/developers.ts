import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
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
import {
  DeveloperRegisterRequestSchema,
  DeveloperLoginRequestSchema,
  DeveloperAuthResponseSchema,
  DeveloperProfileResponseSchema,
  DeveloperUpdateRequestSchema,
  PayoutRequestSchema,
  PayoutResponseSchema,
  MessageResponseSchema,
  ErrorResponseSchema,
} from "../schemas";

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: result.error.format() }, 400);
    }
  },
});

// Register route
const registerRoute = createRoute({
  method: "post",
  path: "/register",
  tags: ["Developers"],
  summary: "Register a new developer",
  description: "Create a new developer account to start monetizing APIs.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: DeveloperRegisterRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Developer registered successfully",
      content: {
        "application/json": {
          schema: DeveloperAuthResponseSchema,
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

app.openapi(registerRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
  const { email, password, name, lightningAddress } = c.req.valid("json");

  // Check if email already exists
  const existing = await db
    .select()
    .from(developers)
    .where(eq(developers.email, email))
    .limit(1);

  if (existing.length > 0) {
    return c.json({ success: false as const, error: "Email already registered" }, 400);
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
    id,
    email,
    name: name ?? null,
    token,
  }, 200);
});

// Login route
const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Developers"],
  summary: "Developer login",
  description: "Authenticate as a developer and receive a JWT token.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: DeveloperLoginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Login successful",
      content: {
        "application/json": {
          schema: DeveloperAuthResponseSchema,
        },
      },
    },
    401: {
      description: "Invalid credentials",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(loginRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
  const { email, password } = c.req.valid("json");

  const developer = await db
    .select()
    .from(developers)
    .where(eq(developers.email, email))
    .limit(1);

  if (developer.length === 0) {
    return c.json({ success: false as const, error: "Invalid credentials" }, 401);
  }

  const valid = await verifyPassword(password, developer[0].passwordHash);
  if (!valid) {
    return c.json({ success: false as const, error: "Invalid credentials" }, 401);
  }

  const token = await generateToken(
    { developerId: developer[0].id },
    requireEnv(c.env, "JWT_SECRET")
  );

  return c.json({
    id: developer[0].id,
    email: developer[0].email,
    name: developer[0].name,
    token,
  }, 200);
});

// Get profile route
const getProfileRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Developers"],
  summary: "Get developer profile",
  description: "Get the authenticated developer's profile and gateway count.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Developer profile",
      content: {
        "application/json": {
          schema: DeveloperProfileResponseSchema,
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

app.openapi(getProfileRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const developer = auth.data;

  // Get gateway count
  const devGateways = await db
    .select()
    .from(gateways)
    .where(eq(gateways.developerId, developer.id));

  return c.json({
    id: developer.id,
    email: developer.email,
    name: developer.name,
    lightningAddress: developer.lightningAddress,
    balanceSats: developer.balanceSats,
    gatewayCount: devGateways.length,
    createdAt: developer.createdAt.toISOString(),
  }, 200);
});

// Update profile route
const updateProfileRoute = createRoute({
  method: "patch",
  path: "/me",
  tags: ["Developers"],
  summary: "Update developer profile",
  description: "Update the authenticated developer's name or Lightning address.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: DeveloperUpdateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Profile updated",
      content: {
        "application/json": {
          schema: MessageResponseSchema,
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

app.openapi(updateProfileRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const developer = auth.data;
  const { name, lightningAddress } = c.req.valid("json");

  await db
    .update(developers)
    .set({
      name: name ?? developer.name,
      lightningAddress: lightningAddress ?? developer.lightningAddress,
      updatedAt: new Date(),
    })
    .where(eq(developers.id, developer.id));

  return c.json({ message: "Profile updated" }, 200);
});

// Payout route
const payoutRoute = createRoute({
  method: "post",
  path: "/payout",
  tags: ["Developers"],
  summary: "Request payout",
  description: "Withdraw earnings to your Lightning address.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: PayoutRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Payout successful",
      content: {
        "application/json": {
          schema: PayoutResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request or insufficient balance",
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
      description: "Payout failed",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(payoutRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const developer = auth.data;
  const { amountSats } = c.req.valid("json");

  if (!developer.lightningAddress) {
    return c.json(
      { success: false as const, error: "Set a Lightning address first" },
      400
    );
  }

  if (amountSats > developer.balanceSats) {
    return c.json({ success: false as const, error: "Insufficient balance" }, 400);
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
      payoutId,
      amountSats,
      paymentHash: payment.payment_hash,
      newBalance: developer.balanceSats - amountSats,
    }, 200);
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
        success: false as const,
        error: `Payout failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      500
    );
  }
});

export default app;
