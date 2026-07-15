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
      <p className="max-w-md text-muted-foreground">
        Foundation is set up. Dashboard and the AI pipeline land in the next
        milestones.
      </p>
      <Button render={<Link href={isLoggedIn ? "/profile" : "/login"} />}>
        {isLoggedIn ? "Go to profile" : "Get started"}
      </Button>
    </div>
  );
}
