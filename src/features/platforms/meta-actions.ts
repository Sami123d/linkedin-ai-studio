"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { serverEnv } from "@/config/env.server";
import { clientEnv } from "@/config/env.client";
import { prisma } from "@/db/prisma";
import { graphDeps } from "@/features/platforms/publish";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { decryptToken, encryptToken } from "@/lib/crypto/token-crypto";
import { parseEncryptionKey } from "@/lib/crypto/aes-gcm";
import { MetaApiError } from "@/lib/meta/graph";
import {
  buildAuthUrl,
  canPublishToPage,
  fetchPages,
  REQUIRED_SCOPES,
} from "@/lib/meta/oauth";
import {
  createOAuthState,
  META_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
} from "@/lib/meta/oauth-state";

function redirectUri(): string {
  return `${clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/auth/meta/callback`;
}

/// Names of the missing env vars (never their values).
function missingConfig(): string[] {
  const missing: string[] = [];
  if (!serverEnv.META_APP_ID) missing.push("META_APP_ID");
  if (!serverEnv.META_APP_SECRET) missing.push("META_APP_SECRET");
  if (!serverEnv.TOKEN_ENCRYPTION_KEY) missing.push("TOKEN_ENCRYPTION_KEY");
  return missing;
}

export type MetaConnectionView = {
  configured: boolean;
  missingConfig: string[];
  redirectUri: string;
  scheduler: boolean;
  connection: null | {
    status: "CONNECTED" | "NEEDS_REAUTH";
    userName: string | null;
    pageId: string | null;
    pageName: string | null;
    instagramUsername: string | null;
    hasInstagram: boolean;
    missingScopes: string[];
    userTokenExpiresAt: Date | null;
    userTokenExpired: boolean;
    lastError: string | null;
  };
};

/// Safe view for the UI: never contains a token or the app secret.
export async function getMetaConnectionStatus(): Promise<MetaConnectionView> {
  const profileId = await requireProfileId();
  const missing = missingConfig();

  const row = await prisma.metaConnection.findUnique({ where: { profileId } });
  return {
    configured: missing.length === 0,
    missingConfig: missing,
    redirectUri: redirectUri(),
    scheduler: Boolean(serverEnv.META_PUBLISH_WEBHOOK_SECRET),
    connection: row
      ? {
          status: row.status,
          userName: row.metaUserName,
          pageId: row.pageId,
          pageName: row.pageName,
          instagramUsername: row.instagramUsername,
          hasInstagram: Boolean(row.instagramAccountId),
          missingScopes: REQUIRED_SCOPES.filter(
            (s) => !row.grantedScopes.includes(s),
          ),
          userTokenExpiresAt: row.userTokenExpiresAt,
          userTokenExpired: Boolean(
            row.userTokenExpiresAt && row.userTokenExpiresAt < new Date(),
          ),
          lastError: row.lastError,
        }
      : null,
  };
}

/// Starts Meta's OAuth flow: sets the CSRF nonce cookie and redirects.
export async function startMetaConnect(): Promise<ActionResult> {
  const profileId = await requireProfileId();

  if (missingConfig().length > 0) {
    return {
      error:
        "Meta publishing isn't configured on the server yet. See the setup steps below.",
    };
  }

  const { state, nonce } = createOAuthState(
    profileId,
    parseEncryptionKey(serverEnv.TOKEN_ENCRYPTION_KEY as string),
  );
  const cookieStore = await cookies();
  cookieStore.set(META_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: clientEnv.NEXT_PUBLIC_SITE_URL.startsWith("https://"),
    path: "/auth/meta",
    maxAge: OAUTH_STATE_TTL_MS / 1000,
  });

  redirect(
    buildAuthUrl({
      appId: serverEnv.META_APP_ID as string,
      redirectUri: redirectUri(),
      state,
      version: serverEnv.META_GRAPH_API_VERSION,
    }),
  );
}

