/**
 * Fixed-window in-memory rate limiter. Good for a single instance; login brute force is
 * additionally protected by a per-account lockout stored in the database (survives restarts
 * and works across instances). Replace with Redis/Upstash if you scale horizontally.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count++;
  if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  return b.count > limit ? { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) } : { ok: true, retryAfterSec: 0 };
}
