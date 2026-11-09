"use client";

import { useEffect, useRef, useState } from "react";

/** How long the pointer must rest on a control before its name appears. */
export const HINT_DELAY_MS = 2000;

interface Hint {
  text: string;
  x: number;
  y: number;
  above: boolean;
}

// ─── Hover hints ─────────────────────────────────────────────────
// Any element with `data-hint="Name"` shows a small label after the pointer
// rests on it for HINT_DELAY_MS. One listener for the whole app; pressing,
// scrolling or leaving the element hides it until the next hover.
export default function HoverHint() {
  const [hint, setHint] = useState<Hint | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setHint(null);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const el = (event.target as Element | null)?.closest<HTMLElement>("[data-hint]") ?? null;
      if (el === target.current) return;
      clear();
      target.current = el;
      if (!el) return;
      timer.current = setTimeout(() => {
        const text = el.dataset.hint;
        if (!text || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const above = r.bottom + 40 > window.innerHeight;
        setHint({ text, x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above });
      }, HINT_DELAY_MS);
    };
    const out = (event: PointerEvent) => {
      const next = event.relatedTarget as Node | null;
      if (target.current && next && target.current.contains(next)) return;
      if (!next || !(next as Element).closest?.("[data-hint]")) {
        target.current = null;
        clear();
      }
    };
    // Any interaction dismisses the hint; the user clearly knows the control.
    const dismiss = () => clear();
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("blur", dismiss);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!hint) return null;
  return (
    <div
      className={`hover-hint ${hint.above ? "is-above" : ""}`}
      role="tooltip"
      style={{ left: hint.x, top: hint.y }}
    >
      {hint.text}
    </div>
  );
}
