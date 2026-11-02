// A fixed-window limit per key, in memory, for one server instance: at most `limit` takes in the
// `windowMs` that starts at a key's first take. Device approval uses it, because the spec counts
// "5 per 15 minutes", which a refilling token bucket does not hold to.
import type { RateLimiter, TakeResult } from "../guards/ratelimit.ts";

export type WindowLimiterOptions = {
  limit: number;
  windowMs: number;
  /** The clock in milliseconds. */
  now: () => number;
};

type Window = { start: number; count: number };

/** Ended windows are looked for at most this often, so a take does not walk every key. */
const SWEEP_MS = 60 * 1000;

export function createWindowLimiter(
  options: WindowLimiterOptions,
): RateLimiter {
  const { limit, windowMs, now } = options;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `window limiter: limit must be a whole number of at least 1, got ${limit}`,
    );
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(
      `window limiter: windowMs must be a positive number, got ${windowMs}`,
    );
  }
  const windows = new Map<string, Window>();
  let lastSweep = -Infinity;

  function sweep(t: number): void {
    if (t >= lastSweep && t - lastSweep < SWEEP_MS) return;
    lastSweep = t;
    for (const [key, w] of windows) {
      if (t - w.start >= windowMs) windows.delete(key);
    }
  }

  return {
    take(key): TakeResult {
      const t = now();
      sweep(t);
      let w = windows.get(key);
      // A clock that steps backwards before the start keeps the window (no free reset).
      if (!w || t - w.start >= windowMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      if (w.count < limit) {
        w.count += 1;
        return { ok: true };
      }
      const ms = w.start + windowMs - t;
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)),
      };
    },
    size() {
      return windows.size;
    },
  };
}
