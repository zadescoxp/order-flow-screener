"use client";

import React, { useEffect, useRef, useState } from "react";

export interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  lines: string[];
}

let tooltipListener: ((state: TooltipState) => void) | null = null;

export function showTooltip(title: string, content: string, e: React.MouseEvent | MouseEvent) {
  tooltipListener?.({
    visible: true,
    x: (e as MouseEvent).clientX,
    y: (e as MouseEvent).clientY,
    title,
    lines: content.split("\n"),
  });
}

export function hideTooltip() {
  tooltipListener?.({ visible: false, x: 0, y: 0, title: "", lines: [] });
}

const WIDTH = 272;

export default function GlobalTooltip() {
  const [state, setState] = useState<TooltipState>({ visible: false, x: 0, y: 0, title: "", lines: [] });
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(140);

  useEffect(() => {
    tooltipListener = setState;
    return () => {
      if (tooltipListener === setState) tooltipListener = null;
    };
  }, []);

  useEffect(() => {
    if (state.visible && ref.current) setHeight(ref.current.offsetHeight);
  }, [state]);

  if (!state.visible) return null;

  const margin = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = state.x + 16;
  let top = state.y + 16;
  if (left + WIDTH > vw - margin) left = state.x - WIDTH - 12;
  if (top + height > vh - margin) top = Math.max(margin, state.y - height - 12);

  const explanationIndex = state.lines.findIndex((line) => line.startsWith("What this means"));
  const dataLines = (explanationIndex >= 0 ? state.lines.slice(0, explanationIndex) : state.lines);
  const explanation = explanationIndex >= 0 ? state.lines[explanationIndex].replace(/^What this means:\s*/, "") : null;

  return (
    <div ref={ref} className="tooltip" style={{ left, top, width: WIDTH }} role="tooltip">
      <div className="tooltip-title">{state.title}</div>
      <div className="tooltip-rows">
        {dataLines.map((line, i) => {
          if (!line.trim()) return <div key={i} className="tooltip-gap" />;
          const colon = line.indexOf(":");
          if (colon > 0) {
            return (
              <div key={i} className="tooltip-row">
                <span>{line.slice(0, colon)}</span>
                <strong>{line.slice(colon + 1).trim()}</strong>
              </div>
            );
          }
          return <div key={i} className="tooltip-note">{line}</div>;
        })}
      </div>
      {explanation && <div className="tooltip-explain">{explanation}</div>}
    </div>
  );
}
