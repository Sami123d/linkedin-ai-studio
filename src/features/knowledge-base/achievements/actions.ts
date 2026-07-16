"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { achievementSchema } from "@/validation/knowledge-base";

export async function listAchievements() {
  const profileId = await requireProfileId();
  return prisma.achievement.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createAchievement(
  input: unknown,
): Promise<ActionResult> {
  const parsed = achievementSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  await prisma.achievement.create({ data: { ...parsed.data, profileId } });

  revalidatePath("/knowledge-base");
  return { success: true, message: "Achievement added." };
}

export async function updateAchievement(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = achievementSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  const { count } = await prisma.achievement.updateMany({
    where: { id, profileId },
    data: parsed.data,
  });
  if (count === 0) {
    return { error: "Achievement not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Achievement updated." };
}

export async function deleteAchievement(id: string): Promise<ActionResult> {
  const profileId = await requireProfileId();
  const { count } = await prisma.achievement.deleteMany({
    where: { id, profileId },
  });
  if (count === 0) {
    return { error: "Achievement not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Achievement deleted." };
}
