import { MetaConnectionPanel } from "@/components/platforms/meta-connection-panel";
import { PlatformCampaigns } from "@/components/platforms/platform-campaigns";
import { getMetaConnectionStatus } from "@/features/platforms/meta-actions";
import { listPlatformCampaigns } from "@/features/platforms/actions";

/// Server Actions on this page (Publish now polls Meta, up to ~25s for an
/// Instagram image) use the page's limit, not the platform default.
export const maxDuration = 60;

export default async function PlatformsPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string }>;
}) {
  const [{ meta: callbackCode }, campaigns, meta] = await Promise.all([
    searchParams,
    listPlatformCampaigns(),
    getMetaConnectionStatus(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platforms</h1>
        <p className="text-muted-foreground">
          Adapt a completed LinkedIn draft for Facebook and Instagram, review
          and approve each version, then publish it through your connected Meta
          account. A post only shows as Published after Meta confirms it.
        </p>
      </div>

      <MetaConnectionPanel view={meta} callbackCode={callbackCode ?? null} />
      <PlatformCampaigns campaigns={campaigns} meta={meta} />
    </div>
  );
}
