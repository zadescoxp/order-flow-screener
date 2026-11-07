"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { scheduleCanvasRedraw } from "@/lib/session/canvasScheduler";
import type { ThemeTokens } from "@/lib/theme";

// ─── Palette ─────────────────────────────────────────────────────
export interface Palette {
  bgBase: string;
  bgSurface: string;
  bgPanel: string;
  bgPanelAlt: string;
  bgActive: string;
  border: string;
  borderMuted: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  buy: string;
  sell: string;
  neutral: string;
  accent: string;
  poc: string;
  vwap: string;
  warn: string;
  grid: string;
  onAccent: string;
  light: boolean;
}

let cachedTheme: string | null = null;
let cachedPalette: Palette | null = null;

export function readPalette(): Palette {
  const root = document.documentElement;
  const theme = root.getAttribute("data-theme") ?? "dark";
  if (cachedPalette && cachedTheme === theme) return cachedPalette;
  const cs = getComputedStyle(root);
  const v = (name: keyof ThemeTokens, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  cachedPalette = {
    bgBase: v("--bg-base", "#07090d"),
    bgSurface: v("--bg-surface", "#0c0f15"),
    bgPanel: v("--bg-panel", "#0e121a"),
    bgPanelAlt: v("--bg-panel-alt", "#121722"),
    bgActive: v("--bg-active", "#1c2433"),
    border: v("--border", "#1e2633"),
    borderMuted: v("--border-muted", "#151b26"),
    text: v("--text-primary", "#e6eaf2"),
    textSecondary: v("--text-secondary", "#9aa4b8"),
    textMuted: v("--text-muted", "#5d677c"),
    buy: v("--buy", "#1fc796"),
    sell: v("--sell", "#f2545b"),
    neutral: v("--neutral", "#6b7488"),
    accent: v("--highlight", "#4f8cff"),
    poc: v("--poc", "#f4c544"),
    vwap: v("--vwap", "#c58cff"),
    warn: v("--warn", "#f59f3a"),
    grid: v("--grid", "rgba(255,255,255,0.045)"),
    onAccent: v("--on-accent", "#0a0b0d"),
    light: theme === "light" || theme === "light-dull",
  };
  cachedTheme = theme;
  return cachedPalette;
}

/** Apply alpha to a #rrggbb color (other formats pass through unchanged). */
export function withAlpha(color: string, alpha: number): string {
  if (!color.startsWith("#") || color.length < 7) return color;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

export const MONO_FONT = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const UI_FONT = 'Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export function monoFont(size: number, weight = 400): string {
  return `${weight} ${size}px ${MONO_FONT}`;
}

// ─── useCanvas ───────────────────────────────────────────────────
// A device-pixel-ratio aware canvas that resizes with its container.
// `draw` receives CSS-pixel dimensions; redraws are coalesced per frame.

export type DrawFn = (ctx: CanvasRenderingContext2D, width: number, height: number, palette: Palette) => void;

export function useCanvas(draw: DrawFn) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const drawRef = useRef(draw);

  useLayoutEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const { width, height } = sizeRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawRef.current(ctx, width, height, readPalette());
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resize = () => {
      const width = Math.floor(container.clientWidth);
      const height = Math.floor(container.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width, height };
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      scheduleCanvasRedraw(paint);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, [paint]);

  useEffect(() => {
    scheduleCanvasRedraw(paint);
  }, [draw, paint]);

  const redraw = useCallback(() => scheduleCanvasRedraw(paint), [paint]);

  return { containerRef, canvasRef, sizeRef, redraw };
}
