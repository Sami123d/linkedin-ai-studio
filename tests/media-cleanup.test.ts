import { beforeEach, describe, expect, it, vi } from "vitest";

// Prepared-image cleanup with a mocked Storage bucket and Prisma. Proves the
// scoping and retry rules; it does not talk to real Supabase Storage.

const PROFILE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const F1 = "0f8fad5b-d9cb-469f-a165-70867728950e.jpg";
const F2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7.jpg";
const BASE = "https://abc.supabase.co/storage/v1/object/public/publish-media";
const url = (profile: string, file: string) => `${BASE}/${profile}/${file}`;

type Args = { where: Record<string, unknown>; data?: Record<string, unknown> };

const db = vi.hoisted(() => ({
  platformVariant: {
    findMany: vi.fn(),
    updateMany: vi.fn<(args: Args) => Promise<{ count: number }>>(async () => ({
      count: 1,
    })),
  },
}));
const clients = vi.hoisted(() => ({
  admin: null as unknown,
  session: null as unknown,
}));

vi.mock("@/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/supabase/admin", () => ({
  publishMediaAdminBucket: () => clients.admin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (!clients.session) throw new Error("no request context");
    return { storage: { from: () => clients.session } };
  },
}));

import {
  cleanupAfterPublish,
  cleanupPublishedMedia,
  deleteMediaForProfiles,
  removeMediaPaths,
  runBackgroundMediaCleanup,
  sweepOrphanedMedia,
  type MediaBucket,
} from "@/features/platforms/media-cleanup";
import {
  findOrphanedPaths,
  ORPHAN_GRACE_MS,
} from "@/features/platforms/media-path";
import { groupMediaByProfile } from "@/features/cleanup/cleanup";

/// In-memory bucket: `objects` maps full paths to creation time.
function memoryBucket(
  objects: Record<string, string>,
  opts: { failRemove?: boolean; silentlyKeep?: string[] } = {},
) {
  const removeCalls: string[][] = [];
  const bucket: MediaBucket = {
    async remove(paths) {
      removeCalls.push(paths);
      if (opts.failRemove) return { data: null, error: { message: "boom" } };
      const deleted = paths.filter(
        (p) => p in objects && !opts.silentlyKeep?.includes(p),
      );
      for (const p of deleted) delete objects[p];
      return { data: deleted.map((name) => ({ name })), error: null };
    },
    async list(prefix, options) {
      const names = Object.keys(objects)
        .filter((p) => (prefix ? p.startsWith(`${prefix}/`) : true))
        .map((p) => (prefix ? p.slice(prefix.length + 1) : p.split("/")[0]!))
        .filter((n) => !options?.search || n.includes(options.search));
      return {
        data: [...new Set(names)].map((name) => ({
          name,
          created_at: prefix ? objects[`${prefix}/${name}`] : null,
        })),
        error: null,
      };
    },
  };
  return { bucket, removeCalls, objects };
}

