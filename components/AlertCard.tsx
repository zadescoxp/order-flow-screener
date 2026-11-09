"use client";

import React from "react";
import { ALERT_RULE_LABEL, type AlertRuleId } from "@/lib/engine/alerts";
import type { LoggedAlert } from "@/lib/store/alertStore";
import { formatClock } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";

const RULE_ICON: Record<AlertRuleId, () => React.ReactElement> = {
  vwapCross: Icon.Crosshair,
  valueAreaCross: Icon.Rows,
  volumeZ: Icon.Zap,
  stackedImbalance: Icon.Layers,
  blockPrint: Icon.Box,
  cvdDivergence: Icon.Diverge,
  liquidation: Icon.Flame,
  absorption: Icon.Shield,
  iceberg: Icon.Snowflake,
};

// One alert: rule glyph, a meta line (rule · symbol · time), the headline
// with its key figure, and a detail line. Used by the toasts and the log.
export function AlertCard({
  alert,
  variant,
  onDismiss,
  timerMs,
}: {
  alert: LoggedAlert;
  variant: "toast" | "log";
  onDismiss?: () => void;
  timerMs?: number;
}) {
  const Glyph = RULE_ICON[alert.rule];
  return (
    <div className={`alert-card alert-${variant} tone-${alert.tone}`} title={alert.title}>
      <span className="alert-glyph" aria-hidden>
        <Glyph />
      </span>
      <div className="alert-main">
        <div className="alert-meta">
          <span className="alert-rule">{ALERT_RULE_LABEL[alert.rule]}</span>
          <span>{alert.symbol}</span>
          {alert.replay && <span className="alert-replay">Replay</span>}
          <time className="alert-time">{formatClock(alert.time)}</time>
        </div>
        <div className="alert-headline">
          <strong>{alert.headline}</strong>
          {alert.figure && <span className="alert-figure">{alert.figure}</span>}
        </div>
        <div className="alert-detail">{alert.body}</div>
      </div>
      {onDismiss && (
        <button type="button" className="alert-close" aria-label="Dismiss alert" data-hint="Dismiss" onClick={onDismiss}>
          <Icon.Close />
        </button>
      )}
      {timerMs !== undefined && <span className="alert-timer" style={{ animationDuration: `${timerMs}ms` }} aria-hidden />}
    </div>
  );
}
