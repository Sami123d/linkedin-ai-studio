"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { skillSchema } from "@/validation/knowledge-base";

/// Prisma's generated error class isn't exported from the client root in
/// this project's generator output path; narrowing by `code` on the error
/// shape (rather than `instanceof`) avoids importing from the generated
/// internals just for this one check.
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function listSkills() {
  const profileId = await requireProfileId();
  return prisma.skill.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createSkill(input: unknown): Promise<ActionResult> {
  const parsed = skillSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  try {
    await prisma.skill.create({
      data: { ...parsed.data, content: parsed.data.content || null, profileId },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { error: "You already have a skill with this name." };
    }
    throw error;
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Skill added." };
}

export async function updateSkill(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = skillSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  try {
    const { count } = await prisma.skill.updateMany({
      where: { id, profileId },
      data: { ...parsed.data, content: parsed.data.content || null },
    });
    if (count === 0) {
      return { error: "Skill not found." };
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { error: "You already have a skill with this name." };
    }
    throw error;
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Skill updated." };
}

export async function deleteSkill(id: string): Promise<ActionResult> {
  const profileId = await requireProfileId();
  const { count } = await prisma.skill.deleteMany({
    where: { id, profileId },
  });
  if (count === 0) {
    return { error: "Skill not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Skill deleted." };
}
