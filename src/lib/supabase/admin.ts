import { createClient } from "@supabase/supabase-js";

import "server-only";

import { clientEnv } from "@/config/env.client";
import { serverEnv } from "@/config/env.server";
import { PUBLISH_MEDIA_BUCKET } from "@/features/platforms/media-path";

/// Service-role Storage access, scoped in code to the `publish-media` bucket.
/// The service-role key bypasses storage policies, so this module only ever
/// exposes that one bucket's API, and callers in media-cleanup.ts only pass
/// paths already verified as `<profileId>/<uuid>.jpg` for the profile being
/// cleaned. Returns null when the key isn't configured.
export function publishMediaAdminBucket() {
  const key = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const client = createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client.storage.from(PUBLISH_MEDIA_BUCKET);
}
