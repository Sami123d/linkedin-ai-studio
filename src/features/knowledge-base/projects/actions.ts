"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { projectSchema } from "@/validation/knowledge-base";

export async function listProjects() {
  const profileId = await requireProfileId();
  return prisma.project.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
  });
}

function toTechStack(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((tech) => tech.trim())
    .filter(Boolean);
}

export async function createProject(input: unknown): Promise<ActionResult> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  const { techStack, ...rest } = parsed.data;
  await prisma.project.create({
    data: { ...rest, techStack: toTechStack(techStack), profileId },
  });

  revalidatePath("/knowledge-base");
  return { success: true, message: "Project added." };
}

export async function updateProject(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  const { techStack, ...rest } = parsed.data;
  const { count } = await prisma.project.updateMany({
    where: { id, profileId },
    data: { ...rest, techStack: toTechStack(techStack) },
  });
  if (count === 0) {
    return { error: "Project not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Project updated." };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const profileId = await requireProfileId();
  const { count } = await prisma.project.deleteMany({
    where: { id, profileId },
  });
  if (count === 0) {
    return { error: "Project not found." };
  }

  revalidatePath("/knowledge-base");
  return { success: true, message: "Project deleted." };
}
