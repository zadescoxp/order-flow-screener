"use client";

import React, { useEffect, useState } from "react";
import { useAlertStore } from "@/lib/store/alertStore";
import { notificationState, requestNotifications, unlockAudio, type NotificationState } from "@/lib/alerts/delivery";
import type { AlertRuleId } from "@/lib/engine/alerts";
import { AlertCard } from "@/components/AlertCard";
import { Icon } from "@/components/ui/Icons";
import { Menu, MenuCheckbox, MenuSection, Segmented } from "@/components/ui/Primitives";
import { useSessionStore } from "@/lib/session/SessionContext";

const RULES: { id: AlertRuleId; label: string; hint: string; perpOnly?: boolean }[] = [
  { id: "vwapCross", label: "VWAP cross", hint: "Price crosses the session VWAP" },
  { id: "valueAreaCross", label: "Value area edge", hint: "Price crosses VAH or VAL" },
  { id: "volumeZ", label: "Volume spike", hint: "5-second volume z-score above threshold" },
  { id: "stackedImbalance", label: "Stacked imbalance", hint: "New stack in the live candle (Indicators ratio)" },
  { id: "blockPrint", label: "Block print", hint: "A print far above the average print" },
  { id: "cvdDivergence", label: "CVD divergence", hint: "1-minute CVD and price move apart" },
  { id: "liquidation", label: "Large liquidation", hint: "A forced close above a notional size", perpOnly: true },
  { id: "absorption", label: "Absorption", hint: "Heavy aggressive volume at a price that held" },
  { id: "iceberg", label: "Iceberg", hint: "A level that kept refilling after trading through its size" },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="menu-row menu-row-indent">
      <span>{label}</span>
      {children}
    </div>
  );
}

export default function AlertsMenu() {
  const unread = useAlertStore((s) => s.unread);
  const enabled = useAlertStore((s) => Object.values(s.settings.rules).filter(Boolean).length);
  return (
    <Menu
      hint={unread > 0 ? `Alerts · ${unread} new` : "Alerts"}
      buttonClassName={enabled ? "has-alerts" : ""}
      label={
        <>
          {enabled ? <Icon.BellRing /> : <Icon.Bell />}
          <span className="hide-compact">Alerts</span>
          {unread > 0 && <span className="chip-count">{unread > 99 ? "99+" : unread}</span>}
        </>
      }
    >
      <AlertsMenuBody />
    </Menu>
  );
}

function AlertsMenuBody() {
  const settings = useAlertStore((s) => s.settings);
  const log = useAlertStore((s) => s.log);
  const setRule = useAlertStore((s) => s.setRule);
  const setSetting = useAlertStore((s) => s.setSetting);
  const markRead = useAlertStore((s) => s.markRead);
  const clear = useAlertStore((s) => s.clear);
  const marketType = useSessionStore((s) => s.marketType);
  const [permission, setPermission] = useState<NotificationState>("default");

  // Opening the menu reads the log; reading permission here avoids SSR mismatch.
  useEffect(() => {
    markRead();
    const id = setTimeout(() => setPermission(notificationState()), 0);
    return () => clearTimeout(id);
  }, [markRead, log.length]);

  const toggleRule = (id: AlertRuleId, on: boolean) => {
    setRule(id, on);
    if (on && settings.sound) unlockAudio();
  };

  return (
    <div className="alerts-menu">
      <MenuSection title="Rules">
        {RULES.filter((r) => !r.perpOnly || marketType === "perpetual").map((rule) => (
          <React.Fragment key={rule.id}>
            <MenuCheckbox checked={settings.rules[rule.id]} onChange={(v) => toggleRule(rule.id, v)} label={rule.label} hint={rule.hint} />
            {rule.id === "volumeZ" && settings.rules.volumeZ && (
              <Row label="Threshold">
                <Segmented size="xs" value={settings.volumeZThreshold} onChange={(v) => setSetting("volumeZThreshold", v)} options={[2, 3, 4].map((n) => ({ value: n, label: `${n}σ` }))} ariaLabel="Volume z threshold" />
              </Row>
            )}
            {rule.id === "blockPrint" && settings.rules.blockPrint && (
              <Row label="Size vs average">
                <Segmented size="xs" value={settings.blockPrintRatio} onChange={(v) => setSetting("blockPrintRatio", v)} options={[10, 20, 50, 100].map((n) => ({ value: n, label: `${n}×` }))} ariaLabel="Block print size" />
              </Row>
            )}
            {rule.id === "liquidation" && settings.rules.liquidation && (
              <Row label="Minimum">
                <Segmented
                  size="xs"
                  value={settings.liquidationNotional}
                  onChange={(v) => setSetting("liquidationNotional", v)}
                  options={[{ value: 100_000, label: "$100K" }, { value: 250_000, label: "$250K" }, { value: 1_000_000, label: "$1M" }]}
                  ariaLabel="Minimum liquidation notional"
                />
              </Row>
            )}
          </React.Fragment>
        ))}
        <Row label="Repeat cooldown">
          <Segmented size="xs" value={settings.cooldownSec} onChange={(v) => setSetting("cooldownSec", v)} options={[10, 30, 60, 300].map((n) => ({ value: n, label: n < 60 ? `${n}s` : `${n / 60}m` }))} ariaLabel="Cooldown between repeats of the same alert" />
        </Row>
      </MenuSection>

      <MenuSection title="Delivery">
        <MenuCheckbox
          checked={settings.sound}
          onChange={(v) => {
            setSetting("sound", v);
            if (v) unlockAudio();
          }}
          label="Sound"
          hint="Short chime; pitch rises for buy-side alerts"
        />
        <MenuCheckbox
          checked={settings.notifications && permission === "granted"}
          onChange={async (v) => {
            if (!v) return setSetting("notifications", false);
            const state = await requestNotifications();
            setPermission(state);
            setSetting("notifications", state === "granted");
          }}
          label="Browser notifications"
          hint={
            permission === "denied"
              ? "Blocked — allow notifications for this site in the browser"
              : permission === "unsupported"
                ? "Not supported in this browser"
                : "When the terminal isn't focused; keeps the feed running in a hidden tab"
          }
        />
      </MenuSection>

      <MenuSection title="Recent">
        {log.length === 0 ? (
          <div className="menu-empty">No alerts yet.</div>
        ) : (
          <div className="alert-log">
            {log.slice(0, 12).map((a) => (
              <AlertCard key={a.id} alert={a} variant="log" />
            ))}
          </div>
        )}
      </MenuSection>
      {log.length > 0 && (
        <div className="menu-footer">
          <button type="button" className="ui-button chip" onClick={clear}>Clear log</button>
        </div>
      )}
    </div>
  );
}
