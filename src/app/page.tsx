import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        LinkedIn AI Studio
      </h1>
      <p className="text-muted-foreground max-w-md">
        Foundation is set up. Dashboard, auth, and the AI pipeline land in the
        next milestones.
      </p>
      <Button>Get started</Button>
    </div>
  );
}
