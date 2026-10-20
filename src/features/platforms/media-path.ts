/// Pure helpers for publishing media: which hosts the server may download
/// campaign images from, and which `publish-media` storage object a public
/// URL refers to. Deletion is restricted to objects under the caller's own
/// profile folder, so a bad URL in the database can never make us delete
/// someone else's file.

export const PUBLISH_MEDIA_BUCKET = "publish-media";

/// The only hosts campaign images are downloaded from (exact match, no
/// wildcards). They are the hosts the configured image providers return:
///  - Unsplash (src/ai/providers/unsplash.ts): `urls.regular` from the API is
///    served from images.unsplash.com; Unsplash+ photos from
///    plus.unsplash.com.
///  - Pollinations (src/ai/providers/pollinations.ts): generation URLs on
///    gen.pollinations.ai (with API key) or image.pollinations.ai (legacy
///    anonymous), and hosted/branded images on media.pollinations.ai.
/// The Gemini image provider is disabled (see gemini-image.ts); if it, or a
/// new provider, starts returning image URLs, add its host here.
export const PUBLISH_IMAGE_HOSTS: ReadonlySet<string> = new Set([
  "images.unsplash.com",
  "plus.unsplash.com",
  "gen.pollinations.ai",
  "image.pollinations.ai",
  "media.pollinations.ai",
]);

/// `<profileId>/<uuid>.jpg` for a Supabase public URL of our bucket, or null
/// when the URL is not one of ours for this profile.
export function publishMediaPath(
  profileId: string,
  publicUrl: string | null | undefined,
): string | null {
  if (!publicUrl) return null;
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return null;
  }
  const prefix = `/storage/v1/object/public/${PUBLISH_MEDIA_BUCKET}/`;
  if (!url.pathname.startsWith(prefix)) return null;

  const path = decodeURIComponent(url.pathname.slice(prefix.length));
  return isOwnMediaPath(profileId, path) ? path : null;
}

/// True for exactly `<profileId>/<uuid>.jpg`: the only object shape this app
/// creates in the bucket.
export function isOwnMediaPath(profileId: string, path: string): boolean {
  const [folder, file, ...rest] = path.split("/");
  return (
    rest.length === 0 &&
    folder === profileId &&
    !!file &&
    /^[0-9a-f-]{36}\.jpg$/i.test(file)
  );
}

/// Objects in a profile folder that no variant references any more and are
/// old enough that an approval in flight (upload first, then the database
/// update) can't be racing with the cleanup.
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export function findOrphanedPaths(input: {
  profileId: string;
  objects: { name: string; createdAt: string | null }[];
  referencedUrls: (string | null)[];
  now: Date;
}): string[] {
  const referenced = new Set(
    input.referencedUrls
      .map((u) => publishMediaPath(input.profileId, u))
      .filter((p): p is string => p !== null),
  );
  const cutoff = input.now.getTime() - ORPHAN_GRACE_MS;
  return input.objects
    .map((o) => ({
      path: `${input.profileId}/${o.name}`,
      createdAt: o.createdAt,
    }))
    .filter(
      (o) =>
        isOwnMediaPath(input.profileId, o.path) &&
        !referenced.has(o.path) &&
        o.createdAt !== null &&
        Date.parse(o.createdAt) < cutoff,
    )
    .map((o) => o.path);
}
