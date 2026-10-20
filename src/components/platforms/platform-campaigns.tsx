"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { VariantPanel } from "@/components/platforms/variant-panel";
import { setPlanPlatforms } from "@/features/platforms/actions";
import type { MetaConnectionView } from "@/features/platforms/meta-actions";
import { PLATFORM_META } from "@/features/platforms/config";
import type {
  ContentPlan,
  Draft,
  ImageAsset,
  PlatformVariant,
  ResearchBrief,
  ScheduledPost,
  Trend,
} from "@/generated/prisma/client";
import {
  campaignPlatformSchema,
  type CampaignPlatform,
  type VariantPlatformValue,
} from "@/validation/platforms";

type Campaign = Draft & {
  contentPlan: ContentPlan & {
    research: ResearchBrief & {
      trend: Trend & { researchRequest: { id: string } | null };
    };
  };
  imageAsset: ImageAsset | null;
  scheduledPost: ScheduledPost | null;
  platformVariants: PlatformVariant[];
};

const ALL_PLATFORMS = campaignPlatformSchema.options;

export function PlatformCampaigns({
  campaigns,
  meta,
}: {
  campaigns: Campaign[];
  meta: MetaConnectionView;
}) {
  if (campaigns.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No completed drafts yet. Finish a LinkedIn draft on the{" "}
        <a href="/writing" className="underline underline-offset-4">
          Writing
        </a>{" "}
        page first — variants are adapted from it.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {campaigns.map((campaign) => (
        <CampaignCard key={campaign.id} campaign={campaign} meta={meta} />
      ))}
    </div>
  );
}

function CampaignCard({
  campaign,
  meta,
}: {
  campaign: Campaign;
  meta: MetaConnectionView;
}) {
  const plan = campaign.contentPlan;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function togglePlatform(platform: CampaignPlatform) {
    const next = plan.platforms.includes(platform)
      ? plan.platforms.filter((p) => p !== platform)
      : [...plan.platforms, platform];
    setPending(true);
    setError("");
    const result = await setPlanPlatforms({ planId: plan.id, platforms: next });
    setPending(false);
    if ("error" in result) setError(result.error);
  }

  const linkedin = campaign.scheduledPost;
  const variantPlatforms = ALL_PLATFORMS.filter(
    (p): p is VariantPlatformValue =>
      p !== "LINKEDIN" && plan.platforms.includes(p),
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{plan.research.trend.topic}</CardTitle>
          <Badge variant="secondary">{plan.format}</Badge>
        </div>
        <CardDescription>
          Select where this campaign should go.
          {plan.research.trend.researchRequest && (
            <>
              {" "}
              <a
                href={`/studio/${plan.research.trend.researchRequest.id}`}
                className="underline underline-offset-2"
              >
                View research and sources
              </a>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {ALL_PLATFORMS.map((platform) => {
            const meta = PLATFORM_META[platform];
            const selected = plan.platforms.includes(platform);
            return (
              <Button
                key={platform}
                size="sm"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                disabled={pending}
                onClick={() => togglePlatform(platform)}
              >
                {meta.label}
              </Button>
            );
          })}
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}

        {plan.platforms.includes("LINKEDIN") && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">LinkedIn</span>
              <span className="text-muted-foreground text-xs">
                {PLATFORM_META.LINKEDIN.note}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Publisher job</Badge>
              <Badge variant={linkedin?.publishedAt ? "default" : "secondary"}>
                {linkedin?.publishedAt
                  ? "Published"
                  : linkedin?.approvalStatus === "APPROVED"
                    ? "Awaiting publish"
                    : "Not approved"}
              </Badge>
              <a
                href="/approval"
                className="text-muted-foreground text-xs underline underline-offset-2"
              >
                Open Approval
              </a>
            </div>
          </div>
        )}

        {variantPlatforms.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            {variantPlatforms.map((platform) => (
              <VariantPanel
                key={platform}
                draftId={campaign.id}
                platform={platform}
                variant={
                  campaign.platformVariants.find(
                    (v) => v.platform === platform,
                  ) ?? null
                }
                imageUrl={
                  campaign.imageAsset?.status === "COMPLETED"
                    ? (campaign.imageAsset.thumbUrl ?? campaign.imageAsset.url)
                    : null
                }
                meta={meta}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
