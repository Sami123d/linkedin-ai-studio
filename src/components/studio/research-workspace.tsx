"use client";

import {
  CheckCircle2Icon,
  CircleIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PLATFORM_META } from "@/features/platforms/config";
import {
  runDiscovery,
  runSourcedResearch,
  runStudioStep,
  saveSourceSelection,
  type getResearchRequest,
} from "@/features/research-studio/actions";
import type { ResearchSource } from "@/generated/prisma/client";
import {
  researchEvidenceSchema,
  STUDIO_STEPS,
  type FindingConfidence,
  type StudioStep,
} from "@/validation/research-studio";

type Request = NonNullable<Awaited<ReturnType<typeof getResearchRequest>>>;

const PROVIDER_LABEL: Record<string, string> = {
  hackernews: "Hacker News",
  devto: "DEV",
  brave: "Brave News",
  "collected-trend": "Collected trend",
};

const CONFIDENCE: Record<
  FindingConfidence,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  supported: { label: "Supported", variant: "default" },
  partially_supported: { label: "Partly supported", variant: "secondary" },
  unverified: { label: "Unverified", variant: "destructive" },
};

const STEP_LABEL: Record<StudioStep, string> = {
  plan: "Plan",
  write: "Write",
  review: "Review",
  image: "Image",
  variants: "Platform variants",
};

function formatDate(value: Date | string | null): string {
  if (!value) return "Date unknown";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="underline-offset-4 hover:underline"
    >
      {children}
    </a>
  );
}

export function ResearchWorkspace({ request }: { request: Request }) {
  const brief = request.trend?.researchBrief ?? null;
  const plan = brief?.contentPlans[0] ?? null;

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(request.sources.filter((s) => s.selected).map((s) => s.id)),
  );
  const [focus, setFocus] = useState<string | null>(request.focusTitle);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(
    op: string,
    action: () => Promise<
      { error: string } | { success: true; message?: string }
    >,
  ) {
    setPending(op);
    setError("");
    setNotice("");
    let result: { error: string } | { success: true; message?: string };
    try {
      result = await action();
    } catch {
      result = {
        error: "The request failed. Check your connection and retry.",
      };
    }
    setPending(null);
    if ("error" in result) setError(result.error);
    else if (result.message) setNotice(result.message);
    return !("error" in result);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function research() {
    const saved = await run("brief", () =>
      saveSourceSelection({
        requestId: request.id,
        sourceIds: [...selected],
        focusTitle: focus ?? undefined,
      }),
    );
    if (saved)
      await run("brief", () => runSourcedResearch({ requestId: request.id }));
  }

  const groups = useMemo(() => {
    const recent: ResearchSource[] = [];
    const background: ResearchSource[] = [];
    const undated: ResearchSource[] = [];
    for (const s of request.sources) {
      if (s.isRecent) recent.push(s);
      else if (s.publishedAt) background.push(s);
      else undated.push(s);
    }
    return { recent, background, undated };
  }, [request.sources]);

  const providerResults = (request.discoveryLogs[0]?.providerResults ??
    {}) as Record<
    string,
    { ok: boolean; count: number; skipped?: boolean; error?: string }
  >;
  const busy = pending !== null;

  return (
    <div className="flex flex-col gap-6">
      {/* Request summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Research request</CardTitle>
          <CardDescription className="whitespace-pre-wrap">
            {request.prompt}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="secondary">Last {request.timeframeDays} day(s)</Badge>
          {request.platforms.map((p) => (
            <Badge key={p} variant="secondary">
              {PLATFORM_META[p].label}
            </Badge>
          ))}
          {[
            ["Audience", request.audience],
            ["Niche", request.industry],
            ["Angle", request.angle],
            ["Purpose", request.purpose],
            ["Tone", request.tone],
            ["CTA", request.callToAction],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <Badge key={k} variant="outline">
                {k}: {v}
              </Badge>
            ))}
          <Badge variant="outline">
            Links in posts: {request.includeLinks ? "allowed" : "off"}
          </Badge>
        </CardContent>
      </Card>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {notice && <p className="text-muted-foreground text-sm">{notice}</p>}

      {/* Sources */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">1. Sources</CardTitle>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run("discover", () => runDiscovery({ requestId: request.id }))
              }
            >
              {pending === "discover" ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RefreshCwIcon />
              )}
              {request.discoveryStatus === "PENDING"
                ? "Find sources"
                : "Search again"}
            </Button>
          </div>
          <CardDescription>
            Results from real search APIs, as returned. Pick the sources the
            brief should use, and optionally the one to focus on.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {Object.keys(providerResults).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(providerResults).map(([name, r]) => (
                <Badge
                  key={name}
                  variant={
                    r.skipped ? "outline" : r.ok ? "secondary" : "destructive"
                  }
                  title={r.error}
                >
                  {PROVIDER_LABEL[name] ?? name}:{" "}
                  {r.skipped
                    ? "not configured"
                    : r.ok
                      ? `${r.count}`
                      : "failed"}
                </Badge>
              ))}
            </div>
          )}
          {request.discoveryStatus === "FAILED" && (
            <p className="text-destructive text-sm">
              {request.discoveryError ?? "Source discovery failed."} Use “Search
              again” to retry.
            </p>
          )}
          {request.discoveryStatus === "COMPLETED" &&
            request.sources.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No sources matched. Try a broader prompt or a longer timeframe
                on a new request.
              </p>
            )}

          {(
            [
              [
                "recent",
                `From the last ${request.timeframeDays} day(s)`,
                groups.recent,
              ],
              ["background", "Older background material", groups.background],
              [
                "undated",
                "No publication date (treat with care)",
                groups.undated,
              ],
            ] as const
          ).map(
            ([key, title, list]) =>
              list.length > 0 && (
                <div key={key} className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">
                    {title}{" "}
                    <span className="text-muted-foreground">
                      ({list.length})
                    </span>
                  </h3>
                  <div className="grid gap-2 lg:grid-cols-2">
                    {list.map((s) => (
                      <SourceCard
                        key={s.id}
                        source={s}
                        checked={selected.has(s.id)}
                        focused={focus === s.title}
                        onToggle={() => toggle(s.id)}
                        onFocus={() =>
                          setFocus(focus === s.title ? null : s.title)
                        }
                        disabled={busy}
                      />
                    ))}
                  </div>
                </div>
              ),
          )}

          {request.sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button disabled={busy || selected.size === 0} onClick={research}>
                {pending === "brief" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <SparklesIcon />
                )}
                {brief ? "Rebuild research brief" : "Build research brief"}
              </Button>
              <span className="text-muted-foreground text-xs">
                {selected.size} source(s) selected
                {focus ? ` · focus: “${focus}”` : ""}
                {groups.recent.length === 0 &&
                  " · none are from your timeframe"}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Brief */}
      {brief && <BriefCard brief={brief} />}

      {/* Content */}
      {brief?.status === "COMPLETED" && request.trendId && (
        <ContentCard request={request} plan={plan} />
      )}
    </div>
  );
}

