const pending = new Set<() => void>();
let frame: number | null = null;

export function scheduleCanvasRedraw(draw: () => void): void {
  pending.add(draw);
  if (typeof document !== "undefined" && document.hidden) return;
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    const callbacks = [...pending];
    pending.clear();
    for (const callback of callbacks) callback();
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && pending.size > 0) {
      scheduleCanvasRedraw(() => undefined);
    }
  });
}
