/// Pure builders for the PlatformVariant rows written after a generation
/// attempt. Kept out of actions.ts ("use server" files may only export
/// async functions) so the "failure must not destroy saved content" rule is
/// unit-testable without a database.

/// Resets applied whenever the publishable content changes (edit,
/// regenerate, options): the prepared image and any resumable Instagram
/// container belong to the old content, and a FAILED publish no longer
/// applies.
export const EDIT_RESETS_PUBLISH = {
  publishStatus: "NOT_PUBLISHED" as const,
  publishError: null,
  igContainerId: null,
  mediaUrl: null,
  mediaSourceUrl: null,
};

export function buildVariantFailureUpdate(message: string, now: Date) {
  // Deliberately NO content/hashtags/approval fields: the last good content
  // (generated or hand-edited) must survive a failed regeneration.
  return {
    status: "FAILED" as const,
    errorMessage: message,
    completedAt: now,
  };
}

export function buildVariantSuccessUpdate(input: {
  provider: string;
  model: string;
  content: string;
  hashtags: string[];
  now: Date;
}) {
  return {
    status: "COMPLETED" as const,
    provider: input.provider,
    model: input.model,
    content: input.content,
    hashtags: input.hashtags,
    edited: false,
    errorMessage: null,
    completedAt: input.now,
    // New text invalidates any earlier approval/plan.
    approvalStatus: "PENDING" as const,
    scheduledFor: null,
    approvedAt: null,
    rejectionReason: null,
    ...EDIT_RESETS_PUBLISH,
  };
}

/// Hashtag text box -> raw tokens ("#a, b  #c" -> ["#a","b","#c"]).
/// Stripping "#" and de-duplicating is left to hashtagListSchema.
export function parseHashtagInput(input: string): string[] {
  return input.split(/[\s,]+/).filter(Boolean);
}
