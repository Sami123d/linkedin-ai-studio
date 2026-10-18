import { EventEmitter } from "node:events";
import { connect, createServer, type Server } from "node:net";
import type { LookupAddress } from "node:dns";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadCampaignImage } from "@/features/platforms/media";
import { PUBLISH_IMAGE_HOSTS } from "@/features/platforms/media-path";
import {
  isGloballyRoutableIp,
  isIpLiteralHostname,
  parseIPv6,
} from "@/lib/net/ip";
import {
  checkOutboundUrl,
  createHttpsTransport,
  createPinnedLookup,
  PinnedFetchError,
  pinnedFetch,
  type RawResponse,
  type Resolver,
  type Transport,
} from "@/lib/net/pinned-fetch";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const PUBLIC_V4 = "151.101.2.208";
const PUBLIC_V6 = "2a04:4e42::720";

describe("IP classification", () => {
  it("accepts globally routable addresses", () => {
    for (const ip of [
      PUBLIC_V4,
      "8.8.8.8",
      "1.1.1.1",
      PUBLIC_V6,
      "2606:4700::1111",
    ]) {
      expect(isGloballyRoutableIp(ip), ip).toBe(true);
    }
  });

  it("rejects loopback, private, link-local, CGNAT, reserved and multicast IPv4", () => {
    for (const ip of [
      "0.0.0.0",
      "127.0.0.1",
      "127.255.255.254",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "192.0.0.8",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.9",
      "224.0.0.1",
      "239.255.255.250",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isGloballyRoutableIp(ip), ip).toBe(false);
    }
  });

  it("rejects non-global IPv6, including mapped / translated private IPv4", () => {
    for (const ip of [
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "fec0::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "::127.0.0.1",
      "64:ff9b::a9fe:a9fe",
      "64:ff9b::10.0.0.1",
      "64:ff9b:1::1",
      "2002:7f00:1::",
      "2002:c0a8:0101::1",
      "2001::1",
      "2001:db8::1",
      "3fff::1",
      "100::1",
      "fe80::1%eth0",
    ]) {
      expect(isGloballyRoutableIp(ip), ip).toBe(false);
    }
  });

  it("judges mapped / NAT64 / 6to4 forms of public IPv4 by the IPv4 address", () => {
    expect(isGloballyRoutableIp("::ffff:8.8.8.8")).toBe(true);
    expect(isGloballyRoutableIp("64:ff9b::808:808")).toBe(true);
    expect(isGloballyRoutableIp("2002:0808:0808::1")).toBe(true);
  });

  it("fails closed on alternate or malformed representations", () => {
    for (const ip of [
      "2130706433",
      "0x7f.0.0.1",
      "0177.0.0.1",
      "127.1",
      "1.2.3.256",
      "",
      "abc",
      "1:2:3:4:5:6:7:8:9",
      "::1::",
    ]) {
      expect(isGloballyRoutableIp(ip), ip).toBe(false);
    }
    expect(parseIPv6("::ffff:127.0.0.1")?.slice(12)).toEqual([127, 0, 0, 1]);
  });

  it("detects IP-literal hostnames", () => {
    expect(isIpLiteralHostname("127.0.0.1")).toBe(true);
    expect(isIpLiteralHostname("[::1]")).toBe(true);
    expect(isIpLiteralHostname("images.unsplash.com")).toBe(false);
  });
});

