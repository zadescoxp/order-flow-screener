// Shared social share card (Open Graph, X/Twitter, LinkedIn, Discord, Slack,
// WhatsApp, iMessage, Telegram…). Rendered to a static PNG at build time.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE } from "@/lib/site";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = `${SITE.name} — real-time footprint, order book, CVD, volume z-score and realized volatility for crypto and FX`;

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

const C = {
  bg: "#08090b",
  card: "#111215",
  border: "#202127",
  text: "#f2f3f5",
  muted: "#8b8e98",
  dim: "#4a4d56",
  accent: "#d7f75b",
  buy: "#2fd897",
  sell: "#ff5c74",
  vwap: "#a68bff",
  poc: "#ffc857",
};

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="${C.accent}"/><path d="M16 4.5a11.5 11.5 0 0 0 0 23z" fill="#0a0b0d"/><g fill="#0a0b0d"><rect x="18.5" y="9" width="6" height="3.6" rx="1.8"/><rect x="18.5" y="14.2" width="8" height="3.6" rx="1.8"/><rect x="18.5" y="19.4" width="4" height="3.6" rx="1.8"/></g></svg>`;
export const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;

// A stylised footprint: [sell, buy] volume per price row, for three candles.
const CANDLES: [number, number][][] = [
  [[2, 3], [5, 4], [8, 6], [6, 9], [3, 5], [1, 2]],
  [[1, 2], [4, 6], [7, 12], [5, 8], [6, 4], [3, 2], [1, 1]],
  [[2, 1], [3, 5], [9, 4], [12, 6], [7, 3], [4, 2]],
];
const PROFILE = [3, 6, 10, 15, 22, 18, 12, 8, 5, 3];

// Fonts don't depend on the request: load once at module scope so the
// image is prerendered at build time.
const FONTS = Promise.all([font("Geist-Bold.ttf"), font("Geist-Medium.ttf"), font("GeistMono-SemiBold.ttf")]);

export async function renderShareImage() {
  const [bold, medium, mono] = await FONTS;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: C.bg,
          backgroundImage: `radial-gradient(900px 500px at 0% 0%, rgba(215,247,91,0.16), transparent 60%), radial-gradient(700px 500px at 100% 100%, rgba(166,139,255,0.12), transparent 60%)`,
          fontFamily: "Geist",
          color: C.text,
          padding: 64,
        }}
      >
        {/* Left: brand + message */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 610 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img> */}
            <img src={LOGO_DATA_URI} width={56} height={56} alt="" />
            <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>
              <span style={{ letterSpacing: -2 }}>orderflow</span>
              <span style={{ color: C.accent, marginLeft: -7 }}>.</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 66, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3.2 }}>
              <span>See who&apos;s really</span>
              <span>
                moving the <span style={{ color: C.accent, marginLeft: 16 }}>market.</span>
              </span>
            </div>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 500, color: C.muted, lineHeight: 1.4 }}>
              Real-time footprint charts, order book, CVD, volume z-score and realized volatility for crypto and FX.
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            {["29 markets", "6 venues aggregated", "Open source"].map((label) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 44,
                  padding: "0 20px",
                  borderRadius: 999,
                  border: `1px solid ${C.border}`,
                  background: C.card,
                  fontSize: 20,
                  fontWeight: 500,
                  color: C.text,
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Right: product card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginLeft: "auto",
            width: 430,
            height: "100%",
            padding: 26,
            borderRadius: 28,
            border: `1px solid ${C.border}`,
            background: C.card,
            boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 18, color: C.muted, fontWeight: 500 }}>BTC/USDT · All perps</span>
              <span style={{ fontFamily: "Geist Mono", fontSize: 44, letterSpacing: -2, marginTop: 4 }}>75,756.1</span>
            </div>
            <div
              style={{
                display: "flex",
                height: 34,
                alignItems: "center",
                padding: "0 14px",
                borderRadius: 999,
                background: "rgba(47,216,151,0.14)",
                color: C.buy,
                fontFamily: "Geist Mono",
                fontSize: 18,
              }}
            >
              ▲ 1.24%
            </div>
          </div>

          {/* Footprint + profile */}
          <div style={{ display: "flex", flex: 1, gap: 12, marginTop: 22, alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 4, width: 70 }}>
              {PROFILE.map((v, i) => (
                <div key={i} style={{ display: "flex", height: 18 }}>
                  <div style={{ width: v * 1.4, height: 18, borderRadius: 4, background: i === 4 ? C.poc : "rgba(255,92,116,0.75)" }} />
                  <div style={{ width: v * 1.4, height: 18, borderRadius: 4, marginLeft: 2, background: i === 4 ? C.poc : "rgba(47,216,151,0.75)" }} />
                </div>
              ))}
            </div>
            {CANDLES.map((rows, ci) => (
              <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, marginBottom: ci * 22 }}>
                {rows.map(([sell, buy], ri) => {
                  const max = 12;
                  return (
                    <div key={ri} style={{ display: "flex", gap: 3, height: 22 }}>
                      <div style={{ flex: 1, borderRadius: 5, background: `rgba(255,92,116,${0.12 + (sell / max) * 0.7})` }} />
                      <div style={{ flex: 1, borderRadius: 5, background: `rgba(47,216,151,${0.12 + (buy / max) * 0.7})` }} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
            {[
              ["VWAP", "75,729.3", C.vwap],
              ["Delta", "+1.1K", C.buy],
              ["Vol z", "+2.4σ", C.accent],
            ].map(([label, value, color]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 16, color: C.dim, fontWeight: 500 }}>{label}</span>
                <span style={{ fontFamily: "Geist Mono", fontSize: 24, color }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Geist", data: bold, weight: 700, style: "normal" },
        { name: "Geist", data: medium, weight: 500, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 600, style: "normal" },
      ],
    }
  );
}
