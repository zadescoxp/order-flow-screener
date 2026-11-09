"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useMarketSession, useSessionStore } from "@/lib/session/SessionContext";
import { useNow } from "@/hooks/useNow";
import type { RecordingMeta } from "@/lib/recording/types";
import { formatCompact, formatDuration, VENUE_LABEL } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Menu, MenuSection } from "@/components/ui/Primitives";

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function formatStart(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

// ─── Record / replay menu ────────────────────────────────────────
// Start or stop recording the live stream and pick a saved session to
// replay. Recordings live in this browser's IndexedDB.

export default function RecordingsMenu() {
  const session = useMarketSession();
  const recording = useSessionStore((s) => s.recording);
  const replaying = useSessionStore((s) => s.replay !== null);
  const now = useNow(1000);
  // IndexedDB exists only in the browser; decide after mount so SSR markup matches.
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setSupported(session.storage !== null), 0);
    return () => clearTimeout(id);
  }, [session]);

  return (
    <div className="record-controls">
      <button
        type="button"
        className={`ui-button record-button ${recording ? "is-recording" : ""}`}
        disabled={!supported || replaying}
        onClick={() => (recording ? void session.stopRecording() : void session.startRecording())}
        aria-label={recording ? "Stop recording" : "Record session"}
        data-hint={
          !supported
            ? "Recording isn't available in this browser"
            : recording
              ? `Stop recording · ${formatCompact(recording.events, 1)} events · ${formatBytes(recording.bytes)}`
              : "Record session"
        }
      >
        <Icon.Record />
        {recording ? (
          <span className="record-elapsed">{now ? formatDuration(now - recording.startedAt) : "0s"}</span>
        ) : (
          <span className="hide-compact">Rec</span>
        )}
      </button>
      <Menu hint="Replay recordings" label={<><Icon.History /><span className="hide-compact">Replay</span></>}>
        <RecordingList />
      </Menu>
    </div>
  );
}

function RecordingList() {
  const session = useMarketSession();
  const recordingId = useSessionStore((s) => s.recording?.id);
  const replayId = useSessionStore((s) => s.replay?.meta.id);
  const [items, setItems] = useState<RecordingMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const storage = session.storage;
    if (!storage) return setError("Recording isn't available in this browser.");
    try {
      setItems(await storage.listMeta());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [session]);

  useEffect(() => {
    const id = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(id);
  }, [refresh, recordingId]);

  const remove = async (meta: RecordingMeta) => {
    if (!window.confirm(`Delete the ${meta.symbol} recording from ${formatStart(meta.startedAt)}? This can't be undone.`)) return;
    await session.storage?.delete(meta.id);
    void refresh();
  };

  return (
    <div className="recordings-menu">
      <MenuSection title="Saved sessions">
        {session.recordingNotice && <div className="menu-note">{session.recordingNotice}</div>}
        {error && <div className="menu-empty">{error}</div>}
        {!error && items === null && <div className="menu-empty">Loading…</div>}
        {!error && items?.length === 0 && (
          <div className="menu-empty">No recordings yet. Press Rec to capture the live stream; replay it here later at 1×, 5× or 20×.</div>
        )}
        <ul className="recording-list">
          {items?.map((meta) => {
            const live = meta.id === recordingId;
            const active = meta.id === replayId;
            const venues = meta.selectedVenues.length > 1 ? `${meta.selectedVenues.length} venues` : VENUE_LABEL[meta.selectedVenues[0]] ?? meta.selectedVenues[0];
            return (
              <li key={meta.id} className={active ? "is-active" : ""}>
                <div className="recording-info">
                  <strong>
                    {meta.symbol} <span>{meta.marketType === "perpetual" ? "Perp" : meta.marketType === "spot" ? "Spot" : "FX"} · {venues}</span>
                  </strong>
                  <small>
                    {formatStart(meta.startedAt)} · {formatDuration(meta.endedAt - meta.startedAt)} · {formatCompact(meta.events, 1)} events · {formatBytes(meta.bytes)}
                    {live ? " · recording" : !meta.complete ? " · interrupted" : ""}
                  </small>
                </div>
                <div className="recording-actions">
                  <button
                    type="button"
                    className="ui-button chip"
                    disabled={live || meta.events === 0}
                    onClick={() => void session.startReplay(meta)}
                    data-hint="Replay this session"
                  >
                    <Icon.Play /> Play
                  </button>
                  <button
                    type="button"
                    className="ui-button chip icon-only"
                    disabled={live || active}
                    onClick={() => void remove(meta)}
                    aria-label="Delete recording"
                    data-hint="Delete recording"
                  >
                    <Icon.Close />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </MenuSection>
    </div>
  );
}