export type PageOption = {
  id: string;
  name: string;
  canPublish: boolean;
  instagramUsername: string | null;
  hasInstagram: boolean;
};

type UserTokenResult = { error: string } | { error?: undefined; token: string };

async function userTokenFor(profileId: string): Promise<UserTokenResult> {
  const row = await prisma.metaConnection.findUnique({ where: { profileId } });
  if (!row) return { error: "Connect a Meta account first." };
  if (row.userTokenExpiresAt && row.userTokenExpiresAt < new Date()) {
    return {
      error:
        "Your Meta login expired. Reconnect your Meta account to choose a Page.",
    };
  }
  try {
    return { token: decryptToken(row.userTokenEnc) };
  } catch {
    return {
      error:
        "The stored Meta token could not be read. Reconnect your Meta account.",
    };
  }
}

async function markReauth(profileId: string, message: string) {
  await prisma.metaConnection.updateMany({
    where: { profileId },
    data: { status: "NEEDS_REAUTH", lastError: message },
  });
  revalidatePath("/platforms");
}

/// Pages the authorized user can manage (fetched live from Meta).
export async function listMetaPages(): Promise<
  { error: string } | { pages: PageOption[] }
> {
  const profileId = await requireProfileId();

  const auth = await userTokenFor(profileId);
  if (auth.error !== undefined) return { error: auth.error };

  try {
    const pages = await fetchPages(auth.token, graphDeps());
    return {
      pages: pages.map((p) => ({
        id: p.id,
        name: p.name,
        canPublish: canPublishToPage(p),
        hasInstagram: p.instagram !== null,
        instagramUsername: p.instagram?.username ?? null,
      })),
    };
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (error.needsReconnect) await markReauth(profileId, error.safeMessage);
      return { error: error.safeMessage };
    }
    return { error: "Could not load your Pages." };
  }
}

const selectPageSchema = z.object({ pageId: z.string().min(1).max(64) });

/// Selects a Page. The id is only accepted if Meta lists it for this user's
/// token right now, so the client can never name an arbitrary Page.
export async function selectMetaPage(input: unknown): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = selectPageSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid Page." };

  const auth = await userTokenFor(profileId);
  if (auth.error !== undefined) return { error: auth.error };

  let pages;
  try {
    pages = await fetchPages(auth.token, graphDeps());
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (error.needsReconnect) await markReauth(profileId, error.safeMessage);
      return { error: error.safeMessage };
    }
    return { error: "Could not verify the Page with Meta." };
  }

  const page = pages.find((p) => p.id === parsed.data.pageId);
  if (!page) {
    return { error: "That Page isn't available to your Meta account." };
  }
  if (!canPublishToPage(page)) {
    return {
      error:
        "Your Meta account can't create content on that Page (it needs the CREATE_CONTENT task). Ask a Page admin to adjust your role.",
    };
  }

  await prisma.metaConnection.updateMany({
    where: { profileId },
    data: {
      status: "CONNECTED",
      pageId: page.id,
      pageName: page.name,
      pageTokenEnc: encryptToken(page.accessToken),
      instagramAccountId: page.instagram?.id ?? null,
      instagramUsername: page.instagram?.username ?? null,
      lastError: null,
    },
  });

  revalidatePath("/platforms");
  return {
    success: true,
    message: page.instagram
      ? `Connected ${page.name} and Instagram @${page.instagram.username ?? page.instagram.id}.`
      : `Connected ${page.name}. No Instagram professional account is linked to this Page.`,
  };
}

/// Removes the stored tokens. This only disconnects the app locally; to
/// revoke the app on Meta's side, remove it in Facebook Settings → Business
/// integrations.
export async function disconnectMeta(): Promise<ActionResult> {
  const profileId = await requireProfileId();
  await prisma.metaConnection.deleteMany({ where: { profileId } });
  revalidatePath("/platforms");
  return { success: true, message: "Meta account disconnected." };
}
