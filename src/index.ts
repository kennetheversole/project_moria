import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getDb } from "./db";
import { rateLimit } from "./middleware/rateLimit";
import developersRoutes from "./routes/developers";
import gatewaysRoutes from "./routes/gateways";
import sessionsRoutes from "./routes/sessions";
import proxyRoutes from "./routes/proxy";
import type { Env } from "./types";
import { ApiInfoResponseSchema, HealthResponseSchema } from "./schemas";

const app = new OpenAPIHono<{ Bindings: Env }>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: result.error.format() }, 400);
    }
  },
});

// Global middleware
app.use("*", logger());
app.use("*", async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.CORS_ORIGIN || "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Session-Key"],
  });
  return corsMiddleware(c, next);
});

// Rate limiting (100 requests/minute per IP)
app.use("/api/*", rateLimit({ windowMs: 60_000, max: 100 }));
app.use("/g/*", rateLimit({ windowMs: 60_000, max: 200 })); // Higher limit for proxy

// Register security schemes
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "JWT token for developer authentication",
});

app.openAPIRegistry.registerComponent("securitySchemes", "sessionKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "X-Session-Key",
  description: "Session key for anonymous session authentication",
});

// OpenAPI documentation
app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "Project Moria - Lightning API Gateway",
    version: "1.0.0",
    description:
      "A Lightning-powered API gateway platform that allows developers to monetize their APIs with Bitcoin Lightning payments.",
  },
  servers: [
    {
      url: "/",
      description: "Current server",
    },
  ],
  tags: [
    { name: "Info", description: "API information and health checks" },
    { name: "Developers", description: "Developer authentication and management" },
    { name: "Gateways", description: "API gateway management" },
    { name: "Sessions", description: "Anonymous session and balance management" },
  ],
});

// Swagger UI
app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));

// API info route
const apiInfoRoute = createRoute({
  method: "get",
  path: "/api",
  tags: ["Info"],
  summary: "API information",
  description: "Get basic information about the API and available endpoints.",
  responses: {
    200: {
      description: "API information",
      content: {
        "application/json": {
          schema: ApiInfoResponseSchema,
        },
      },
    },
  },
});

app.openapi(apiInfoRoute, (c) => {
  const dbAvailable = !!getDb(c.env.DB, c.env.DATABASE_URL, c.env.HYPERDRIVE);

  return c.json({
    name: "Project Moria - Lightning API Gateway",
    version: "1.0.0",
    status: "ok",
    database: dbAvailable ? "connected" : "not configured",
    endpoints: {
      developers: "/api/developers",
      gateways: "/api/gateways",
      sessions: "/api/sessions",
      proxy: "/g/:gatewayId/*",
    },
  });
});

// Health check route
const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  tags: ["Info"],
  summary: "Health check",
  description: "Check the health status of the API and database connection.",
  responses: {
    200: {
      description: "Health status",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

app.openapi(healthRoute, (c) => {
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
app.route("/api/sessions", sessionsRoutes);
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
