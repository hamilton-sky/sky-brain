// The rate-limit key of a client address. One IPv6 customer usually holds a whole /64, so keying
// on the full address would give a caller about 2^64 fresh buckets: IPv6 is keyed by its /64.
import { isIP } from "node:net";

/** IPv4 as it is (an IPv4-mapped IPv6 address too); IPv6 as `a:b:c:d::/64`; anything else as is. */
export function addressKey(ip: string): string {
  if (isIP(ip) === 4) return ip;
  const bare = ip.split("%")[0]!;
  if (isIP(bare) !== 6) return ip;
  const groups = ipv6Groups(bare);
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi, lo] = [groups[6]!, groups[7]!];
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address (`isIP` already said it is one). */
function ipv6Groups(ip: string): number[] {
  const toGroups = (part: string): number[] => {
    if (part === "") return [];
    return part.split(":").flatMap((g) => {
      if (!g.includes(".")) return [parseInt(g, 16)];
      const [a, b, c, d] = g.split(".").map(Number) as [
        number,
        number,
        number,
        number,
      ];
      return [(a << 8) | b, (c << 8) | d];
    });
  };
  const [head = "", tail] = ip.split("::");
  const front = toGroups(head);
  if (tail === undefined) return front;
  const back = toGroups(tail);
  return [
    ...front,
    ...Array<number>(8 - front.length - back.length).fill(0),
    ...back,
  ];
}
