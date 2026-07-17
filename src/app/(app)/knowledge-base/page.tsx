import { FacetManager, type FacetItem } from "@/components/knowledge-base/facet-manager";
import { RagSyncPanel } from "@/components/knowledge-base/rag-sync-panel";
import { ResumeManager } from "@/components/knowledge-base/resume-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createAchievement,
  deleteAchievement,
  listAchievements,
  updateAchievement,
} from "@/features/knowledge-base/achievements/actions";
import {
  createExperience,
  deleteExperience,
  listExperiences,
  updateExperience,
} from "@/features/knowledge-base/experiences/actions";
import {
  createGoal,
  deleteGoal,
  listGoals,
  updateGoal,
} from "@/features/knowledge-base/goals/actions";
import {
  createOpinion,
  deleteOpinion,
  listOpinions,
  updateOpinion,
} from "@/features/knowledge-base/opinions/actions";
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from "@/features/knowledge-base/projects/actions";
import { getResume } from "@/features/knowledge-base/resume/actions";
import { getKnowledgeChunkCount } from "@/features/rag/actions";
import {
  createSkill,
  deleteSkill,
  listSkills,
  updateSkill,
} from "@/features/knowledge-base/skills/actions";
import {
  createWritingSample,
  deleteWritingSample,
  listWritingSamples,
  updateWritingSample,
} from "@/features/knowledge-base/writing-samples/actions";

function formatDate(date: Date | null): string | null {
  if (!date) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
  });
}

