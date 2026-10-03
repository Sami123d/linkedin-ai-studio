/**
 * LinkedIn Publisher (a port of n8n/workflows/02-publisher-scheduler.json).
 *
 * Claims the approved posts that are due (GET /api/scheduler/due), publishes
 * each one to LinkedIn (with its image when it has one) and reports success
 * or failure back to POST /api/scheduler/publish.
 *
 * Runs on GitHub Actions (.github/workflows/linkedin-publisher.yml):
 *
 *   APP_BASE_URL=... SCHEDULER_WEBHOOK_SECRET=... LINKEDIN_ACCESS_TOKEN=... \
 *     node --experimental-strip-types scripts/linkedin-publisher.ts
 *
 * LINKEDIN_ACCESS_TOKEN needs the `openid profile w_member_social` scopes.
 * LINKEDIN_PERSON_URN (urn:li:person:...) is optional; without it the author
 * is looked up from /v2/userinfo.
 */
import { pathToFileURL } from "node:url";

export type DuePost = {
  scheduledPostId: string;
  topic?: string;
  format?: string;
  content?: string | null;
  slides?: string[] | null;
  hashtags?: string[] | null;
  imageUrl?: string | null;
};

export type PublishResult =
  | { scheduledPostId: string; success: true; publishedUrl?: string }
  | { scheduledPostId: string; success: false; error: string };

const LINKEDIN_API = "https://api.linkedin.com";
const MAX_POST_LENGTH = 3000; // LinkedIn's limit for share commentary

/** Same rules as the n8n "Build Post Text" node: body (or numbered slides) + hashtags. */
export function buildPostText(post: DuePost): string {
  let text = post.content || "";
  if (!text && Array.isArray(post.slides) && post.slides.length > 0) {
    text = post.slides.map((s, i) => `${i + 1}. ${s}`).join("\n\n");
  }
  if (Array.isArray(post.hashtags) && post.hashtags.length > 0) {
    text +=
      "\n\n" + post.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  }
  return text.trim().slice(0, MAX_POST_LENGTH);
}

/** Body for POST /v2/ugcPosts (text-only, or with one uploaded image asset). */
export function buildUgcPost(
  author: string,
  text: string,
  imageAsset?: string,
  title?: string,
) {
  return {
    author,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: imageAsset ? "IMAGE" : "NONE",
        ...(imageAsset
          ? {
              media: [
                {
                  status: "READY",
                  media: imageAsset,
                  ...(title ? { title: { text: title.slice(0, 200) } } : {}),
                },
              ],
            }
          : {}),
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };
}

export function postUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}`;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2000,
  );
}

async function linkedin(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${LINKEDIN_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    const hint =
      res.status === 401
        ? " (LinkedIn token expired or invalid: generate a new one and update the LINKEDIN_ACCESS_TOKEN secret)"
        : "";
    throw new Error(
      `LinkedIn ${init.method || "GET"} ${path} -> HTTP ${res.status}${hint}: ${body}`,
    );
  }
  return res;
}

async function resolveAuthor(token: string): Promise<string> {
  const configured = process.env.LINKEDIN_PERSON_URN?.trim();
  if (configured) return configured;
  const me = (await (await linkedin(token, "/v2/userinfo")).json()) as {
    sub?: string;
  };
  if (!me.sub)
    throw new Error(
      "LinkedIn /v2/userinfo returned no `sub`; set LINKEDIN_PERSON_URN instead.",
    );
  return `urn:li:person:${me.sub}`;
}

/** Registers an image upload, sends the bytes and returns the digital media asset URN. */
async function uploadImage(
  token: string,
  author: string,
  imageUrl: string,
): Promise<string> {
  const register = (await (
    await linkedin(token, "/v2/assets?action=registerUpload", {
      method: "POST",
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
          owner: author,
          serviceRelationships: [
            {
              relationshipType: "OWNER",
              identifier: "urn:li:userGeneratedContent",
            },
          ],
        },
      }),
    })
  ).json()) as {
    value: {
      asset: string;
      uploadMechanism: {
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
          uploadUrl: string;
        };
      };
    };
  };
  const uploadUrl =
    register.value.uploadMechanism[
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ].uploadUrl;

  const image = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!image.ok) throw new Error(`Image download failed: HTTP ${image.status}`);
  const bytes = new Uint8Array(await image.arrayBuffer());

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": image.headers.get("content-type") || "image/jpeg",
    },
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  });
  if (!put.ok) throw new Error(`Image upload failed: HTTP ${put.status}`);
  return register.value.asset;
}

async function publishOne(
  token: string,
  author: string,
  post: DuePost,
): Promise<PublishResult> {
  const text = buildPostText(post);
  if (!text)
    return {
      scheduledPostId: post.scheduledPostId,
      success: false,
      error: "Draft has no text to publish.",
    };

  try {
    let asset: string | undefined;
    if (post.imageUrl) {
      try {
        asset = await uploadImage(token, author, post.imageUrl);
      } catch (error) {
        // A broken image shouldn't block the post itself.
        console.warn(
          `  ${post.scheduledPostId}: image skipped (${errorMessage(error)})`,
        );
      }
    }
    const res = await linkedin(token, "/v2/ugcPosts", {
      method: "POST",
      body: JSON.stringify(buildUgcPost(author, text, asset, post.topic)),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    const urn = res.headers.get("x-restli-id") || body.id;
    return {
      scheduledPostId: post.scheduledPostId,
      success: true,
      ...(urn ? { publishedUrl: postUrl(urn) } : {}),
    };
  } catch (error) {
    return {
      scheduledPostId: post.scheduledPostId,
      success: false,
      error: errorMessage(error),
    };
  }
}

async function app(
  path: string,
  secret: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "x-webhook-secret": secret,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(
      `App ${init.method || "GET"} ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  return res;
}

async function main() {
  const secret = process.env.SCHEDULER_WEBHOOK_SECRET || "";
  const token = process.env.LINKEDIN_ACCESS_TOKEN || "";
  if (!process.env.APP_BASE_URL || !secret || !token) {
    // Not set up yet: skip quietly instead of failing every scheduled run.
    console.log(
      "Skipping: set APP_BASE_URL, SCHEDULER_WEBHOOK_SECRET and LINKEDIN_ACCESS_TOKEN to enable this workflow.",
    );
    return;
  }

  // Check the LinkedIn token BEFORE claiming posts, so an expired token
  // doesn't mark posts as in-progress for nothing.
  const author = await resolveAuthor(token);

  const { posts = [] } = (await (
    await app("/api/scheduler/due?limit=20", secret)
  ).json()) as { posts?: DuePost[] };
  console.log(`${posts.length} post(s) due.`);

  let failures = 0;
  for (const post of posts) {
    const result = await publishOne(token, author, post);
    if (result.success)
      console.log(
        `  ${post.scheduledPostId}: published ${result.publishedUrl ?? ""}`,
      );
    else {
      failures++;
      console.error(`  ${post.scheduledPostId}: failed (${result.error})`);
    }
    await app("/api/scheduler/publish", secret, {
      method: "POST",
      body: JSON.stringify(result),
    });
  }

  if (failures > 0) process.exit(1); // surface failures as a red run (and GitHub's failure email)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
