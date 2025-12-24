import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { z } from "@hono/zod-openapi";
import { developers, gateways, payouts, sessions, type Session } from "../db/schema";
import { requireDb } from "../db";
import {
  generateToken,
  authenticateDeveloper,
  verifyNostrAuth,
  generateChallenge,
} from "../middleware/auth";
import { createAlbyService } from "../services/alby";
import { requireEnv, type Env, type Variables } from "../types";
import {
  NostrAuthRequestSchema,
  DeveloperAuthResponseSchema,
  DeveloperProfileResponseSchema,
  DeveloperUpdateRequestSchema,
  PayoutRequestSchema,
  PayoutResponseSchema,
  MessageResponseSchema,
  ErrorResponseSchema,
  ChallengeResponseSchema,
} from "../schemas";

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: result.error.format() }, 400);
    }
  },
});

// Challenge route - get a server-issued challenge for auth
const challengeRoute = createRoute({
  method: "get",
  path: "/challenge",
  tags: ["Developers"],
  summary: "Get authentication challenge",
  description: "Get a server-issued challenge that must be included in the signed Nostr event. Challenges expire after 60 seconds and can only be used once.",
  responses: {
    200: {
      description: "Challenge generated",
      content: {
        "application/json": {
          schema: ChallengeResponseSchema,
        },
      },
    },
  },
});

app.openapi(challengeRoute, async (c) => {
  const challenge = generateChallenge();

  return c.json({
    challenge,
    expiresIn: 60,
  }, 200);
});

// Nostr auth route - handles both login and signup
const authRoute = createRoute({
  method: "post",
  path: "/auth",
  tags: ["Developers"],
  summary: "Authenticate with Nostr",
  description: "Sign in or create account using a signed Nostr event. The event must include a valid challenge from /challenge in its tags: [[\"challenge\", \"moria_...\"]]. If the pubkey is new, an account is automatically created.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: NostrAuthRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Authentication successful",
      content: {
        "application/json": {
          schema: DeveloperAuthResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request or signature",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(authRoute, async (c) => {
  try {
    const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
    const { signedEvent } = c.req.valid("json");

    // Verify the Nostr signature
    const authResult = verifyNostrAuth(signedEvent);
    if (!authResult.valid || !authResult.pubkey) {
      return c.json({ success: false as const, error: authResult.error || "Invalid signature" }, 400);
    }

    const pubkey = authResult.pubkey;

    // Check if developer exists
    let developer = await db
      .select()
      .from(developers)
      .where(eq(developers.id, pubkey))
      .limit(1);

    // If not exists, create new developer
    if (developer.length === 0) {
      await db.insert(developers).values({
        id: pubkey,
      });

      developer = await db
        .select()
        .from(developers)
        .where(eq(developers.id, pubkey))
        .limit(1);
    }

    const token = await generateToken(
      { developerId: pubkey },
      requireEnv(c.env, "JWT_SECRET")
    );

    return c.json({
      id: developer[0].id,
      pubkey: developer[0].id,
      token,
    }, 200);
  } catch (error) {
    console.error("Auth error:", error);
    const errorMessage = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    return c.json({
      success: false as const,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    }, 500);
  }
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
    pubkey: developer.id,
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
  description: "Update the authenticated developer's Lightning address.",
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
  const { lightningAddress } = c.req.valid("json");

  await db
    .update(developers)
    .set({
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
  const payoutId = crypto.randomUUID();

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

// Developer sessions schema
const DeveloperSessionSchema = z.object({
  id: z.string(),
  sessionKey: z.string(),
  name: z.string().nullable(),
  balanceSats: z.number(),
  createdAt: z.string(),
});

// Get developer sessions route
const getSessionsRoute = createRoute({
  method: "get",
  path: "/sessions",
  tags: ["Developers"],
  summary: "Get developer sessions",
  description: "Get all sessions linked to the authenticated developer.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "List of sessions",
      content: {
        "application/json": {
          schema: z.array(DeveloperSessionSchema),
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

app.openapi(getSessionsRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const developer = auth.data;

  const devSessions = await db
    .select()
    .from(sessions)
    .where(eq(sessions.developerId, developer.id));

  return c.json(
    devSessions.map((s: Session) => ({
      id: s.id,
      sessionKey: s.sessionKey,
      name: s.name,
      balanceSats: s.balanceSats,
      createdAt: s.createdAt.toISOString(),
    })),
    200
  );
});

// Link session to developer route
const linkSessionRoute = createRoute({
  method: "post",
  path: "/sessions/link",
  tags: ["Developers"],
  summary: "Link session to developer",
  description: "Link an existing session to your account using its session key.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            sessionKey: z.string().min(1),
            name: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Session linked",
      content: {
        "application/json": {
          schema: DeveloperSessionSchema,
        },
      },
    },
    400: {
      description: "Invalid session key or already linked",
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
  },
});

app.openapi(linkSessionRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const developer = auth.data;
  const { sessionKey, name } = c.req.valid("json");

  // Find the session
  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionKey, sessionKey))
    .limit(1);

  if (session.length === 0) {
    return c.json({ success: false as const, error: "Session not found" }, 400);
  }

  if (session[0].developerId && session[0].developerId !== developer.id) {
    return c.json({ success: false as const, error: "Session already linked to another account" }, 400);
  }

  // Link session to developer
  await db
    .update(sessions)
    .set({
      developerId: developer.id,
      name: name || session[0].name,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, session[0].id));

  return c.json({
    id: session[0].id,
    sessionKey: session[0].sessionKey,
    name: name || session[0].name,
    balanceSats: session[0].balanceSats,
    createdAt: session[0].createdAt.toISOString(),
  }, 200);
});

export default app;
