"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/db/prisma";
import { requireProfileId } from "@/features/knowledge-base/session";
import type { ActionResult } from "@/features/knowledge-base/types";
import { createClient } from "@/lib/supabase/server";
import { resumeSchema } from "@/validation/knowledge-base";

const RESUME_BUCKET = "resumes";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // matches the bucket's file_size_limit
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function getResume() {
  const profileId = await requireProfileId();
  return prisma.resume.findUnique({ where: { profileId } });
}

/// Returns a short-lived signed URL for downloading the currently stored
/// file. The bucket is private (see the storage migration), so there is no
/// stable public URL to just read off the row — `fileUrl` on `Resume` holds
/// the object's storage *path*, not a browsable URL.
export async function getResumeFileSignedUrl(): Promise<string | null> {
  const profileId = await requireProfileId();
  const resume = await prisma.resume.findUnique({ where: { profileId } });
  if (!resume?.fileUrl) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(resume.fileUrl, 60);

  if (error) return null;
  return data.signedUrl;
}

export async function saveResumeContent(
  input: unknown,
): Promise<ActionResult> {
  const parsed = resumeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileId = await requireProfileId();
  await prisma.resume.upsert({
    where: { profileId },
    create: { profileId, content: parsed.data.content },
    update: { content: parsed.data.content },
  });

  revalidatePath("/knowledge-base");
  return { success: true, message: "Resume text saved." };
}

export async function uploadResumeFile(
  formData: FormData,
): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "File is too large (10 MB max)." };
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Only PDF, DOC, DOCX, or TXT files are accepted." };
  }

  const profileId = await requireProfileId();
  const supabase = await createClient();

  // Path prefix must be the caller's own profileId — the storage RLS
  // policies (see the migration) key off exactly this segment to decide
  // who may read/write the object.
  const path = `${profileId}/${Date.now()}-${file.name}`;

  const existing = await prisma.resume.findUnique({ where: { profileId } });
  if (existing?.fileUrl) {
    await supabase.storage.from(RESUME_BUCKET).remove([existing.fileUrl]);
  }

  const { error: uploadError } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, file, { contentType: file.type });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  await prisma.resume.upsert({
    where: { profileId },
    create: {
      profileId,
      content: existing?.content ?? "",
      fileName: file.name,
      fileUrl: path,
    },
    update: { fileName: file.name, fileUrl: path },
  });

  revalidatePath("/knowledge-base");
  return { success: true, message: "File uploaded." };
}

export async function deleteResumeFile(): Promise<ActionResult> {
  const profileId = await requireProfileId();
  const resume = await prisma.resume.findUnique({ where: { profileId } });
  if (!resume?.fileUrl) {
    return { success: true };
  }

  const supabase = await createClient();
  await supabase.storage.from(RESUME_BUCKET).remove([resume.fileUrl]);

  await prisma.resume.update({
    where: { profileId },
    data: { fileName: null, fileUrl: null },
  });

  revalidatePath("/knowledge-base");
  return { success: true, message: "File removed." };
}
