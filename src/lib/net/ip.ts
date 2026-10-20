/// Classifies resolved IP addresses for outbound requests. Pure (no I/O), so
/// it is fully unit-tested. Anything that does not parse as a canonical
/// IPv4/IPv6 address is treated as NOT routable (fail closed).

type V4 = [number, number, number, number];

/// Strict dotted-decimal only: four parts, 0-255, no leading zeros, no
/// shorthand ("127.1"), hex ("0x7f.0.0.1") or integer ("2130706433") forms.
export function parseIPv4(text: string): V4 | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out as V4;
}

/// 16 bytes, or null. Supports "::" compression and a trailing dotted quad
/// ("::ffff:127.0.0.1"). Zone ids ("fe80::1%eth0") are rejected.
export function parseIPv6(text: string): number[] | null {
  if (text.includes("%")) return null;
  let s = text;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  if (lastColon >= 0 && s.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4;
    s = s.slice(0, lastColon + 1) + "0:0"; // placeholder hextets, overwritten by the IPv4 tail
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parseGroups(halves[0]!);
  const rest = halves.length === 2 ? parseGroups(halves[1]!) : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest]
      : head;
  if (groups.length !== 8) return null;
  if (halves.length === 2 && head.length + rest.length > 7) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

function v4Routable([a, b, c]: V4): boolean {
  if (a === 0) return false; // "this network"
  if (a === 10) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function v6Routable(b: number[]): boolean {
  const word = (i: number) => (b[i * 2]! << 8) | b[i * 2 + 1]!;
  const embeddedV4 = (offset: number): V4 =>
    [b[offset]!, b[offset + 1]!, b[offset + 2]!, b[offset + 3]!] as V4;

  // ::ffff:0:0/96 IPv4-mapped -> judge the IPv4 address it maps to.
  if (b.slice(0, 10).every((x) => x === 0) && word(5) === 0xffff) {
    return v4Routable(embeddedV4(12));
  }
  // 64:ff9b::/96 NAT64 well-known prefix -> judge the embedded IPv4.
  if (
    word(0) === 0x64 &&
    word(1) === 0xff9b &&
    b.slice(4, 12).every((x) => x === 0)
  ) {
    return v4Routable(embeddedV4(12));
  }
  // 2002::/16 6to4 -> judge the embedded IPv4.
  if (word(0) === 0x2002) {
    return v4Routable(embeddedV4(2));
  }
  // Only global unicast 2000::/3 is accepted; this excludes ::, ::1,
  // IPv4-compatible ::/96, 64:ff9b:1::/48, 100::/64, fc00::/7, fe80::/10,
  // fec0::/10 and ff00::/8 multicast.
  if ((b[0]! & 0xe0) !== 0x20) return false;
  // Special ranges inside 2000::/3.
  if (word(0) === 0x2001 && word(1) < 0x0200) return false; // 2001::/23 (incl. Teredo)
  if (word(0) === 0x2001 && word(1) === 0x0db8) return false; // documentation
  if (word(0) === 0x3fff && word(1) < 0x1000) return false; // 3fff::/20 documentation
  return true;
}

/// True only for a canonical, globally routable unicast address.
export function isGloballyRoutableIp(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return v4Routable(v4);
  const v6 = parseIPv6(address);
  if (v6) return v6Routable(v6);
  return false;
}

/// True when a URL hostname is an IP literal in any form the WHATWG URL
/// parser accepts (it normalizes "0x7f.1", "2130706433" etc. to dotted
/// quads, and keeps IPv6 in brackets).
export function isIpLiteralHostname(hostname: string): boolean {
  return (
    hostname.startsWith("[") ||
    parseIPv4(hostname) !== null ||
    /^[\d.]+$/.test(hostname)
  );
}
