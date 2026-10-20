import "server-only";

import { prisma } from "@/db/prisma";
import {
  findOrphanedPaths,
  isOwnMediaPath,
  PUBLISH_MEDIA_BUCKET,
  publishMediaPath,
} from "@/features/platforms/media-path";
import { publishMediaAdminBucket } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/// Cleanup of prepared publish images (the public `publish-media` bucket).
///
/// Rules:
///  - Profile-scoped: only `<profileId>/<uuid>.jpg` objects of the profile
///    being cleaned are ever passed to Storage (checked again right before
///    every delete).
///  - Never affects publishing: callers ignore the result, nothing here
///    throws, and a published variant stays PUBLISHED whatever happens.
///  - Retryable: a database reference is only cleared after Storage confirms
///    the object is gone. Failures are logged (no URLs, no secrets) and
///    retried by the next sweep. Files whose reference was already removed
///    (replaced images, deleted campaigns) are caught by the orphan sweep.
///
/// User-facing paths use the signed-in user's session (storage policies
/// limit it to their own folder). Jobs without a session (Meta scheduler,
/// trend housekeeping) need SUPABASE_SERVICE_ROLE_KEY; without it they log
/// and leave the work for the next time the owner opens /platforms.

/// The subset of the Storage bucket API used here (injectable for tests).
export type MediaBucket = {
  remove(paths: string[]): Promise<{
    data: { name: string }[] | null;
    error: { message: string } | null;
  }>;
  list(
    path: string,
    options?: { limit?: number; offset?: number; search?: string },
  ): Promise<{
    data: { name: string; created_at?: string | null }[] | null;
    error: { message: string } | null;
  }>;
};

export function logCleanupFailure(
  context: string,
  details: { profileId?: string; count: number; reason?: string },
) {
  console.warn("[publish-media] cleanup incomplete, will retry later", {
    context,
    profileId: details.profileId,
    count: details.count,
    reason: details.reason?.slice(0, 200),
  });
}

async function sessionBucket(): Promise<MediaBucket | null> {
  try {
    const supabase = await createClient();
    return supabase.storage.from(
      PUBLISH_MEDIA_BUCKET,
    ) as unknown as MediaBucket;
  } catch {
    return null;
  }
}

function adminBucket(): MediaBucket | null {
  return publishMediaAdminBucket() as unknown as MediaBucket | null;
}

/// Deletes the given objects and reports which are confirmed gone. An object
/// missing from Storage's answer counts as gone only if a follow-up listing
/// can't find it (it may have been deleted earlier).
export async function removeMediaPaths(
  bucket: MediaBucket,
  profileId: string,
  paths: string[],
): Promise<{ removed: string[]; failed: string[]; reason?: string }> {
  const safe = [...new Set(paths)].filter((p) => isOwnMediaPath(profileId, p));
  if (safe.length === 0) return { removed: [], failed: [] };

  let deleted: Set<string>;
  try {
    const { data, error } = await bucket.remove(safe);
    if (error) return { removed: [], failed: safe, reason: error.message };
    deleted = new Set((data ?? []).map((o) => o.name));
  } catch {
    return { removed: [], failed: safe, reason: "storage request failed" };
  }

  const removed: string[] = [];
  const failed: string[] = [];
  for (const path of safe) {
    if (deleted.has(path)) {
      removed.push(path);
      continue;
    }
    const file = path.slice(profileId.length + 1);
    try {
      const { data, error } = await bucket.list(profileId, {
        limit: 100,
        search: file,
      });
      if (error) failed.push(path);
      else if ((data ?? []).some((o) => o.name === file)) failed.push(path);
      else removed.push(path);
    } catch {
      failed.push(path);
    }
  }
  return {
    removed,
    failed,
    reason: failed.length ? "object still present after delete" : undefined,
  };
}

/// Removes images whose database reference was just replaced or cleared
/// (re-approval, edit, regenerate, reject). Runs in user actions.
export async function deletePublishMedia(
  profileId: string,
  urls: (string | null | undefined)[],
): Promise<void> {
  const paths = urls
    .map((u) => publishMediaPath(profileId, u))
    .filter((p): p is string => p !== null);
  if (paths.length === 0) return;
  const bucket = (await sessionBucket()) ?? adminBucket();
  if (!bucket) {
    logCleanupFailure("replace", {
      profileId,
      count: paths.length,
      reason: "no storage client",
    });
    return;
  }
  const result = await removeMediaPaths(bucket, profileId, paths);
  if (result.failed.length) {
    // The reference is already gone, so the orphan sweep retries these.
    logCleanupFailure("replace", {
      profileId,
      count: result.failed.length,
      reason: result.reason,
    });
  }
}

