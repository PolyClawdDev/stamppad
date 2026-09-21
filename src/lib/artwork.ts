/**
 * Stamp artwork travels as a base64 data URL, so the request body and the
 * stored launch row run about a third larger than the file the creator picked.
 * The limit is stated in file bytes and checked against the decoded length, so
 * the browser and the API agree on what the maximum means.
 */
export const ARTWORK_MAX_BYTES = 2 * 1024 * 1024;
export const ARTWORK_MAX_LABEL = "2 MB";

/** Mirrors the accept list on the file input. */
const ARTWORK_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** The reason the artwork cannot be accepted, or null when it can. */
export function artworkProblem(dataUrl: string | null | undefined): string | null {
  if (!dataUrl) return null;
  if (!ARTWORK_DATA_URL.test(dataUrl)) {
    return "Artwork must be a base64 PNG, JPEG, or WebP data URL.";
  }
  if (dataUrlByteLength(dataUrl) > ARTWORK_MAX_BYTES) {
    return `Artwork must be ${ARTWORK_MAX_LABEL} or smaller.`;
  }
  return null;
}
