import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { gateways, requests, type Gateway, type Request } from "../db/schema";
import { requireDb } from "../db";
import { authenticateDeveloper } from "../middleware/auth";
import { requireEnv, type Env, type Variables } from "../types";
import {
  GatewayCreateRequestSchema,
  GatewayResponseSchema,
  GatewayListItemSchema,
  GatewayDetailResponseSchema,
  GatewayUpdateRequestSchema,
  GatewayIdParamSchema,
  MessageResponseSchema,
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

// Create gateway route
const createGatewayRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Gateways"],
  summary: "Create a new gateway",
  description: "Create a new API gateway to monetize your API.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: GatewayCreateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Gateway created successfully",
      content: {
        "application/json": {
          schema: GatewayResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
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

app.openapi(createGatewayRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const developer = auth.data;
  const { name, targetUrl, pricePerRequestSats, description } = c.req.valid("json");

  // Validate URL
  try {
    new URL(targetUrl);
  } catch {
    return c.json({ success: false as const, error: "Invalid target URL" }, 400);
  }

  const id = nanoid(12);

  await db.insert(gateways).values({
    id,
    developerId: developer.id,
    name,
    targetUrl,
    pricePerRequestSats: pricePerRequestSats || 1,
    description,
  });

  return c.json({
    id,
    name,
    targetUrl,
    pricePerRequestSats: pricePerRequestSats || 1,
    proxyUrl: `/g/${id}`,
  }, 200);
});

// List gateways route
const listGatewaysRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Gateways"],
  summary: "List your gateways",
  description: "Get a list of all gateways you have created.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "List of gateways",
      content: {
        "application/json": {
          schema: z.array(GatewayListItemSchema),
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

app.openapi(listGatewaysRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const developer = auth.data;

  const devGateways = await db
    .select()
    .from(gateways)
    .where(eq(gateways.developerId, developer.id));

  return c.json(
    devGateways.map((gw: Gateway) => ({
      id: gw.id,
      name: gw.name,
      targetUrl: gw.targetUrl,
      pricePerRequestSats: gw.pricePerRequestSats,
      isActive: gw.isActive,
      description: gw.description,
      proxyUrl: `/g/${gw.id}`,
      createdAt: gw.createdAt.toISOString(),
    })),
    200
  );
});

// Get gateway details route
const getGatewayRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Gateways"],
  summary: "Get gateway details",
  description: "Get details and statistics for a specific gateway.",
  security: [{ bearerAuth: [] }],
  request: {
    params: GatewayIdParamSchema,
  },
  responses: {
    200: {
      description: "Gateway details",
      content: {
        "application/json": {
          schema: GatewayDetailResponseSchema,
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
      description: "Gateway not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(getGatewayRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const developer = auth.data;
  const { id: gatewayId } = c.req.valid("param");

  const gateway = await db
    .select()
    .from(gateways)
    .where(
      and(eq(gateways.id, gatewayId), eq(gateways.developerId, developer.id))
    )
    .limit(1);

  if (gateway.length === 0) {
    return c.json({ success: false as const, error: "Gateway not found" }, 404);
  }

  // Get request stats
  const gatewayRequests = await db
    .select()
    .from(requests)
    .where(eq(requests.gatewayId, gatewayId));

  const totalRequests = gatewayRequests.length;
  const totalEarnings = gatewayRequests.reduce(
    (sum: number, r: Request) => sum + r.devEarningsSats,
    0
  );

  const gw = gateway[0];
  return c.json({
    id: gw.id,
    developerId: gw.developerId,
    name: gw.name,
    targetUrl: gw.targetUrl,
    pricePerRequestSats: gw.pricePerRequestSats,
    isActive: gw.isActive,
    description: gw.description,
    proxyUrl: `/g/${gw.id}`,
    createdAt: gw.createdAt.toISOString(),
    updatedAt: gw.updatedAt?.toISOString() ?? null,
    stats: {
      totalRequests,
      totalEarnings,
    },
  }, 200);
});

// Update gateway route
const updateGatewayRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Gateways"],
  summary: "Update gateway",
  description: "Update a gateway's configuration.",
  security: [{ bearerAuth: [] }],
  request: {
    params: GatewayIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: GatewayUpdateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Gateway updated",
      content: {
        "application/json": {
          schema: MessageResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
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
    404: {
      description: "Gateway not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(updateGatewayRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const developer = auth.data;
  const { id: gatewayId } = c.req.valid("param");
  const { name, targetUrl, pricePerRequestSats, description, isActive } =
    c.req.valid("json");

  const gateway = await db
    .select()
    .from(gateways)
    .where(
      and(eq(gateways.id, gatewayId), eq(gateways.developerId, developer.id))
    )
    .limit(1);

  if (gateway.length === 0) {
    return c.json({ success: false as const, error: "Gateway not found" }, 404);
  }

  // Validate URL if provided
  if (targetUrl) {
    try {
      new URL(targetUrl);
    } catch {
      return c.json({ success: false as const, error: "Invalid target URL" }, 400);
    }
  }

  await db
    .update(gateways)
    .set({
      name: name ?? gateway[0].name,
      targetUrl: targetUrl ?? gateway[0].targetUrl,
      pricePerRequestSats: pricePerRequestSats ?? gateway[0].pricePerRequestSats,
      description: description ?? gateway[0].description,
      isActive: isActive ?? gateway[0].isActive,
      updatedAt: new Date(),
    })
    .where(eq(gateways.id, gatewayId));

  return c.json({ message: "Gateway updated" }, 200);
});

// Delete gateway route
const deleteGatewayRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Gateways"],
  summary: "Delete gateway",
  description: "Delete a gateway. This action cannot be undone.",
  security: [{ bearerAuth: [] }],
  request: {
    params: GatewayIdParamSchema,
  },
  responses: {
    200: {
      description: "Gateway deleted",
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
    404: {
      description: "Gateway not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(deleteGatewayRoute, async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false as const, error: auth.error }, 401);
  }

  const developer = auth.data;
  const { id: gatewayId } = c.req.valid("param");

  const gateway = await db
    .select()
    .from(gateways)
    .where(
      and(eq(gateways.id, gatewayId), eq(gateways.developerId, developer.id))
    )
    .limit(1);

  if (gateway.length === 0) {
    return c.json({ success: false as const, error: "Gateway not found" }, 404);
  }

  await db.delete(gateways).where(eq(gateways.id, gatewayId));

  return c.json({ message: "Gateway deleted" }, 200);
});

export default app;
