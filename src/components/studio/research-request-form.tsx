"use client";

import { Loader2Icon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PLATFORM_META } from "@/features/platforms/config";
import {
  createResearchRequest,
  runDiscovery,
} from "@/features/research-studio/actions";
import type { CampaignPlatform } from "@/validation/platforms";
import { TIMEFRAME_OPTIONS } from "@/validation/research-studio";

const TIMEFRAME_LABEL: Record<(typeof TIMEFRAME_OPTIONS)[number], string> = {
  1: "24 hours",
  7: "7 days",
  30: "30 days",
  90: "90 days",
};

const PLATFORMS: CampaignPlatform[] = ["LINKEDIN", "FACEBOOK", "INSTAGRAM"];

const TEXT_FIELDS = [
  {
    name: "audience",
    label: "Target audience",
    placeholder: "e.g. small e-commerce business owners",
  },
  {
    name: "industry",
    label: "Industry or niche",
    placeholder: "e.g. e-commerce",
  },
  {
    name: "angle",
    label: "Preferred angle",
    placeholder: "e.g. practical first steps",
  },
  {
    name: "purpose",
    label: "Purpose of the post",
    placeholder: "e.g. educate, start a discussion",
  },
  { name: "tone", label: "Tone", placeholder: "e.g. clear, friendly, no hype" },
  {
    name: "callToAction",
    label: "Call to action",
    placeholder: "e.g. ask readers what they've tried",
  },
] as const;

type TextField = (typeof TEXT_FIELDS)[number]["name"];

export function ResearchRequestForm({
  prefill,
}: {
  prefill?: { trendId: string; topic: string; category: string | null } | null;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(
    prefill
      ? `Research the latest developments around "${prefill.topic}".`
      : "",
  );
  const [timeframe, setTimeframe] = useState<number>(7);
  const [fields, setFields] = useState<Record<TextField, string>>({
    audience: "",
    industry: prefill?.category ?? "",
    angle: "",
    purpose: "",
    tone: "",
    callToAction: "",
  });
  const [instructions, setInstructions] = useState("");
  const [platforms, setPlatforms] = useState<CampaignPlatform[]>(["LINKEDIN"]);
  const [includeLinks, setIncludeLinks] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState("");
  const busy = status !== null;

  function togglePlatform(p: CampaignPlatform) {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("Saving your request…");
    const created = await createResearchRequest({
      prompt,
      timeframeDays: timeframe,
      ...fields,
      instructions,
      includeLinks,
      platforms,
      baseTrendId: prefill?.trendId,
    });
    if ("error" in created) {
      setStatus(null);
      setError(created.error);
      return;
    }
    setStatus("Searching Hacker News, DEV and collected trends for sources…");
    // Discovery errors are shown (with a retry) on the request page.
    await runDiscovery({ requestId: created.id }).catch(() => undefined);
    router.push(`/studio/${created.id}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New research</CardTitle>
        <CardDescription>
          Describe what to research. Sources come from real search APIs; nothing
          is published until you approve it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {prefill && (
            <p className="text-muted-foreground text-sm">
              Starting from the collected trend “{prefill.topic}”.
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="studio-prompt">Topic or research prompt</Label>
            <Textarea
              id="studio-prompt"
              rows={3}
              required
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Find recent trends about AI agents in e-commerce and create an educational post for business owners."
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Timeframe</Label>
            <div className="flex flex-wrap gap-2">
              {TIMEFRAME_OPTIONS.map((days) => (
                <Button
                  key={days}
                  type="button"
                  size="sm"
                  variant={timeframe === days ? "default" : "outline"}
                  aria-pressed={timeframe === days}
                  onClick={() => setTimeframe(days)}
                >
                  Last {TIMEFRAME_LABEL[days]}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.map((f) => (
              <div key={f.name} className="grid gap-1.5">
                <Label htmlFor={`studio-${f.name}`}>{f.label}</Label>
                <Input
                  id={`studio-${f.name}`}
                  value={fields[f.name]}
                  placeholder={f.placeholder}
                  onChange={(e) =>
                    setFields((prev) => ({ ...prev, [f.name]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="studio-instructions">
              Other instructions (optional)
            </Label>
            <Textarea
              id="studio-instructions"
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={platforms.includes(p) ? "default" : "outline"}
                  aria-pressed={platforms.includes(p)}
                  onClick={() => togglePlatform(p)}
                >
                  {PLATFORM_META[p].label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={includeLinks ? "default" : "outline"}
              aria-pressed={includeLinks}
              onClick={() => setIncludeLinks((v) => !v)}
            >
              Source links in posts: {includeLinks ? "allowed" : "off"}
            </Button>
            <span className="text-muted-foreground text-xs">
              Sources are always kept in the research view; posts include links
              only if you allow it.
            </span>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
          {status && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              {status}
            </p>
          )}

          <Button
            type="submit"
            className="self-start"
            disabled={
              busy || prompt.trim().length < 10 || platforms.length === 0
            }
          >
            <SearchIcon />
            Research topic
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
