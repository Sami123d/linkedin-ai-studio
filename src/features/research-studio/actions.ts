"use server";

import { revalidatePath } from "next/cache";

import { getAIProvider } from "@/ai/providers";
import {
  extractSearchQueries,
  QueryExtractionError,
} from "@/ai/research/extract-search-queries";
import {
  generateSourcedBrief,
  groundBrief,
  SourcedBriefGenerationError,
  toBriefColumns,
} from "@/ai/research/generate-sourced-brief";
import { serverEnv } from "@/config/env.server";
import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { runPipelineStep } from "@/features/pipeline/actions";
import { generateVariantAction } from "@/features/platforms/actions";
import type { Prisma } from "@/generated/prisma/client";
import { discoverSources, lookbackDays } from "@/lib/sources/discover";
import { keywordsFromText } from "@/lib/sources/normalize";
import {
  requestIdSchema,
  researchRequestSchema,
  sourceSelectionSchema,
  studioStepSchema,
} from "@/validation/research-studio";

/// Research Studio. Everything here is profile-owned: requests, sources and
/// discovery audit rows are always read and written with `profileId`, and
/// the private Trend/ResearchBrief a request creates carries the profile id
/// too (see schema.prisma). Nothing here approves or publishes content.

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

function revalidateStudio(requestId?: string) {
  revalidatePath("/studio");
  if (requestId) revalidatePath(`/studio/${requestId}`);
}

const DEFAULT_SELECTED = 5;
const STALE_RUN_MS = 3 * 60 * 1000;

