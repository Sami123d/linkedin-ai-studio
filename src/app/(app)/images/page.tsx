import { ImageQueue } from "@/components/images/image-queue";
import { listImageQueue } from "@/features/images/actions";

export default async function ImagesPage() {
  const items = await listImageQueue();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Post images
        </h1>
        <p className="text-muted-foreground">
          Find a relevant, properly-attributed photo for each completed
          draft. AI-generated images are a future upgrade once billing is
          enabled — this uses free Unsplash search for now.
        </p>
      </div>

      <ImageQueue items={items} />
    </div>
  );
}
