// The per-actor write rate limit (spec.md Decisions -> Rate limit per actor, in memory):
// a token bucket per key, in memory, for one server instance.

export type TakeResult =
  { ok: true } | { ok: false; retryAfterSeconds: number };

export type RateLimiter = {
  /** Takes one token from `key`'s bucket. */
  take(key: string): TakeResult;
  /** How many buckets are held now. */
  size(): number;
};

export type RateLimiterOptions = {
  /** Most tokens a bucket holds, and the burst a new key gets (default 60). */
  capacity?: number;
  /** Tokens added per second (default 1). */
  refillPerSecond?: number;
  /** The clock in milliseconds (default Date.now). */
  now?: () => number;
};

/** A bucket that has been full this long is dropped on the next access. */
const IDLE_MS = 10 * 60 * 1000;

type Bucket = { tokens: number; at: number };

export function createRateLimiter(
  options: RateLimiterOptions = {},
): RateLimiter {
  const { capacity = 60, refillPerSecond = 1, now = Date.now } = options;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(
      `rate limiter: capacity must be a whole number of at least 1, got ${capacity}`,
    );
  }
  if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
    throw new Error(
      `rate limiter: refillPerSecond must be a positive number, got ${refillPerSecond}`,
    );
  }

  const buckets = new Map<string, Bucket>();

  function refill(bucket: Bucket, t: number): void {
    const elapsed = Math.max(0, t - bucket.at) / 1000;
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + elapsed * refillPerSecond,
    );
    bucket.at = t;
  }

  /** When the bucket is (or was) full again, in ms. */
  function fullAt(bucket: Bucket): number {
    return bucket.at + ((capacity - bucket.tokens) / refillPerSecond) * 1000;
  }

  function dropIdle(t: number): void {
    for (const [key, bucket] of buckets) {
      if (t - fullAt(bucket) > IDLE_MS) buckets.delete(key);
    }
  }

  return {
    take(key) {
      const t = now();
      dropIdle(t);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: capacity, at: t };
        buckets.set(key, bucket);
      }
      refill(bucket, t);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { ok: true };
      }
      const seconds = (1 - bucket.tokens) / refillPerSecond;
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(seconds)) };
    },
    size() {
      return buckets.size;
    },
  };
}
