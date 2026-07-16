import { z } from "zod";

/// HTML `<input type="date">` submits `"YYYY-MM-DD"` or `""`. This turns an
/// empty string into `undefined` (so optional dates stay optional) and a
/// real string into a `Date` for Prisma's `@db.Date` columns.
const optionalDateInput = z
  .string()
  .optional()
  .transform((value) => (value ? new Date(value) : undefined));

const facetContent = z
  .string()
  .trim()
  .min(1, "This field can't be empty")
  .max(20_000, "Keep this under 20,000 characters");

export const resumeSchema = z.object({
  content: facetContent,
});
export type ResumeInput = z.infer<typeof resumeSchema>;

export const projectSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  role: z.string().trim().max(200).optional(),
  /// Submitted as a single comma-separated field from the form; split into
  /// the `String[]` column at the action layer, not here, so this schema
  /// stays a plain string the form's `<Input>` can bind to directly.
  techStack: z.string().trim().max(500).optional(),
  url: z.union([z.url("Enter a valid URL"), z.literal("")]).optional(),
  startDate: optionalDateInput,
  endDate: optionalDateInput,
  content: facetContent,
});
export type ProjectInput = z.infer<typeof projectSchema>;

export const experienceSchema = z.object({
  company: z.string().trim().min(1, "Company is required").max(200),
  title: z.string().trim().min(1, "Title is required").max(200),
  location: z.string().trim().max(200).optional(),
  startDate: optionalDateInput,
  endDate: optionalDateInput,
  isCurrent: z.boolean().default(false),
  content: facetContent,
});
export type ExperienceInput = z.infer<typeof experienceSchema>;

export const achievementSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  issuer: z.string().trim().max(200).optional(),
  achievedDate: optionalDateInput,
  content: facetContent,
});
export type AchievementInput = z.infer<typeof achievementSchema>;

export const skillSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  category: z.string().trim().max(100).optional(),
  proficiency: z.string().trim().max(100).optional(),
  /// Nullable on the model (see schema.prisma) — empty string here is
  /// normalized to `undefined` at the action layer so it's stored as `null`
  /// rather than `""`.
  content: z.string().trim().max(20_000).optional(),
});
export type SkillInput = z.infer<typeof skillSchema>;

export const writingStyleSampleSchema = z.object({
  title: z.string().trim().max(200).optional(),
  source: z.string().trim().max(100).optional(),
  content: facetContent,
});
export type WritingStyleSampleInput = z.infer<typeof writingStyleSampleSchema>;

export const goalSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  timeframe: z.string().trim().max(100).optional(),
  targetDate: optionalDateInput,
  content: facetContent,
});
export type GoalInput = z.infer<typeof goalSchema>;

export const opinionSchema = z.object({
  topic: z.string().trim().min(1, "Topic is required").max(200),
  content: facetContent,
});
export type OpinionInput = z.infer<typeof opinionSchema>;
