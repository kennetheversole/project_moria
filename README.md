# Project Moria

Lightning-powered API gateway. Charge sats per request. No subscriptions, no credit cards.

## What is this?

A proxy that sits between users and your API. Users pay satoshis (via Lightning) for each request. Developers earn 98%, platform takes 2%.

```
User (has sats) → Moria Gateway → Your API
                      ↓
              Deduct sats, log request
              Credit developer balance
```

## Use Cases

- **Monetize APIs** - Charge per call without Stripe's 30¢ minimum
- **Gate content** - Articles, videos, data behind micropayments
- **AI agent payments** - Programmatic payments for autonomous agents (no KYC, instant, permissionless)
- **Global payments** - No bank account needed, works anywhere
- **Anti-abuse** - Real cost per request stops spam

## Features

- Pay-per-request billing (satoshis via Lightning)
- Developer dashboard with earnings tracking
- Anonymous sessions - no signup required, just pay and get a key
- Request logging and analytics
- 2% platform fee (configurable)
- **Auto-payouts** - Developers paid automatically every 5 minutes when balance ≥ 100 sats
- **Platform fee sweep** - Platform fees auto-sent to separate Lightning address
- **Nostr session storage** - Sessions synced via NIP-78 across devices
- **Browser 402 flow** - QR code payment page with auto-redirect on payment

## Tech Stack

- **Runtime**: Cloudflare Workers (portable to Deno, Fly.io, etc.)
- **Framework**: Hono
- **Database**: PlanetScale Postgres (via Hyperdrive) or D1 SQLite
- **ORM**: Drizzle
- **Payments**: Lightning via Alby

## Quick Start

```bash
# Install
pnpm install

# Set up environment
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your DATABASE_URL, JWT_SECRET, ALBY_API_KEY

# Run migrations
pnpm db:migrate:pg

# Start dev server
pnpm wrangler dev --remote
```

## API Endpoints

### Developers (sell APIs)

```bash
# Register
POST /api/developers/register
{"email": "dev@example.com", "password": "...", "name": "Dev Name"}

# Login
POST /api/developers/login
{"email": "dev@example.com", "password": "..."}

# Get profile
GET /api/developers/me
Authorization: Bearer <token>

# Update profile (set Lightning address for payouts)
PATCH /api/developers/me
{"lightningAddress": "dev@getalby.com"}

# Request payout
POST /api/developers/payout
{"amountSats": 1000}
```

### Gateways (your APIs)

```bash
# Create gateway
POST /api/gateways
Authorization: Bearer <token>
{"name": "My API", "targetUrl": "https://api.example.com", "pricePerRequestSats": 10}

# List gateways
GET /api/gateways

# Get gateway details + stats
GET /api/gateways/:id

# Update gateway
PATCH /api/gateways/:id
{"pricePerRequestSats": 20, "isActive": false}

# Delete gateway
DELETE /api/gateways/:id
```

### Sessions (consume APIs)

```bash
# Create top-up invoice (creates session automatically)
POST /api/sessions/topup
{"amountSats": 1000}
# Returns: {"sessionKey": "sk_xxx...", "paymentRequest": "lnbc1..."}

# Add to existing session
POST /api/sessions/topup
{"amountSats": 1000, "sessionKey": "sk_xxx..."}

# Get balance
GET /api/sessions/me
X-Session-Key: sk_xxx...

# Check payment status
GET /api/sessions/topup/:id
X-Session-Key: sk_xxx...

# List all top-ups
GET /api/sessions/topups
X-Session-Key: sk_xxx...
```

### Proxy (use gated APIs)

```bash
# Make request through gateway
GET /g/:gatewayId/any/path/here
X-Session-Key: sk_xxx...

# Or use query parameter
GET /g/:gatewayId/any/path/here?session_key=sk_xxx...

# Response includes headers:
# X-Balance-Remaining: 990
# X-Request-Cost: 10
```

## Example Flow

