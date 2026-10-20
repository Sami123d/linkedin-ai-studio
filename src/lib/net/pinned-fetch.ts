import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { ClientRequest, IncomingHttpHeaders } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";

import "server-only";

import { isGloballyRoutableIp, isIpLiteralHostname } from "@/lib/net/ip";

/// Outbound HTTPS GET for server-side fetches of untrusted URLs (image URLs
/// that come from third-party provider responses).
///
/// Protection, per request and per redirect hop:
///  1. URL policy: https only, no credentials, default port (443) only, the
///     hostname must be on an explicit allowlist and must not be an IP
///     literal.
///  2. DNS pinning: the socket is opened by node:https with a custom
///     `lookup`. That lookup resolves the name once, rejects the connection
///     if ANY returned address is not globally routable, and hands exactly
///     the validated addresses to the socket. The address that was checked
///     is the address that is connected to, so a DNS answer cannot change
///     between check and use (no second resolution, no shared keep-alive
///     socket: `agent: false`).
///  3. TLS is verified normally against the hostname (Node's default
///     `rejectUnauthorized: true`; SNI/servername = the hostname), so pinning
///     an IP never weakens certificate checks.
///  4. Redirects are never followed automatically; each Location is put
///     through the same checks before a new pinned connection is opened.
///  5. Size and time limits: the body is streamed and aborted past
///     `maxBytes`; the whole request is aborted after `timeoutMs`.

export class PinnedFetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "BLOCKED_URL"
      | "BLOCKED_HOST"
      | "BLOCKED_ADDRESS"
      | "DNS_FAILED"
      | "TOO_MANY_REDIRECTS"
      | "TOO_LARGE"
      | "TIMEOUT"
      | "NETWORK",
  ) {
    super(message);
    this.name = "PinnedFetchError";
  }
}

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

const defaultResolver: Resolver = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

/// Returns the URL if it passes the policy, otherwise throws.
export function checkOutboundUrl(
  raw: string,
  allowedHosts: ReadonlySet<string>,
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PinnedFetchError("Invalid URL.", "BLOCKED_URL");
  }
  if (url.protocol !== "https:") {
    throw new PinnedFetchError("Only HTTPS URLs are allowed.", "BLOCKED_URL");
  }
  if (url.username || url.password) {
    throw new PinnedFetchError(
      "URLs with credentials are not allowed.",
      "BLOCKED_URL",
    );
  }
  if (url.port !== "" && url.port !== "443") {
    throw new PinnedFetchError(
      "Only the default HTTPS port is allowed.",
      "BLOCKED_URL",
    );
  }
  const host = url.hostname.toLowerCase();
  if (isIpLiteralHostname(host)) {
    throw new PinnedFetchError(
      "IP-address URLs are not allowed.",
      "BLOCKED_HOST",
    );
  }
  if (!allowedHosts.has(host)) {
    throw new PinnedFetchError(
      `Host "${host}" is not an approved image host.`,
      "BLOCKED_HOST",
    );
  }
  return url;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/// A `lookup` for net/tls sockets that resolves once and only yields
/// globally routable addresses. If any answer is non-routable the whole
/// lookup fails, so a mixed answer (public + private) can't be used to slip
/// a private address in.
export function createPinnedLookup(
  resolver: Resolver,
  onResolved?: (addresses: LookupAddress[]) => void,
  /// Only tests override this (to connect to a local test server).
  isAllowedAddress: (address: string) => boolean = isGloballyRoutableIp,
) {
  return (
    hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: LookupCallback,
  ): void => {
    const wantAll = typeof options === "object" && options?.all === true;
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(
            new PinnedFetchError(`No address for ${hostname}.`, "DNS_FAILED"),
            "",
          );
          return;
        }
        const blocked = addresses.find((a) => !isAllowedAddress(a.address));
        if (blocked) {
          callback(
            new PinnedFetchError(
              `${hostname} resolved to a non-public address.`,
              "BLOCKED_ADDRESS",
            ),
            "",
          );
          return;
        }
        onResolved?.(addresses);
        if (wantAll) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      () =>
        callback(
          new PinnedFetchError(`Could not resolve ${hostname}.`, "DNS_FAILED"),
          "",
        ),
    );
  };
}

export type RawResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

export type Transport = (
  url: URL,
  options: {
    lookup: ReturnType<typeof createPinnedLookup>;
    maxBytes: number;
    timeoutMs: number;
  },
) => Promise<RawResponse>;

type HttpsRequestFn = typeof httpsRequest;

/// One pinned HTTPS GET (no redirect handling). `requestFn` is injectable
/// for tests; production uses node:https.
export function createHttpsTransport(
  requestFn: HttpsRequestFn = httpsRequest,
): Transport {
  return (url, { lookup, maxBytes, timeoutMs }) =>
    new Promise<RawResponse>((resolve, reject) => {
      const options: RequestOptions = {
        method: "GET",
        protocol: "https:",
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        // TLS: SNI and certificate verification use the hostname, not the
        // pinned IP. Never disable verification here.
        servername: url.hostname,
        rejectUnauthorized: true,
        lookup: lookup as unknown as RequestOptions["lookup"],
        // A fresh socket per request, so a pooled connection to an earlier
        // resolution can never be reused.
        agent: false,
        headers: { accept: "image/*", "user-agent": "linkedin-ai-studio" },
      };

      let settled = false;
      const conn: { req?: ClientRequest } = {};
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        conn.req?.destroy();
        reject(error);
      };

      const timer = setTimeout(
        () => fail(new PinnedFetchError("The request timed out.", "TIMEOUT")),
        timeoutMs,
      );

      const req = requestFn(options, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          clearTimeout(timer);
          res.destroy();
          fail(new PinnedFetchError("The response is too large.", "TOO_LARGE"));
          return;
        }
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            clearTimeout(timer);
            res.destroy();
            fail(
              new PinnedFetchError("The response is too large.", "TOO_LARGE"),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", (error) => {
          clearTimeout(timer);
          fail(
            error instanceof PinnedFetchError
              ? error
              : new PinnedFetchError("The connection failed.", "NETWORK"),
          );
        });
      });

      conn.req = req;
      req.on("error", (error) => {
        clearTimeout(timer);
        fail(
          error instanceof PinnedFetchError
            ? error
            : new PinnedFetchError("The connection failed.", "NETWORK"),
        );
      });
      req.end();
    });
}

export type PinnedFetchOptions = {
  allowedHosts: ReadonlySet<string>;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  resolver?: Resolver;
  transport?: Transport;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function pinnedFetch(
  rawUrl: string,
  options: PinnedFetchOptions,
): Promise<RawResponse & { url: string }> {
  const transport = options.transport ?? createHttpsTransport();
  const resolver = options.resolver ?? defaultResolver;
  const maxRedirects = options.maxRedirects ?? 3;

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = checkOutboundUrl(current, options.allowedHosts);
    const response = await transport(url, {
      lookup: createPinnedLookup(resolver),
      maxBytes: options.maxBytes,
      timeoutMs: options.timeoutMs,
    });

    const location = response.headers.location;
    if (
      REDIRECT_STATUSES.has(response.status) &&
      typeof location === "string"
    ) {
      // Resolve relative Locations against the current URL, then re-check
      // the result exactly like the first URL.
      current = new URL(location, url).toString();
      continue;
    }
    return { ...response, url: url.toString() };
  }
  throw new PinnedFetchError("Too many redirects.", "TOO_MANY_REDIRECTS");
}
