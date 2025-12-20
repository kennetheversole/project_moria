import { z } from "@hono/zod-openapi";

// Common schemas
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

export const SuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

// Developer schemas
export const DeveloperRegisterRequestSchema = z.object({
  email: z.string().email().openapi({ example: "dev@example.com" }),
  password: z.string().min(8).openapi({ example: "securepassword123" }),
  name: z.string().optional().openapi({ example: "John Doe" }),
  lightningAddress: z.string().optional().openapi({ example: "john@getalby.com" }),
});

export const DeveloperLoginRequestSchema = z.object({
  email: z.string().email().openapi({ example: "dev@example.com" }),
  password: z.string().openapi({ example: "securepassword123" }),
});

export const DeveloperAuthResponseSchema = z.object({
  id: z.string().openapi({ example: "abc123" }),
  email: z.string().email().openapi({ example: "dev@example.com" }),
  name: z.string().nullable().openapi({ example: "John Doe" }),
  token: z.string().openapi({ example: "eyJhbGciOiJIUzI1NiIs..." }),
});

export const DeveloperProfileResponseSchema = z.object({
  id: z.string().openapi({ example: "abc123" }),
  email: z.string().email().openapi({ example: "dev@example.com" }),
  name: z.string().nullable().openapi({ example: "John Doe" }),
  lightningAddress: z.string().nullable().openapi({ example: "john@getalby.com" }),
  balanceSats: z.number().openapi({ example: 1000 }),
  gatewayCount: z.number().openapi({ example: 3 }),
  createdAt: z.string().or(z.date()).openapi({ example: "2024-01-01T00:00:00Z" }),
});

export const DeveloperUpdateRequestSchema = z.object({
  name: z.string().optional().openapi({ example: "Jane Doe" }),
  lightningAddress: z.string().optional().openapi({ example: "jane@getalby.com" }),
});

export const PayoutRequestSchema = z.object({
  amountSats: z.number().min(1).openapi({ example: 500 }),
});

export const PayoutResponseSchema = z.object({
  payoutId: z.string().openapi({ example: "payout_abc123" }),
  amountSats: z.number().openapi({ example: 500 }),
  paymentHash: z.string().openapi({ example: "abc123def456..." }),
  newBalance: z.number().openapi({ example: 500 }),
});

// Gateway schemas
export const GatewayCreateRequestSchema = z.object({
  name: z.string().openapi({ example: "My API Gateway" }),
  targetUrl: z.string().url().openapi({ example: "https://api.example.com" }),
  pricePerRequestSats: z.number().optional().default(1).openapi({ example: 1 }),
  description: z.string().optional().openapi({ example: "A gateway for my API" }),
});

export const GatewayResponseSchema = z.object({
  id: z.string().openapi({ example: "gw_abc123" }),
  name: z.string().openapi({ example: "My API Gateway" }),
  targetUrl: z.string().openapi({ example: "https://api.example.com" }),
  pricePerRequestSats: z.number().openapi({ example: 1 }),
  proxyUrl: z.string().openapi({ example: "/g/gw_abc123" }),
});

export const GatewayListItemSchema = z.object({
  id: z.string().openapi({ example: "gw_abc123" }),
  name: z.string().openapi({ example: "My API Gateway" }),
  targetUrl: z.string().openapi({ example: "https://api.example.com" }),
  pricePerRequestSats: z.number().openapi({ example: 1 }),
  isActive: z.boolean().openapi({ example: true }),
  description: z.string().nullable().openapi({ example: "A gateway for my API" }),
  proxyUrl: z.string().openapi({ example: "/g/gw_abc123" }),
  createdAt: z.string().or(z.date()).openapi({ example: "2024-01-01T00:00:00Z" }),
});

export const GatewayDetailResponseSchema = z.object({
  id: z.string().openapi({ example: "gw_abc123" }),
  developerId: z.string().openapi({ example: "dev_abc123" }),
  name: z.string().openapi({ example: "My API Gateway" }),
  targetUrl: z.string().openapi({ example: "https://api.example.com" }),
  pricePerRequestSats: z.number().openapi({ example: 1 }),
  isActive: z.boolean().openapi({ example: true }),
  description: z.string().nullable().openapi({ example: "A gateway for my API" }),
  proxyUrl: z.string().openapi({ example: "/g/gw_abc123" }),
  createdAt: z.string().or(z.date()).openapi({ example: "2024-01-01T00:00:00Z" }),
  updatedAt: z.string().or(z.date()).nullable().openapi({ example: "2024-01-02T00:00:00Z" }),
  stats: z.object({
    totalRequests: z.number().openapi({ example: 1000 }),
    totalEarnings: z.number().openapi({ example: 980 }),
  }),
});