const OLD = new Date(Date.now() - ORPHAN_GRACE_MS - 60_000).toISOString();
const NEW = new Date().toISOString();

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  clients.admin = null;
  clients.session = null;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("removeMediaPaths", () => {
  it("only ever sends the profile's own <uuid>.jpg objects to Storage", async () => {
    const { bucket, removeCalls } = memoryBucket({
      [`${PROFILE}/${F1}`]: OLD,
      [`${OTHER}/${F2}`]: OLD,
    });
    const r = await removeMediaPaths(bucket, PROFILE, [
      `${PROFILE}/${F1}`,
      `${OTHER}/${F2}`,
      `${PROFILE}/../${OTHER}/${F2}`,
      `${PROFILE}/resume.pdf`,
    ]);
    expect(removeCalls).toEqual([[`${PROFILE}/${F1}`]]);
    expect(r.removed).toEqual([`${PROFILE}/${F1}`]);
  });

  it("reports a Storage error as failed (nothing confirmed)", async () => {
    const { bucket } = memoryBucket(
      { [`${PROFILE}/${F1}`]: OLD },
      { failRemove: true },
    );
    const r = await removeMediaPaths(bucket, PROFILE, [`${PROFILE}/${F1}`]);
    expect(r).toMatchObject({ removed: [], failed: [`${PROFILE}/${F1}`] });
  });

  it("treats an object still listed after delete as failed (e.g. blocked by policy)", async () => {
    const { bucket } = memoryBucket(
      { [`${PROFILE}/${F1}`]: OLD },
      { silentlyKeep: [`${PROFILE}/${F1}`] },
    );
    const r = await removeMediaPaths(bucket, PROFILE, [`${PROFILE}/${F1}`]);
    expect(r.failed).toEqual([`${PROFILE}/${F1}`]);
  });

  it("treats an already-deleted object as removed", async () => {
    const { bucket } = memoryBucket({});
    const r = await removeMediaPaths(bucket, PROFILE, [`${PROFILE}/${F1}`]);
    expect(r.removed).toEqual([`${PROFILE}/${F1}`]);
  });
});

describe("cleanupPublishedMedia", () => {
  it("deletes the image and clears the reference only for PUBLISHED variants it removed", async () => {
    const { bucket, objects } = memoryBucket({ [`${PROFILE}/${F1}`]: OLD });
    db.platformVariant.findMany.mockResolvedValue([
      { id: "v1", mediaUrl: url(PROFILE, F1) },
    ]);
    await cleanupPublishedMedia(bucket, PROFILE, ["v1"]);

    expect(db.platformVariant.findMany.mock.calls[0]![0].where).toMatchObject({
      profileId: PROFILE,
      publishStatus: "PUBLISHED",
      id: { in: ["v1"] },
    });
    expect(objects).toEqual({});
    expect(db.platformVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["v1"] },
        profileId: PROFILE,
        publishStatus: "PUBLISHED",
      },
      data: { mediaUrl: null },
    });
  });

  it("keeps the reference (for a later retry) and logs when deletion fails", async () => {
    const { bucket } = memoryBucket(
      { [`${PROFILE}/${F1}`]: OLD },
      { failRemove: true },
    );
    db.platformVariant.findMany.mockResolvedValue([
      { id: "v1", mediaUrl: url(PROFILE, F1) },
    ]);
    await cleanupPublishedMedia(bucket, PROFILE);
    expect(db.platformVariant.updateMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    // The log carries no URL and no secret.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("supabase.co");
  });

  it("never touches another profile's object even if the reference points there", async () => {
    const { bucket, removeCalls, objects } = memoryBucket({
      [`${OTHER}/${F2}`]: OLD,
    });
    db.platformVariant.findMany.mockResolvedValue([
      { id: "v1", mediaUrl: url(OTHER, F2) },
    ]);
    await cleanupPublishedMedia(bucket, PROFILE);
    expect(removeCalls).toEqual([]);
    expect(objects).toHaveProperty(`${OTHER}/${F2}`);
  });
});

describe("orphan sweep", () => {
  it("removes unreferenced objects past the grace period, keeping referenced and recent ones", async () => {
    const recent = "4d1a3f8e-0000-4000-8000-000000000001.jpg";
    const { bucket, objects } = memoryBucket({
      [`${PROFILE}/${F1}`]: OLD, // referenced
      [`${PROFILE}/${F2}`]: OLD, // orphan
      [`${PROFILE}/${recent}`]: NEW, // too new (approval may be in flight)
      [`${OTHER}/${F2}`]: OLD, // another profile
    });
    db.platformVariant.findMany.mockResolvedValue([
      { mediaUrl: url(PROFILE, F1) },
    ]);
    await sweepOrphanedMedia(bucket, PROFILE);
    expect(Object.keys(objects).sort()).toEqual(
      [`${PROFILE}/${F1}`, `${PROFILE}/${recent}`, `${OTHER}/${F2}`].sort(),
    );
    expect(db.platformVariant.findMany.mock.calls[0]![0].where).toMatchObject({
      profileId: PROFILE,
    });
  });

  it("findOrphanedPaths ignores folders and odd names", () => {
    expect(
      findOrphanedPaths({
        profileId: PROFILE,
        objects: [
          { name: "sub", createdAt: null },
          { name: "notes.txt", createdAt: OLD },
          { name: F1, createdAt: OLD },
        ],
        referencedUrls: [],
        now: new Date(),
      }),
    ).toEqual([`${PROFILE}/${F1}`]);
  });
});

