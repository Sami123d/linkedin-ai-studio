"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  approveVariant,
  checkVariantStatus,
  generateVariantAction,
  publishVariantNow,
  rejectVariant,
  saveVariant,
  saveVariantOptions,
} from "@/features/platforms/actions";
import type { MetaConnectionView } from "@/features/platforms/meta-actions";
import { PLATFORM_META } from "@/features/platforms/config";
import {
  composeCaption,
  PLATFORM_LIMITS,
  validateVariantLimits,
} from "@/features/platforms/limits";
import {
  deriveDisplayState,
  type VariantDisplayState,
} from "@/features/platforms/publish-state";
import { parseHashtagInput } from "@/features/platforms/variant-state";
import type { DraftStatus, PlatformVariant } from "@/generated/prisma/client";
import type { VariantPlatformValue } from "@/validation/platforms";

const GENERATION_LABEL: Record<DraftStatus, string> = {
  PENDING: "Not generated",
  PROCESSING: "Generating",
  COMPLETED: "Ready",
  FAILED: "Generation failed",
};

/// The states the user must be able to tell apart (approved vs scheduled vs
/// publishing vs published vs failed vs account not connected).
const DISPLAY: Record<
  VariantDisplayState,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  NOT_APPROVED: { label: "Not approved", variant: "secondary" },
  ACCOUNT_NOT_CONNECTED: {
    label: "Approved · account not connected",
    variant: "secondary",
  },
  APPROVED: { label: "Approved · not published", variant: "secondary" },
  SCHEDULED: { label: "Scheduled", variant: "secondary" },
  PUBLISHING: { label: "Publishing…", variant: "secondary" },
  PUBLISHED: { label: "Published", variant: "default" },
  FAILED: { label: "Publish failed", variant: "destructive" },
  UNCONFIRMED: { label: "Outcome unconfirmed", variant: "destructive" },
};