export async function listResearchRequests() {
  const profileId = await requireProfileId();
  return prisma.researchRequest.findMany({
    where: { profileId },
    include: {
      _count: { select: { sources: true } },
      trend: { select: { researchBrief: { select: { status: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getResearchRequest(requestId: string) {
  const profileId = await requireProfileId();
  return prisma.researchRequest.findFirst({
    where: { id: requestId, profileId },
    include: {
      baseTrend: { select: { id: true, topic: true, sourceUrl: true } },
      sources: {
        where: { profileId },
        orderBy: [{ isRecent: "desc" }, { publishedAt: "desc" }],
      },
      discoveryLogs: { orderBy: { createdAt: "desc" }, take: 1 },
      trend: {
        include: {
          researchBrief: {
            include: {
              contentPlans: {
                where: { profileId },
                include: {
                  draft: {
                    include: {
                      platformVariants: { where: { profileId } },
                      qualityReview: true,
                      imageAsset: true,
                      scheduledPost: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

/// A shared, collected trend used to pre-fill the request form.
export async function getTrendForPrefill(trendId: string) {
  await requireProfileId();
  return prisma.trend.findFirst({
    where: { id: trendId, profileId: null },
    select: { id: true, topic: true, summary: true, category: true },
  });
}

export async function createResearchRequest(
  input: unknown,
): Promise<{ error: string } | { success: true; id: string }> {
  const profileId = await requireProfileId();

  const parsed = researchRequestSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const data = parsed.data;

  if (data.baseTrendId) {
    const base = await prisma.trend.findFirst({
      where: { id: data.baseTrendId, profileId: null },
      select: { id: true },
    });
    if (!base) return { error: "That trend is no longer available." };
  }

  const request = await prisma.researchRequest.create({
    data: {
      profileId,
      prompt: data.prompt,
      timeframeDays: data.timeframeDays,
      audience: data.audience,
      industry: data.industry,
      angle: data.angle,
      purpose: data.purpose,
      tone: data.tone,
      instructions: data.instructions,
      callToAction: data.callToAction,
      includeLinks: data.includeLinks,
      platforms: data.platforms,
      baseTrendId: data.baseTrendId,
    },
  });

  revalidateStudio();
  return { success: true, id: request.id };
}

function providerNameSafely(): string | null {
  try {
    return getAIProvider().name;
  } catch {
    return null;
  }
}

/// Finds sources through real search APIs (see src/lib/sources). Re-running
/// replaces the source list; an existing brief keeps its own snapshot of
/// the sources it cited.
export async function runDiscovery(input: unknown): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { requestId } = parsed.data;

  const request = await prisma.researchRequest.findFirst({
    where: { id: requestId, profileId },
    include: { baseTrend: true },
  });
  if (!request) return { error: "Research request not found." };
  if (
    request.discoveryStatus === "PROCESSING" &&
    Date.now() - request.updatedAt.getTime() < STALE_RUN_MS
  ) {
    return { error: "Source discovery is already running." };
  }

  const attemptNumber = request.discoveryAttempts + 1;
  const startedAt = new Date();
  await prisma.researchRequest.updateMany({
    where: { id: requestId, profileId },
    data: {
      discoveryStatus: "PROCESSING",
      discoveryAttempts: attemptNumber,
      discoveryError: null,
    },
  });

  // 1. Search queries: the model writes queries only; a deterministic
  //    keyword fallback keeps discovery working if the model fails.
  let queries: string[] = [];
  const audit: {
    provider: string | null;
    model: string | null;
    prompt: string | null;
    response: string | null;
  } = { provider: null, model: null, prompt: null, response: null };
  try {
    const provider = getAIProvider();
    const result = await extractSearchQueries(provider, {
      prompt: request.prompt,
      industry: request.industry,
    });
    queries = result.queries;
    Object.assign(audit, {
      provider: provider.name,
      model: result.raw.model,
      prompt: result.prompt,
      response: result.raw.text,
    });
  } catch (error) {
    if (error instanceof QueryExtractionError) {
      Object.assign(audit, {
        provider: providerNameSafely(),
        model: error.raw?.model ?? null,
        prompt: error.prompt,
        response: error.raw?.text ?? null,
      });
    }
    const fallback = keywordsFromText(request.prompt, 5).join(" ");
    queries = fallback ? [fallback] : [];
  }
  if (
    request.baseTrend &&
    !queries.some(
      (q) => q.toLowerCase() === request.baseTrend!.topic.toLowerCase(),
    )
  ) {
    queries = [request.baseTrend.topic.slice(0, 100), ...queries].slice(0, 3);
  }
  const keywords = keywordsFromText(
    [...queries, request.industry ?? ""].join(" "),
    8,
  );

  const now = new Date();
  try {
    if (queries.length === 0 || keywords.length === 0) {
      throw new Error(
        "Couldn't derive search terms from the prompt. Rephrase it with the main subject.",
      );
    }

    // 2. Trends already collected by the scheduled collector (shared pool).
    const since = new Date(
      now.getTime() - lookbackDays(request.timeframeDays) * 86_400_000,
    );
    const collected = await prisma.trend.findMany({
      where: {
        profileId: null,
        sourceUrl: { not: null },
        createdAt: { gte: since },
        OR: keywords.slice(0, 6).map((k) => ({
          topic: { contains: k, mode: "insensitive" as const },
        })),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    if (
      request.baseTrend?.sourceUrl &&
      !collected.some((t) => t.id === request.baseTrend!.id)
    ) {
      collected.unshift(request.baseTrend);
    }

    // 3. Real search APIs.
    const result = await discoverSources({
      queries,
      keywords,
      timeframeDays: request.timeframeDays,
      now,
      braveApiKey: serverEnv.BRAVE_SEARCH_API_KEY,
      collectedTrends: collected,
    });

    if (result.allFailed) {
      const details = Object.entries(result.providerResults)
        .filter(([, r]) => r && !r.ok && !r.skipped)
        .map(([name, r]) => `${name}: ${r!.error ?? "failed"}`)
        .join("; ");
      throw new Error(
        `Every search provider failed (${details}). Try again later.`,
      );
    }

    let selectedCount = 0;
    const rows = result.sources.map((s) => {
      const select =
        s.freshness === "recent" && selectedCount < DEFAULT_SELECTED;
      if (select) selectedCount++;
      return {
        requestId,
        profileId,
        provider: s.provider,
        title: s.title,
        publisher: s.publisher,
        url: s.url,
        discussionUrl: s.discussionUrl,
        publishedAt: s.publishedAt,
        retrievedAt: now,
        snippet: s.snippet,
        isRecent: s.freshness === "recent",
        selected: select,
        dedupeKey: s.dedupeKey,
      };
    });

    await prisma.$transaction([
      prisma.researchSource.deleteMany({ where: { requestId, profileId } }),
      prisma.researchSource.createMany({ data: rows }),
      prisma.researchRequest.updateMany({
        where: { id: requestId, profileId },
        data: {
          discoveryStatus: "COMPLETED",
          discoveryError: null,
          discoveredAt: now,
        },
      }),
      prisma.researchDiscoveryAttempt.create({
        data: {
          requestId,
          attemptNumber,
          queries,
          providerResults: result.providerResults as Prisma.InputJsonValue,
          sourceCount: rows.length,
          ...audit,
          succeeded: true,
          startedAt,
          completedAt: new Date(),
        },
      }),
    ]);

    revalidateStudio(requestId);
    const recent = rows.filter((r) => r.isRecent).length;
    return {
      success: true,
      message:
        rows.length === 0
          ? "No sources matched. Try a broader prompt or a longer timeframe."
          : `Found ${rows.length} source(s), ${recent} from the selected timeframe.`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Source discovery failed.";
    await prisma.$transaction([
      prisma.researchRequest.updateMany({
        where: { id: requestId, profileId },
        data: { discoveryStatus: "FAILED", discoveryError: message },
      }),
      prisma.researchDiscoveryAttempt.create({
        data: {
          requestId,
          attemptNumber,
          queries,
          providerResults: {},
          sourceCount: 0,
          ...audit,
          succeeded: false,
          errorMessage: message,
          startedAt,
          completedAt: new Date(),
        },
      }),
    ]);
    revalidateStudio(requestId);
    return { error: message };
  }
}

export async function saveSourceSelection(
  input: unknown,
): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = sourceSelectionSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { requestId, sourceIds, focusTitle } = parsed.data;

  const request = await prisma.researchRequest.findFirst({
    where: { id: requestId, profileId },
    select: { id: true },
  });
  if (!request) return { error: "Research request not found." };

  await prisma.$transaction([
    prisma.researchSource.updateMany({
      where: { requestId, profileId },
      data: { selected: false },
    }),
    prisma.researchSource.updateMany({
      where: { requestId, profileId, id: { in: sourceIds } },
      data: { selected: true },
    }),
    prisma.researchRequest.updateMany({
      where: { id: requestId, profileId },
      data: { focusTitle: focusTitle ?? null },
    }),
  ]);

  revalidateStudio(requestId);
  return { success: true, message: "Selection saved." };
}

/// Builds the research brief from the selected sources only. Creates (or
/// reuses) this request's private Trend so the existing pipeline can run
/// on it, then follows the research agent's retry-in-place + audit pattern.
export async function runSourcedResearch(
  input: unknown,
): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { requestId } = parsed.data;

  const request = await prisma.researchRequest.findFirst({
    where: { id: requestId, profileId },
    include: {
      sources: {
        where: { profileId, selected: true },
        orderBy: [{ isRecent: "desc" }, { publishedAt: "desc" }],
      },
      trend: { include: { researchBrief: true } },
    },
  });
  if (!request) return { error: "Research request not found." };
  if (request.sources.length === 0) {
    return { error: "Select at least one source to research." };
  }
  const existingBrief = request.trend?.researchBrief;
  if (
    existingBrief?.status === "PROCESSING" &&
    existingBrief.startedAt &&
    Date.now() - existingBrief.startedAt.getTime() < STALE_RUN_MS
  ) {
    return { error: "The research brief is already being generated." };
  }

  const snapshots = request.sources.map((s, i) => ({
    ref: `S${i + 1}`,
    provider: s.provider,
    title: s.title,
    publisher: s.publisher,
    url: s.url,
    publishedAt: s.publishedAt ? s.publishedAt.toISOString() : null,
    isRecent: s.isRecent,
  }));
  const focus = (request.focusTitle ?? request.sources[0]!.title).slice(0, 300);
  const newest = request.sources
    .map((s) => s.publishedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const trendData = {
    topic: focus,
    summary: request.prompt.slice(0, 5000),
    sourceName: request.sources[0]!.publisher,
    sourceUrl: request.sources[0]!.url,
    category: request.industry,
    publishedAt: newest ?? null,
    status: "REVIEWED" as const,
  };

  // The private trend: owned by this profile, linked to the request.
  const trendId = await prisma.$transaction(async (tx) => {
    if (request.trendId) {
      await tx.trend.updateMany({
        where: { id: request.trendId, profileId },
        data: trendData,
      });
      return request.trendId;
    }
    const trend = await tx.trend.create({ data: { ...trendData, profileId } });
    await tx.researchRequest.updateMany({
      where: { id: requestId, profileId },
      data: { trendId: trend.id },
    });
    return trend.id;
  });

  const attemptNumber = (existingBrief?.attempts ?? 0) + 1;
  const attemptStartedAt = new Date();
  const brief = await prisma.researchBrief.upsert({
    where: { trendId },
    create: {
      trendId,
      status: "PROCESSING",
      attempts: attemptNumber,
      startedAt: attemptStartedAt,
    },
    update: {
      status: "PROCESSING",
      attempts: attemptNumber,
      startedAt: attemptStartedAt,
      errorMessage: null,
    },
  });

  try {
    const provider = getAIProvider();
    const { data, raw, prompt } = await generateSourcedBrief(provider, {
      focus,
      prompt: request.prompt,
      timeframeDays: request.timeframeDays,
      audience: request.audience,
      industry: request.industry,
      angle: request.angle,
      purpose: request.purpose,
      platforms: request.platforms,
      sources: request.sources.map((s, i) => ({
        ...snapshots[i]!,
        snippet: s.snippet,
      })),
    });
    const evidence = groundBrief(data, snapshots, {
      requestId,
      timeframeDays: request.timeframeDays,
    });
    const columns = toBriefColumns(data, evidence);

    await prisma.$transaction([
      prisma.researchBrief.update({
        where: { id: brief.id },
        data: {
          status: "COMPLETED",
          provider: provider.name,
          model: raw.model,
          ...columns,
          evidence: evidence as unknown as Prisma.InputJsonValue,
          errorMessage: null,
          completedAt: new Date(),
        },
      }),
      prisma.researchAttempt.create({
        data: {
          researchId: brief.id,
          attemptNumber,
          provider: provider.name,
          model: raw.model,
          prompt,
          response: raw.text,
          promptTokens: raw.usage?.promptTokens,
          completionTokens: raw.usage?.completionTokens,
          totalTokens: raw.usage?.totalTokens,
          succeeded: true,
          startedAt: attemptStartedAt,
          completedAt: new Date(),
        },
      }),
    ]);

    revalidateStudio(requestId);
    const verified = evidence.findings.filter(
      (f) => f.confidence !== "unverified",
    ).length;
    return {
      success: true,
      message:
        verified === 0
          ? "Brief generated, but none of its findings could be tied to a source. Review it carefully or pick different sources."
          : `Research brief ready: ${verified} of ${evidence.findings.length} findings backed by sources.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const prompt =
      error instanceof SourcedBriefGenerationError
        ? error.prompt
        : "(provider unavailable before a prompt could be built)";
    const raw =
      error instanceof SourcedBriefGenerationError ? error.raw : undefined;

    await prisma.$transaction([
      prisma.researchBrief.update({
        where: { id: brief.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),
      prisma.researchAttempt.create({
        data: {
          researchId: brief.id,
          attemptNumber,
          provider: providerNameSafely() ?? "unknown",
          model: raw?.model ?? "unknown",
          prompt,
          response: raw?.text,
          promptTokens: raw?.usage?.promptTokens,
          completionTokens: raw?.usage?.completionTokens,
          totalTokens: raw?.usage?.totalTokens,
          succeeded: false,
          errorMessage: message,
          startedAt: attemptStartedAt,
          completedAt: new Date(),
        },
      }),
    ]);
    revalidateStudio(requestId);
    return { error: message };
  }
}

/// One content step for a researched request: plan → write → review →
/// image → variants. Delegates to the existing stage actions (so retries,
/// audit rows and ownership checks are unchanged) and never approves,
/// schedules or publishes anything.
export async function runStudioStep(input: unknown): Promise<ActionResult> {
  const profileId = await requireProfileId();

  const parsed = studioStepSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { requestId, step } = parsed.data;

  const request = await prisma.researchRequest.findFirst({
    where: { id: requestId, profileId },
    select: {
      trendId: true,
      platforms: true,
      trend: {
        select: {
          profileId: true,
          researchBrief: { select: { id: true, status: true } },
        },
      },
    },
  });
  const brief = request?.trend?.researchBrief;
  if (!request?.trendId || request.trend?.profileId !== profileId || !brief) {
    return { error: "Generate the research brief first." };
  }
  if (brief.status !== "COMPLETED") {
    return {
      error: "The research brief must be completed before creating content.",
    };
  }

  let result: ActionResult;
  if (step !== "variants") {
    result = await runPipelineStep({ trendId: request.trendId, step });
    if (step === "plan" && "success" in result) {
      // Carry the requested platforms onto the campaign.
      await prisma.contentPlan.updateMany({
        where: { researchId: brief.id, profileId },
        data: { platforms: request.platforms },
      });
    }
  } else {
    const plan = await prisma.contentPlan.findFirst({
      where: { researchId: brief.id, profileId },
      include: {
        draft: { include: { platformVariants: { where: { profileId } } } },
      },
    });
    const draft = plan?.draft;
    if (!draft || draft.status !== "COMPLETED") {
      return { error: "The LinkedIn draft must be written first." };
    }
    const wanted = request.platforms.filter(
      (p): p is "FACEBOOK" | "INSTAGRAM" =>
        p === "FACEBOOK" || p === "INSTAGRAM",
    );
    const errors: string[] = [];
    for (const platform of wanted) {
      const existing = draft.platformVariants.find(
        (v) => v.platform === platform,
      );
      if (existing?.status === "COMPLETED") continue;
      const r = await generateVariantAction({ draftId: draft.id, platform });
      if ("error" in r) errors.push(`${platform}: ${r.error}`);
    }
    result = errors.length
      ? { error: errors.join(" ") }
      : {
          success: true,
          message: wanted.length
            ? "Platform variants ready."
            : "No Facebook or Instagram variants were requested.",
        };
  }

  revalidateStudio(requestId);
  return result;
}
