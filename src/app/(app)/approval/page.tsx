import { ApprovalQueue } from "@/components/approval/approval-queue";
import { listApprovalQueue } from "@/features/approval/actions";

export default async function ApprovalPage() {
  const items = await listApprovalQueue();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approval</h1>
        <p className="text-muted-foreground">
          The final human check — approve a draft with a publish date, or
          reject it with a reason so you remember why next time.
        </p>
      </div>

      <ApprovalQueue items={items} />
    </div>
  );
}
