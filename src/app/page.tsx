import Link from "next/link";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        LinkedIn AI Studio
      </h1>
      <p className="text-muted-foreground max-w-md">
        Turn trending topics into LinkedIn posts written in your own voice:
        research, plan, draft, review, approve and schedule, with n8n handling
        trend collection, publishing and analytics.
      </p>
      <Button render={<Link href={isLoggedIn ? "/dashboard" : "/login"} />}>
        {isLoggedIn ? "Go to dashboard" : "Get started"}
      </Button>
    </div>
  );
}
