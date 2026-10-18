import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { listResearchRequests } from "@/features/research-studio/actions";

type Item = Awaited<ReturnType<typeof listResearchRequests>>[number];

function stageLabel(item: Item): {
  label: string;
  variant: "default" | "secondary" | "destructive";
} {
  const brief = item.trend?.researchBrief?.status;
  if (brief === "COMPLETED")
    return { label: "Brief ready", variant: "default" };
  if (brief === "FAILED")
    return { label: "Brief failed", variant: "destructive" };
  if (brief === "PROCESSING")
    return { label: "Writing brief", variant: "secondary" };
  if (item.discoveryStatus === "FAILED")
    return { label: "Search failed", variant: "destructive" };
  if (item.discoveryStatus === "PROCESSING")
    return { label: "Searching", variant: "secondary" };
  if (item.discoveryStatus === "COMPLETED")
    return { label: "Sources found", variant: "secondary" };
  return { label: "Not searched", variant: "secondary" };
}

export function ResearchRequestList({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No research yet. Start one above, or pick a collected trend on the{" "}
        <Link href="/trends" className="underline underline-offset-4">
          Trends
        </Link>{" "}
        page.
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      {items.map((item) => {
        const stage = stageLabel(item);
        return (
          <Link key={item.id} href={`/studio/${item.id}`} className="block">
            <Card className="hover:bg-muted/50 transition-colors">
              <CardContent className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="line-clamp-2 text-sm font-medium">
                  {item.focusTitle ?? item.prompt}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary">
                    {item._count.sources} sources
                  </Badge>
                  <Badge variant={stage.variant}>{stage.label}</Badge>
                  <span className="text-muted-foreground text-xs">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