/// Deletes the prepared image of PUBLISHED variants and clears the
/// reference for the ones Storage confirms are gone.
export async function cleanupPublishedMedia(
  bucket: MediaBucket,
  profileId: string,
  variantIds?: string[],
): Promise<void> {
  const rows = await prisma.platformVariant.findMany({
    where: {
      profileId,
      publishStatus: "PUBLISHED",
      mediaUrl: { not: null },
      ...(variantIds ? { id: { in: variantIds } } : {}),
    },
    select: { id: true, mediaUrl: true },
    take: 50,
  });
  if (rows.length === 0) return;

  const pathOf = new Map(
    rows.map((r) => [r.id, publishMediaPath(profileId, r.mediaUrl)]),
  );
  const result = await removeMediaPaths(
    bucket,
    profileId,
    [...pathOf.values()].filter((p): p is string => p !== null),
  );
  const removed = new Set(result.removed);
  // A reference that isn't one of our objects can't be deleted; just drop it.
  const clearIds = rows
    .filter((r) => {
      const path = pathOf.get(r.id);
      return path === null || removed.has(path as string);
    })
    .map((r) => r.id);

  if (clearIds.length) {
    await prisma.platformVariant.updateMany({
      where: { id: { in: clearIds }, profileId, publishStatus: "PUBLISHED" },
      data: { mediaUrl: null },
    });
  }
  if (result.failed.length) {
    logCleanupFailure("published", {
      profileId,
      count: result.failed.length,
      reason: result.reason,
    });
  }
}

/// Deletes objects in the profile folder that nothing references and that
/// are older than the grace period.
export async function sweepOrphanedMedia(
  bucket: MediaBucket,
  profileId: string,
  now = new Date(),
): Promise<void> {
  const { data, error } = await bucket.list(profileId, { limit: 100 });
  if (error || !data) {
    if (error)
      logCleanupFailure("orphans", {
        profileId,
        count: 0,
        reason: error.message,
      });
    return;
  }
  const referenced = await prisma.platformVariant.findMany({
    where: { profileId, mediaUrl: { not: null } },
    select: { mediaUrl: true },
  });
  const orphans = findOrphanedPaths({
    profileId,
    objects: data.map((o) => ({
      name: o.name,
      createdAt: o.created_at ?? null,
    })),
    referencedUrls: referenced.map((r) => r.mediaUrl),
    now,
  });
  if (orphans.length === 0) return;
  const result = await removeMediaPaths(bucket, profileId, orphans);
  if (result.failed.length) {
    logCleanupFailure("orphans", {
      profileId,
      count: result.failed.length,
      reason: result.reason,
    });
  }
}

/// Signed-in user housekeeping (runs when /platforms loads).
export async function sweepPublishedMedia(profileId: string): Promise<void> {
  const bucket = await sessionBucket();
  if (!bucket) return;
  try {
    await cleanupPublishedMedia(bucket, profileId);
    await sweepOrphanedMedia(bucket, profileId);
  } catch {
    logCleanupFailure("session-sweep", { profileId, count: 0 });
  }
}

/// Right after a confirmed publish (manual or scheduled). Prefers the
/// service-role client so the scheduler can clean up without a session.
/// Never throws: the post is published whatever happens here.
export async function cleanupAfterPublish(
  variantId: string,
  profileId: string,
): Promise<void> {
  try {
    const bucket = adminBucket() ?? (await sessionBucket());
    if (!bucket) {
      logCleanupFailure("after-publish", {
        profileId,
        count: 1,
        reason: "no storage client",
      });
      return;
    }
    await cleanupPublishedMedia(bucket, profileId, [variantId]);
  } catch {
    logCleanupFailure("after-publish", {
      profileId,
      count: 1,
      reason: "unexpected error",
    });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// Background retry for every profile (scheduler). Needs the service-role
/// key; without it this is a no-op and /platforms visits do the work.
export async function runBackgroundMediaCleanup(
  now = new Date(),
): Promise<void> {
  const bucket = adminBucket();
  if (!bucket) return;
  try {
    const pending = await prisma.platformVariant.findMany({
      where: { publishStatus: "PUBLISHED", mediaUrl: { not: null } },
      select: { profileId: true },
      distinct: ["profileId"],
      take: 20,
    });
    for (const { profileId } of pending) {
      await cleanupPublishedMedia(bucket, profileId);
    }

    const { data: folders } = await bucket.list("", { limit: 100 });
    for (const folder of folders ?? []) {
      if (UUID.test(folder.name)) {
        await sweepOrphanedMedia(bucket, folder.name, now);
      }
    }
  } catch {
    logCleanupFailure("background", { count: 0, reason: "unexpected error" });
  }
}

/// Before campaigns are deleted by trend housekeeping: delete the prepared
/// images their variants still reference. If this can't run (no service
/// key) the orphan sweep removes them later.
export async function deleteMediaForProfiles(
  urlsByProfile: Map<string, string[]>,
): Promise<void> {
  const bucket = adminBucket();
  if (!bucket || urlsByProfile.size === 0) return;
  for (const [profileId, urls] of urlsByProfile) {
    try {
      const paths = urls
        .map((u) => publishMediaPath(profileId, u))
        .filter((p): p is string => p !== null);
      const result = await removeMediaPaths(bucket, profileId, paths);
      if (result.failed.length) {
        logCleanupFailure("campaign-delete", {
          profileId,
          count: result.failed.length,
          reason: result.reason,
        });
      }
    } catch {
      logCleanupFailure("campaign-delete", {
        profileId,
        count: urls.length,
        reason: "unexpected error",
      });
    }
  }
}
