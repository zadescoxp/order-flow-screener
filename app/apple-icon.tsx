import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og";

// iOS home-screen / Safari pinned icon (opaque, 180×180).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#08090b" }}>
        <img src={LOGO_DATA_URI} width={132} height={132} alt="" />
      </div>
    ),
    size
  );
}
