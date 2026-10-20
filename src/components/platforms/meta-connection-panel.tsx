"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  disconnectMeta,
  listMetaPages,
  selectMetaPage,
  startMetaConnect,
  type MetaConnectionView,
  type PageOption,
} from "@/features/platforms/meta-actions";

/// Messages for the short status code the OAuth callback appends to
/// /platforms?meta=... (the callback never puts provider text in a URL).
const CALLBACK_NOTICE: Record<string, { text: string; tone: "ok" | "bad" }> = {
  connected: {
    text: "Meta account connected. Choose a Facebook Page below.",
    tone: "ok",
  },
  denied: {
    text: "Authorization was cancelled, so nothing was connected.",
    tone: "bad",
  },
  state_invalid: {
    text: "The authorization could not be verified (state mismatch). Try connecting again.",
    tone: "bad",
  },
  state_expired: {
    text: "The authorization took too long. Try connecting again.",
    tone: "bad",
  },
  not_configured: {
    text: "Meta publishing is not configured on the server.",
    tone: "bad",
  },
  error: {
    text: "Meta could not complete the connection. Try again, and check the server setup if it keeps failing.",
    tone: "bad",
  },
};

export function MetaConnectionPanel({
  view,
  callbackCode,
}: {
  view: MetaConnectionView;
  callbackCode: string | null;
}) {
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pages, setPages] = useState<PageOption[] | null>(null);

  const connection = view.connection;
  const callback = callbackCode ? CALLBACK_NOTICE[callbackCode] : undefined;
  const busy = pendingOp !== null;

  async function connect() {
    setPendingOp("connect");
    setError("");
    // On success the server action redirects to Meta and never returns.
    const result = await startMetaConnect();
    setPendingOp(null);
    if ("error" in result) setError(result.error);
  }

  async function loadPages() {
    setPendingOp("pages");
    setError("");
    const result = await listMetaPages();
    setPendingOp(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setPages(result.pages);
    if (result.pages.length === 0) {
      setError(
        "Meta returned no Pages for this account. You need to be an admin or editor of a Facebook Page, and you must have granted access to it during authorization.",
      );
    }
  }

  async function choose(pageId: string) {
    setPendingOp(`page:${pageId}`);
    setError("");
    const result = await selectMetaPage({ pageId });
    setPendingOp(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setNotice(result.message ?? "");
    setPages(null);
  }

  async function disconnect() {
    setPendingOp("disconnect");
    setError("");
    const result = await disconnectMeta();
    setPendingOp(null);
    if ("error" in result) setError(result.error);
    else setNotice(result.message ?? "");
    setPages(null);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Meta account</CardTitle>
          {!view.configured ? (
            <Badge variant="secondary">Not configured</Badge>
          ) : !connection ? (
            <Badge variant="secondary">Not connected</Badge>
          ) : connection.status === "NEEDS_REAUTH" ? (
            <Badge variant="destructive">Reconnect needed</Badge>
          ) : (
            <Badge>Connected</Badge>
          )}
        </div>
        <CardDescription>
          Connect through Meta&apos;s official login to publish to a Facebook
          Page and its linked Instagram professional account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {callback && (
          <Alert variant={callback.tone === "bad" ? "destructive" : "default"}>
            <AlertDescription>{callback.text}</AlertDescription>
          </Alert>
        )}

        {!view.configured && (
          <Alert>
            <AlertTitle>Meta app setup needed</AlertTitle>
            <AlertDescription>
              <p>
                Set these server environment variables, then redeploy:{" "}
                {view.missingConfig.join(", ")}.
              </p>
              <p>
                In your Meta app, add the Facebook Login product and allow this
                exact redirect URI:{" "}
                <span className="font-mono break-all">{view.redirectUri}</span>
              </p>
              <p>See the README section &quot;Meta publishing&quot;.</p>
            </AlertDescription>
          </Alert>
        )}

        {view.configured && !connection && (
          <div className="flex flex-col items-start gap-2">
            <Button disabled={busy} onClick={connect}>
              {pendingOp === "connect"
                ? "Redirecting…"
                : "Connect Meta account"}
            </Button>
            <p className="text-muted-foreground text-xs">
              You will be sent to Meta to approve access. Tokens are stored
              encrypted on the server and are never shown in the browser.
            </p>
          </div>
        )}

        {connection && (
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">Meta user</span>
                <span>{connection.userName ?? "Connected account"}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">
                  Facebook Page
                </span>
                <span>
                  {connection.pageName ?? (
                    <span className="text-muted-foreground">
                      None selected yet
                    </span>
                  )}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">Instagram</span>
                <span>
                  {!connection.pageId ? (
                    <span className="text-muted-foreground">
                      Select a Page first
                    </span>
                  ) : connection.hasInstagram ? (
                    `@${connection.instagramUsername ?? "linked account"}`
                  ) : (
                    <span className="text-muted-foreground">
                      No Instagram professional account linked to this Page
                    </span>
                  )}
                </span>
              </div>
              {connection.userTokenExpiresAt && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-xs">
                    Meta login valid until
                  </span>
                  <span>
                    {new Date(
                      connection.userTokenExpiresAt,
                    ).toLocaleDateString()}
                    {connection.userTokenExpired && " (expired)"}
                  </span>
                </div>
              )}
            </div>

            {connection.status === "NEEDS_REAUTH" && (
              <Alert variant="destructive">
                <AlertDescription>
                  {connection.lastError ??
                    "Meta rejected the saved token. Reconnect your Meta account."}
                </AlertDescription>
              </Alert>
            )}
            {connection.missingScopes.length > 0 && (
              <Alert>
                <AlertTitle>Some permissions were not granted</AlertTitle>
                <AlertDescription>
                  Missing: {connection.missingScopes.join(", ")}. Publishing
                  needs all of them. Reconnect and approve every permission.
                </AlertDescription>
              </Alert>
            )}
            {connection.userTokenExpired && (
              <p className="text-muted-foreground text-xs">
                The Meta login expired, so Pages can&apos;t be re-listed.
                Publishing to the already selected Page keeps working until Meta
                invalidates its Page token. Reconnect to change Pages.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || connection.userTokenExpired}
                onClick={loadPages}
              >
                {pendingOp === "pages"
                  ? "Loading Pages…"
                  : connection.pageId
                    ? "Change Page"
                    : "Choose Page"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={connect}
              >
                Reconnect
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={disconnect}
              >
                {pendingOp === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>

            {pages && pages.length > 0 && (
              <div className="grid gap-2">
                {pages.map((page) => (
                  <div
                    key={page.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{page.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {page.hasInstagram
                          ? `Instagram @${page.instagramUsername ?? "linked"}`
                          : "No linked Instagram account"}
                        {!page.canPublish &&
                          " · your role can't create content here"}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy || !page.canPublish}
                      onClick={() => choose(page.id)}
                    >
                      {pendingOp === `page:${page.id}`
                        ? "Selecting…"
                        : "Use this Page"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {notice && <p className="text-muted-foreground text-sm">{notice}</p>}
        {error && <p className="text-destructive text-sm">{error}</p>}

        {view.configured && !view.scheduler && (
          <p className="text-muted-foreground text-xs">
            Scheduled publishing is off: META_PUBLISH_WEBHOOK_SECRET is not set.
            Use Publish now on approved variants.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
