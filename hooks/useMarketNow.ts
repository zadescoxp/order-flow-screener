"use client";

import { useSessionStore } from "@/lib/session/SessionContext";
import { useNow } from "./useNow";

/**
 * "Now" for rolling windows and countdowns: wall time when live, the
 * replay's virtual clock while a recording is playing back.
 */
export function useMarketNow(intervalMs = 1000): number {
  const wall = useNow(intervalMs);
  const replaying = useSessionStore((s) => s.replay !== null);
  const clock = useSessionStore((s) => (s.replay ? s.replay.position : 0));
  return replaying ? clock : wall;
}
