import "server-only";

import { ImageResponse } from "next/og";

/// HalfClicks brand (halfclicks.com). Text is drawn here instead of asked
/// from the image model, which garbles letters, so the name and slogan are
/// always spelled correctly.
export const BRAND = {
  name: "halfclicks",
  tagline: "Build smarter. Click less.",
  black: "#0D0D0D",
  lime: "#D4FF3A",
  paper: "#F4F4EF",
};

export const BRANDED_WIDTH = 1200;
export const BRANDED_HEIGHT = 627;

/// Space Grotesk is the site's display font. It is fetched once and cached;
/// if the CDN is unreachable the overlay falls back to the bundled font
/// rather than failing the image.
const FONT_URL = (weight: number) =>
  `https://cdn.jsdelivr.net/fontsource/fonts/space-grotesk@latest/latin-${weight}-normal.woff`;

const fontCache = new Map<number, Promise<ArrayBuffer | null>>();

function loadFont(weight: number): Promise<ArrayBuffer | null> {
  let cached = fontCache.get(weight);
  if (!cached) {
    cached = fetch(FONT_URL(weight), { signal: AbortSignal.timeout(10_000) })
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .catch(() => null)
      .then((font) => {
        // Don't remember a failure, so the next image can try again.
        if (!font) fontCache.delete(weight);
        return font;
      });
    fontCache.set(weight, cached);
  }
  return cached;
}

/// The cursor-and-click mark from the HalfClicks site header.
function LogoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="200 140 400 510">
      <g stroke={BRAND.lime} strokeWidth="24" strokeLinecap="round">
        <line x1="222" y1="268" x2="268" y2="268" />
        <line x1="248" y1="190" x2="284" y2="224" />
        <line x1="328" y1="164" x2="328" y2="208" />
      </g>
      <path d="M332 282 L332 568 L414 494 L414 360 Z" fill={BRAND.lime} />
      <path
        d="M330 262 L578 490 L466 490 L520 606 L470 628 L414 508 L330 586 Z"
        fill="none"
        stroke={BRAND.paper}
        strokeWidth="24"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/// Overlays the HalfClicks logo, name and slogan along the bottom edge of an
/// image and returns a 1200x627 PNG (LinkedIn's feed size).
export async function brandImage(image: {
  mimeType: string;
  data: string;
}): Promise<Uint8Array> {
  const [bold, medium] = await Promise.all([loadFont(700), loadFont(500)]);
  const fonts = [
    bold && {
      name: "Space Grotesk",
      data: bold,
      weight: 700 as const,
      style: "normal" as const,
    },
    medium && {
      name: "Space Grotesk",
      data: medium,
      weight: 500 as const,
      style: "normal" as const,
    },
  ].filter((font): font is NonNullable<typeof font> => !!font);

  const response = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: BRAND.black,
        fontFamily: "Space Grotesk",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered by satori, not the browser */}
      <img
        src={`data:${image.mimeType};base64,${image.data}`}
        width={BRANDED_WIDTH}
        height={BRANDED_HEIGHT}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          objectFit: "cover",
        }}
        alt=""
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 170,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          padding: "0 48px 34px",
          backgroundImage: `linear-gradient(to top, ${BRAND.black}f2 0%, ${BRAND.black}b3 55%, ${BRAND.black}00 100%)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LogoMark size={52} />
          <div
            style={{
              display: "flex",
              fontSize: 44,
              fontWeight: 700,
              color: BRAND.paper,
              letterSpacing: -1,
            }}
          >
            {BRAND.name}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 500,
            color: BRAND.lime,
          }}
        >
          {BRAND.tagline}
        </div>
      </div>
    </div>,
    { width: BRANDED_WIDTH, height: BRANDED_HEIGHT, fonts },
  );

  return new Uint8Array(await response.arrayBuffer());
}
