"use client";

import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleIcon,
  Loader2Icon,
  SparklesIcon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { runPipelineStep } from "@/features/pipeline/actions";
import { PIPELINE_STEPS, type PipelineStep } from "@/validation/pipeline";

const STEP_LABEL: Record<PipelineStep, string> = {
  research: "Research",
  plan: "Plan",
  write: "Write",
  review: "Review",
  image: "Image",
};

type StepState = "pending" | "running" | "done" | "failed";

const INITIAL_STATES = Object.fromEntries(
  PIPELINE_STEPS.map((step) => [step, "pending"]),
) as Record<PipelineStep, StepState>;

/// Runs research → plan → write → review → image for one trend, one request
/// per stage, with live progress. Retrying after a failure just calls it
/// again: stages that already completed are skipped server-side.
export function PipelineRunner({ trendId }: { trendId: string }) {
  const [states, setStates] = useState(INITIAL_STATES);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  function setStep(step: PipelineStep, state: StepState) {
    setStates((prev) => ({ ...prev, [step]: state }));
  }

  async function run() {
    setRunning(true);
    setError(null);
    setFinished(false);
    setStates(INITIAL_STATES);

    for (const step of PIPELINE_STEPS) {
      setStep(step, "running");
      let result: Awaited<ReturnType<typeof runPipelineStep>>;
      try {
        result = await runPipelineStep({ trendId, step });
      } catch {
        result = { error: "The request failed. Check your connection." };
      }

      if ("error" in result) {
        setStep(step, "failed");
        setError(`${STEP_LABEL[step]} failed: ${result.error}`);
        setRunning(false);
        return;
      }
      setStep(step, "done");
    }

    setRunning(false);
    setFinished(true);
  }

  const started = running || finished || error !== null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={running} onClick={run}>
          {running ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <SparklesIcon />
          )}
          {error ? "Retry" : "Generate post"}
        </Button>

        {started && (
          <ol className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {PIPELINE_STEPS.map((step) => (
              <li key={step} className="flex items-center gap-1">
                {states[step] === "done" && (
                  <CheckCircle2Icon className="text-primary size-3.5" />
                )}
                {states[step] === "running" && (
                  <Loader2Icon className="size-3.5 animate-spin" />
                )}
                {states[step] === "failed" && (
                  <XCircleIcon className="text-destructive size-3.5" />
                )}
                {states[step] === "pending" && (
                  <CircleIcon className="size-3.5" />
                )}
                <span
                  className={
                    states[step] === "running" ? "text-foreground" : ""
                  }
                >
                  {STEP_LABEL[step]}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {finished && (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          render={<Link href="/approval" />}
        >
          Review &amp; approve
          <ArrowRightIcon />
        </Button>
      )}
    </div>
  );
}
