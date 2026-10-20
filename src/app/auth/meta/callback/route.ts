import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { clientEnv } from "@/config/env.client";
import { serverEnv } from "@/config/env.server";
import { prisma } from "@/db/prisma";
import { graphDeps } from "@/features/platforms/publish";
import { requireProfileId } from "@/features/knowledge-base/session";
import { parseEncryptionKey } from "@/lib/crypto/aes-gcm";
import { encryptToken } from "@/lib/crypto/token-crypto";
import { MetaApiError } from "@/lib/meta/graph";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchMe,
  fetchPermissions,
} from "@/lib/meta/oauth";
import { META_STATE_COOKIE, verifyOAuthState } from "@/lib/meta/oauth-state";

/// Meta redirects here after the user approves or cancels. The response only
/// ever redirects back to /platforms with a short status code; tokens,
/// codes and provider messages never appear in a URL or response body.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const done = (code: string) =>
    NextResponse.redirect(`${origin}/platforms?meta=${code}`);

  // Session-authenticated (the cookie travels with the browser redirect).
  const profileId = await requireProfileId();

  const cookieStore = await cookies();
  const nonce = cookieStore.get(META_STATE_COOKIE)?.value;
  cookieStore.delete({ name: META_STATE_COOKIE, path: "/auth/meta" });

  if (
    !serverEnv.META_APP_ID ||
    !serverEnv.META_APP_SECRET ||
    !serverEnv.TOKEN_ENCRYPTION_KEY
  ) {
    return done("not_configured");
  }

  // Validate state before trusting anything else in the query string.
  const key = parseEncryptionKey(serverEnv.TOKEN_ENCRYPTION_KEY);
  const state = verifyOAuthState(
    searchParams.get("state"),
    nonce,
    profileId,
    key,
  );
  if (!state.valid) {
    return done(state.reason === "expired" ? "state_expired" : "state_invalid");
  }

  if (searchParams.get("error")) {
    return done(
      searchParams.get("error") === "access_denied" ? "denied" : "error",
    );
  }
  const code = searchParams.get("code");
  if (!code) return done("error");

  try {
    const deps = graphDeps();
    const redirectUri = `${origin}/auth/meta/callback`;
    const short = await exchangeCodeForToken(
      {
        appId: serverEnv.META_APP_ID,
        appSecret: serverEnv.META_APP_SECRET,
        redirectUri,
        code,
      },
      deps,
    );
    const long = await exchangeForLongLivedToken(
      {
        appId: serverEnv.META_APP_ID,
        appSecret: serverEnv.META_APP_SECRET,
        shortLivedToken: short.token,
      },
      deps,
    );
    const [me, permissions] = await Promise.all([
      fetchMe(long.token, deps),
      fetchPermissions(long.token, deps),
    ]);

    const data = {
      status: "CONNECTED" as const,
      metaUserId: me.id,
      metaUserName: me.name ?? null,
      userTokenEnc: encryptToken(long.token),
      userTokenExpiresAt: long.expiresAt ?? null,
      grantedScopes: permissions.granted,
      declinedScopes: permissions.declined,
      lastError: null,
    };
    const existing = await prisma.metaConnection.findUnique({
      where: { profileId },
    });
    // Reconnecting as a different Meta user invalidates the old Page choice.
    const sameUser = existing?.metaUserId === me.id;
    await prisma.metaConnection.upsert({
      where: { profileId },
      create: { profileId, ...data },
      update: sameUser
        ? data
        : {
            ...data,
            pageId: null,
            pageName: null,
            pageTokenEnc: null,
            instagramAccountId: null,
            instagramUsername: null,
          },
    });
    return done("connected");
  } catch (error) {
    // Deliberately no logging of the error object: it can carry request
    // details. The category is enough to debug.
    console.error(
      "Meta OAuth callback failed:",
      error instanceof MetaApiError ? error.category : "unexpected",
    );
    return done("error");
  }
}
