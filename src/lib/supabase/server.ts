import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import "server-only";

import { clientEnv } from "@/config/env.client";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore because
            // session refresh happens in proxy.ts (Milestone 1) instead.
          }
        },
      },
    },
  );
}
