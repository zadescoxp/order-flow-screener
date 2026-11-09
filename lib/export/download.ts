"use client";

// Browser-side file delivery and canvas snapshots for the export menu.

import { readPalette, UI_FONT } from "@/hooks/useCanvas";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, type = "text/csv;charset=utf-8"): void {
  downloadBlob(new Blob([text], { type }), filename);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))), "image/png"));
}

/** PNG of a single chart canvas at device resolution. */
export async function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return toBlob(canvas);
}

/**
 * Composite of every chart canvas in `root`, placed where it sits on screen,
 * with each panel's title and a caption line. DOM-only panels (order book,
 * tape) appear as labelled outlines.
 */
export async function workspacePng(root: HTMLElement, caption: string): Promise<Blob> {
  const dpr = window.devicePixelRatio || 1;
  const box = root.getBoundingClientRect();
  const captionH = 28;
  const out = document.createElement("canvas");
  out.width = Math.round(box.width * dpr);
  out.height = Math.round((box.height + captionH) * dpr);
  const ctx = out.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const p = readPalette();
  ctx.fillStyle = p.bgBase;
  ctx.fillRect(0, 0, box.width, box.height + captionH);
  ctx.fillStyle = p.text;
  ctx.font = `600 13px ${UI_FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText(caption, 12, captionH / 2);

  for (const panel of root.querySelectorAll<HTMLElement>(".panel")) {
    const r = panel.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const x = r.left - box.left;
    const y = r.top - box.top + captionH;
    ctx.fillStyle = p.bgPanel;
    ctx.strokeStyle = p.borderMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, r.width - 1, r.height - 1, 12);
    ctx.fill();
    ctx.stroke();
    const name = panel.getAttribute("aria-label") ?? "";
    const value = panel.querySelector(".panel-value")?.textContent;
    const title = value ? `${name}   ${value}` : name;
    ctx.fillStyle = p.textSecondary;
    ctx.font = `600 12px ${UI_FONT}`;
    ctx.fillText(title, x + 12, y + 16);
    for (const canvas of panel.querySelectorAll("canvas")) {
      const c = canvas.getBoundingClientRect();
      if (c.width < 2 || c.height < 2) continue;
      ctx.drawImage(canvas, c.left - box.left, c.top - box.top + captionH, c.width, c.height);
    }
  }
  return toBlob(out);
}
