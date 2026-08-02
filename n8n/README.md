# n8n Workflows — LinkedIn AI Studio

These workflows are the automation layer that connects this app to the outside world (trend sources, LinkedIn, engagement data) — see each workflow's own doc for the full design rationale.

| # | Workflow | Status | Docs |
|---|---|---|---|
| 1 | Trend Collector (10 sources) | ✅ Built | [`workflows/01-trend-collector.md`](workflows/01-trend-collector.md) |
| 2 | Publisher Scheduler | ⏳ Pending approval of #1 | — |
| 3 | Analytics Collector | ⏳ Not started | — |

## Shared setup notes

- All three workflows call this app's webhook endpoints, each guarded by its own shared secret (`TREND_WEBHOOK_SECRET`, `SCHEDULER_WEBHOOK_SECRET`, `ANALYTICS_WEBHOOK_SECRET` — see `linkedin-ai-studio/.env`). Each workflow uses an n8n **Header Auth** credential rather than inlining the secret, so the exported JSON files are safe to commit.
- Workflow 1 additionally needs a **Product Hunt developer token** (free, one-time signup) as its own Header Auth credential — see that workflow's doc for setup, or just skip the Product Hunt branch if you'd rather not sign up right now.
- All three reference `{{ $env.APP_BASE_URL }}` for the app's base URL — set this once in your n8n instance's environment variables (or hardcode it per-workflow if your n8n plan doesn't expose custom env vars).
- Import order doesn't matter functionally, but Trend Collector → Publisher Scheduler → Analytics Collector mirrors the actual content pipeline order.
