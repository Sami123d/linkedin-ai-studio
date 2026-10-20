import "server-only";

import type { CreativeContext } from "@/ai/creative-context";
import { prisma } from "@/db/prisma";
import {
  researchEvidenceSchema,
  type ResearchEvidence,
} from "@/validation/research-studio";

type RequestPrefs = {
  audience: string | null;
  industry: string | null;
  angle: string | null;
  purpose: string | null;
  tone: string | null;
  callToAction: string | null;
  instructions: string | null;
  includeLinks: boolean;
};

const MAX_LINKS = 3;

/// Pure: preferences from the request, findings that cite a real source,
/// and (only if the creator asked) links to the cited sources.
export function buildCreativeContext(
  request: RequestPrefs,
  evidence: ResearchEvidence | null,
): CreativeContext {
  const backed = (evidence?.findings ?? []).filter(
    (f) => f.confidence !== "unverified" && f.sources.length > 0,
  );
  const links: { title: string; url: string }[] = [];
  if (request.includeLinks) {
    for (const f of backed) {
      for (const s of f.sources) {
        if (links.length >= MAX_LINKS) break;
        if (!links.some((l) => l.url === s.url)) {
          links.push({ title: s.title, url: s.url });
        }
      }
    }
  }
  return {
    preferences: {
      audience: request.audience,
      industry: request.industry,
      angle: request.angle,
      purpose: request.purpose,
      tone: request.tone,
      callToAction: request.callToAction,
      instructions: request.instructions,
    },
    findings: backed.map((f) =>
      f.confidence === "partially_supported"
        ? `${f.statement} (partially supported by the sources)`
        : f.statement,
    ),
    sourceLinks: links,
  };
}

/// The creative context for a research brief, if (and only if) it is a
/// private Research Studio brief owned by this profile. Classic shared
/// briefs return null, leaving their pipeline unchanged.
export async function loadCreativeContext(
  profileId: string,
  researchId: string,
): Promise<CreativeContext | null> {
  const brief = await prisma.researchBrief.findUnique({
    where: { id: researchId },
    select: {
      evidence: true,
      trend: {
        select: {
          profileId: true,
          researchRequest: {
            select: {
              profileId: true,
              audience: true,
              industry: true,
              angle: true,
              purpose: true,
              tone: true,
              callToAction: true,
              instructions: true,
              includeLinks: true,
            },
          },
        },
      },
    },
  });
  const request = brief?.trend.researchRequest;
  if (
    !brief ||
    !request ||
    brief.trend.profileId !== profileId ||
    request.profileId !== profileId
  ) {
    return null;
  }
  const parsed = researchEvidenceSchema.safeParse(brief.evidence);
  return buildCreativeContext(request, parsed.success ? parsed.data : null);
}
