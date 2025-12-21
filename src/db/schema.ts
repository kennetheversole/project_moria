import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  bigint,
  index,
} from "drizzle-orm/pg-core";

// Developers - people selling APIs
export const developers = pgTable("developers", {
  id: text("id").primaryKey(), // nanoid
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  lightningAddress: text("lightning_address"), // For payouts
  balanceSats: bigint("balance_sats", { mode: "number" }).notNull().default(0), // Accumulated earnings
  createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
});

// Gateways - the APIs (URL + pricing)
export const gateways = pgTable(
  "gateways",
  {
    id: text("id").primaryKey(), // nanoid - used in URL: /g/{id}/...
    developerId: text("developer_id")
      .notNull()
      .references(() => developers.id),
    name: text("name").notNull(),
    targetUrl: text("target_url").notNull(), // The actual API URL to proxy to
    pricePerRequestSats: integer("price_per_request_sats").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("gateways_developer_idx").on(table.developerId)]
);

// Sessions - anonymous pay-and-go access (session key + balance)
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // nanoid
    sessionKey: text("session_key").notNull().unique(), // sk_xxx - used for authentication
    balanceSats: bigint("balance_sats", { mode: "number" }).notNull().default(0), // Prepaid credits
    createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("sessions_key_idx").on(table.sessionKey)]
);

// Top-ups - Lightning payment tracking
export const topups = pgTable(
  "topups",
  {
    id: text("id").primaryKey(), // nanoid
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    amountSats: integer("amount_sats").notNull(),
    paymentHash: text("payment_hash"), // Lightning invoice payment hash
    invoiceId: text("invoice_id"), // Alby invoice ID
    status: text("status").notNull().default("pending"), // pending, paid, expired
    createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
    paidAt: timestamp("paid_at"),
  },
  (table) => [
    index("topups_session_idx").on(table.sessionId),
    index("topups_payment_hash_idx").on(table.paymentHash),
  ]
);

// Requests - for logging/metering
export const requests = pgTable(
  "requests",
  {
    id: text("id").primaryKey(), // nanoid
    gatewayId: text("gateway_id")
      .notNull()
      .references(() => gateways.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    costSats: integer("cost_sats").notNull(),
    devEarningsSats: integer("dev_earnings_sats").notNull(), // 95%
    platformFeeSats: integer("platform_fee_sats").notNull(), // 5%
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code"),
    createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("requests_gateway_idx").on(table.gatewayId),
    index("requests_session_idx").on(table.sessionId),
    index("requests_created_idx").on(table.createdAt),
  ]
);

// Payouts - developer withdrawal tracking
export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(), // nanoid
    developerId: text("developer_id")
      .notNull()
      .references(() => developers.id),
    amountSats: integer("amount_sats").notNull(),
    lightningAddress: text("lightning_address").notNull(),
    status: text("status").notNull().default("pending"), // pending, completed, failed
    createdAt: timestamp("created_at").notNull().$defaultFn(() => new Date()),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("payouts_developer_idx").on(table.developerId)]
);

// Type exports
export type Developer = typeof developers.$inferSelect;
export type NewDeveloper = typeof developers.$inferInsert;
export type Gateway = typeof gateways.$inferSelect;
export type NewGateway = typeof gateways.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Topup = typeof topups.$inferSelect;
export type NewTopup = typeof topups.$inferInsert;
export type Request = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
export type Payout = typeof payouts.$inferSelect;
export type NewPayout = typeof payouts.$inferInsert;
