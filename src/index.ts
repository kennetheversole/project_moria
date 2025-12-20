import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getDb } from "./db";
import { rateLimit } from "./middleware/rateLimit";
import developersRoutes from "./routes/developers";
import gatewaysRoutes from "./routes/gateways";
import usersRoutes from "./routes/users";
import proxyRoutes from "./routes/proxy";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", logger());
app.use("*", async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.CORS_ORIGIN || "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  });
  return corsMiddleware(c, next);
});

// Rate limiting (100 requests/minute per IP)
app.use("/api/*", rateLimit({ windowMs: 60_000, max: 100 }));
app.use("/g/*", rateLimit({ windowMs: 60_000, max: 200 })); // Higher limit for proxy

// API info (static index.html serves at /)
app.get("/api", (c) => {
  const dbAvailable = !!getDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  return c.json({
    name: "Project Moria - Lightning API Gateway",
    version: "1.0.0",
    status: "ok",
    database: dbAvailable ? "connected" : "not configured",
    endpoints: {
      developers: "/api/developers",
      gateways: "/api/gateways",
      users: "/api/users",
      proxy: "/g/:gatewayId/*",
    },
  });
});

// Health check endpoint
app.get("/api/health", (c) => {
  const dbAvailable = !!getDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  return c.json({
    status: dbAvailable ? "healthy" : "degraded",
    database: dbAvailable ? "connected" : "not configured",
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
app.route("/api/developers", developersRoutes);
app.route("/api/gateways", gatewaysRoutes);
app.route("/api/users", usersRoutes);
app.route("/g", proxyRoutes);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: "Not found",
    },
    404
  );
});

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);

  // Handle database not configured
  if (err.message.includes("Database not configured")) {
    return c.json(
      {
        success: false,
        error: "Service temporarily unavailable - database not configured",
      },
      503
    );
  }

  return c.json(
    {
      success: false,
      error: "Internal server error",
    },
    500
  );
});

export default app;
