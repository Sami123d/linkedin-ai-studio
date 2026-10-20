const MIN_ASPECT = 4 / 5;
const MAX_ASPECT = 1.91;

/// Centered crop that brings an image inside Instagram's aspect-ratio
/// range; null when it already fits. (A 1200×627 branded image is 1.914:1,
/// just outside the limit, so it loses a few pixels at the sides.)
export function aspectCrop(
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } | null {
  const ratio = width / height;
  if (ratio > MAX_ASPECT) {
    const w = Math.floor(height * MAX_ASPECT);
    return { left: Math.floor((width - w) / 2), top: 0, width: w, height };
  }
  if (ratio < MIN_ASPECT) {
    const h = Math.floor(width / MIN_ASPECT);
    return { left: 0, top: Math.floor((height - h) / 2), width, height: h };
  }
  return null;
}
