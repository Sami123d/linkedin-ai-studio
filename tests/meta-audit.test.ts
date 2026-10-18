import { describe, expect, it } from "vitest";

import {
  countHashtags,
  countMentions,
  validateVariantLimits,
} from "@/features/platforms/limits";
import { publishMediaPath } from "@/features/platforms/media-path";
import { META_SCOPES, REQUIRED_SCOPES } from "@/lib/meta/oauth";
import { skipReason } from "../scripts/meta-publisher";

const PROFILE = "11111111-1111-1111-1111-111111111111";
const FILE = "0f8fad5b-d9cb-469f-a165-70867728950e.jpg";

describe("requested permissions", () => {
  it("are the minimum documented set, without the undocumented pages_read_user_engagement", () => {
    expect([...META_SCOPES].sort()).toEqual(
      [
        "instagram_basic",
        "instagram_content_publish",
        "pages_manage_posts",
        "pages_read_engagement",
        "pages_show_list",
      ].sort(),
    );
    expect(REQUIRED_SCOPES).not.toContain("pages_read_user_engagement");
    expect(REQUIRED_SCOPES).not.toContain("business_management");
  });
});

describe("Instagram caption limits as the platform counts them", () => {
  it("counts hashtags written inline in the body, not just the list", () => {
    const body = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ");
    expect(countHashtags(body)).toBe(31);
    expect(validateVariantLimits("INSTAGRAM", body, []).join(" ")).toMatch(
      /31 hashtags/,
    );
  });

  it("adds inline and list hashtags together", () => {
    const body = Array.from({ length: 20 }, (_, i) => `#a${i}`).join(" ");
    const list = Array.from({ length: 11 }, (_, i) => `b${i}`);
    expect(validateVariantLimits("INSTAGRAM", body, list).join(" ")).toMatch(
      /31 hashtags/,
    );
  });

  it("does not count anchors or URL fragments as hashtags", () => {
    expect(
      countHashtags("see https://example.com/page#section and a&#38;b"),
    ).toBe(0);
    expect(countHashtags("#one #two\n#three")).toBe(3);
  });

  it("limits @ mentions to 20 on Instagram and ignores email addresses", () => {
    const mentions = Array.from({ length: 21 }, (_, i) => `@user${i}`).join(
      " ",
    );
    expect(countMentions(mentions)).toBe(21);
    expect(validateVariantLimits("INSTAGRAM", mentions, []).join(" ")).toMatch(
      /21 @ mentions/,
    );
    expect(countMentions("write to me@example.com")).toBe(0);
    expect(validateVariantLimits("FACEBOOK", mentions, [])).toEqual([]);
  });
});

describe("public media object paths", () => {
  const base = "https://abc.supabase.co/storage/v1/object/public/publish-media";

  it("resolves our own objects under the profile folder", () => {
    expect(publishMediaPath(PROFILE, `${base}/${PROFILE}/${FILE}`)).toBe(
      `${PROFILE}/${FILE}`,
    );
  });

  it("refuses another profile's folder, other buckets and odd paths", () => {
    const other = "22222222-2222-2222-2222-222222222222";
    expect(publishMediaPath(PROFILE, `${base}/${other}/${FILE}`)).toBeNull();
    expect(
      publishMediaPath(
        PROFILE,
        `https://abc.supabase.co/storage/v1/object/public/resumes/${PROFILE}/${FILE}`,
      ),
    ).toBeNull();
    expect(
      publishMediaPath(PROFILE, `${base}/${PROFILE}/../${other}/${FILE}`),
    ).toBeNull();
    expect(
      publishMediaPath(PROFILE, `${base}/${PROFILE}/sub/${FILE}`),
    ).toBeNull();
    expect(
      publishMediaPath(PROFILE, `${base}/${PROFILE}/resume.pdf`),
    ).toBeNull();
    expect(publishMediaPath(PROFILE, "https://example.com/a.jpg")).toBeNull();
    expect(publishMediaPath(PROFILE, null)).toBeNull();
    expect(publishMediaPath(PROFILE, "garbage")).toBeNull();
  });
});

describe("scheduled job when Meta publishing is not set up", () => {
  it("skips (does not fail) without a secret or when the app says not configured", () => {
    expect(skipReason({ secret: undefined })).toMatch(/not enabled/);
    expect(skipReason({ secret: "" })).toMatch(/not enabled/);
    expect(skipReason({ secret: "s", status: 503 })).toMatch(/not configured/);
  });

  it("does not skip a configured run, including auth failures that should alert", () => {
    expect(skipReason({ secret: "s", status: 200 })).toBeNull();
    expect(skipReason({ secret: "s", status: 401 })).toBeNull();
    expect(skipReason({ secret: "s", status: 500 })).toBeNull();
  });
});