```bash
# 1. Developer creates account
curl -X POST http://localhost:8787/api/developers/register \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@test.com","password":"secret","name":"Dev"}'

# 2. Developer creates a gateway
curl -X POST http://localhost:8787/api/gateways \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Weather API","targetUrl":"https://api.weather.com","pricePerRequestSats":5}'
# Returns: {"id": "abc123", "proxyUrl": "/g/abc123"}

# 3. User creates a top-up (no registration needed!)
curl -X POST http://localhost:8787/api/sessions/topup \
  -H "Content-Type: application/json" \
  -d '{"amountSats": 1000}'
# Returns: {"sessionKey": "sk_xxx...", "paymentRequest": "lnbc1..."}
# Pay the Lightning invoice with any wallet

# 4. Check payment status
curl http://localhost:8787/api/sessions/topup/<topupId> \
  -H "X-Session-Key: sk_xxx..."
# Returns: {"status": "paid", "newBalance": 1000}

# 5. User makes API requests
curl http://localhost:8787/g/abc123/weather?city=london \
  -H "X-Session-Key: sk_xxx..."
# Proxies to https://api.weather.com/weather?city=london
# Deducts 5 sats from session, credits developer
```

## Configuration

Environment variables (`.dev.vars` or Cloudflare dashboard):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Secret for signing developer tokens |
| `ALBY_API_KEY` | Alby API key for Lightning payments |
| `PLATFORM_FEE_PERCENT` | Fee percentage (default: 2) |
| `PLATFORM_LIGHTNING_ADDRESS` | Lightning address for platform fee sweeps |

## Database Schema

```
developers      - API sellers (email, password, balance, lightning_address)
gateways        - APIs to proxy (target_url, price_per_request, developer_id)
sessions        - Anonymous API consumers (session_key, balance)
topups          - Lightning payment tracking
requests        - Usage logs (gateway, session, cost, method, path)
payouts         - Developer withdrawal history (includes is_auto_payout flag)
platform_sweeps - Platform fee payout tracking
```

## Auto-Payouts (Cron Job)

Every 5 minutes, a scheduled job runs:

1. **Platform Fee Sweep**: If accumulated platform fees ≥ 100 sats, sends to `PLATFORM_LIGHTNING_ADDRESS`
2. **Developer Auto-Payouts**: Any developer with balance ≥ 100 sats and a Lightning address set gets paid automatically

This creates an "instant payout" experience - developers don't need to manually withdraw.

## Browser 402 Flow

When a browser hits a gateway without a session:

1. Shows a QR code payment page
2. Creates a temporary session + invoice
3. Polls for payment confirmation
4. Auto-redirects with `?session_key=xxx` on payment
5. Session persists via Nostr (NIP-78) for cross-device sync

## Deployment

```bash
# Deploy to Cloudflare Workers
pnpm wrangler deploy --env production

# Set secrets
pnpm wrangler secret put DATABASE_URL --env production
pnpm wrangler secret put JWT_SECRET --env production
pnpm wrangler secret put ALBY_API_KEY --env production
pnpm wrangler secret put PLATFORM_LIGHTNING_ADDRESS --env production
```

## Economics

- **Platform fee**: 2% (minimum 1 sat)
- **Developer earnings**: 98%
- **User cost**: Set by developer per gateway

At 1 sat ≈ $0.001:
- 5 sat request = $0.005 (half a cent)
- Stripe would charge 30¢+ for the same transaction
- Break-even: ~20,000 requests/month covers infra ($20)

## Local Development

```bash
# Use local SQLite (D1)
pnpm db:local
pnpm dev

# Or use remote Postgres
pnpm wrangler dev --remote
```

## Scripts

```bash
pnpm dev              # Start local dev server
pnpm test:run         # Run tests
pnpm typecheck        # TypeScript check
pnpm db:generate      # Generate migrations
pnpm db:migrate:pg    # Apply migrations to Postgres
pnpm db:local         # Apply migrations to local D1
pnpm db:studio        # Open Drizzle Studio
```

## AI Agent Payments

Moria is ideal for autonomous AI agents that need to pay for services:

- **No KYC** - Agents can't do identity verification
- **Programmatic** - Just API calls, no card forms
- **Micropayments** - Pay per token, per call, per action
- **Instant** - Sub-second settlement
- **Permissionless** - No signup, no approval needed

With Nostr integration, agents can have identity (npub) + money (Lightning) without human involvement.

## License

MIT
