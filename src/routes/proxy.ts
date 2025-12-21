import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { gateways, sessions, developers, requests } from "../db/schema";
import { requireDb } from "../db";
import { calculateFees, getPlatformFeePercent } from "../services/billing";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

// Check if request is from a browser
function isBrowserRequest(acceptHeader: string | undefined): boolean {
  return !!acceptHeader?.includes("text/html");
}

// Generate 402 Payment Required HTML page
function generate402Page(gatewayName: string, pricePerRequest: number, gatewayId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>402 Payment Required - ${gatewayName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }
    .container {
      max-width: 500px;
      padding: 2rem;
      text-align: center;
    }
    .lightning-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 { font-size: 3rem; margin-bottom: 0.5rem; color: #f7931a; }
    h2 { font-size: 1.5rem; margin-bottom: 1.5rem; font-weight: 400; opacity: 0.9; }
    .card {
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 2rem;
      margin: 1.5rem 0;
      backdrop-filter: blur(10px);
    }
    .price {
      font-size: 2.5rem;
      font-weight: bold;
      color: #f7931a;
    }
    .price-label { opacity: 0.7; margin-top: 0.5rem; }
    .steps {
      text-align: left;
      margin-top: 1.5rem;
    }
    .step {
      display: flex;
      align-items: flex-start;
      margin-bottom: 1rem;
    }
    .step-num {
      background: #f7931a;
      color: #000;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 0.8rem;
      margin-right: 1rem;
      flex-shrink: 0;
    }
    code {
      background: rgba(0,0,0,0.3);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    .api-url {
      background: rgba(0,0,0,0.3);
      padding: 1rem;
      border-radius: 8px;
      margin-top: 1rem;
      word-break: break-all;
      font-family: monospace;
      font-size: 0.85rem;
    }
    a { color: #f7931a; }
  </style>
</head>
<body>
  <div class="container">
    <div class="lightning-icon">&#9889;</div>
    <h1>402</h1>
    <h2>Payment Required</h2>
    <div class="card">
      <div>Access to <strong>${gatewayName}</strong></div>
      <div class="price">${pricePerRequest} sat${pricePerRequest !== 1 ? 's' : ''}</div>
      <div class="price-label">per request</div>
    </div>
    <div class="card">
      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div>Create a top-up at <code>/api/sessions/topup</code></div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div>Pay the Lightning invoice to get your session key</div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div>Add <code>X-Session-Key</code> header or <code>?session_key=</code> param</div>
        </div>
      </div>
      <div class="api-url">GET /g/${gatewayId}/*</div>
    </div>
    <p style="opacity: 0.6; margin-top: 1rem;">Powered by Lightning Network</p>
  </div>
</body>
</html>`;
}

// Proxy all requests to /g/:gatewayId/*
app.all("/:gatewayId/*", async (c) => {
  const db = requireDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);
  const gatewayId = c.req.param("gatewayId");
  const acceptHeader = c.req.header("Accept");
  const isBrowser = isBrowserRequest(acceptHeader);

  // Get session key from header or query
  const sessionKey = c.req.header("X-Session-Key") || c.req.query("session_key");

  if (!sessionKey) {
    // Look up gateway for 402 page info
    if (isBrowser) {
      const gateway = await db
        .select()
        .from(gateways)
        .where(eq(gateways.id, gatewayId))
        .limit(1);

      if (gateway.length > 0) {
        return c.html(generate402Page(gateway[0].name, gateway[0].pricePerRequestSats, gatewayId), 402);
      }
    }

    return c.json(
      {
        success: false,
        error: "Session key required",
        code: "AUTH_REQUIRED",
      },
      401
    );
  }

  // Look up session
  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionKey, sessionKey))
    .limit(1);

  if (session.length === 0) {
    return c.json(
      {
        success: false,
        error: "Invalid session key",
        code: "INVALID_SESSION_KEY",
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
  if (session[0].balanceSats < costSats) {
    if (isBrowser) {
      return c.html(generate402Page(gateway[0].name, gateway[0].pricePerRequestSats, gatewayId), 402);
    }
    return c.json(
      {
        success: false,
        error: "Insufficient balance. Please top up.",
        code: "INSUFFICIENT_BALANCE",
        balanceSats: session[0].balanceSats,
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
    if (key !== "session_key") {
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
    "x-session-key",
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

  // Deduct from session balance
  await db
    .update(sessions)
    .set({
      balanceSats: session[0].balanceSats - costSats,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, session[0].id));

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
    sessionId: session[0].id,
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
    String(session[0].balanceSats - costSats)
  );
  responseHeaders.set("X-Request-Cost", String(costSats));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
});

export default app;
