"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { goalSchema } from "@/validation/knowledge-base";

export async function listGoals() {
  const profileId = await requireProfileId();
  return prisma.goal.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createGoal(input: unknown): Promise<ActionResult> {
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  await prisma.goal.create({ data: { ...parsed.data, profileId } });

  revalidatePath("/knowledge-base");
  return { success: true, message: "Goal added." };
}

export async function updateGoal(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  const { count } = await prisma.goal.updateMany({
    where: { id, profileId },
    data: parsed.data,
  });
  if (count === 0) {
    return { error: "Goal not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Goal updated." };
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  const profileId = await requireProfileId();
  const { count } = await prisma.goal.deleteMany({
    where: { id, profileId },
  });
  if (count === 0) {
    return { error: "Goal not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Goal deleted." };
}