describe("outbound URL policy", () => {
  const hosts = new Set(["images.unsplash.com"]);

  it("allows only allowlisted https hosts on the default port", () => {
    expect(
      checkOutboundUrl("https://images.unsplash.com/photo-1?w=10", hosts)
        .hostname,
    ).toBe("images.unsplash.com");
    expect(
      checkOutboundUrl("https://IMAGES.unsplash.com:443/a", hosts).hostname,
    ).toBe("images.unsplash.com");
  });

  it.each([
    ["http://images.unsplash.com/a", "BLOCKED_URL"],
    ["ftp://images.unsplash.com/a", "BLOCKED_URL"],
    ["https://user:pw@images.unsplash.com/a", "BLOCKED_URL"],
    ["https://images.unsplash.com:8443/a", "BLOCKED_URL"],
    ["https://evil.example.com/a", "BLOCKED_HOST"],
    ["https://images.unsplash.com.evil.example/a", "BLOCKED_HOST"],
    ["https://images.unsplash.com./a", "BLOCKED_HOST"],
    ["https://127.0.0.1/a", "BLOCKED_HOST"],
    ["https://2130706433/a", "BLOCKED_HOST"],
    ["https://0x7f.1/a", "BLOCKED_HOST"],
    ["https://[::1]/a", "BLOCKED_HOST"],
    ["https://[::ffff:127.0.0.1]/a", "BLOCKED_HOST"],
    ["not a url", "BLOCKED_URL"],
  ])("rejects %s", (url, code) => {
    expect(() => checkOutboundUrl(url, hosts)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it("covers the hosts the configured image providers return", () => {
    for (const host of [
      "images.unsplash.com",
      "gen.pollinations.ai",
      "image.pollinations.ai",
      "media.pollinations.ai",
    ]) {
      expect(PUBLISH_IMAGE_HOSTS.has(host), host).toBe(true);
    }
    // No wildcard or catch-all entries.
    for (const host of PUBLISH_IMAGE_HOSTS)
      expect(host).toMatch(/^[a-z0-9.-]+$/);
  });
});

function lookupAsync(
  lookup: ReturnType<typeof createPinnedLookup>,
  host: string,
  all = true,
) {
  return new Promise<LookupAddress[] | string>((resolve, reject) =>
    lookup(host, { all }, (err, address) =>
      err ? reject(err) : resolve(address),
    ),
  );
}

describe("pinned DNS lookup", () => {
  it("returns the validated addresses (all and single forms)", async () => {
    const resolver: Resolver = async () => [{ address: PUBLIC_V4, family: 4 }];
    expect(await lookupAsync(createPinnedLookup(resolver), "x")).toEqual([
      { address: PUBLIC_V4, family: 4 },
    ]);
    expect(await lookupAsync(createPinnedLookup(resolver), "x", false)).toBe(
      PUBLIC_V4,
    );
  });

  it("blocks a private answer", async () => {
    const resolver: Resolver = async () => [{ address: "10.0.0.7", family: 4 }];
    await expect(
      lookupAsync(createPinnedLookup(resolver), "x"),
    ).rejects.toMatchObject({
      code: "BLOCKED_ADDRESS",
    });
  });

  it("blocks a mixed public + private answer instead of picking the public one", async () => {
    const resolver: Resolver = async () => [
      { address: PUBLIC_V4, family: 4 },
      { address: "::ffff:169.254.169.254", family: 6 },
    ];
    await expect(
      lookupAsync(createPinnedLookup(resolver), "x"),
    ).rejects.toMatchObject({
      code: "BLOCKED_ADDRESS",
    });
  });

  it("fails on empty answers and resolver errors", async () => {
    await expect(
      lookupAsync(
        createPinnedLookup(async () => []),
        "x",
      ),
    ).rejects.toMatchObject({
      code: "DNS_FAILED",
    });
    await expect(
      lookupAsync(
        createPinnedLookup(async () => Promise.reject(new Error("ENOTFOUND"))),
        "x",
      ),
    ).rejects.toMatchObject({ code: "DNS_FAILED" });
  });
});

/// A fake transport that behaves like a real socket: it must run the pinned
/// lookup, and "connects" to exactly the address the lookup returned.
function fakeNetwork(responses: Record<string, Partial<RawResponse>>) {
  const connections: { host: string; address: string }[] = [];
  const transport: Transport = async (url, { lookup }) => {
    const resolved = await lookupAsync(lookup, url.hostname);
    const address = Array.isArray(resolved) ? resolved[0]!.address : resolved;
    connections.push({ host: url.hostname, address });
    const r = responses[url.toString()] ?? { status: 404 };
    return {
      status: r.status ?? 200,
      headers: r.headers ?? {},
      body: r.body ?? Buffer.alloc(0),
    };
  };
  return { transport, connections };
}

const jpegResponse = {
  status: 200,
  headers: { "content-type": "image/jpeg" },
  body: Buffer.from([1, 2, 3]),
};
const publicDns: Resolver = async () => [{ address: PUBLIC_V4, family: 4 }];

describe("pinnedFetch redirects", () => {
  const hosts = new Set(["images.unsplash.com", "media.pollinations.ai"]);

  it("follows a redirect to another allowlisted host, pinning each hop", async () => {
    const { transport, connections } = fakeNetwork({
      "https://images.unsplash.com/a": {
        status: 302,
        headers: { location: "https://media.pollinations.ai/b" },
      },
      "https://media.pollinations.ai/b": jpegResponse,
    });
    const res = await pinnedFetch("https://images.unsplash.com/a", {
      allowedHosts: hosts,
      maxBytes: 1000,
      timeoutMs: 1000,
      resolver: publicDns,
      transport,
    });
    expect(res.status).toBe(200);
    expect(res.url).toBe("https://media.pollinations.ai/b");
    expect(connections).toEqual([
      { host: "images.unsplash.com", address: PUBLIC_V4 },
      { host: "media.pollinations.ai", address: PUBLIC_V4 },
    ]);
  });

  it("refuses to follow a redirect to an unapproved host (no connection made)", async () => {
    const { transport, connections } = fakeNetwork({
      "https://images.unsplash.com/a": {
        status: 301,
        headers: { location: "https://evil.example.com/x" },
      },
    });
    await expect(
      pinnedFetch("https://images.unsplash.com/a", {
        allowedHosts: hosts,
        maxBytes: 1000,
        timeoutMs: 1000,
        resolver: publicDns,
        transport,
      }),
    ).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    expect(connections).toHaveLength(1);
  });

  it.each([
    "http://images.unsplash.com/x",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/x",
    "https://images.unsplash.com:8080/x",
  ])("refuses a redirect to %s", async (location) => {
    const { transport, connections } = fakeNetwork({
      "https://images.unsplash.com/a": { status: 307, headers: { location } },
    });
    await expect(
      pinnedFetch("https://images.unsplash.com/a", {
        allowedHosts: hosts,
        maxBytes: 1000,
        timeoutMs: 1000,
        resolver: publicDns,
        transport,
      }),
    ).rejects.toBeInstanceOf(PinnedFetchError);
    expect(connections).toHaveLength(1);
  });

  it("stops redirect loops", async () => {
    const { transport } = fakeNetwork({
      "https://images.unsplash.com/a": {
        status: 302,
        headers: { location: "/a" },
      },
    });
    await expect(
      pinnedFetch("https://images.unsplash.com/a", {
        allowedHosts: hosts,
        maxBytes: 1000,
        timeoutMs: 1000,
        maxRedirects: 3,
        resolver: publicDns,
        transport,
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });

  it("DNS rebinding: an allowlisted name that later resolves to a private IP is blocked", async () => {
    // First answer public, every later answer private (a rebinding attack).
    let calls = 0;
    const rebinding: Resolver = async () =>
      calls++ === 0
        ? [{ address: PUBLIC_V4, family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    const { transport, connections } = fakeNetwork({
      "https://images.unsplash.com/a": {
        status: 302,
        headers: { location: "https://images.unsplash.com/b" },
      },
      "https://images.unsplash.com/b": jpegResponse,
    });
    await expect(
      pinnedFetch("https://images.unsplash.com/a", {
        allowedHosts: hosts,
        maxBytes: 1000,
        timeoutMs: 1000,
        resolver: rebinding,
        transport,
      }),
    ).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
    // The only connection went to the address that was validated.
    expect(connections).toEqual([
      { host: "images.unsplash.com", address: PUBLIC_V4 },
    ]);
  });

  it("an allowlisted name resolving to a cloud metadata address is never connected to", async () => {
    const { transport, connections } = fakeNetwork({
      "https://images.unsplash.com/a": jpegResponse,
    });
    await expect(
      pinnedFetch("https://images.unsplash.com/a", {
        allowedHosts: hosts,
        maxBytes: 1000,
        timeoutMs: 1000,
        resolver: async () => [{ address: "169.254.169.254", family: 4 }],
        transport,
      }),
    ).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
    expect(connections).toHaveLength(0);
  });
});

describe("downloadCampaignImage", () => {
  it("downloads an image from an approved provider host", async () => {
    const { transport } = fakeNetwork({
      "https://images.unsplash.com/photo-1": jpegResponse,
    });
    const bytes = await downloadCampaignImage(
      "https://images.unsplash.com/photo-1",
      {
        resolver: publicDns,
        transport,
      },
    );
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("rejects hosts outside the allowlist with a clear message", async () => {
    const { transport, connections } = fakeNetwork({});
    await expect(
      downloadCampaignImage("https://attacker.example/x.png", {
        resolver: publicDns,
        transport,
      }),
    ).rejects.toThrow(/not an approved image host/);
    expect(connections).toHaveLength(0);
  });

  it("rejects private destinations reached through an approved name", async () => {
    const { transport } = fakeNetwork({
      "https://images.unsplash.com/a": jpegResponse,
    });
    await expect(
      downloadCampaignImage("https://images.unsplash.com/a", {
        resolver: async () => [{ address: "10.0.0.1", family: 4 }],
        transport,
      }),
    ).rejects.toThrow(/non-public address/);
  });

  it("rejects non-image and non-200 responses", async () => {
    const { transport } = fakeNetwork({
      "https://images.unsplash.com/html": {
        status: 200,
        headers: { "content-type": "text/html" },
      },
    });
    await expect(
      downloadCampaignImage("https://images.unsplash.com/html", {
        resolver: publicDns,
        transport,
      }),
    ).rejects.toThrow(/did not return an image/);
    await expect(
      downloadCampaignImage("https://images.unsplash.com/missing", {
        resolver: publicDns,
        transport,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("HTTPS transport options", () => {
  type FakeRes = PassThrough & { statusCode?: number; headers?: object };
  function fakeRequest(
    meta: { status: number; headers: Record<string, string> } | null,
    drive: (res: FakeRes) => void = () => {},
  ) {
    const calls: Record<string, unknown>[] = [];
    const requestFn = ((
      options: Record<string, unknown>,
      cb: (res: unknown) => void,
    ) => {
      calls.push(options);
      const req = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: () => void;
      };
      req.destroy = vi.fn();
      req.end = () => {
        if (!meta) return; // the server never answers
        const res: FakeRes = new PassThrough();
        res.statusCode = meta.status;
        res.headers = meta.headers;
        cb(res);
        drive(res);
      };
      return req;
    }) as unknown as Parameters<typeof createHttpsTransport>[0];
    return { requestFn, calls };
  }

  it("connects through the pinned lookup with full TLS verification and no shared agent", async () => {
    const { requestFn, calls } = fakeRequest(
      { status: 200, headers: { "content-type": "image/jpeg" } },
      (res) => res.end(Buffer.from([9])),
    );
    const lookup = createPinnedLookup(publicDns);
    const out = await createHttpsTransport(requestFn)(
      new URL("https://images.unsplash.com/p?q=1"),
      {
        lookup,
        maxBytes: 100,
        timeoutMs: 1000,
      },
    );
    expect(out.status).toBe(200);
    expect([...out.body]).toEqual([9]);
    expect(calls[0]).toMatchObject({
      hostname: "images.unsplash.com",
      servername: "images.unsplash.com",
      port: 443,
      path: "/p?q=1",
      rejectUnauthorized: true,
      agent: false,
      lookup,
    });
  });

  it("aborts bodies over the size limit", async () => {
    const { requestFn } = fakeRequest({ status: 200, headers: {} }, (res) => {
      res.write(Buffer.alloc(60));
      res.end(Buffer.alloc(60));
    });
    await expect(
      createHttpsTransport(requestFn)(
        new URL("https://images.unsplash.com/p"),
        {
          lookup: createPinnedLookup(publicDns),
          maxBytes: 100,
          timeoutMs: 1000,
        },
      ),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("rejects a declared Content-Length over the limit before reading", async () => {
    const { requestFn } = fakeRequest({
      status: 200,
      headers: { "content-length": "999999" },
    });
    await expect(
      createHttpsTransport(requestFn)(
        new URL("https://images.unsplash.com/p"),
        {
          lookup: createPinnedLookup(publicDns),
          maxBytes: 100,
          timeoutMs: 1000,
        },
      ),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("times out", async () => {
    const { requestFn } = fakeRequest(null);
    await expect(
      createHttpsTransport(requestFn)(
        new URL("https://images.unsplash.com/p"),
        {
          lookup: createPinnedLookup(publicDns),
          maxBytes: 100,
          timeoutMs: 20,
        },
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("real socket behavior (local TCP server)", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function listen(): Promise<{ port: number; accepted: () => number }> {
    let count = 0;
    server = createServer((socket) => {
      count++;
      socket.end();
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    return {
      port: typeof address === "object" && address ? address.port : 0,
      accepted: () => count,
    };
  }

  function tryConnect(
    port: number,
    lookup: ReturnType<typeof createPinnedLookup>,
  ) {
    return new Promise<string>((resolve, reject) => {
      const socket = connect({
        host: "rebind.test",
        port,
        lookup: lookup as never,
      });
      socket.on("connect", () => {
        resolve(socket.remoteAddress ?? "");
        socket.destroy();
      });
      socket.on("error", reject);
    });
  }

  it("a hostname resolving to loopback is never connected to", async () => {
    const { port, accepted } = await listen();
    const lookup = createPinnedLookup(async () => [
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(tryConnect(port, lookup)).rejects.toMatchObject({
      code: "BLOCKED_ADDRESS",
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(accepted()).toBe(0);
  });

  it("the socket connects to exactly the address the lookup validated, resolving once", async () => {
    const { port, accepted } = await listen();
    // Test-only policy that treats 127.0.0.1 as allowed so a local server can
    // stand in for a public host; the resolver would rebind on a 2nd call.
    const resolver = vi
      .fn<Resolver>()
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
      .mockResolvedValue([{ address: "10.9.9.9", family: 4 }]);
    const lookup = createPinnedLookup(
      resolver,
      undefined,
      (a) => a === "127.0.0.1",
    );
    expect(await tryConnect(port, lookup)).toBe("127.0.0.1");
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(accepted()).toBe(1);
  });
});
