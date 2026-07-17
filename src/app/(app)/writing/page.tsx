import { WritingQueue } from "@/components/writing/writing-queue";
import { listWritingQueue } from "@/features/writing/actions";

export default async function WritingPage() {
  const items = await listWritingQueue();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Writing queue
        </h1>
        <p className="text-muted-foreground">
          Turn a completed content plan into the actual post — written in
          your voice from your own writing samples.
        </p>
      </div>

      <WritingQueue items={items} />
    </div>
  );
}
