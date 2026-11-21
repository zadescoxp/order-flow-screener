import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og";

// iOS home-screen / Safari pinned icon (opaque, 180×180). iOS rounds the
// corners itself, so this is a full-bleed graphite tile with the white mark.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0b",
          backgroundImage: "radial-gradient(160px 120px at 30% 0%, rgba(255,255,255,0.14), transparent 70%), linear-gradient(180deg, #1c1c1f, #0a0a0b)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img> */}
        <img src={LOGO_DATA_URI} width={116} height={116} alt="" />
      </div>
    ),
    size
  );
}
