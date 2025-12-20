-- Migration: Initial schema
-- Creates all tables for the Lightning API Gateway

-- Developers - people selling APIs
CREATE TABLE IF NOT EXISTS developers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  lightning_address TEXT,
  balance_sats INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Gateways - the APIs (URL + pricing)
CREATE TABLE IF NOT EXISTS gateways (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL REFERENCES developers(id),
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  price_per_request_sats INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS gateways_developer_idx ON gateways(developer_id);

-- Users - people buying access (API key + balance)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  api_key TEXT NOT NULL UNIQUE,
  balance_sats INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS users_api_key_idx ON users(api_key);

-- Top-ups - Lightning payment tracking
CREATE TABLE IF NOT EXISTS topups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount_sats INTEGER NOT NULL,
  payment_hash TEXT,
  invoice_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  paid_at INTEGER
);

CREATE INDEX IF NOT EXISTS topups_user_idx ON topups(user_id);
CREATE INDEX IF NOT EXISTS topups_payment_hash_idx ON topups(payment_hash);

-- Requests - for logging/metering
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  gateway_id TEXT NOT NULL REFERENCES gateways(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  cost_sats INTEGER NOT NULL,
  dev_earnings_sats INTEGER NOT NULL,
  platform_fee_sats INTEGER NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS requests_gateway_idx ON requests(gateway_id);
CREATE INDEX IF NOT EXISTS requests_user_idx ON requests(user_id);
CREATE INDEX IF NOT EXISTS requests_created_idx ON requests(created_at);

-- Payouts - developer withdrawal tracking
CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL REFERENCES developers(id),
  amount_sats INTEGER NOT NULL,
  lightning_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS payouts_developer_idx ON payouts(developer_id);
