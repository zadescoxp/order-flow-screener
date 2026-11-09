"use client";

import { useEffect, useState } from "react";
import { useAlertStore } from "@/lib/store/alertStore";
import { AlertCard } from "./AlertCard";

const TOAST_MS = 8_000;
const MAX_TOASTS = 3;

// Newest alerts in the bottom-right corner, newest on top. Hovering the
// stack pauses the countdown; leaving it gives the toasts a fresh window.
export default function AlertToasts() {
  const log = useAlertStore((s) => s.log);
  const dismiss = useAlertStore((s) => s.dismiss);
  const dismissAll = useAlertStore((s) => s.dismissAll);
  const restartTimers = useAlertStore((s) => s.restartTimers);
  const [now, setNow] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [paused]);

  const live = log.filter((a) => !a.dismissed && (now === 0 || now - a.shownAt < TOAST_MS));
  if (!live.length) return null;
  const shown = live.slice(0, MAX_TOASTS);
  const hidden = live.length - shown.length;

  return (
    <div
      className={`alert-toasts ${paused ? "is-paused" : ""}`}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        restartTimers(live.map((a) => a.id));
        setPaused(false);
      }}
    >
      {shown.map((a) => (
        <AlertCard key={`${a.id}:${a.shownAt}`} alert={a} variant="toast" timerMs={TOAST_MS} onDismiss={() => dismiss(a.id)} />
      ))}
      {(hidden > 0 || live.length > 1) && (
        <div className="alert-toasts-footer">
          {hidden > 0 && <span>+{hidden} more in Alerts</span>}
          <button type="button" onClick={dismissAll}>Dismiss all</button>
        </div>
      )}
    </div>
  );
}
