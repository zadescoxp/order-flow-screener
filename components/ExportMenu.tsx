"use client";

import React, { useState } from "react";
import { useMarketSession, useSessionStore } from "@/lib/session/SessionContext";
import {
  candlesCsv,
  exportFilename,
  footprintLevelsCsv,
  liquidationsCsv,
  openInterestCsv,
  profileCsv,
  tapeCsv,
} from "@/lib/export/csv";
import { canvasPng, downloadBlob, downloadText, workspacePng } from "@/lib/export/download";
import { TAPE_LOG_SIZE } from "@/lib/managers/marketDataManager";
import { formatCompact, VENUE_LABEL } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Menu, MenuSection } from "@/components/ui/Primitives";

// ─── Export menu ─────────────────────────────────────────────────
// CSV of the session's footprint, profile, tape and derivatives series,
// and PNG snapshots of the charts.

function Item({ label, hint, disabled, onClick }: { label: string; hint: string; disabled?: boolean; onClick: () => void | Promise<void> }) {
  return (
    <button type="button" className="menu-item menu-action" role="menuitem" disabled={disabled} onClick={() => void onClick()}>
      <span className="menu-item-text">
        <span>{label}</span>
        <small>{hint}</small>
      </span>
    </button>
  );
}

export default function ExportMenu() {
  return (
    <Menu hint="Export" label={<><Icon.Download /><span className="hide-compact">Export</span></>}>
      <ExportItems />
    </Menu>
  );
}

function ExportItems() {
  const session = useMarketSession();
  const store = session.store;
  const symbol = useSessionStore((s) => s.symbol);
  const timeframe = useSessionStore((s) => s.timeframe);
  const marketType = useSessionStore((s) => s.marketType);
  const candleCount = useSessionStore((s) => s.candles.length + (s.currentCandle ? 1 : 0));
  const hasProfile = useSessionStore((s) => Boolean(s.volumeProfile?.levels.length));
  const liqCount = useSessionStore((s) => s.liquidations.length);
  const oiCount = useSessionStore((s) => s.oiHistory.length);
  const [error, setError] = useState<string | null>(null);

  const name = (kind: string, ext = "csv") => exportFilename(symbol, timeframe, kind, ext);
  const candles = () => {
    const s = store.getState();
    return s.currentCandle ? [...s.candles, s.currentCandle] : s.candles;
  };
  const run = async (fn: () => void | Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const isPerp = marketType === "perpetual";
  const tapeSize = session.manager.tapeLogSize;

  return (
    <div className="export-menu">
      <MenuSection title="CSV">
        <Item label="Footprint candles" hint={`${candleCount} candles · OHLC, volume, delta, CVD, VWAP`} disabled={!candleCount} onClick={() => run(() => downloadText(candlesCsv(candles()), name("candles")))} />
        <Item label="Footprint levels" hint="Bid / ask volume per price per candle" disabled={!candleCount} onClick={() => run(() => downloadText(footprintLevelsCsv(candles()), name("footprint")))} />
        <Item
          label="Session profile"
          hint="Volume by price with POC and value area"
          disabled={!hasProfile}
          onClick={() => run(() => { const p = store.getState().volumeProfile; if (p) downloadText(profileCsv(p), name("profile")); })}
        />
        <Item
          label="Time & sales"
          hint={`Last ${formatCompact(Math.min(tapeSize, TAPE_LOG_SIZE), 0)} prints (up to ${formatCompact(TAPE_LOG_SIZE, 0)})`}
          disabled={!tapeSize}
          onClick={() => run(() => downloadText(tapeCsv(session.manager.getTapeLog()), name("tape")))}
        />
        {isPerp && (
          <>
            <Item label="Liquidations" hint={`${liqCount} this session`} disabled={!liqCount} onClick={() => run(() => downloadText(liquidationsCsv(store.getState().liquidations), name("liquidations")))} />
            <Item label="Open interest" hint={`${oiCount} one-second samples`} disabled={!oiCount} onClick={() => run(() => downloadText(openInterestCsv(store.getState().oiHistory), name("open-interest")))} />
          </>
        )}
      </MenuSection>
      <MenuSection title="Image">
        <Item
          label="Footprint PNG"
          hint="The footprint chart at screen resolution"
          disabled={!candleCount}
          onClick={() =>
            run(async () => {
              const canvas = document.querySelector<HTMLCanvasElement>(".footprint-panel canvas");
              if (!canvas) throw new Error("Footprint chart is not visible");
              downloadBlob(await canvasPng(canvas), name("footprint", "png"));
            })
          }
        />
        <Item
          label="Workspace PNG"
          hint="All chart panels composited into one image"
          onClick={() =>
            run(async () => {
              const root = document.querySelector<HTMLElement>(".workspace");
              if (!root) throw new Error("Workspace not found");
              const s = store.getState();
              const venue = s.selectedVenues.length > 1 ? VENUE_LABEL[s.venue] ?? s.venue : VENUE_LABEL[s.selectedVenues[0]] ?? s.venue;
              const caption = `orderflow. · ${s.symbol} · ${venue} · ${s.timeframe.toUpperCase()} · ${new Date(s.replay ? s.replay.position : Date.now()).toISOString().slice(0, 19).replace("T", " ")} UTC${s.replay ? " (replay)" : ""}`;
              downloadBlob(await workspacePng(root, caption), name("workspace", "png"));
            })
          }
        />
      </MenuSection>
      {error && <div className="menu-note tone-sell">{error}</div>}
    </div>
  );
}
