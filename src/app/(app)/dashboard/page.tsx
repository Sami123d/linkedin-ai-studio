import {
  Calendar,
  FileText,
  LineChart,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { prisma } from "@/db/prisma";

function buildDashboardCards(newTrendCount: number) {
  return [
    {
      title: "Today's draft",
      icon: FileText,
      description:
        "No draft yet. Once your Knowledge Base and content pipeline are set up, today's AI-generated post will appear here for review.",
    },
    {
      title: "Upcoming schedule",
      icon: Calendar,
      description:
        "Nothing scheduled. Approved posts will show up here with their scheduled publish times.",
    },
    {
      title: "Trending topics",
      icon: TrendingUp,
      description:
        newTrendCount > 0 ? (
          <>
            {newTrendCount} new trend{newTrendCount === 1 ? "" : "s"} waiting
            for review.{" "}
            <Link href="/trends" className="underline underline-offset-4">
              Take a look
            </Link>
            .
          </>
        ) : (
          "No trends collected yet. Point your n8n workflow at the trend webhook to start surfacing topics here."
        ),
    },
    {
      title: "Analytics",
      icon: LineChart,
      description:
        "No data yet. Engagement metrics will appear here once you start publishing.",
    },
    {
      title: "Writing score",
      icon: Sparkles,
      description:
        "Not available yet. Each generated post will get a quality score here once the review agent is live.",
    },
    {
      title: "Growth",
      icon: Trophy,
      description:
        "No growth data yet. Follower growth over time will be tracked here once analytics are connected.",
    },
  ];
}

export default async function DashboardPage() {
  const newTrendCount = await prisma.trend.count({ where: { status: "NEW" } });
  const dashboardCards = buildDashboardCards(newTrendCount);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Your content pipeline will come together here as each milestone lands.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {dashboardCards.map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <card.icon className="text-muted-foreground size-5" />
              <CardTitle className="mt-2">{card.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>{card.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
