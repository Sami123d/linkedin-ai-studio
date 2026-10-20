import "server-only";

import { graphRequest, MetaApiError, type GraphDeps } from "@/lib/meta/graph";

/// Facebook Login for Pages + the Instagram account linked to a Page.
///
/// Minimum permission set, and the calls that need each one:
///  - pages_show_list: GET me/accounts (list Pages, Page tokens, linked
///    instagram_business_account).
///  - pages_manage_posts: POST {page}/feed and {page}/photos.
///  - pages_read_engagement: GET {post}?fields=permalink_url and
///    GET {page}/posts (status check after an unconfirmed publish); also a
///    documented dependency of pages_manage_posts and instagram_content_publish.
///  - instagram_basic: the Instagram username/id, GET {media}?fields=permalink
///    and GET {ig}/media (status check); dependency of instagram_content_publish.
///  - instagram_content_publish: POST {ig}/media and {ig}/media_publish.
/// pages_read_user_engagement is deliberately NOT requested: it is not in
/// Meta's permissions reference and no call here needs it. If Meta reports a
/// missing dependency (for example pages_read_user_content for
/// instagram_basic) while testing in the Graph API Explorer, add it here.
/// Users without a role on the app need Advanced Access via App Review.
export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
] as const;

/// Permissions that must be granted for publishing to work at all.
export const REQUIRED_SCOPES: readonly string[] = META_SCOPES;

export function buildAuthUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
  version: string;
}): string {
  const url = new URL(`https://www.facebook.com/${input.version}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", META_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

type TokenResponse = { access_token?: unknown; expires_in?: unknown };

function parseToken(r: TokenResponse): { token: string; expiresAt?: Date } {
  if (typeof r.access_token !== "string" || !r.access_token) {
    throw new MetaApiError(
      "Meta did not return an access token.",
      "ambiguous",
      { write: false },
    );
  }
  const seconds = typeof r.expires_in === "number" ? r.expires_in : undefined;
  return {
    token: r.access_token,
    expiresAt: seconds ? new Date(Date.now() + seconds * 1000) : undefined,
  };
}

export async function exchangeCodeForToken(
  input: {
    appId: string;
    appSecret: string;
    redirectUri: string;
    code: string;
  },
  deps: GraphDeps,
) {
  return parseToken(
    await graphRequest<TokenResponse>(
      "GET",
      "oauth/access_token",
      {
        client_id: input.appId,
        client_secret: input.appSecret,
        redirect_uri: input.redirectUri,
        code: input.code,
      },
      undefined,
      deps,
    ),
  );
}

/// Short-lived user token -> long-lived (~60 days). There is no refresh
/// endpoint: a still-valid token can be exchanged again, an expired one
/// can't, so the user must reconnect.
export async function exchangeForLongLivedToken(
  input: { appId: string; appSecret: string; shortLivedToken: string },
  deps: GraphDeps,
) {
  return parseToken(
    await graphRequest<TokenResponse>(
      "GET",
      "oauth/access_token",
      {
        grant_type: "fb_exchange_token",
        client_id: input.appId,
        client_secret: input.appSecret,
        fb_exchange_token: input.shortLivedToken,
      },
      undefined,
      deps,
    ),
  );
}

export async function fetchMe(
  token: string,
  deps: GraphDeps,
): Promise<{ id: string; name?: string }> {
  const r = await graphRequest<{ id?: unknown; name?: unknown }>(
    "GET",
    "me",
    { fields: "id,name" },
    token,
    deps,
  );
  if (typeof r.id !== "string") {
    throw new MetaApiError("Meta returned no account id.", "ambiguous", {
      write: false,
    });
  }
  return { id: r.id, name: typeof r.name === "string" ? r.name : undefined };
}

export async function fetchPermissions(
  token: string,
  deps: GraphDeps,
): Promise<{ granted: string[]; declined: string[] }> {
  const r = await graphRequest<{
    data?: { permission?: unknown; status?: unknown }[];
  }>("GET", "me/permissions", {}, token, deps);
  const granted: string[] = [];
  const declined: string[] = [];
  for (const p of r.data ?? []) {
    if (typeof p.permission !== "string") continue;
    (p.status === "granted" ? granted : declined).push(p.permission);
  }
  return { granted, declined };
}

export type MetaPage = {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
  instagram: { id: string; username?: string } | null;
};

export async function fetchPages(
  userToken: string,
  deps: GraphDeps,
): Promise<MetaPage[]> {
  const r = await graphRequest<{
    data?: {
      id?: unknown;
      name?: unknown;
      access_token?: unknown;
      tasks?: unknown;
      instagram_business_account?: { id?: unknown; username?: unknown };
    }[];
  }>(
    "GET",
    "me/accounts",
    {
      fields:
        "id,name,access_token,tasks,instagram_business_account{id,username}",
      limit: "100",
    },
    userToken,
    deps,
  );

  const pages: MetaPage[] = [];
  for (const p of r.data ?? []) {
    if (
      typeof p.id !== "string" ||
      typeof p.name !== "string" ||
      typeof p.access_token !== "string"
    ) {
      continue;
    }
    const ig = p.instagram_business_account;
    pages.push({
      id: p.id,
      name: p.name,
      accessToken: p.access_token,
      tasks: Array.isArray(p.tasks)
        ? p.tasks.filter((t): t is string => typeof t === "string")
        : [],
      instagram:
        ig && typeof ig.id === "string"
          ? {
              id: ig.id,
              username:
                typeof ig.username === "string" ? ig.username : undefined,
            }
          : null,
    });
  }
  return pages;
}

/// Pages where this user may create content (needed to publish).
export function canPublishToPage(page: Pick<MetaPage, "tasks">): boolean {
  return page.tasks.includes("CREATE_CONTENT");
}
