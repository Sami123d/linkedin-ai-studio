/// Computed, never stored (see schema.prisma's AnalyticsSnapshot comment)
/// so it can never drift out of sync with the raw counts it's derived
/// from. Plain utility, not a server action — kept out of actions.ts since
/// a "use server" file's exports must all be async functions.
export function computeEngagementRate(snapshot: {
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}): number | null {
  if (!snapshot.impressions || snapshot.impressions === 0) return null;
  const engagements =
    (snapshot.likes ?? 0) + (snapshot.comments ?? 0) + (snapshot.shares ?? 0);
  return engagements / snapshot.impressions;
}
