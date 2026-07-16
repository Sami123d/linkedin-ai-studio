"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { experienceSchema } from "@/validation/knowledge-base";

export async function listExperiences() {
  const profileId = await requireProfileId();
  return prisma.experience.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createExperience(input: unknown): Promise<ActionResult> {
  const parsed = experienceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  await prisma.experience.create({ data: { ...parsed.data, profileId } });

  revalidatePath("/knowledge-base");
  return { success: true, message: "Experience added." };
}

export async function updateExperience(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = experienceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  const { count } = await prisma.experience.updateMany({
    where: { id, profileId },
    data: parsed.data,
  });
  if (count === 0) {
    return { error: "Experience not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Experience updated." };
}

export async function deleteExperience(id: string): Promise<ActionResult> {
  const profileId = await requireProfileId();
  const { count } = await prisma.experience.deleteMany({
    where: { id, profileId },
  });
  if (count === 0) {
    return { error: "Experience not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Experience deleted." };
}
