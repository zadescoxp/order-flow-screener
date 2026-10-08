"use client";

import React, { useEffect, useState, useRef } from "react";

export interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  lines: string[]; // Pre-split lines for proper rendering
}

let tooltipListener: ((state: TooltipState) => void) | null = null;

export function showTooltip(
  title: string,
  content: string,
  e: React.MouseEvent | MouseEvent
) {
  if (tooltipListener) {
    tooltipListener({
      visible: true,
      x: (e as MouseEvent).clientX,
      y: (e as MouseEvent).clientY,
      title,
      lines: content.split("\n"),
    });
  }
}

export function hideTooltip() {
  if (tooltipListener) {
    tooltipListener({ visible: false, x: 0, y: 0, title: "", lines: [] });
  }
}

export default function GlobalTooltip() {
  const [state, setState] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    title: "",
    lines: [],
  });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    tooltipListener = setState;
    return () => {
      if (tooltipListener === setState) tooltipListener = null;
    };
  }, []);

  if (!state.visible) return null;

  // Keep tooltip within viewport
  const TW = 260;
  const margin = 12;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = state.x + 16;
  let top = state.y + 16;
  if (left + TW > vw - margin) left = state.x - TW - 8;
  if (top > vh * 0.6) top = state.y - 8 - (tooltipRef.current?.offsetHeight ?? 120);

  // Split lines into data rows vs explanation paragraph
  const dataLines = state.lines.filter((l) => l.trim() !== "" && !l.startsWith("What this means"));
  const explanation = state.lines.find((l) => l.startsWith("What this means"));

  return (
    <div
      ref={tooltipRef}
      style={{
        position: "fixed",
        left,
        top,
        width: TW,
        background: "linear-gradient(145deg, #14141e, #0f0f18)",
        border: "1px solid rgba(124,106,245,0.35)",
        borderRadius: 8,
        boxShadow: "0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
        zIndex: 9999,
        pointerEvents: "none",
        overflow: "hidden",
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "6px 10px",
          background: "rgba(124,106,245,0.15)",
          borderBottom: "1px solid rgba(124,106,245,0.2)",
          fontSize: 10.5,
          fontWeight: 700,
          color: "#c4b9ff",
          letterSpacing: "0.03em",
        }}
      >
        {state.title}
      </div>

      {/* Data rows */}
      <div style={{ padding: "6px 10px 4px" }}>
        {dataLines.map((line, i) => {
          const colonIdx = line.indexOf(":");
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim();
            const val = line.slice(colonIdx + 1).trim();
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 10,
                  lineHeight: "1.8",
                }}
              >
                <span style={{ color: "#6a6a88" }}>{key}</span>
                <span style={{ color: "#e0e0f0", fontWeight: 600 }}>{val}</span>
              </div>
            );
          }
          return (
            <div key={i} style={{ fontSize: 10, color: "#8a8aaa", lineHeight: "1.6" }}>
              {line}
            </div>
          );
        })}
      </div>

      {/* Explanation */}
      {explanation && (
        <div
          style={{
            padding: "5px 10px 8px",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            fontSize: 9.5,
            color: "#5a5a7a",
            lineHeight: "1.5",
            fontStyle: "italic",
          }}
        >
          {explanation}
        </div>
      )}
    </div>
  );
}