export default async function KnowledgeBasePage() {
  const [
    resume,
    projects,
    experiences,
    achievements,
    skills,
    writingSamples,
    goals,
    opinions,
    chunkCount,
  ] = await Promise.all([
    getResume(),
    listProjects(),
    listExperiences(),
    listAchievements(),
    listSkills(),
    listWritingSamples(),
    listGoals(),
    listOpinions(),
    getKnowledgeChunkCount(),
  ]);

  const projectItems: FacetItem[] = projects.map((p) => ({
    id: p.id,
    title: p.title,
    subtitle:
      [p.role, p.techStack.join(", ")].filter(Boolean).join(" · ") || null,
    content: p.content,
    // `techStack` is `string[]` on the model but the edit form binds it to a
    // single comma-separated text input — override with that shape here.
    raw: { ...p, techStack: p.techStack.join(", ") },
  }));

  const experienceItems: FacetItem[] = experiences.map((e) => ({
    id: e.id,
    title: `${e.title} at ${e.company}`,
    subtitle:
      [e.location, e.isCurrent ? "Current" : formatDate(e.endDate)]
        .filter(Boolean)
        .join(" · ") || null,
    content: e.content,
    raw: e,
  }));

  const achievementItems: FacetItem[] = achievements.map((a) => ({
    id: a.id,
    title: a.title,
    subtitle:
      [a.issuer, formatDate(a.achievedDate)].filter(Boolean).join(" · ") ||
      null,
    content: a.content,
    raw: a,
  }));

  const skillItems: FacetItem[] = skills.map((s) => ({
    id: s.id,
    title: s.name,
    subtitle: [s.category, s.proficiency].filter(Boolean).join(" · ") || null,
    content: s.content,
    raw: s,
  }));

  const writingSampleItems: FacetItem[] = writingSamples.map((w) => ({
    id: w.id,
    title: w.title || w.source || "Untitled sample",
    subtitle: w.title ? w.source : null,
    content: w.content,
    raw: w,
  }));

  const goalItems: FacetItem[] = goals.map((g) => ({
    id: g.id,
    title: g.title,
    subtitle:
      [g.timeframe, formatDate(g.targetDate)].filter(Boolean).join(" · ") ||
      null,
    content: g.content,
    raw: g,
  }));

  const opinionItems: FacetItem[] = opinions.map((o) => ({
    id: o.id,
    title: o.topic,
    content: o.content,
    raw: o,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Knowledge Base
        </h1>
        <p className="text-muted-foreground">
          What you add here is what the AI pipeline will draw from to
          research, write, and sound like you.
        </p>
      </div>

      <Tabs defaultValue="resume">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="resume">Resume</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="experience">Experience</TabsTrigger>
          <TabsTrigger value="achievements">Achievements</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="writing-samples">Writing samples</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="opinions">Opinions</TabsTrigger>
          <TabsTrigger value="rag-sync">RAG Sync</TabsTrigger>
        </TabsList>

        <TabsContent value="resume" className="mt-4">
          <ResumeManager
            initialContent={resume?.content ?? ""}
            fileName={resume?.fileName ?? null}
          />
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          <FacetManager
            itemLabel="Project"
            items={projectItems}
            emptyMessage="No projects yet. Add one so the AI can reference your real work."
            fields={[
              { name: "title", label: "Title", type: "text", required: true },
              { name: "role", label: "Your role", type: "text" },
              {
                name: "techStack",
                label: "Tech stack (comma-separated)",
                type: "text",
                placeholder: "TypeScript, React, Postgres",
              },
              { name: "url", label: "URL", type: "url" },
              { name: "startDate", label: "Start date", type: "date" },
              { name: "endDate", label: "End date", type: "date" },
              {
                name: "content",
                label: "Description",
                type: "textarea",
                required: true,
              },
            ]}
            createAction={createProject}
            updateAction={updateProject}
            deleteAction={deleteProject}
          />
        </TabsContent>

        <TabsContent value="experience" className="mt-4">
          <FacetManager
            itemLabel="Experience"
            items={experienceItems}
            emptyMessage="No work history yet."
            fields={[
              {
                name: "company",
                label: "Company",
                type: "text",
                required: true,
              },
              { name: "title", label: "Title", type: "text", required: true },
              { name: "location", label: "Location", type: "text" },
              { name: "startDate", label: "Start date", type: "date" },
              { name: "endDate", label: "End date", type: "date" },
              { name: "isCurrent", label: "This is my current role", type: "checkbox" },
              {
                name: "content",
                label: "Responsibilities / impact",
                type: "textarea",
                required: true,
              },
            ]}
            createAction={createExperience}
            updateAction={updateExperience}
            deleteAction={deleteExperience}
          />
        </TabsContent>

        <TabsContent value="achievements" className="mt-4">
          <FacetManager
            itemLabel="Achievement"
            items={achievementItems}
            emptyMessage="No achievements yet."
            fields={[
              { name: "title", label: "Title", type: "text", required: true },
              { name: "issuer", label: "Issuer", type: "text" },
              { name: "achievedDate", label: "Date", type: "date" },
              {
                name: "content",
                label: "Detail / impact",
                type: "textarea",
                required: true,
              },
            ]}
            createAction={createAchievement}
            updateAction={updateAchievement}
            deleteAction={deleteAchievement}
          />
        </TabsContent>

        <TabsContent value="skills" className="mt-4">
          <FacetManager
            itemLabel="Skill"
            items={skillItems}
            emptyMessage="No skills yet."
            fields={[
              { name: "name", label: "Name", type: "text", required: true },
              { name: "category", label: "Category", type: "text" },
              { name: "proficiency", label: "Proficiency", type: "text" },
              { name: "content", label: "Elaboration (optional)", type: "textarea" },
            ]}
            createAction={createSkill}
            updateAction={updateSkill}
            deleteAction={deleteSkill}
          />
        </TabsContent>

        <TabsContent value="writing-samples" className="mt-4">
          <FacetManager
            itemLabel="Writing sample"
            items={writingSampleItems}
            emptyMessage="No writing samples yet. Add a few so the AI can learn your voice."
            fields={[
              { name: "title", label: "Title", type: "text" },
              {
                name: "source",
                label: "Source",
                type: "text",
                placeholder: "LinkedIn post, newsletter, email...",
              },
              {
                name: "content",
                label: "Sample text",
                type: "textarea",
                required: true,
              },
            ]}
            createAction={createWritingSample}
            updateAction={updateWritingSample}
            deleteAction={deleteWritingSample}
          />
        </TabsContent>

        <TabsContent value="goals" className="mt-4">
          <FacetManager
            itemLabel="Goal"
            items={goalItems}
            emptyMessage="No goals yet."
            fields={[
              { name: "title", label: "Title", type: "text", required: true },
              {
                name: "timeframe",
                label: "Timeframe",
                type: "text",
                placeholder: "Q3 2026, next 6 months...",
              },
              { name: "targetDate", label: "Target date", type: "date" },
              {
                name: "content",
                label: "Why this matters",
                type: "textarea",
                required: true,
              },
            ]}
            createAction={createGoal}
            updateAction={updateGoal}
            deleteAction={deleteGoal}
          />
        </TabsContent>

        <TabsContent value="opinions" className="mt-4">
          <FacetManager
            itemLabel="Opinion"
            items={opinionItems}
            emptyMessage="No opinions yet."
            fields={[
              { name: "topic", label: "Topic", type: "text", required: true },
              {
                name: "content",
                label: "Your stance",
                type: "textarea",
                required: true,
              },
            ]}
            createAction={createOpinion}
            updateAction={updateOpinion}
            deleteAction={deleteOpinion}
          />
        </TabsContent>

        <TabsContent value="rag-sync" className="mt-4">
          <RagSyncPanel initialChunkCount={chunkCount} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
