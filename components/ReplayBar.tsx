"use client";

import React from "react";
import { useMarketSession, useSessionStore } from "@/lib/session/SessionContext";
import { formatClock, formatDuration, VENUE_LABEL } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Segmented } from "@/components/ui/Primitives";
import type { ReplaySpeed } from "@/lib/recording/types";

const SPEEDS: { value: ReplaySpeed; label: string }[] = [
  { value: 1, label: "1×" },
  { value: 5, label: "5×" },
  { value: 20, label: "20×" },
];

// ─── Replay transport ────────────────────────────────────────────
// Shown while a recording plays back in place of the live feed.

export default function ReplayBar() {
  const session = useMarketSession();
  const replay = useSessionStore((s) => s.replay);
  if (!replay) return null;

  const { meta, position, playing, speed, ended, seeking } = replay;
  const duration = Math.max(1, meta.endedAt - meta.startedAt);
  const progress = Math.min(1, Math.max(0, (position - meta.startedAt) / duration));
  const venues = meta.selectedVenues.map((v) => VENUE_LABEL[v] ?? v).join(", ");

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    void session.replaySeek(meta.startedAt + fraction * duration);
  };

  return (
    <section className="replay-bar" aria-label="Replay controls">
      <span className="replay-badge">Replay</span>
      <button
        type="button"
        className="ui-button chip icon-only"
        onClick={() => (playing ? session.replayPause() : session.replayPlay())}
        disabled={seeking}
        aria-label={playing ? "Pause" : ended ? "Play from start" : "Play"}
        data-hint={playing ? "Pause" : ended ? "Play from start" : "Play"}
      >
        {playing ? <Icon.Pause /> : <Icon.Play />}
      </button>
      <button
        type="button"
        className="ui-button chip icon-only"
        onClick={() => void session.replaySeek(meta.startedAt)}
        disabled={seeking}
        aria-label="Restart"
        data-hint="Restart"
      >
        <Icon.Restart />
      </button>
      <Segmented size="xs" value={speed} onChange={(v) => session.replaySpeed(v)} options={SPEEDS} ariaLabel="Replay speed" />
      <span className="replay-time">{formatClock(position)}</span>
      <div
        className="replay-track"
        role="slider"
        tabIndex={0}
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        onClick={seekFromPointer}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 60_000 : 10_000;
          if (e.key === "ArrowRight") void session.replaySeek(position + step);
          if (e.key === "ArrowLeft") void session.replaySeek(position - step);
        }}
        title="Click to jump. ← / → move 10 s (Shift: 1 min)"
      >
        <div className="replay-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="replay-time muted">
        {formatDuration(position - meta.startedAt)} / {formatDuration(duration)}
      </span>
      <span className="replay-meta" title={`${meta.symbol} · ${venues} · recorded ${new Date(meta.startedAt).toLocaleString()}`}>
        {seeking ? "Seeking…" : ended ? "End of recording" : `${meta.symbol} · ${meta.selectedVenues.length > 1 ? `${meta.selectedVenues.length} venues` : venues}`}
      </span>
      <button type="button" className="ui-button chip" onClick={() => session.exitReplay()} data-hint="Back to the live feed">
        <Icon.Close /> Exit
      </button>
    </section>
  );
}
