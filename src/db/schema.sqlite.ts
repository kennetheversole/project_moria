import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";

// Developers - people selling APIs
export const developers = sqliteTable("developers", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  lightningAddress: text("lightning_address"),
  balanceSats: integer("balance_sats").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Gateways - the APIs (URL + pricing)
export const gateways = sqliteTable(
  "gateways",
  {
    id: text("id").primaryKey(),
    developerId: text("developer_id").notNull().references(() => developers.id),
    name: text("name").notNull(),
    targetUrl: text("target_url").notNull(),
    pricePerRequestSats: integer("price_per_request_sats").notNull().default(1),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("gateways_developer_idx").on(table.developerId)]
);

// Users - people buying access (API key + balance)
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    apiKey: text("api_key").notNull().unique(),
    balanceSats: integer("balance_sats").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("users_api_key_idx").on(table.apiKey)]
);

// Top-ups - Lightning payment tracking
export const topups = sqliteTable(
  "topups",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    amountSats: integer("amount_sats").notNull(),
    paymentHash: text("payment_hash"),
    invoiceId: text("invoice_id"),
    status: text("status").notNull().default("pending"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    paidAt: integer("paid_at", { mode: "timestamp" }),
  },
  (table) => [
    index("topups_user_idx").on(table.userId),
    index("topups_payment_hash_idx").on(table.paymentHash),
  ]
);

// Requests - for logging/metering
export const requests = sqliteTable(
  "requests",
  {
    id: text("id").primaryKey(),
    gatewayId: text("gateway_id").notNull().references(() => gateways.id),
    userId: text("user_id").notNull().references(() => users.id),
    costSats: integer("cost_sats").notNull(),
    devEarningsSats: integer("dev_earnings_sats").notNull(),
    platformFeeSats: integer("platform_fee_sats").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("requests_gateway_idx").on(table.gatewayId),
    index("requests_user_idx").on(table.userId),
    index("requests_created_idx").on(table.createdAt),
  ]
);

// Payouts - developer withdrawal tracking
export const payouts = sqliteTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    developerId: text("developer_id").notNull().references(() => developers.id),
    amountSats: integer("amount_sats").notNull(),
    lightningAddress: text("lightning_address").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [index("payouts_developer_idx").on(table.developerId)]
);

// Type exports
export type Developer = typeof developers.$inferSelect;
export type NewDeveloper = typeof developers.$inferInsert;
export type Gateway = typeof gateways.$inferSelect;
export type NewGateway = typeof gateways.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Topup = typeof topups.$inferSelect;
export type NewTopup = typeof topups.$inferInsert;
export type Request = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
export type Payout = typeof payouts.$inferSelect;
export type NewPayout = typeof payouts.$inferInsert;
