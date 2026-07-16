import {
  Calendar,
  FileText,
  LineChart,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const DASHBOARD_CARDS = [
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
      "No trends collected yet. Topics relevant to your niche will be surfaced here once trend collection is running.",
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

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Your content pipeline will come together here as each milestone lands.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DASHBOARD_CARDS.map((card) => (
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
