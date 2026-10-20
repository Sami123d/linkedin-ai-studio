import type { CampaignPlatform } from "@/validation/platforms";

/// Static per-platform copy. Connection state for Facebook/Instagram is live
/// (see MetaConnectionView); LinkedIn is published by the external publisher
/// job, which the app can not observe.
export const PLATFORM_META: Record<
  CampaignPlatform,
  { label: string; note: string }
> = {
  LINKEDIN: {
    label: "LinkedIn",
    note: "Published by the external scheduler job. Use Writing and Approval.",
  },
  FACEBOOK: {
    label: "Facebook Page",
    note: "Posts to the Facebook Page selected above (never a personal profile). Text, a link, or one image.",
  },
  INSTAGRAM: {
    label: "Instagram",
    note: "Posts a single image to the linked Instagram professional account. An image is required.",
  },
};