describe("cleanup after a confirmed publish", () => {
  it("uses the service-role bucket when configured (works from the scheduler)", async () => {
    const admin = memoryBucket({ [`${PROFILE}/${F1}`]: OLD });
    clients.admin = admin.bucket;
    db.platformVariant.findMany.mockResolvedValue([
      { id: "v1", mediaUrl: url(PROFILE, F1) },
    ]);
    await cleanupAfterPublish("v1", PROFILE);
    expect(admin.objects).toEqual({});
    expect(db.platformVariant.updateMany).toHaveBeenCalled();
  });

  it("never throws, even when there is no storage client or the database fails", async () => {
    await expect(cleanupAfterPublish("v1", PROFILE)).resolves.toBeUndefined();
    clients.admin = memoryBucket({}).bucket;
    db.platformVariant.findMany.mockRejectedValue(new Error("db down"));
    await expect(cleanupAfterPublish("v1", PROFILE)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe("background cleanup (scheduler)", () => {
  it("is a no-op without the service-role key", async () => {
    await runBackgroundMediaCleanup();
    expect(db.platformVariant.findMany).not.toHaveBeenCalled();
  });

  it("retries published leftovers and sweeps orphans per profile folder", async () => {
    const admin = memoryBucket({
      [`${PROFILE}/${F1}`]: OLD, // published leftover
      [`${OTHER}/${F2}`]: OLD, // orphan of a deleted campaign
    });
    clients.admin = admin.bucket;
    db.platformVariant.findMany.mockImplementation(
      async (args: { where: Record<string, unknown>; distinct?: unknown }) => {
        if (args.distinct) return [{ profileId: PROFILE }];
        if (args.where.publishStatus === "PUBLISHED") {
          return args.where.profileId === PROFILE
            ? [{ id: "v1", mediaUrl: url(PROFILE, F1) }]
            : [];
        }
        return []; // nothing referenced any more
      },
    );
    await runBackgroundMediaCleanup();
    expect(admin.objects).toEqual({});
  });
});

describe("campaign deletion", () => {
  it("groups still-referenced images by profile before the cascade delete", () => {
    expect(
      groupMediaByProfile([
        { profileId: PROFILE, mediaUrl: url(PROFILE, F1) },
        { profileId: OTHER, mediaUrl: url(OTHER, F2) },
        { profileId: PROFILE, mediaUrl: null },
      ]),
    ).toEqual(
      new Map([
        [PROFILE, [url(PROFILE, F1)]],
        [OTHER, [url(OTHER, F2)]],
      ]),
    );
  });

  it("deletes each profile's images from that profile's folder only", async () => {
    const admin = memoryBucket({
      [`${PROFILE}/${F1}`]: OLD,
      [`${OTHER}/${F2}`]: OLD,
    });
    clients.admin = admin.bucket;
    await deleteMediaForProfiles(
      new Map([[PROFILE, [url(PROFILE, F1), url(OTHER, F2)]]]),
    );
    expect(Object.keys(admin.objects)).toEqual([`${OTHER}/${F2}`]);
  });

  it("does nothing (orphan sweep handles it later) without the service-role key", async () => {
    await expect(
      deleteMediaForProfiles(new Map([[PROFILE, [url(PROFILE, F1)]]])),
    ).resolves.toBeUndefined();
  });
});
