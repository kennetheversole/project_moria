import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { gateways, users, developers, requests } from "../db/schema";
import { requireDb } from "../db";
import { calculateFees, getPlatformFeePercent } from "../services/billing";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

// Proxy all requests to /g/:gatewayId/*
app.all("/:gatewayId/*", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
  const gatewayId = c.req.param("gatewayId");

  // Get API key from header or query
  const apiKey = c.req.header("X-API-Key") || c.req.query("api_key");

  if (!apiKey) {
    return c.json(
      {
        success: false,
        error: "API key required",
        code: "AUTH_REQUIRED",
      },
      401
    );
  }

  // Look up user
  const user = await db
    .select()
    .from(users)
    .where(eq(users.apiKey, apiKey))
    .limit(1);

  if (user.length === 0) {
    return c.json(
      {
        success: false,
        error: "Invalid API key",
        code: "INVALID_API_KEY",
      },
      401
    );
  }

  // Look up gateway
  const gateway = await db
    .select()
    .from(gateways)
    .where(eq(gateways.id, gatewayId))
    .limit(1);

  if (gateway.length === 0) {
    return c.json(
      {
        success: false,
        error: "Gateway not found",
        code: "GATEWAY_NOT_FOUND",
      },
      404
    );
  }

  if (!gateway[0].isActive) {
    return c.json(
      {
        success: false,
        error: "Gateway is not active",
        code: "GATEWAY_INACTIVE",
      },
      503
    );
  }

  const costSats = gateway[0].pricePerRequestSats;

  // Check balance
  if (user[0].balanceSats < costSats) {
    return c.json(
      {
        success: false,
        error: "Insufficient balance. Please top up.",
        code: "INSUFFICIENT_BALANCE",
        balanceSats: user[0].balanceSats,
        requiredSats: costSats,
      },
      402
    );
  }

  // Calculate fees
  const feePercent = getPlatformFeePercent(c.env.PLATFORM_FEE_PERCENT);
  const fees = calculateFees(costSats, feePercent);

  // Build the target URL
  const pathAfterGateway = c.req.path.replace(`/g/${gatewayId}`, "");
  const targetUrl = new URL(pathAfterGateway || "/", gateway[0].targetUrl);

  // Copy query parameters
  const originalUrl = new URL(c.req.url);
  originalUrl.searchParams.forEach((value, key) => {
    if (key !== "api_key") {
      targetUrl.searchParams.set(key, value);
    }
  });

  // Prepare headers (exclude hop-by-hop and our custom headers)
  const headersToExclude = new Set([
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "x-api-key",
  ]);

  const forwardHeaders = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    if (!headersToExclude.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });

  // Forward the request
  let response: Response;
  let statusCode: number;

  try {
    response = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers: forwardHeaders,
      body:
        c.req.method !== "GET" && c.req.method !== "HEAD"
          ? await c.req.raw.clone().arrayBuffer()
          : undefined,
    });
    statusCode = response.status;
  } catch (error) {
    console.error("Proxy error:", error);
    return c.json(
      {
        success: false,
        error: "Failed to reach target API",
        code: "PROXY_ERROR",
      },
      502
    );
  }

  // Deduct from user balance
  await db
    .update(users)
    .set({
      balanceSats: user[0].balanceSats - costSats,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user[0].id));

  // Credit developer
  const developer = await db
    .select()
    .from(developers)
    .where(eq(developers.id, gateway[0].developerId))
    .limit(1);

  if (developer.length > 0) {
    await db
      .update(developers)
      .set({
        balanceSats: developer[0].balanceSats + fees.devEarnings,
        updatedAt: new Date(),
      })
      .where(eq(developers.id, developer[0].id));
  }

  // Log request
  await db.insert(requests).values({
    id: nanoid(),
    gatewayId: gateway[0].id,
    userId: user[0].id,
    costSats: fees.totalCost,
    devEarningsSats: fees.devEarnings,
    platformFeeSats: fees.platformFee,
    method: c.req.method,
    path: pathAfterGateway || "/",
    statusCode,
  });

  // Build response with balance headers
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set(
    "X-Balance-Remaining",
    String(user[0].balanceSats - costSats)
  );
  responseHeaders.set("X-Request-Cost", String(costSats));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
});

export default app;
