"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { opinionSchema } from "@/validation/knowledge-base";

export async function listOpinions() {
  const profileId = await requireProfileId();
  return prisma.opinion.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createOpinion(input: unknown): Promise<ActionResult> {
  const parsed = opinionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  await prisma.opinion.create({ data: { ...parsed.data, profileId } });

  revalidatePath("/knowledge-base");
  return { success: true, message: "Opinion added." };
}

export async function updateOpinion(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = opinionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  const { count } = await prisma.opinion.updateMany({
    where: { id, profileId },
    data: parsed.data,
  });
  if (count === 0) {
    return { error: "Opinion not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Opinion updated." };
}

export async function deleteOpinion(id: string): Promise<ActionResult> {
  const profileId = await requireProfileId();
  const { count } = await prisma.opinion.deleteMany({
    where: { id, profileId },
  });
  if (count === 0) {
    return { error: "Opinion not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Opinion deleted." };
}
