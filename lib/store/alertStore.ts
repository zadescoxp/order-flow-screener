import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_ALERT_SETTINGS, type AlertEvent, type AlertSettings } from "@/lib/engine/alerts";

// Alert rules and delivery preferences persist per browser, like the
// indicator settings. The alert log is kept for this page view only.

export interface LoggedAlert extends AlertEvent {
  symbol: string;
  replay: boolean;
  dismissed?: boolean; // hidden from the toast stack, still in the log
  shownAt: number; // wall time it was logged; toasts age by this, so replays work too
}

const MAX_LOG = 50;

interface AlertStore {
  settings: AlertSettings;
  log: LoggedAlert[]; // newest first
  unread: number;
  setRule: (rule: keyof AlertSettings["rules"], enabled: boolean) => void;
  setSetting: <K extends Exclude<keyof AlertSettings, "rules">>(key: K, value: AlertSettings[K]) => void;
  push: (events: Omit<LoggedAlert, "shownAt">[]) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  /** Give these toasts a fresh display window (after the pointer leaves the stack). */
  restartTimers: (ids: string[]) => void;
  markRead: () => void;
  clear: () => void;
}

export const useAlertStore = create<AlertStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_ALERT_SETTINGS,
      log: [],
      unread: 0,
      setRule: (rule, enabled) =>
        set((s) => ({ settings: { ...s.settings, rules: { ...s.settings.rules, [rule]: enabled } } })),
      setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
      push: (events) =>
        set((s) => {
          const shownAt = Date.now();
          const logged = events.map((e) => ({ ...e, shownAt })).reverse();
          return { log: [...logged, ...s.log].slice(0, MAX_LOG), unread: s.unread + events.length };
        }),
      dismiss: (id) => set((s) => ({ log: s.log.map((a) => (a.id === id ? { ...a, dismissed: true } : a)) })),
      dismissAll: () => set((s) => ({ log: s.log.map((a) => (a.dismissed ? a : { ...a, dismissed: true })) })),
      restartTimers: (ids) =>
        set((s) => {
          const now = Date.now();
          return { log: s.log.map((a) => (ids.includes(a.id) ? { ...a, shownAt: now } : a)) };
        }),
      markRead: () => set({ unread: 0 }),
      clear: () => set({ log: [], unread: 0 }),
    }),
    {
      name: "oft-alerts",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({ settings: state.settings }),
      merge: (persisted, current) => {
        const saved = ((persisted ?? {}) as Partial<AlertStore>).settings;
        return {
          ...current,
          settings: {
            ...DEFAULT_ALERT_SETTINGS,
            ...(saved ?? {}),
            rules: { ...DEFAULT_ALERT_SETTINGS.rules, ...(saved?.rules ?? {}) },
          },
        };
      },
    }
  )
);

/** True when alerts should keep the feed running while the tab is hidden. */
export function alertsNeedBackground(): boolean {
  const { settings } = useAlertStore.getState();
  return (
    settings.notifications &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted" &&
    Object.values(settings.rules).some(Boolean)
  );
}
