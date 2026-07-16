import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/// Every Knowledge Base server action scopes its Prisma query by this id.
/// Prisma's own connection bypasses RLS (see schema.prisma's top comment),
/// so this check — not a database policy — is what actually prevents one
/// user from reading/writing another user's facet rows.
export async function requireProfileId(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data) {
    redirect("/login");
  }

  return data.claims.sub;
}
