"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Pick the most spacious density level at which a flex row's contents fit
 * on one line. Level 0 is roomiest; each higher level is a CSS step that
 * makes the row narrower (e.g. icon-only buttons), and the last level is
 * expected to always fit (e.g. wrapping). Re-evaluates when the row or its
 * contents resize, so new buttons never push items off-screen.
 */
export function useFitDensity<T extends HTMLElement>(maxLevel: number) {
  const ref = useRef<T>(null);
  const [level, setLevel] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const fits = () => el.scrollWidth <= el.clientWidth + 1;
    const fit = () => {
      // Try from roomiest to tightest, applying each level synchronously so
      // the measurement reflects it; settle on the first that fits.
      for (let next = 0; next <= maxLevel; next++) {
        el.dataset.density = String(next);
        if (next === maxLevel || fits()) {
          setLevel(next);
          return;
        }
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    window.addEventListener("resize", schedule);
    // Fonts loading late change label widths.
    document.fonts?.ready.then(schedule).catch(() => undefined);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [maxLevel]);

  return { ref, level };
}
