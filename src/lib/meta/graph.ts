import "server-only";

/// Thin Graph API client. Everything here takes its dependencies (fetch,
/// version) as arguments so it can be tested with mocked responses and never
/// reads env itself. Tokens go in the request (query for GET, form body for
/// POST) and are never put in error messages, logs or return values.

export type MetaErrorCategory =
  | "auth" // token invalid/expired/revoked -> reconnect
  | "permission" // missing permission / Page role
  | "rate_limit" // app/user/Page throttling -> retry later
  | "blocked" // policy block
  | "rejected" // definitive 4xx rejection (bad input, media, duplicate…)
  | "transient" // Meta-side 5xx / temporary error
  | "network" // timeout or connection failure
  | "ambiguous"; // 2xx with an unusable body

export class MetaApiError extends Error {
  constructor(
    /// Safe to show to the user: contains no token, no raw provider text.
    readonly safeMessage: string,
    readonly category: MetaErrorCategory,
    readonly details: {
      httpStatus?: number;
      code?: number;
      subcode?: number;
      traceId?: string;
      write: boolean;
    },
  ) {
    super(safeMessage);
    this.name = "MetaApiError";
  }

  /// A write whose outcome is unknown: the platform may have accepted it.
  /// Must never be retried blindly.
  get ambiguous(): boolean {
    return (
      this.details.write &&
      (this.category === "network" ||
        this.category === "transient" ||
        this.category === "ambiguous")
    );
  }

  get needsReconnect(): boolean {
    return this.category === "auth";
  }
}

const AUTH_CODES = new Set([102, 190]);
const PERMISSION_CODES = new Set([3, 10]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613]);
const TRANSIENT_CODES = new Set([1, 2]);

export function classifyGraphError(input: {
  httpStatus: number;
  code?: number;
  subcode?: number;
  traceId?: string;
  write: boolean;
}): MetaApiError {
  const { httpStatus, code, subcode, traceId, write } = input;
  const ref = code
    ? ` (Meta error ${code}${subcode ? `/${subcode}` : ""})`
    : "";
  const details = { httpStatus, code, subcode, traceId, write };

  if (code !== undefined && AUTH_CODES.has(code)) {
    return new MetaApiError(
      `Meta rejected the saved access token (expired, revoked or invalid). Reconnect your Meta account.${ref}`,
      "auth",
      details,
    );
  }
  if (
    code !== undefined &&
    (PERMISSION_CODES.has(code) || (code >= 200 && code <= 299))
  ) {
    return new MetaApiError(
      `Meta denied the request: a required permission is missing or you no longer have the right role on the Page. Reconnect and grant all requested permissions.${ref}`,
      "permission",
      details,
    );
  }
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
    return new MetaApiError(
      `Meta rate limit reached. Wait a while and retry.${ref}`,
      "rate_limit",
      details,
    );
  }
  if (code === 368) {
    return new MetaApiError(
      `Meta temporarily blocked this action for policy reasons.${ref}`,
      "blocked",
      details,
    );
  }
  if (httpStatus >= 500 || (code !== undefined && TRANSIENT_CODES.has(code))) {
    return new MetaApiError(
      `Meta had a temporary problem handling the request.${ref}`,
      "transient",
      details,
    );
  }
  return new MetaApiError(
    `Meta rejected the request. Check the content, link and image, then retry.${ref}`,
    "rejected",
    details,
  );
}

export type GraphDeps = {
  version: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type GraphErrorBody = {
  error?: {
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

const GRAPH_HOST = "https://graph.facebook.com";

export async function graphRequest<T>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | undefined>,
  token: string | undefined,
  deps: GraphDeps,
): Promise<T> {
  const write = method === "POST";
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = new URL(`${GRAPH_HOST}/${deps.version}/${path}`);

  const fields = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) fields.set(key, value);
  }
  if (token) fields.set("access_token", token);

  let response: Response;
  try {
    if (write) {
      response = await fetchImpl(url, {
        method,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: fields,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
      });
    } else {
      url.search = fields.toString();
      response = await fetchImpl(url, {
        method,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
      });
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new MetaApiError(
      timedOut ? "Meta did not respond in time." : "Could not reach Meta.",
      "network",
      { write },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const errorBody = (body as GraphErrorBody | undefined)?.error;

  if (!response.ok || errorBody) {
    throw classifyGraphError({
      httpStatus: response.status,
      code: errorBody?.code,
      subcode: errorBody?.error_subcode,
      traceId: errorBody?.fbtrace_id,
      write,
    });
  }
  if (body === undefined || body === null || typeof body !== "object") {
    throw new MetaApiError(
      "Meta returned an unreadable response.",
      "ambiguous",
      { httpStatus: response.status, write },
    );
  }
  return body as T;
}
