import Link from "next/link";
import { notFound } from "next/navigation";

import { ResearchWorkspace } from "@/components/studio/research-workspace";
import { getResearchRequest } from "@/features/research-studio/actions";

/// Server Actions on this page (discovery, the research brief and each
/// content step) call search APIs and the model.
export const maxDuration = 60;

export default async function StudioRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const request = await getResearchRequest(id);
  if (!request) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/studio"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          ← Research Studio
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {request.focusTitle ?? "Research"}
        </h1>
      </div>
      <ResearchWorkspace request={request} />
    </div>
  );
}
