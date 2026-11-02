// The rate-limit key of a client address: IPv4 as it is, IPv6 by its /64 (ticket 01 review
// round 2, finding 3).
import { describe, expect, it } from "vitest";
import { addressKey } from "./address-key.ts";

describe("addressKey", () => {
  it("keeps an IPv4 address as it is", () => {
    expect(addressKey("198.51.100.7")).toBe("198.51.100.7");
  });

  it("keys an IPv4-mapped IPv6 address as its IPv4 address", () => {
    expect(addressKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(addressKey("::FFFF:c633:6407")).toBe("198.51.100.7");
  });

  it("gives every address in one IPv6 /64 the same key", () => {
    const a = addressKey("2001:db8:1:2::1");
    expect(addressKey("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(a);
    expect(addressKey("2001:0DB8:0001:0002:abcd::9")).toBe(a);
    expect(a).toBe("2001:db8:1:2::/64");
  });

  it("gives addresses in different IPv6 /64s different keys", () => {
    expect(addressKey("2001:db8:1:2::1")).not.toBe(
      addressKey("2001:db8:1:3::1"),
    );
    expect(addressKey("::1")).toBe("0:0:0:0::/64");
  });

  it("keys an IPv6 address with an embedded IPv4 tail by its /64", () => {
    expect(addressKey("64:ff9b::198.51.100.7")).toBe("64:ff9b:0:0::/64");
  });

  it("keys an address with a zone by its /64", () => {
    expect(addressKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("keeps anything that is not an IP address as it is", () => {
    expect(addressKey("unknown")).toBe("unknown");
    expect(addressKey("")).toBe("");
  });
});