export const GatewayUpdateRequestSchema = z.object({
  name: z.string().optional().openapi({ example: "Updated Gateway Name" }),
  targetUrl: z.string().url().optional().openapi({ example: "https://newapi.example.com" }),
  pricePerRequestSats: z.number().optional().openapi({ example: 2 }),
  description: z.string().optional().openapi({ example: "Updated description" }),
  isActive: z.boolean().optional().openapi({ example: true }),
});

export const GatewayIdParamSchema = z.object({
  id: z.string().openapi({ example: "gw_abc123", param: { name: "id", in: "path" } }),
});

// User schemas
export const UserRegisterRequestSchema = z.object({
  email: z.string().email().openapi({ example: "user@example.com" }),
});

export const UserRegisterResponseSchema = z.object({
  id: z.string().openapi({ example: "user_abc123" }),
  email: z.string().email().openapi({ example: "user@example.com" }),
  apiKey: z.string().openapi({ example: "mk_abc123def456..." }),
  balanceSats: z.number().openapi({ example: 0 }),
});

export const UserProfileResponseSchema = z.object({
  id: z.string().openapi({ example: "user_abc123" }),
  email: z.string().email().openapi({ example: "user@example.com" }),
  balanceSats: z.number().openapi({ example: 1000 }),
  createdAt: z.string().or(z.date()).openapi({ example: "2024-01-01T00:00:00Z" }),
});

export const TopupRequestSchema = z.object({
  amountSats: z.number().min(100).openapi({ example: 1000 }),
});

export const TopupResponseSchema = z.object({
  topupId: z.string().openapi({ example: "topup_abc123" }),
  amountSats: z.number().openapi({ example: 1000 }),
  paymentRequest: z.string().openapi({ example: "lnbc10u1p..." }),
  paymentHash: z.string().openapi({ example: "abc123def456..." }),
  expiresAt: z.string().openapi({ example: "2024-01-01T01:00:00Z" }),
});

export const TopupIdParamSchema = z.object({
  id: z.string().openapi({ example: "topup_abc123", param: { name: "id", in: "path" } }),
});

export const TopupStatusResponseSchema = z.object({
  id: z.string().openapi({ example: "topup_abc123" }),
  amountSats: z.number().openapi({ example: 1000 }),
  status: z.enum(["pending", "paid", "expired"]).openapi({ example: "pending" }),
  paidAt: z.string().or(z.date()).nullable().optional().openapi({ example: "2024-01-01T00:30:00Z" }),
  newBalance: z.number().optional().openapi({ example: 2000 }),
});

export const TopupListItemSchema = z.object({
  id: z.string().openapi({ example: "topup_abc123" }),
  amountSats: z.number().openapi({ example: 1000 }),
  status: z.enum(["pending", "paid", "expired"]).openapi({ example: "paid" }),
  createdAt: z.string().or(z.date()).openapi({ example: "2024-01-01T00:00:00Z" }),
  paidAt: z.string().or(z.date()).nullable().openapi({ example: "2024-01-01T00:30:00Z" }),
});

// Message response
export const MessageResponseSchema = z.object({
  message: z.string().openapi({ example: "Operation successful" }),
});

// API info schemas
export const ApiInfoResponseSchema = z.object({
  name: z.string().openapi({ example: "Project Moria - Lightning API Gateway" }),
  version: z.string().openapi({ example: "1.0.0" }),
  status: z.string().openapi({ example: "ok" }),
  database: z.string().openapi({ example: "connected" }),
  endpoints: z.object({
    developers: z.string().openapi({ example: "/api/developers" }),
    gateways: z.string().openapi({ example: "/api/gateways" }),
    users: z.string().openapi({ example: "/api/users" }),
    proxy: z.string().openapi({ example: "/g/:gatewayId/*" }),
  }),
});

export const HealthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded"]).openapi({ example: "healthy" }),
  database: z.string().openapi({ example: "connected" }),
  timestamp: z.string().openapi({ example: "2024-01-01T00:00:00Z" }),
});

// Auth header schema
export const AuthHeaderSchema = z.object({
  authorization: z.string().openapi({ example: "Bearer eyJhbGciOiJIUzI1NiIs..." }),
});

export const ApiKeyHeaderSchema = z.object({
  "x-api-key": z.string().openapi({ example: "mk_abc123def456..." }),
});
