"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { writingStyleSampleSchema } from "@/validation/knowledge-base";

export async function listWritingSamples() {
  const profileId = await requireProfileId();
  return prisma.writingStyleSample.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createWritingSample(
  input: unknown,
): Promise<ActionResult> {
  const parsed = writingStyleSampleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  await prisma.writingStyleSample.create({
    data: { ...parsed.data, profileId },
  });

  revalidatePath("/knowledge-base");
  return { success: true, message: "Writing sample added." };
}

export async function updateWritingSample(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = writingStyleSampleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  const { count } = await prisma.writingStyleSample.updateMany({
    where: { id, profileId },
    data: parsed.data,
  });
  if (count === 0) {
    return { error: "Writing sample not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Writing sample updated." };
}

export async function deleteWritingSample(id: string): Promise<ActionResult> {
  const profileId = await requireProfileId();
  const { count } = await prisma.writingStyleSample.deleteMany({
    where: { id, profileId },
  });
  if (count === 0) {
    return { error: "Writing sample not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Writing sample deleted." };
}
