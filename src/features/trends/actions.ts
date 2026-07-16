"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import type { TrendStatus } from "@/generated/prisma/client";

/// Trends aren't scoped to a profile (see schema.prisma) — any signed-in
/// user can view/triage the shared trend pool. `requireProfileId()` is
/// still called to enforce "must be logged in," even though its return
/// value isn't used for filtering here.
export async function listTrends() {
  await requireProfileId();
  return prisma.trend.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
}

export async function updateTrendStatus(
  id: string,
  status: TrendStatus,
): Promise<ActionResult> {
  await requireProfileId();
  const { count } = await prisma.trend.updateMany({
    where: { id },
    data: { status },
  });
  if (count === 0) {
    return { error: "Trend not found." };
  }

  revalidatePath("/trends");
  revalidatePath("/dashboard");
  return { success: true };
}
