import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./ratelimit.ts";

// spec.md Decisions -> Rate limit per actor, in memory: a token bucket per key.
// The clock is injected (milliseconds), so refill is tested without sleeping.

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(seconds: number) {
      t += seconds * 1000;
    },
  };
}

describe("createRateLimiter", () => {
  it("refuses a burst over capacity with retryAfterSeconds", () => {
    const c = clock();
    const limiter = createRateLimiter({
      capacity: 3,
      refillPerSecond: 1,
      now: c.now,
    });
    expect(limiter.take("human:a")).toEqual({ ok: true });
    expect(limiter.take("human:a")).toEqual({ ok: true });
    expect(limiter.take("human:a")).toEqual({ ok: true });
    expect(limiter.take("human:a")).toEqual({
      ok: false,
      retryAfterSeconds: 1,
    });
  });

  it("gives whole seconds until one token is back, at least 1", () => {
    const c = clock();
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerSecond: 0.1,
      now: c.now,
    });
    expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("k")).toEqual({ ok: false, retryAfterSeconds: 10 });
    c.advance(2.5);
    expect(limiter.take("k")).toEqual({ ok: false, retryAfterSeconds: 8 });
    c.advance(7.4);
    expect(limiter.take("k")).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it("refills after the clock moves", () => {
    const c = clock();
    const limiter = createRateLimiter({
      capacity: 2,
      refillPerSecond: 1,
      now: c.now,
    });
    expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("k").ok).toBe(false);
    c.advance(1);
    expect(limiter.take("k")).toEqual({ ok: true });
    expect(limiter.take("k").ok).toBe(false);
    // Refill never goes above capacity.
    c.advance(100);
    expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("k").ok).toBe(false);
  });

  it("keeps actors apart", () => {
    const c = clock();
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerSecond: 1,
      now: c.now,
    });
    expect(limiter.take("human:a").ok).toBe(true);
    expect(limiter.take("human:a").ok).toBe(false);
    expect(limiter.take("agent:x:a")).toEqual({ ok: true });
    expect(limiter.take("human:b")).toEqual({ ok: true });
    expect(limiter.take("human:a").ok).toBe(false);
  });

  it("defaults to 60 writes refilling 1 per second", () => {
    const c = clock();
    const limiter = createRateLimiter({ now: c.now });
    for (let i = 0; i < 60; i += 1) expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("k")).toEqual({ ok: false, retryAfterSeconds: 1 });
    c.advance(1);
    expect(limiter.take("k").ok).toBe(true);
  });

  it("works with the real clock when none is given", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
    expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("k").ok).toBe(false);
  });

  it("drops buckets that have been full for over ten minutes, on access", () => {
    const c = clock();
    const limiter = createRateLimiter({
      capacity: 2,
      refillPerSecond: 1,
      now: c.now,
    });
    limiter.take("old");
    limiter.take("busy");
    limiter.take("busy");
    expect(limiter.size()).toBe(2);
    // "old" is full again after 1 s; ten minutes later it is still kept.
    c.advance(1 + 600);
    limiter.take("busy");
    expect(limiter.size()).toBe(2);
    // Past ten minutes full, the next access drops both idle buckets (and keeps the one used now).
    c.advance(602);
    limiter.take("new");
    expect(limiter.size()).toBe(1);
    // A dropped key starts again with a full bucket.
    expect(limiter.take("old")).toEqual({ ok: true });
    expect(limiter.take("old")).toEqual({ ok: true });
    expect(limiter.take("old").ok).toBe(false);
  });

  it("does not refill twice when the clock steps backwards", () => {
    const c = clock();
    const limiter = createRateLimiter({
      capacity: 2,
      refillPerSecond: 1,
      now: c.now,
    });
    expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("k").ok).toBe(true);
    c.advance(-5);
    expect(limiter.take("k").ok).toBe(false);
    // Back where it was: no time has really passed, so no token is back.
    c.advance(5);
    expect(limiter.take("k").ok).toBe(false);
    c.advance(1);
    expect(limiter.take("k")).toEqual({ ok: true });
  });

  it("sweeps idle buckets at most once a minute", () => {
    const c = clock();
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerSecond: 1,
      now: c.now,
    });
    limiter.take("a"); // sweeps (the first take), a is full again 1 s later
    c.advance(30);
    limiter.take("b"); // under a minute since the last sweep: no sweep
    c.advance(601 - 30);
    limiter.take("c"); // sweeps: a has been full for 600 s, not over ten minutes
    expect(limiter.size()).toBe(3);
    c.advance(30);
    limiter.take("c"); // a is past ten minutes, but the last sweep was 30 s ago
    expect(limiter.size()).toBe(3);
    c.advance(30);
    limiter.take("c"); // a minute since the last sweep: a and b go
    expect(limiter.size()).toBe(1);
  });

  it("refuses options that cannot make a bucket", () => {
    expect(() => createRateLimiter({ capacity: 0 })).toThrow(/capacity/);
    expect(() => createRateLimiter({ capacity: 1.5 })).toThrow(/capacity/);
    expect(() => createRateLimiter({ refillPerSecond: 0 })).toThrow(
      /refillPerSecond/,
    );
    expect(() => createRateLimiter({ refillPerSecond: Number.NaN })).toThrow(
      /refillPerSecond/,
    );
  });
});
