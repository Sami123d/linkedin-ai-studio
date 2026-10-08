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

