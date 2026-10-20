import "server-only";

import { graphRequest, MetaApiError, type GraphDeps } from "@/lib/meta/graph";

/// Facebook Page feed publishing and Instagram single-image publishing,
/// following Meta's documented sequences:
///   Facebook: POST /{page-id}/feed (text, link) or /{page-id}/photos (url)
///   Instagram: POST /{ig-id}/media (image_url, caption) -> poll
///              GET /{container-id}?fields=status_code -> POST
///              /{ig-id}/media_publish (creation_id)
/// A result is only "published" when Meta returned a post/media id.

export type FailedResult = {
  kind: "failed";
  error: MetaApiError;
  /// Instagram: the container can't be reused (ERROR/EXPIRED).
  resetContainer?: boolean;
  containerId?: string;
};
export type UnconfirmedResult = {
  kind: "unconfirmed";
  error: MetaApiError | null;
  message: string;
  containerId?: string;
};
export type PublishedResult = {
  kind: "published";
  postId: string;
  permalink?: string;
};
export type PendingResult = { kind: "pending"; containerId: string };

export type PublishResult =
  PublishedResult | FailedResult | UnconfirmedResult | PendingResult;

type IdResponse = { id?: unknown; post_id?: unknown };

function stringId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function wrap(error: unknown): MetaApiError {
  if (error instanceof MetaApiError) return error;
  throw error;
}

function outcomeFor(error: MetaApiError, containerId?: string): PublishResult {
  return error.ambiguous
    ? {
        kind: "unconfirmed",
        error,
        message: error.safeMessage,
        containerId,
      }
    : { kind: "failed", error, containerId };
}

// ── Facebook ────────────────────────────────────────────────────────────

export async function publishFacebookPost(
  input: {
    pageId: string;
    pageToken: string;
    message?: string;
    link?: string;
    photoUrl?: string;
  },
  deps: GraphDeps,
): Promise<PublishResult> {
  let response: IdResponse;
  try {
    response = input.photoUrl
      ? await graphRequest<IdResponse>(
          "POST",
          `${input.pageId}/photos`,
          { url: input.photoUrl, message: input.message },
          input.pageToken,
          deps,
        )
      : await graphRequest<IdResponse>(
          "POST",
          `${input.pageId}/feed`,
          { message: input.message, link: input.link },
          input.pageToken,
          deps,
        );
  } catch (error) {
    return outcomeFor(wrap(error));
  }

  // Photos return the page post in `post_id` and the photo in `id`.
  const postId = stringId(response.post_id) ?? stringId(response.id);
  if (!postId) {
    // Meta answered 2xx but without an id: the post may exist.
    return {
      kind: "unconfirmed",
      error: null,
      message:
        "Meta answered without a post id, so it is unclear whether the post went live.",
    };
  }

  return {
    kind: "published",
    postId,
    permalink: await fbPermalink(postId, input.pageToken, deps),
  };
}

async function fbPermalink(
  postId: string,
  token: string,
  deps: GraphDeps,
): Promise<string | undefined> {
  try {
    const r = await graphRequest<{ permalink_url?: unknown }>(
      "GET",
      postId,
      { fields: "permalink_url" },
      token,
      deps,
    );
    const link = stringId(r.permalink_url);
    if (!link) return undefined;
    return link.startsWith("http") ? link : `https://www.facebook.com${link}`;
  } catch {
    return undefined; // best effort; the post itself is confirmed
  }
}

// ── Instagram ───────────────────────────────────────────────────────────

