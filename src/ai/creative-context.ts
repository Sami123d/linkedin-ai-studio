/// Creator preferences and verified research findings from a Research
/// Studio request, carried into planning, writing and platform variants.
/// Absent for content that didn't come from Research Studio, in which case
/// every agent prompt is exactly what it was before.

export type CreativeContext = {
  preferences: {
    audience?: string | null;
    industry?: string | null;
    angle?: string | null;
    purpose?: string | null;
    tone?: string | null;
    callToAction?: string | null;
    instructions?: string | null;
  };
  /// Findings that cite at least one real source.
  findings: string[];
  /// Only present when the creator asked for links in posts.
  sourceLinks: { title: string; url: string }[];
};

/// Prompt lines appended by every stage that receives a CreativeContext.
export function formatCreativeContext(
  ctx: CreativeContext | null | undefined,
): string[] {
  if (!ctx) return [];
  const p = ctx.preferences;
  const prefs = [
    p.audience && `- Audience: ${p.audience}`,
    p.industry && `- Industry/niche: ${p.industry}`,
    p.angle && `- Preferred angle: ${p.angle}`,
    p.purpose && `- Purpose: ${p.purpose}`,
    p.tone && `- Tone: ${p.tone}`,
    p.callToAction && `- Call to action: ${p.callToAction}`,
    p.instructions && `- Extra instructions: ${p.instructions}`,
  ].filter((l): l is string => Boolean(l));

  const lines: string[] = [];
  if (prefs.length > 0) {
    lines.push(
      "The creator's preferences for this post (follow them):",
      ...prefs,
      "",
    );
  }
  if (ctx.findings.length > 0) {
    lines.push(
      "Verified research findings (each backed by a real source). Use these as the factual basis and do not add facts, figures or claims beyond them:",
      ...ctx.findings.map((f) => `- ${f}`),
      "",
    );
  }
  if (ctx.sourceLinks.length > 0) {
    lines.push(
      "The creator asked for source links. Where it fits naturally, you may include up to two of these exact URLs (never any other URL):",
      ...ctx.sourceLinks.map((s) => `- ${s.title}: ${s.url}`),
      "",
    );
  } else {
    lines.push("Do not include any URLs in the post.", "");
  }
  return lines;
}
