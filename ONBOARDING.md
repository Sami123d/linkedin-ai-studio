# Onboarding: First-Time Setup for LinkedIn AI Studio

This is the complete path from a fresh checkout to your first
automatically-published LinkedIn post. Written for a single user (you)
running this for personal LinkedIn branding.

---

## 1. How do I connect my LinkedIn account?

**Yes, you need a LinkedIn Developer App, and yes, it uses OAuth** — but
the OAuth flow itself is handled entirely by n8n, not by this Next.js app.
The app you're building your personal brand content in never talks to
LinkedIn directly; only the **Publisher Scheduler** and **Analytics
Collector** n8n workflows do, on your behalf.

### Steps

1. Go to **[linkedin.com/developers/apps](https://www.linkedin.com/developers/apps)** and sign in with your personal LinkedIn account.
2. Click **Create App**. You'll need:
   - An app name (anything, e.g. "My Content Automation")
   - Your LinkedIn Company Page as the "associated" page — **if you don't have one**, LinkedIn requires you to create a placeholder company page first (a quirk of their developer portal, not this app's requirement). A one-person page with any name works fine; it's not customer-facing.
   - A logo image (any square image, LinkedIn just requires one to create the app).
3. Once created, go to the app's **Products** tab and request **"Share on LinkedIn"**. This is the product that grants the `w_member_social` scope — posting on your own behalf — and does **not** require LinkedIn's partner review/approval process (unlike Marketing API access, which does — more on that in section 6).
4. Go to the **Auth** tab. You'll see:
   - **Client ID** and **Client Secret** — copy both, you'll paste them into n8n, not into this app's `.env`.
   - **Authorized redirect URLs** — leave this tab open; n8n will show you the exact URL to paste here in the next section.

### What credentials are required, and where they're used

| Credential | Where it lives | Used by |
|---|---|---|
| Client ID / Client Secret | n8n's **LinkedIn OAuth2 API** credential (n8n's built-in credential type) | Publisher Scheduler (posting), Analytics Collector (reading engagement) |

You do this **once**. After the initial OAuth consent (a one-time browser popup where you approve the app), n8n stores and refreshes the token automatically — you don't re-authenticate on a schedule.

**This app's own `.env` never sees your LinkedIn credentials at all** — that's a deliberate design choice (see section 6 for why).

---

## 2. How do I connect n8n with my application?

n8n and this Next.js app talk to each other over plain HTTP, secured by
shared secrets — no OAuth between them, no special SDK.

### Credentials to configure in n8n

| Credential name (as used in the workflow JSONs) | Type | Value |
|---|---|---|
| `Trend Webhook Secret` | Header Auth (`x-webhook-secret`) | Your app's `TREND_WEBHOOK_SECRET` |
| `Scheduler Webhook Secret` | Header Auth (`x-webhook-secret`) | Your app's `SCHEDULER_WEBHOOK_SECRET` |
| `Analytics Webhook Secret` | Header Auth (`x-webhook-secret`) | Your app's `ANALYTICS_WEBHOOK_SECRET` |
| `Product Hunt Bearer Token` | Header Auth (`Authorization: Bearer <token>`) | Your Product Hunt developer token (see section 6) |
| `LinkedIn account` | LinkedIn OAuth2 API | Client ID/Secret from section 1 |

Each is created once via n8n's **Credentials → New** screen. Full step-by-step for each is in the corresponding workflow doc under `n8n/workflows/`.

### Environment variables required

**In this app's `.env`** (project root):

```bash
# Database (Supabase) — already set up if you've gotten this far
DATABASE_URL=...
DIRECT_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# AI provider (Research/Planning/Writing/Review/Learning agents)
AI_PROVIDER=gemini
GEMINI_API_KEY=<your Gemini API key>
GEMINI_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001

# Image sourcing
IMAGE_PROVIDER=unsplash
UNSPLASH_ACCESS_KEY=<your Unsplash access key>

# n8n webhook secrets — generate each with:
# node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
TREND_WEBHOOK_SECRET=<random hex string>
SCHEDULER_WEBHOOK_SECRET=<random hex string>
ANALYTICS_WEBHOOK_SECRET=<random hex string>
```

**In n8n's instance environment variables** (Settings, not per-workflow):

```bash
APP_BASE_URL=http://localhost:3000   # or your real domain in production
```

This is what every workflow's HTTP nodes use to reach your app — set once, all three workflows pick it up via `{{ $env.APP_BASE_URL }}`.

### Which webhooks/endpoints get called

Nothing needs manual "registration" the way a webhook subscription
normally does — these are just plain REST endpoints n8n calls on a
schedule. For reference, here's every one your n8n instance will hit:

| Endpoint | Called by | Direction |
|---|---|---|
| `POST /api/webhooks/trends` | Trend Collector | n8n → app |
| `GET /api/scheduler/due` | Publisher Scheduler | n8n → app |
| `POST /api/scheduler/publish` | Publisher Scheduler | n8n → app |
| `GET /api/analytics/published-posts` | Analytics Collector | n8n → app |
| `POST /api/webhooks/analytics` | Analytics Collector | n8n → app |

