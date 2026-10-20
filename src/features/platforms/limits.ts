import type { VariantPlatformValue } from "@/validation/platforms";

/// Hard limits: exceeding them makes the platform reject the post, so we
/// block saving/approving. Facebook allows 63,206 characters per post (the
/// 10-hashtag cap is our own product limit). Instagram (per Meta's media
/// reference): 2,200 characters, 30 hashtags and 20 @ tags per caption.
export const PLATFORM_LIMITS: Record<
  VariantPlatformValue,
  {
    maxCaptionChars: number;
    maxHashtags: number;
    maxMentions: number;
    recommendedChars: number;
  }
> = {
  FACEBOOK: {
    maxCaptionChars: 63206,
    maxHashtags: 10,
    maxMentions: Infinity,
    recommendedChars: 500,
  },
  INSTAGRAM: {
    maxCaptionChars: 2200,
    maxHashtags: 30,
    maxMentions: 20,
    recommendedChars: 1500,
  },
};

/// The text that would actually be published: body plus hashtags.
export function composeCaption(content: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => `#${h}`).join(" ");
  return tags ? `${content.trim()}\n\n${tags}` : content.trim();
}

/// Counts hashtags the way the platform sees them: anywhere in the caption,
/// including ones the model wrote inline in the body.
export function countHashtags(text: string): number {
  return (text.match(/(?:^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export function countMentions(text: string): number {
  return (text.match(/(?:^|[^\p{L}\p{N}_.])@[\p{L}\p{N}_.]+/gu) ?? []).length;
}

/// Returns human-readable problems; empty array means within limits.
export function validateVariantLimits(
  platform: VariantPlatformValue,
  content: string,
  hashtags: string[],
): string[] {
  const limits = PLATFORM_LIMITS[platform];
  const name = platform === "FACEBOOK" ? "Facebook" : "Instagram";
  const issues: string[] = [];
  const caption = composeCaption(content, hashtags);

  if (caption.length > limits.maxCaptionChars) {
    issues.push(
      `Caption is ${caption.length} characters; ${name} allows at most ${limits.maxCaptionChars}.`,
    );
  }

  // Instagram counts every hashtag in the caption; Facebook's cap applies to
  // the hashtag list.
  const hashtagCount =
    platform === "INSTAGRAM" ? countHashtags(caption) : hashtags.length;
  if (hashtagCount > limits.maxHashtags) {
    issues.push(
      `${hashtagCount} hashtags; at most ${limits.maxHashtags} allowed.`,
    );
  }

  const mentions = countMentions(caption);
  if (mentions > limits.maxMentions) {
    issues.push(
      `${mentions} @ mentions; ${name} allows at most ${limits.maxMentions}.`,
    );
  }
  return issues;
}