function defaultScheduleValue(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/// The connected Page/Instagram account this platform would publish to.
function accountReady(
  platform: VariantPlatformValue,
  connection: MetaConnectionView["connection"],
): boolean {
  if (!connection || connection.status !== "CONNECTED" || !connection.pageId) {
    return false;
  }
  return platform === "FACEBOOK" ? true : connection.hasInstagram;
}

export function VariantPanel({
  draftId,
  platform,
  variant,
  imageUrl,
  meta,
}: {
  draftId: string;
  platform: VariantPlatformValue;
  variant: PlatformVariant | null;
  imageUrl: string | null;
  meta: MetaConnectionView;
}) {
  const info = PLATFORM_META[platform];
  const limits = PLATFORM_LIMITS[platform];
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [scheduleFor, setScheduleFor] = useState(defaultScheduleValue);
  const [reason, setReason] = useState("");
  const [linkInput, setLinkInput] = useState(variant?.linkUrl ?? "");
  const [includeImage, setIncludeImage] = useState(
    variant?.includeImage ?? false,
  );
  const [confirmAnyway, setConfirmAnyway] = useState(false);

  const busy = pendingOp !== null;
  const genStatus: DraftStatus = variant?.status ?? "PENDING";
  const hasContent = !!variant?.content;
  const publishStatus = variant?.publishStatus ?? "NOT_PUBLISHED";
  const locked =
    publishStatus === "PUBLISHING" ||
    publishStatus === "PUBLISHED" ||
    publishStatus === "UNCONFIRMED";
  const ready = accountReady(platform, meta.connection);
  const display = variant
    ? deriveDisplayState(
        {
          approvalStatus: variant.approvalStatus,
          publishStatus: variant.publishStatus,
          scheduledFor: variant.scheduledFor
            ? new Date(variant.scheduledFor)
            : null,
        },
        ready,
      )
    : "NOT_APPROVED";
  const caption = hasContent
    ? composeCaption(variant?.content ?? "", variant?.hashtags ?? [])
    : "";

  async function run(
    op: string,
    action: () => Promise<
      { error: string } | { success: true; message?: string }
    >,
  ) {
    setPendingOp(op);
    setError("");
    setNotice("");
    const result = await action();
    setPendingOp(null);
    if ("error" in result) {
      setError(result.error);
      return false;
    }
    if (result.message) setNotice(result.message);
    return true;
  }

  function openEditor() {
    setDraftContent(variant?.content ?? "");
    setDraftTags((variant?.hashtags ?? []).map((h) => `#${h}`).join(" "));
    setError("");
    setEditOpen(true);
  }

  const editTags = parseHashtagInput(draftTags).map((t) =>
    t.replace(/^#+/, ""),
  );
  const editIssues = validateVariantLimits(platform, draftContent, editTags);

  async function handleSave() {
    const ok = await run("save", () =>
      saveVariant({
        variantId: variant?.id,
        content: draftContent,
        hashtags: parseHashtagInput(draftTags),
      }),
    );
    if (ok) setEditOpen(false);
  }

  const canPublish =
    variant?.approvalStatus === "APPROVED" &&
    genStatus === "COMPLETED" &&
    (publishStatus === "NOT_PUBLISHED" || publishStatus === "FAILED");

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{info.label}</span>
        <div className="flex flex-wrap items-center gap-2">
          {genStatus !== "COMPLETED" && !hasContent ? (
            <Badge
              variant={genStatus === "FAILED" ? "destructive" : "secondary"}
            >
              {GENERATION_LABEL[genStatus]}
            </Badge>
          ) : (
            <Badge variant={DISPLAY[display].variant}>
              {DISPLAY[display].label}
            </Badge>
          )}
          {variant?.approvalStatus === "REJECTED" && (
            <Badge variant="destructive">Rejected</Badge>
          )}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{info.note}</p>

      {hasContent ? (
        <div className="flex flex-col gap-2">
          {(platform === "INSTAGRAM" || includeImage) &&
            (imageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- external image URLs, same as the Images queue */}
                <img
                  src={imageUrl}
                  alt="Campaign image"
                  className="aspect-square w-full max-w-48 rounded-lg border object-cover"
                />
              </>
            ) : (
              <p className="text-muted-foreground text-xs">
                No image yet.{" "}
                {platform === "INSTAGRAM"
                  ? "Instagram needs one"
                  : "Needed for an image post"}{" "}
                — generate it on the Images page.
              </p>
            ))}
          <p className="bg-muted/50 rounded-lg p-3 text-sm whitespace-pre-wrap">
            {caption}
          </p>
          <p
            className={
              caption.length > limits.maxCaptionChars
                ? "text-destructive text-xs"
                : "text-muted-foreground text-xs"
            }
          >
            {caption.length.toLocaleString()} /{" "}
            {limits.maxCaptionChars.toLocaleString()} characters ·{" "}
            {variant?.hashtags.length ?? 0} / {limits.maxHashtags} hashtags
            {variant?.edited ? " · edited" : ""}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">Not generated yet.</p>
      )}

      {genStatus === "FAILED" && variant?.errorMessage && (
        <p className="text-destructive text-xs">
          {variant.errorMessage}
          {hasContent && " The last saved version is shown above."}
        </p>
      )}
      {variant?.approvalStatus === "REJECTED" && variant.rejectionReason && (
        <p className="text-muted-foreground text-xs">
          Reason: {variant.rejectionReason}
        </p>
      )}

      {/* Publishing status, in plain words */}
      {display === "SCHEDULED" && variant?.scheduledFor && (
        <p className="text-muted-foreground text-xs">
          Planned for {new Date(variant.scheduledFor).toLocaleString()}. It
          posts then only if the Meta publisher job is running
          {meta.scheduler ? "" : " (not configured on this server)"}; otherwise
          use Publish now.
        </p>
      )}
      {display === "ACCOUNT_NOT_CONNECTED" && (
        <p className="text-muted-foreground text-xs">
          {platform === "INSTAGRAM" &&
          meta.connection?.pageId &&
          !meta.connection.hasInstagram
            ? "The selected Page has no linked Instagram professional account."
            : "Connect a Meta account and select a Page above to publish."}
        </p>
      )}
      {display === "PUBLISHED" && (
        <p className="text-xs">
          Published{" "}
          {variant?.publishedAt &&
            new Date(variant.publishedAt).toLocaleString()}
          .{" "}
          {variant?.publishedUrl ? (
            <a
              href={variant.publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              View post
            </a>
          ) : (
            <span className="text-muted-foreground">
              Post id {variant?.publishedPostId} (no link returned).
            </span>
          )}
        </p>
      )}
      {variant?.publishError && display !== "PUBLISHED" && (
        <p
          className={
            publishStatus === "FAILED" || publishStatus === "UNCONFIRMED"
              ? "text-destructive text-xs"
              : "text-muted-foreground text-xs"
          }
        >
          {variant.publishError}
        </p>
      )}
      {display === "PUBLISHING" && (
        <p className="text-muted-foreground text-xs">
          A publish is in progress. Refresh in a moment; do not publish again.
        </p>
      )}

      {notice && <p className="text-muted-foreground text-xs">{notice}</p>}
      {error && !editOpen && (
        <p className="text-destructive text-sm">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {!locked && (
          <Button
            size="sm"
            variant={hasContent ? "outline" : "default"}
            disabled={busy || genStatus === "PROCESSING"}
            onClick={() =>
              run("generate", () =>
                generateVariantAction({ draftId, platform }),
              )
            }
          >
            {pendingOp === "generate"
              ? "Generating…"
              : hasContent
                ? "Regenerate"
                : "Generate"}
          </Button>
        )}
        {hasContent && !locked && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={openEditor}
          >
            Edit
          </Button>
        )}
      </div>

      {platform === "FACEBOOK" && hasContent && !locked && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={
                includeImage && !linkInput.trim() ? "default" : "outline"
              }
              aria-pressed={includeImage}
              disabled={busy || !!linkInput.trim()}
              onClick={() => setIncludeImage((v) => !v)}
            >
              Image: {includeImage && !linkInput.trim() ? "on" : "off"}
            </Button>
            <span className="text-muted-foreground text-xs">
              A Facebook post can have an image or a link, not both.
            </span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`link-${draftId}`}>Link (optional)</Label>
            <Input
              id={`link-${draftId}`}
              type="url"
              placeholder="https://"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={busy}
            onClick={() =>
              run("options", () =>
                saveVariantOptions({
                  variantId: variant?.id,
                  includeImage,
                  linkUrl: linkInput,
                }),
              )
            }
          >
            {pendingOp === "options" ? "Saving…" : "Save options"}
          </Button>
        </div>
      )}

      {hasContent && genStatus === "COMPLETED" && !locked && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`schedule-${draftId}-${platform}`}>Plan for</Label>
            <Input
              id={`schedule-${draftId}-${platform}`}
              type="datetime-local"
              value={scheduleFor}
              onChange={(e) => setScheduleFor(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`reason-${draftId}-${platform}`}>
              Rejection reason (optional)
            </Label>
            <Input
              id={`reason-${draftId}-${platform}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run("approve", () =>
                  approveVariant({
                    variantId: variant?.id,
                    scheduledFor: scheduleFor,
                  }),
                )
              }
            >
              {pendingOp === "approve" ? "Approving…" : "Approve & schedule"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                run("reject", () =>
                  rejectVariant({ variantId: variant?.id, reason }),
                )
              }
            >
              {pendingOp === "reject" ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </div>
      )}

      {(canPublish || publishStatus === "UNCONFIRMED") && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {canPublish && (
            <Button
              size="sm"
              disabled={busy || !ready}
              onClick={() =>
                run("publish", () =>
                  publishVariantNow({ variantId: variant?.id }),
                )
              }
            >
              {pendingOp === "publish"
                ? "Publishing…"
                : publishStatus === "FAILED"
                  ? "Retry publish"
                  : "Publish now"}
            </Button>
          )}
          {publishStatus === "UNCONFIRMED" && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run("check", () =>
                    checkVariantStatus({ variantId: variant?.id }),
                  )
                }
              >
                {pendingOp === "check" ? "Checking…" : "Check status"}
              </Button>
              {!confirmAnyway ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmAnyway(true)}
                >
                  Publish anyway…
                </Button>
              ) : (
                <>
                  <span className="text-destructive text-xs">
                    Only if you checked the post is NOT live — this may create a
                    duplicate.
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy || !ready}
                    onClick={() =>
                      run("publish", () =>
                        publishVariantNow({
                          variantId: variant?.id,
                          acknowledgeUnconfirmed: true,
                        }),
                      )
                    }
                  >
                    {pendingOp === "publish" ? "Publishing…" : "Yes, publish"}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {info.label} version</DialogTitle>
            <DialogDescription>
              Saving an edit clears any earlier approval.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`content-${draftId}-${platform}`}>Text</Label>
              <Textarea
                id={`content-${draftId}-${platform}`}
                rows={10}
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`tags-${draftId}-${platform}`}>Hashtags</Label>
              <Input
                id={`tags-${draftId}-${platform}`}
                value={draftTags}
                onChange={(e) => setDraftTags(e.target.value)}
                placeholder="#one #two"
              />
            </div>
            <p
              className={
                editIssues.length > 0
                  ? "text-destructive text-xs"
                  : "text-muted-foreground text-xs"
              }
            >
              {composeCaption(draftContent, editTags).length.toLocaleString()} /{" "}
              {limits.maxCaptionChars.toLocaleString()} characters
              {editIssues.length > 0 && ` · ${editIssues.join(" ")}`}
            </p>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                draftContent.trim().length === 0 ||
                editIssues.length > 0
              }
              onClick={handleSave}
            >
              {pendingOp === "save" ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
