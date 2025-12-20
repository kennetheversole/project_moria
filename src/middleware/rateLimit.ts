import type { Context, Next } from "hono";

// Simple in-memory rate limiter
// Note: In production with multiple Workers, use Cloudflare Rate Limiting or Durable Objects
const requests = new Map<string, { count: number; resetAt: number }>();

interface RateLimitOptions {
  windowMs?: number;  // Time window in ms (default: 60000 = 1 minute)
  max?: number;       // Max requests per window (default: 100)
}

export function rateLimit(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs || 60_000;
  const max = options.max || 100;

  return async (c: Context, next: Next) => {
    // Use IP + path as key
    const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();

    let record = requests.get(key);

    // Reset if window expired
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      requests.set(key, record);
    }

    record.count++;

    // Set headers
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, max - record.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(record.resetAt / 1000)));

    if (record.count > max) {
      return c.json(
        {
          success: false,
          error: "Too many requests. Please slow down.",
          retryAfter: Math.ceil((record.resetAt - now) / 1000),
        },
        429
      );
    }

    // Cleanup old entries periodically (every 100 requests)
    if (Math.random() < 0.01) {
      for (const [k, v] of requests.entries()) {
        if (now > v.resetAt) {
          requests.delete(k);
        }
      }
    }

    await next();
  };
}