All five require the matching `x-webhook-secret` header — the app rejects
anything else with `401`.

---

## 3. How do I import and configure the three workflows?

1. Open your n8n instance (self-hosted or n8n Cloud both work).
2. **Workflows → Import from File** → select each of:
   - `n8n/workflows/01-trend-collector.json`
   - `n8n/workflows/02-publisher-scheduler.json`
   - `n8n/workflows/03-analytics-collector.json`
3. For **each** imported workflow, open it and attach real credentials to every node currently showing a placeholder — n8n will visibly flag these (usually a warning icon on the node) since the JSON exports reference credentials by name, not by embedding secrets. Cross-reference the table in section 2.
4. **Activate** each workflow (top-right toggle in n8n's editor) once credentials are attached — an imported workflow is inactive by default and won't run on its schedule until you flip this.
5. Do **not** trust it blindly yet — each workflow's own doc has a "Testing Instructions" section with a specific first-manual-run checklist. Follow those in order (Trend Collector first, it has zero destructive side effects; Publisher Scheduler and Analytics Collector touch your real LinkedIn account, test more carefully).

Full setup detail (schedules, exact node purposes, error handling) is in
each workflow's own doc — this section is just the mechanical
import-and-activate steps.

---

## 4. How do I run the system for the first time?

```bash
# 1. Install dependencies (first time only)
npm install

# 2. Apply database migrations (first time only, or after pulling new ones)
npx prisma migrate deploy
npx prisma generate

# 3. Start the app
npm run dev
```

The app runs at `http://localhost:3000`. Separately, your n8n instance
needs to be running too (self-hosted via Docker, or n8n Cloud — however
you've set it up; that's independent of this repo).

**First account**: go to `http://localhost:3000/register`, create your
account, confirm the email Supabase sends (or disable email confirmation
in Supabase's Auth settings for local testing).

---

## 5. Complete user journey: fresh install → first automatic post

```
1.  Install project                  npm install
2.  Configure .env                   Section 2 above
3.  Apply DB migrations               npx prisma migrate deploy
4.  Start Next.js                    npm run dev  (localhost:3000)
5.  Register + log in                /register → /login
6.  Fill in Knowledge Base            /knowledge-base
      — Resume, Projects, Experience, Achievements, Skills,
        Writing Samples (important — this is your voice),
        Goals, Opinions
7.  Sync Knowledge Base to RAG        /knowledge-base → "RAG Sync" tab → Sync now
8.  Set up n8n                        Separate from this repo — Docker/Cloud
9.  Connect LinkedIn to n8n           Section 1 above (one-time OAuth)
10. Import + activate 3 workflows     Section 3 above
11. Trend Collector runs              Automatic (every 6h) or trigger manually
12. Review trends                     /trends → mark good ones "Reviewed"
13. Generate research                 /research → "Generate research" per trend
14. Generate content plan             /planning → "Plan content"
15. Generate draft                    /writing → "Write draft"
16. Quality review                    /review → "Review draft" (AI critique + score)
17. Find an image                     /images → "Find image"
18. Approve + schedule                /approval → review everything, pick a
                                       publish date/time, Approve
19. See it on the calendar            /calendar
20. Publisher Scheduler runs           Automatic (every 15 min) — publishes to
                                       LinkedIn when the scheduled time arrives
21. Confirm it's live                  /calendar shows "Published" + link to
                                       the real LinkedIn post
22. Analytics Collector runs           Automatic (daily) — pulls likes/comments
23. See engagement                     /analytics
24. Generate insights                  /learning → "Generate insights" (once
                                       you have a few published, measured posts)
25. Insights inform your next          Back to step 12 — you now know which
    round of trend review              angles/topics/tones actually work
```

Steps 1–10 are one-time setup. Steps 11–25 are the repeating content loop
— everything in italics-marked "Automatic" runs on its own once the
workflows are active; everything else is a deliberate human action (you
reviewing/approving), which is the intended design — you stay the one
decision point in the pipeline.

---

## 6. External services — what each one is and why it's needed

| Service | What it's for | Cost | Required or optional |
|---|---|---|---|
| **Supabase** | Postgres database + auth | Free tier is enough for personal use | Required |
| **Google AI Studio (Gemini)** | Powers Research/Planning/Writing/Review/Learning agents (text) + Knowledge Base embeddings (RAG) | Free tier (`gemini-2.5-flash`, `gemini-embedding-001` both confirmed free-tier eligible) | Required |
| **Unsplash** | Sources a relevant photo per post | Free (Demo app tier: 50 requests/hour) | Required for the Images step (or leave it unconfigured and just skip that step) |
| **n8n** | Runs all 3 automation workflows — this is the actual "engine" connecting your app to the outside world | Free if self-hosted (Docker); n8n Cloud has a free tier too, with limits | Required |
| **LinkedIn Developer Portal** | Lets n8n post on your behalf and read engagement on your posts | Free | Required |
| **Product Hunt API** | One of 10 trend sources in the Trend Collector | Free (developer token, no review needed) | Optional — skip that one branch if you don't want to sign up |
| **Hacker News, dev.to, GitHub, Google News, Reddit, OpenAI/Anthropic/Vercel/Next.js blogs** | The other 9 trend sources | Free, no signup for any of them | Already working, nothing to configure |

**Why LinkedIn credentials live in n8n, not this app:** this app has no
persistent background process (it's a request-driven Next.js server) and
building a full LinkedIn OAuth token-refresh flow directly into it would
duplicate what n8n already does well. Keeping LinkedIn's OAuth entirely in
n8n also means this app's `.env` (and therefore its git history, its
deployment config, anything that reads that file) never touches your
LinkedIn credentials at all.

**What Gemini does NOT cover:** actual image *generation* (as opposed to
sourcing a stock photo) needs a billing-enabled Google Cloud project —
confirmed by testing against the live API, not assumed. That's why
Unsplash is the default image source; see `n8n/README.md` and Milestone
11's history if you want to revisit enabling billing later.

**What LinkedIn does NOT cover for free:** real per-post impressions/reach
data requires LinkedIn's Marketing API Partner Program — a separate,
approval-gated relationship most individual developers don't have. The
Analytics Collector workflow is built to work with what's actually
available (likes/comments) rather than assume access you may not get.

---

## 7. Deployment checklist

Work through this before trusting the system to run unattended.

### App

- [ ] `npm install` completed without errors
- [ ] `.env` has all required variables (compare against `.env.example` and section 2 above)
- [ ] `npx prisma migrate deploy` shows all migrations applied, no errors
- [ ] `npm run build` completes successfully (catches anything `dev` mode might mask)
- [ ] `npm run dev` starts, `http://localhost:3000` loads
- [ ] Registered an account, logged in successfully, `/dashboard` loads

### Knowledge Base

- [ ] Resume, at least 2–3 Projects, Experience, and several Writing Samples filled in — the more real writing samples, the better the Writing Agent's voice match
- [ ] "Sync Knowledge Base" run at least once on `/knowledge-base` → "RAG Sync" tab, chunk count is nonzero

### Gemini

- [ ] `GEMINI_API_KEY` set, real key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- [ ] Test: run "Generate research" on any trend and confirm it completes (proves the key works end-to-end)

### Unsplash (optional but recommended)

- [ ] `UNSPLASH_ACCESS_KEY` set, from a Demo app at [unsplash.com/developers](https://unsplash.com/developers)
- [ ] Test: run "Find image" on a completed draft, confirm an image + attribution appears on `/images`

### n8n instance

- [ ] n8n is running and reachable (self-hosted or Cloud)
- [ ] `APP_BASE_URL` set in n8n's environment, pointing at your app's real, reachable address (not `localhost` if n8n runs somewhere that can't reach your machine's localhost — see note below)

### LinkedIn

- [ ] LinkedIn Developer app created, "Share on LinkedIn" product added
- [ ] `LinkedIn account` OAuth2 credential created in n8n, consent flow completed successfully (n8n shows "Connected")

### Product Hunt (optional)

- [ ] Developer token generated, `Product Hunt Bearer Token` credential created in n8n — or deliberately skipped (disconnect that branch in Workflow 1)

### The 3 workflows

- [ ] All 3 imported into n8n
- [ ] Every placeholder credential replaced with a real one (no node shows a credential warning icon)
- [ ] Each workflow's `TREND_WEBHOOK_SECRET`/`SCHEDULER_WEBHOOK_SECRET`/`ANALYTICS_WEBHOOK_SECRET` credential value matches the app's actual `.env` value exactly
- [ ] **Trend Collector**: manually executed once, confirmed trends appear on `/trends`
- [ ] **Publisher Scheduler**: manually executed once against a real test post scheduled a few minutes out, confirmed it actually appears on LinkedIn and `/calendar` shows "Published"
- [ ] **Analytics Collector**: manually executed once against that same test post, confirmed a snapshot appears on `/analytics`
- [ ] All 3 workflows toggled **Active** in n8n

### End-to-end dry run

- [ ] Walked one trend all the way through: Trend → Research → Plan → Draft → Review → Image → Approve → (wait for schedule) → Published → Analytics
- [ ] Confirmed no step required manual database intervention — everything reachable through the UI

### Ongoing health

- [ ] Considered assigning an Error Workflow in n8n to each of the 3 workflows (Workflow Settings → Error Workflow) so a silent failure surfaces instead of going unnoticed
- [ ] Know where to check when something seems stuck: n8n's **Executions** tab (per-workflow run history) is the first place to look, before assuming the app itself is broken

---

**Note on `APP_BASE_URL` and localhost:** if n8n runs in Docker or in the
cloud, it can't reach `http://localhost:3000` on your machine — that
`localhost` would resolve to n8n's own container/server, not yours. For
local development with self-hosted n8n in Docker, use your machine's LAN
IP (e.g. `http://192.168.1.x:3000`) or a tunnel (e.g. `ngrok`) instead.
This only matters once you're testing the workflows against a real
running app, not before.
