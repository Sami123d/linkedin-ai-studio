import "server-only";

import { prisma } from "@/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

/// How long things are kept before housekeeping removes them. Ages are
/// measured from when the trend was collected (untouched trends) or when
/// the pipeline was started on it (research brief creation), so a trend
/// that is old but was only just processed isn't deleted from under you.
export const DEFAULT_RETENTION = {
  /// NEW/DISMISSED trends nobody ran the pipeline on. The collector adds
  /// ~90 a day, so a longer window buries the fresh ones.
  untouchedTrendDays: 2,
  /// Pipelines with a failed stage, kept this long so you can still retry.
  failedHours: 24,
  /// Finished posts that were never approved or scheduled.
  unapprovedDays: 7,
  /// A stage still PROCESSING after this long is treated as crashed.
  stuckMinutes: 60,
};

export type CleanupOptions = Partial<typeof DEFAULT_RETENTION> & {
  now?: Date;
  /// Only count what would be deleted.
  dryRun?: boolean;
};

export type CleanupResult = {
  untouchedTrends: number;
  failedPipelines: number;
  unapprovedPipelines: number;
};

/// Anything approved or published is never deleted: deleting its trend would
/// cascade through the draft to the scheduled post and its analytics.
const KEEP: Prisma.TrendWhereInput = {
  researchBrief: {
    is: {
      contentPlans: {
        some: {
          draft: {
            is: {
              scheduledPost: {
                is: {
                  OR: [
                    { approvalStatus: "APPROVED" },
                    { publishedAt: { not: null } },
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
};

type StageFilter = {
  OR: (
    { status: "FAILED" } | { status: "PROCESSING"; updatedAt: { lt: Date } }
  )[];
};

function failedOrStuck(stuckBefore: Date): StageFilter {
  return {
    OR: [
      { status: "FAILED" },
      { status: "PROCESSING", updatedAt: { lt: stuckBefore } },
    ],
  };
}

/// Pure so the rules can be unit-tested without a database.
export function buildCleanupFilters(options: CleanupOptions = {}) {
  const keep = { ...DEFAULT_RETENTION, ...options };
  const now = options.now ?? new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  const stage = failedOrStuck(ago(keep.stuckMinutes * 60_000));

  const untouchedTrends: Prisma.TrendWhereInput = {
    status: { in: ["NEW", "DISMISSED"] },
    researchBrief: { is: null },
    createdAt: { lt: ago(keep.untouchedTrendDays * DAY) },
  };

  const failedPipelines: Prisma.TrendWhereInput = {
    NOT: KEEP,
    researchBrief: {
      is: {
        createdAt: { lt: ago(keep.failedHours * HOUR) },
        OR: [
          stage,
          {
            contentPlans: {
              some: {
                OR: [
                  stage,
                  {
                    draft: {
                      is: {
                        OR: [
                          stage,
                          { qualityReview: { is: stage } },
                          { imageAsset: { is: stage } },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  };

  const unapprovedPipelines: Prisma.TrendWhereInput = {
    NOT: KEEP,
    researchBrief: {
      is: { createdAt: { lt: ago(keep.unapprovedDays * DAY) } },
    },
  };

  return { untouchedTrends, failedPipelines, unapprovedPipelines };
}

/// Deletes stale trends and abandoned pipelines so the Trends page stays a
/// short list of fresh topics. Deleting a Trend cascades (database ON DELETE
/// CASCADE) to its research, plans, drafts, reviews and images. Failed
/// pipelines go first so each row is counted once.
export async function cleanupStaleData(
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const filters = buildCleanupFilters(options);

  async function remove(where: Prisma.TrendWhereInput): Promise<number> {
    if (options.dryRun) return prisma.trend.count({ where });
    return (await prisma.trend.deleteMany({ where })).count;
  }

  return {
    failedPipelines: await remove(filters.failedPipelines),
    // A dry run deletes nothing, so failed pipelines would be counted again
    // here; exclude them to report the same numbers a real run would.
    unapprovedPipelines: await remove(
      options.dryRun
        ? {
            AND: [
              filters.unapprovedPipelines,
              { NOT: filters.failedPipelines },
            ],
          }
        : filters.unapprovedPipelines,
    ),
    untouchedTrends: await remove(filters.untouchedTrends),
  };
}
