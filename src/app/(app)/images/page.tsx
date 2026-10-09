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
          One relevant image per completed draft. With the Pollinations
          provider it is generated for the post&apos;s subject in the
          HalfClicks brand style, checked against the post, and stamped with
          the logo and slogan; with Unsplash it is a searched stock photo.
          Generating can take up to a minute.
        </p>
      </div>

      <ImageQueue items={items} />
    </div>
  );
}