export type InstagramOptions = {
  /// Delay between container status checks (docs: about once a minute, up
  /// to 5 minutes; we poll sooner within a short request budget and leave
  /// the container for a later resume if it isn't ready).
  pollIntervalMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function publishInstagramImage(
  input: {
    igId: string;
    token: string;
    imageUrl: string;
    caption: string;
    /// Resume an earlier container instead of creating another.
    containerId?: string;
  },
  deps: GraphDeps,
  options: InstagramOptions = {},
): Promise<PublishResult> {
  const sleep = options.sleep ?? defaultSleep;
  const pollInterval = options.pollIntervalMs ?? 3_000;
  const maxWait = options.maxWaitMs ?? 25_000;

  let containerId = input.containerId;
  if (!containerId) {
    try {
      const created = await graphRequest<IdResponse>(
        "POST",
        `${input.igId}/media`,
        { image_url: input.imageUrl, caption: input.caption },
        input.token,
        deps,
      );
      containerId = stringId(created.id);
    } catch (error) {
      // Creating a container publishes nothing, so even an ambiguous
      // failure here is safe to retry.
      return { kind: "failed", error: wrap(error) };
    }
    if (!containerId) {
      return {
        kind: "failed",
        error: new MetaApiError(
          "Meta did not return a media container id.",
          "ambiguous",
          { write: false },
        ),
      };
    }
  }

  // Wait for the container to be ready.
  let waited = 0;
  for (;;) {
    let status: string | undefined;
    try {
      const r = await graphRequest<{ status_code?: unknown }>(
        "GET",
        containerId,
        { fields: "status_code" },
        input.token,
        deps,
      );
      status = typeof r.status_code === "string" ? r.status_code : undefined;
    } catch (error) {
      return { kind: "failed", error: wrap(error), containerId };
    }

    if (status === "FINISHED") break;
    if (status === "PUBLISHED") {
      return {
        kind: "unconfirmed",
        error: null,
        message:
          "Instagram reports this container is already published. Use “Check status” to find the post.",
        containerId,
      };
    }
    if (status === "ERROR" || status === "EXPIRED") {
      return {
        kind: "failed",
        resetContainer: true,
        error: new MetaApiError(
          status === "EXPIRED"
            ? "The Instagram media container expired. Publish again to create a new one."
            : "Instagram could not process the image (container error). Check the image format, size and aspect ratio.",
          "rejected",
          { write: false },
        ),
      };
    }
    if (waited >= maxWait) return { kind: "pending", containerId };
    await sleep(pollInterval);
    waited += pollInterval;
  }

  let published: IdResponse;
  try {
    published = await graphRequest<IdResponse>(
      "POST",
      `${input.igId}/media_publish`,
      { creation_id: containerId },
      input.token,
      deps,
    );
  } catch (error) {
    return outcomeFor(wrap(error), containerId);
  }

  const mediaId = stringId(published.id);
  if (!mediaId) {
    return {
      kind: "unconfirmed",
      error: null,
      message:
        "Instagram answered without a media id, so it is unclear whether the post went live.",
      containerId,
    };
  }

  let permalink: string | undefined;
  try {
    const r = await graphRequest<{ permalink?: unknown }>(
      "GET",
      mediaId,
      { fields: "permalink" },
      input.token,
      deps,
    );
    permalink = stringId(r.permalink);
  } catch {
    // best effort; the media id is confirmed
  }
  return { kind: "published", postId: mediaId, permalink };
}

// ── Reconciliation after an unconfirmed outcome ─────────────────────────

export type ReconcileResult =
  | { kind: "found"; postId: string; permalink?: string }
  | { kind: "not_found" }
  | { kind: "unknown"; message: string };

const RECONCILE_SKEW_MS = 5 * 60 * 1000;

function sameText(a: unknown, b: string): boolean {
  return typeof a === "string" && a.trim() === b.trim();
}

export async function reconcileFacebook(
  input: { pageId: string; token: string; message: string; since: Date },
  deps: GraphDeps,
): Promise<ReconcileResult> {
  try {
    const r = await graphRequest<{
      data?: {
        id?: unknown;
        message?: unknown;
        created_time?: unknown;
        permalink_url?: unknown;
      }[];
    }>(
      "GET",
      `${input.pageId}/posts`,
      { fields: "id,message,created_time,permalink_url", limit: "10" },
      input.token,
      deps,
    );
    const cutoff = input.since.getTime() - RECONCILE_SKEW_MS;
    const match = (r.data ?? []).find(
      (p) =>
        sameText(p.message, input.message) &&
        typeof p.created_time === "string" &&
        Date.parse(p.created_time) >= cutoff,
    );
    const id = stringId(match?.id);
    if (!match || !id) return { kind: "not_found" };
    const link = stringId(match.permalink_url);
    return {
      kind: "found",
      postId: id,
      permalink: link?.startsWith("http")
        ? link
        : link
          ? `https://www.facebook.com${link}`
          : undefined,
    };
  } catch (error) {
    return {
      kind: "unknown",
      message:
        error instanceof MetaApiError
          ? error.safeMessage
          : "Could not check Facebook.",
    };
  }
}

export async function reconcileInstagram(
  input: {
    igId: string;
    token: string;
    containerId?: string;
    caption: string;
    since: Date;
  },
  deps: GraphDeps,
): Promise<ReconcileResult & { containerStatus?: string }> {
  try {
    let containerStatus: string | undefined;
    if (input.containerId) {
      const c = await graphRequest<{ status_code?: unknown }>(
        "GET",
        input.containerId,
        { fields: "status_code" },
        input.token,
        deps,
      );
      containerStatus =
        typeof c.status_code === "string" ? c.status_code : undefined;
      // A container that is not PUBLISHED has not produced a post.
      if (containerStatus && containerStatus !== "PUBLISHED") {
        return { kind: "not_found", containerStatus };
      }
    }
    const r = await graphRequest<{
      data?: {
        id?: unknown;
        caption?: unknown;
        timestamp?: unknown;
        permalink?: unknown;
      }[];
    }>(
      "GET",
      `${input.igId}/media`,
      { fields: "id,caption,timestamp,permalink", limit: "10" },
      input.token,
      deps,
    );
    const cutoff = input.since.getTime() - RECONCILE_SKEW_MS;
    const match = (r.data ?? []).find(
      (m) =>
        sameText(m.caption, input.caption) &&
        typeof m.timestamp === "string" &&
        Date.parse(m.timestamp) >= cutoff,
    );
    const id = stringId(match?.id);
    if (!match || !id) return { kind: "not_found", containerStatus };
    return {
      kind: "found",
      postId: id,
      permalink: stringId(match.permalink),
      containerStatus,
    };
  } catch (error) {
    return {
      kind: "unknown",
      message:
        error instanceof MetaApiError
          ? error.safeMessage
          : "Could not check Instagram.",
    };
  }
}
