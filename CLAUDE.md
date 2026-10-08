@AGENTS.md

# CLAUDE.md

## 1. Project Overview
LinkedIn AI Studio is a single-user content pipeline. Trends come in from n8n or GitHub Actions. LLM agents then run in order: research → plan → write → review → image. The user approves and schedules each post. An external job publishes it to LinkedIn and pulls likes and comments back in for analytics and "learning" insights. `README.md` has the full feature/status table, and `ONBOARDING.md` covers setup.

## 2. Tech Stack
- **Next.js 16.2** App Router, React 19, TypeScript (strict). Read `node_modules/next/dist/docs/` before using any Next API you aren't sure of. Middleware is **`proxy.ts`** (exported `proxy` function), not `middleware.ts`.
- **Tailwind CSS 4**: CSS-first config in `src/app/globals.css` (there is no tailwind.config). Uses `tw-animate-css`.
- **shadcn/ui, style `base-nova`, built on Base UI (`@base-ui/react`), not Radix.** Compose with the `render` prop (`<DialogTrigger render={<Button />}>`), **not `asChild`**.
- lucide-react icons, next-themes (class-based dark mode).
- **Prisma 7** with `@prisma/adapter-pg`. The client is generated to `src/generated/prisma` (gitignored) and imported from `@/generated/prisma/client`.
- Supabase Auth (`@supabase/ssr`) and Supabase Storage (resume bucket). Postgres uses pgvector (768-dim).
- **Zod 4** (`z.url()` and similar v4 APIs), react-hook-form (auth pages only).
- AI: `@google/genai` (Gemini) or Ollama for text and embeddings; Unsplash or Gemini for images.
- Vitest, ESLint 9 (next core-web-vitals + typescript), Prettier with the tailwind plugin.

## 3. Architecture
Request flow: **page (RSC) → server action in `src/features/*/actions.ts` → Prisma / AI layer**.
- **Pages** in `src/app/(app)/*/page.tsx` are async server components. They call a `list*` server action and pass the data to one client component from `src/components/<feature>/`.
- **Server actions** (`"use server"`):
  - Call `requireProfileId()` first (`src/features/knowledge-base/session.ts`).
  - Validate input with a Zod schema from `src/validation/` (`safeParse` on `input: unknown`).
  - Return `ActionResult` (`src/features/knowledge-base/types.ts`): `{ error } | { success: true, message? }`.
  - Call `revalidatePath()` for the affected pages.
  - Do not throw for expected failures.
- **Authorization is in app code, not RLS.** Prisma bypasses RLS, so every query on profile-owned data must filter by `profileId`, e.g. `updateMany({ where: { id, profileId } })`. `Trend` and `ResearchBrief` are shared across profiles. Everything from `ContentPlan` onward belongs to a profile.
- **AI layer (`src/ai/`)**:
  - `providers/index.ts` is the only place that reads `AI_PROVIDER` / `IMAGE_PROVIDER`. It exposes `getAIProvider()`, `getAIEmbeddingProvider()` and `getImageProvider()`.
  - Provider SDKs may only be imported inside `src/ai/providers/*`.
  - Every agent's JSON output goes through `generateStructured()` (`src/ai/generate-structured.ts`) with a Zod schema from `src/validation/`.
  - Agent modules (`src/ai/<stage>/generate-*.ts`) take an `AIProvider` as a parameter. They throw a `<Stage>GenerationError` that carries the `prompt` and `raw` response.
- **Agent run pattern** (see `src/features/research/actions.ts` as the reference):
  1. Upsert the stage row with status `PROCESSING` and increment `attempts`.
  2. Call the agent.
  3. In a `$transaction`, update the row to `COMPLETED`/`FAILED` and create a `*Attempt` audit row with the prompt, response, tokens and error.
  4. Re-running a stage retries in place on the same row.
- **RAG**: `src/features/rag/` holds sync (embedding Knowledge Base rows into `KnowledgeChunk`), retrieve (cosine similarity via `$queryRaw`) and vector helpers.
- **Auth**:
  - `proxy.ts` → `src/lib/supabase/proxy.ts` refreshes the session and redirects between auth pages and protected pages.
  - `src/app/(app)/layout.tsx` redirects signed-out users to `/login`. That layout check is the real guard for every app page.
  - Supabase clients live in `src/lib/supabase/{server,client}.ts`.