function SourceCard({
  source,
  checked,
  focused,
  onToggle,
  onFocus,
  disabled,
}: {
  source: ResearchSource;
  checked: boolean;
  focused: boolean;
  onToggle: () => void;
  onFocus: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={
        checked
          ? "border-primary flex flex-col gap-2 rounded-lg border p-3"
          : "flex flex-col gap-2 rounded-lg border p-3"
      }
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="accent-primary mt-1 size-4 shrink-0"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
          aria-label={`Use source: ${source.title}`}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <ExternalLink href={source.url}>
            <span className="text-sm font-medium break-words">
              {source.title}
            </span>
          </ExternalLink>
          <span className="text-muted-foreground text-xs">
            {source.publisher ?? "Unknown publisher"} ·{" "}
            {formatDate(source.publishedAt)} · retrieved{" "}
            {formatDate(source.retrievedAt)}
          </span>
        </div>
      </div>
      {source.snippet && (
        <p className="text-muted-foreground line-clamp-3 text-xs">
          {source.snippet}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          {PROVIDER_LABEL[source.provider] ?? source.provider}
        </Badge>
        {source.discussionUrl && (
          <a
            href={source.discussionUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-muted-foreground text-xs underline underline-offset-2"
          >
            Discussion
          </a>
        )}
        {checked && (
          <Button
            size="xs"
            variant={focused ? "default" : "ghost"}
            onClick={onFocus}
            disabled={disabled}
          >
            {focused ? "Focus topic" : "Make focus"}
          </Button>
        )}
      </div>
    </div>
  );
}

type Brief = NonNullable<Request["trend"]>["researchBrief"] & {};

function BriefCard({ brief }: { brief: NonNullable<Brief> }) {
  const evidence = researchEvidenceSchema.safeParse(brief.evidence);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">2. Research brief</CardTitle>
          <Badge
            variant={
              brief.status === "COMPLETED"
                ? "default"
                : brief.status === "FAILED"
                  ? "destructive"
                  : "secondary"
            }
          >
            {brief.status === "COMPLETED"
              ? "Ready"
              : brief.status === "FAILED"
                ? "Failed"
                : "Generating"}
          </Badge>
        </div>
        <CardDescription>
          Written by the AI only from the selected sources. Check each
          finding&apos;s evidence before creating posts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {brief.status === "FAILED" && (
          <p className="text-destructive">
            {brief.errorMessage ?? "Generation failed."} Use “Rebuild research
            brief” to retry.
          </p>
        )}
        {brief.status === "COMPLETED" && (
          <>
            {brief.executiveSummary && <p>{brief.executiveSummary}</p>}
            {brief.whyItMattersNow && (
              <div>
                <h3 className="font-medium">Why it matters now</h3>
                <p className="text-muted-foreground">{brief.whyItMattersNow}</p>
              </div>
            )}

            {evidence.success ? (
              <div className="flex flex-col gap-2">
                <h3 className="font-medium">Findings</h3>
                {evidence.data.findings.map((f, i) => (
                  <details key={i} className="rounded-lg border p-3">
                    <summary className="flex cursor-pointer list-none flex-wrap items-start gap-2">
                      <Badge variant={CONFIDENCE[f.confidence].variant}>
                        {CONFIDENCE[f.confidence].label}
                      </Badge>
                      <span className="min-w-0 flex-1">{f.statement}</span>
                      <span className="text-muted-foreground text-xs">
                        {f.sources.length} source(s)
                      </span>
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1 border-t pt-2">
                      {f.sources.length === 0 && (
                        <li className="text-muted-foreground text-xs">
                          No source supports this statement; treat it as an
                          assumption, not a fact.
                        </li>
                      )}
                      {f.sources.map((s) => (
                        <li key={s.ref} className="text-xs">
                          <span className="text-muted-foreground">
                            [{s.ref}]{" "}
                          </span>
                          <ExternalLink href={s.url}>{s.title}</ExternalLink>
                          <span className="text-muted-foreground">
                            {" "}
                            · {s.publisher ?? "unknown"} ·{" "}
                            {formatDate(s.publishedAt)}
                            {s.publishedAt && !s.isRecent
                              ? " · background"
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
                {evidence.data.droppedRefs.length > 0 && (
                  <p className="text-muted-foreground text-xs">
                    The AI cited source ids that don&apos;t exist (
                    {evidence.data.droppedRefs.join(", ")}); those citations
                    were removed.
                  </p>
                )}
              </div>
            ) : (
              brief.keyInsights.length > 0 && (
                <ul className="list-disc pl-5">
                  {brief.keyInsights.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              )
            )}

            {brief.risks.length > 0 && (
              <div>
                <h3 className="font-medium">
                  Counterpoints, limitations and open questions
                </h3>
                <ul className="text-muted-foreground list-disc pl-5">
                  {brief.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {brief.contentAngles.length > 0 && (
              <div>
                <h3 className="font-medium">Suggested angles</h3>
                <ul className="text-muted-foreground list-disc pl-5">
                  {brief.contentAngles.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {(brief.audienceFit || brief.platformFit.length > 0) && (
              <div>
                <h3 className="font-medium">Audience and platform fit</h3>
                {brief.audienceFit && (
                  <p className="text-muted-foreground">{brief.audienceFit}</p>
                )}
                <ul className="text-muted-foreground list-disc pl-5">
                  {brief.platformFit.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {evidence.success && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  All sources used ({evidence.data.sources.length})
                </summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {evidence.data.sources.map((s) => (
                    <li key={s.ref} className="text-xs">
                      <span className="text-muted-foreground">[{s.ref}] </span>
                      <ExternalLink href={s.url}>{s.title}</ExternalLink>
                      <span className="text-muted-foreground">
                        {" "}
                        · {s.publisher ?? "unknown"} ·{" "}
                        {formatDate(s.publishedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type StepState = "pending" | "running" | "done" | "failed" | "skipped";

function ContentCard({
  request,
  plan,
}: {
  request: Request;
  plan:
    | NonNullable<
        NonNullable<Request["trend"]>["researchBrief"]
      >["contentPlans"][number]
    | null;
}) {
  const [states, setStates] = useState<Record<StudioStep, StepState>>(
    () =>
      Object.fromEntries(STUDIO_STEPS.map((s) => [s, "pending"])) as Record<
        StudioStep,
        StepState
      >,
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  async function continueToContent() {
    setRunning(true);
    setError("");
    setWarning("");
    for (const step of STUDIO_STEPS) {
      setStates((p) => ({ ...p, [step]: "running" }));
      let result: { error: string } | { success: true; message?: string };
      try {
        result = await runStudioStep({ requestId: request.id, step });
      } catch {
        result = { error: "The request failed. Check your connection." };
      }
      if ("error" in result) {
        if (step === "image") {
          // An image is optional for LinkedIn/Facebook; Instagram approval
          // will ask for one later.
          setStates((p) => ({ ...p, image: "skipped" }));
          setWarning(
            `Image: ${result.error} You can generate it later on the Images page.`,
          );
          continue;
        }
        setStates((p) => ({ ...p, [step]: "failed" }));
        setError(`${STEP_LABEL[step]}: ${result.error}`);
        setRunning(false);
        return;
      }
      setStates((p) => ({ ...p, [step]: "done" }));
    }
    setRunning(false);
  }

  const draft = plan?.draft ?? null;
  const started = Object.values(states).some((s) => s !== "pending");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">3. Content</CardTitle>
        <CardDescription>
          Plan, write and review a LinkedIn post from this brief, then adapt it
          for the other selected platforms. Nothing is approved, scheduled or
          published here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={continueToContent} disabled={running}>
            {running ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <SparklesIcon />
            )}
            {draft ? "Continue / retry content" : "Continue to content"}
          </Button>
          {started && (
            <ol className="flex flex-wrap items-center gap-3 text-sm">
              {STUDIO_STEPS.map((step) => (
                <li key={step} className="flex items-center gap-1">
                  {states[step] === "done" && (
                    <CheckCircle2Icon className="text-primary size-4" />
                  )}
                  {states[step] === "running" && (
                    <Loader2Icon className="size-4 animate-spin" />
                  )}
                  {states[step] === "failed" && (
                    <XCircleIcon className="text-destructive size-4" />
                  )}
                  {(states[step] === "pending" ||
                    states[step] === "skipped") && (
                    <CircleIcon className="text-muted-foreground size-4" />
                  )}
                  <span
                    className={
                      states[step] === "pending" ? "text-muted-foreground" : ""
                    }
                  >
                    {STEP_LABEL[step]}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        {error && (
          <p className="text-destructive text-sm">
            {error} Retry continues from this step.
          </p>
        )}
        {warning && <p className="text-muted-foreground text-sm">{warning}</p>}

        {plan?.status === "COMPLETED" && (
          <div className="text-sm">
            <span className="font-medium">Plan: </span>
            <span className="text-muted-foreground">
              {plan.selectedAngle} — “{plan.hook}”
            </span>
          </div>
        )}

        {draft?.status === "COMPLETED" && (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">LinkedIn</span>
                <Badge variant="secondary">
                  {draft.scheduledPost?.publishedAt
                    ? "Published"
                    : draft.scheduledPost?.approvalStatus === "APPROVED"
                      ? "Approved"
                      : "Not approved"}
                </Badge>
              </div>
              <p className="bg-muted/50 line-clamp-6 rounded-lg p-2 text-sm whitespace-pre-wrap">
                {draft.content || draft.slides.join("\n\n")}
              </p>
              {draft.qualityReview?.overallScore != null && (
                <span className="text-muted-foreground text-xs">
                  Quality review score: {draft.qualityReview.overallScore}
                </span>
              )}
              <Link
                href="/approval"
                className="text-xs underline underline-offset-2"
              >
                Edit, approve or reject in Approval
              </Link>
            </div>
            {draft.platformVariants.map((v) => (
              <div
                key={v.id}
                className="flex flex-col gap-2 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {PLATFORM_META[v.platform].label}
                  </span>
                  <Badge
                    variant={
                      v.status === "FAILED" ? "destructive" : "secondary"
                    }
                  >
                    {v.publishStatus === "PUBLISHED"
                      ? "Published"
                      : v.approvalStatus === "APPROVED"
                        ? "Approved"
                        : v.status === "COMPLETED"
                          ? "Not approved"
                          : v.status === "FAILED"
                            ? "Generation failed"
                            : "Generating"}
                  </Badge>
                </div>
                {v.content && (
                  <p className="bg-muted/50 line-clamp-6 rounded-lg p-2 text-sm whitespace-pre-wrap">
                    {v.content}
                  </p>
                )}
                {v.errorMessage && (
                  <p className="text-destructive text-xs">{v.errorMessage}</p>
                )}
                <Link
                  href="/platforms"
                  className="text-xs underline underline-offset-2"
                >
                  Edit, approve or publish in Platforms{" "}
                  <ExternalLinkIcon className="inline size-3" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
