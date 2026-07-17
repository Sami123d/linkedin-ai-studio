import { ReviewQueue } from "@/components/review/review-queue";
import { listReviewQueue } from "@/features/review/actions";

export default async function ReviewPage() {
  const items = await listReviewQueue();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Quality review
        </h1>
        <p className="text-muted-foreground">
          A skeptical second pass on each draft before it goes to you for
          final approval — hook strength, clarity, voice match, value, and
          call-to-action, scored and critiqued.
        </p>
      </div>

      <ReviewQueue items={items} />
    </div>
  );
}