- **External API** (`src/app/api/*/route.ts`): endpoints for n8n and GitHub Actions. They are not session-authenticated. Each route checks `checkWebhookSecret(request, serverEnv.<X>_WEBHOOK_SECRET)` (`src/lib/webhook-auth.ts`, header `x-webhook-secret`), then validates the body with Zod and returns `NextResponse.json`.
- **Env**:
  - Read env vars only through `serverEnv` (`src/config/env.server.ts`, `server-only`) and `clientEnv` (`src/config/env.client.ts`).
  - A new env var must be added to the schema, to `.env.example`, and to the CI placeholder env if it is required.

## 4. Folder Structure
```
proxy.ts                 session refresh + route redirects
prisma/schema.prisma     models (one status enum + *Attempt table per AI stage); migrations/ include raw SQL (pgvector, signup trigger, RLS, storage)
src/app/(auth)/          login, register (react-hook-form + zod)
src/app/(app)/<page>/    authenticated pages; layout.tsx = sidebar shell + auth guard
src/app/api/             webhooks/{trends,analytics}, scheduler/{due,publish}, analytics/published-posts
src/app/auth/callback/   Supabase email confirmation
src/features/<feature>/  server actions ("use server") + feature utils; knowledge-base/<facet>/actions.ts
src/ai/                  providers/, generate-structured.ts, <stage>/generate-*.ts (research, planning, writing, review, learning, images)
src/components/ui/       shadcn primitives (generated)
src/components/<feature>/ one client component per page (e.g. research-queue.tsx)
src/validation/<feature>.ts  Zod schemas + inferred types (forms, webhooks, LLM output)
src/config/ src/db/ src/lib/ src/hooks/
scripts/                 standalone Node scripts (GitHub Actions ports of the n8n workflows) — no `@/` imports, no deps
n8n/workflows/           exported workflow JSON + matching .md design docs
tests/                   vitest unit tests (*.test.ts); server-only is stubbed
```
`src/ai/agents`, `src/ai/prompts`, `src/repositories`, `src/services` and `src/types` are empty placeholders (`.gitkeep`). Don't put new code there; follow the existing locations above.

## 5. UI/UX and Design System
- Neutral shadcn theme. Colors are oklch CSS variables in `globals.css` (`:root` and `.dark`), and `--radius` is 0.625rem. Fonts are Geist Sans and Geist Mono.
- Use semantic token classes only (`bg-primary`, `text-muted-foreground`, `border`, `bg-card`, and so on). Do not hardcode colors, so light and dark mode both keep working.
- App shell: collapsible icon sidebar (`src/components/layout/app-sidebar.tsx`, `NAV_ITEMS`), a header with `SidebarTrigger` and `ThemeToggle`, and `<main className="flex flex-1 flex-col gap-4 p-4">`.
- Page layout pattern:
  ```tsx
  <div className="flex flex-col gap-6">
    <div><h1 className="text-2xl font-semibold tracking-tight">…</h1><p className="text-muted-foreground">…</p></div>
    <FeatureComponent data={…} />
  </div>
  ```
- Lists of records are rendered as `Card`s. Status is shown with a `Badge`, using `STATUS_VARIANT`/`STATUS_LABEL` maps keyed by the Prisma enum (`default`/`secondary`/`destructive`).
- Client components track pending state and errors with `useState` (`pendingId`, `errors: Record<id, string>`) and check `"error" in result`. There is no toast library, no `useActionState`, and no global store.

## 6. Reusable Components
- **Primitives in `src/components/ui/`**: alert, avatar, badge, button, card, dialog, dropdown-menu, input, label, select, separator, sheet, sidebar, skeleton, table, tabs, textarea, tooltip. Check this list before creating anything new. Add missing primitives with `npx shadcn add <name>`, not by hand.
- Button variants: `default | outline | secondary | ghost | destructive | link`. Sizes: `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`.
- `cn()` from `@/lib/utils` merges classes.
- `src/components/knowledge-base/facet-manager.tsx` is the generic config-driven CRUD list + dialog form for every Knowledge Base facet. Extend its field config rather than writing a new form.
- `ThemeProvider` and `ThemeToggle` live in `src/components/`. `useIsMobile` is in `src/hooks/use-mobile.ts`.

