import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { gateways, requests, type Gateway, type Request } from "../db/schema";
import { requireDb } from "../db";
import { authenticateDeveloper } from "../middleware/auth";
import { requireEnv, type Env, type Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Create a new gateway
app.post("/", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const developer = auth.data;
  const { name, targetUrl, pricePerRequestSats, description } =
    await c.req.json();

  if (!name || !targetUrl) {
    return c.json(
      { success: false, error: "Name and target URL required" },
      400
    );
  }

  // Validate URL
  try {
    new URL(targetUrl);
  } catch {
    return c.json({ success: false, error: "Invalid target URL" }, 400);
  }

  const id = nanoid(12); // Shorter ID for URLs

  await db.insert(gateways).values({
    id,
    developerId: developer.id,
    name,
    targetUrl,
    pricePerRequestSats: pricePerRequestSats || 1,
    description,
  });

  return c.json({
    success: true,
    data: {
      id,
      name,
      targetUrl,
      pricePerRequestSats: pricePerRequestSats || 1,
      proxyUrl: `/g/${id}`,
    },
  });
});

// List developer's gateways
app.get("/", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const developer = auth.data;

  const devGateways = await db
    .select()
    .from(gateways)
    .where(eq(gateways.developerId, developer.id));

  return c.json({
    success: true,
    data: devGateways.map((gw: Gateway) => ({
      id: gw.id,
      name: gw.name,
      targetUrl: gw.targetUrl,
      pricePerRequestSats: gw.pricePerRequestSats,
      isActive: gw.isActive,
      description: gw.description,
      proxyUrl: `/g/${gw.id}`,
      createdAt: gw.createdAt,
    })),
  });
});

// Get gateway details
app.get("/:id", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const developer = auth.data;
  const gatewayId = c.req.param("id");

  const gateway = await db
    .select()
    .from(gateways)
    .where(
      and(eq(gateways.id, gatewayId), eq(gateways.developerId, developer.id))
    )
    .limit(1);

  if (gateway.length === 0) {
    return c.json({ success: false, error: "Gateway not found" }, 404);
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

  return c.json({
    success: true,
    data: {
      ...gateway[0],
      proxyUrl: `/g/${gateway[0].id}`,
      stats: {
        totalRequests,
        totalEarnings,
      },
    },
  });
});

// Update gateway
app.patch("/:id", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const developer = auth.data;
  const gatewayId = c.req.param("id");
  const { name, targetUrl, pricePerRequestSats, description, isActive } =
    await c.req.json();

  const gateway = await db
    .select()
    .from(gateways)
    .where(
      and(eq(gateways.id, gatewayId), eq(gateways.developerId, developer.id))
    )
    .limit(1);

  if (gateway.length === 0) {
    return c.json({ success: false, error: "Gateway not found" }, 404);
  }

  // Validate URL if provided
  if (targetUrl) {
    try {
      new URL(targetUrl);
    } catch {
      return c.json({ success: false, error: "Invalid target URL" }, 400);
    }
  }

  await db
    .update(gateways)
    .set({
      name: name ?? gateway[0].name,
      targetUrl: targetUrl ?? gateway[0].targetUrl,
      pricePerRequestSats:
        pricePerRequestSats ?? gateway[0].pricePerRequestSats,
      description: description ?? gateway[0].description,
      isActive: isActive ?? gateway[0].isActive,
      updatedAt: new Date(),
    })
    .where(eq(gateways.id, gatewayId));

  return c.json({
    success: true,
    data: { message: "Gateway updated" },
  });
});

// Delete gateway
app.delete("/:id", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  const auth = await authenticateDeveloper(c, db, requireEnv(c.env, "JWT_SECRET"));
  if (!auth.success) {
    return c.json({ success: false, error: auth.error }, auth.status as 401);
  }

  const developer = auth.data;
  const gatewayId = c.req.param("id");

  const gateway = await db
    .select()
    .from(gateways)
    .where(
      and(eq(gateways.id, gatewayId), eq(gateways.developerId, developer.id))
    )
    .limit(1);

  if (gateway.length === 0) {
    return c.json({ success: false, error: "Gateway not found" }, 404);
  }

  await db.delete(gateways).where(eq(gateways.id, gatewayId));

  return c.json({
    success: true,
    data: { message: "Gateway deleted" },
  });
});

export default app;
