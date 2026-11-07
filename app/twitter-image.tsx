import { OG_ALT, OG_SIZE, renderShareImage } from "@/lib/og";

// X/Twitter "summary_large_image" uses the same 1200×630 card.
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function TwitterImage() {
  return renderShareImage();
}
