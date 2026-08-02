# n8n Workflows — LinkedIn AI Studio

These workflows are the automation layer that connects this app to the outside world (trend sources, LinkedIn, engagement data) — see each workflow's own doc for the full design rationale.

| # | Workflow | Status | Docs |
|---|---|---|---|
| 1 | Trend Collector (10 sources) | ✅ Built | [`workflows/01-trend-collector.md`](workflows/01-trend-collector.md) |
| 2 | Publisher Scheduler | ✅ Built | [`workflows/02-publisher-scheduler.md`](workflows/02-publisher-scheduler.md) |
| 3 | Analytics Collector | ✅ Built (all 3 done) | [`workflows/03-analytics-collector.md`](workflows/03-analytics-collector.md) |

## Shared setup notes

- All three workflows call this app's webhook endpoints, each guarded by its own shared secret (`TREND_WEBHOOK_SECRET`, `SCHEDULER_WEBHOOK_SECRET`, `ANALYTICS_WEBHOOK_SECRET` — see `linkedin-ai-studio/.env`). Each workflow uses an n8n **Header Auth** credential rather than inlining the secret, so the exported JSON files are safe to commit.
- Workflow 1 additionally needs a **Product Hunt developer token** (free, one-time signup) as its own Header Auth credential — see that workflow's doc for setup, or just skip the Product Hunt branch if you'd rather not sign up right now.
- Workflow 2 additionally needs a **LinkedIn OAuth2 credential** (n8n's built-in LinkedIn credential type, backed by a free LinkedIn Developer app) — see that workflow's doc for setup. This is the one workflow whose external API (LinkedIn's actual posting behavior) couldn't be verified live from here; see the doc's "one thing I couldn't fully verify" section before relying on it unattended.
- Workflow 3 **reuses that same `LinkedIn account` credential** — no new LinkedIn app/consent needed — but its own external dependency (LinkedIn's `socialActions` engagement API) is the **least verifiable piece across all 3 workflows**: likes/comments are likely accessible with a standard developer app, but impressions/share counts require LinkedIn's separate, approval-gated Marketing API Partner Program. Read that workflow's doc before assuming full analytics will just work.
- All three reference `{{ $env.APP_BASE_URL }}` for the app's base URL — set this once in your n8n instance's environment variables (or hardcode it per-workflow if your n8n plan doesn't expose custom env vars).
- Import order doesn't matter functionally, but Trend Collector → Publisher Scheduler → Analytics Collector mirrors the actual content pipeline order.

## All 3 workflows are now built

Next step is yours: import them into n8n, work through each doc's Testing Instructions (start with the highest-risk nodes — Product Hunt's token, LinkedIn's posting node, and especially Workflow 3's `socialActions` call), and validate the full pipeline end-to-end with your own account before trusting it unattended on a schedule.
