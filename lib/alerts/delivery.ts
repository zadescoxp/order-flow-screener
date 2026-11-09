"use client";

// Alert delivery: a short synthesized chime and browser notifications.
// No audio files — the tone is generated with the Web Audio API.

import type { AlertTone } from "@/lib/engine/alerts";

let audio: AudioContext | null = null;

/** Create / resume the audio context. Call from a user gesture so browsers allow playback. */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  if (!audio) audio = new Ctor();
  if (audio.state === "suspended") void audio.resume();
}

const PITCH: Record<AlertTone, [number, number]> = {
  buy: [660, 880],
  sell: [660, 495],
  warn: [880, 880],
  neutral: [740, 740],
};

export function playChime(tone: AlertTone): void {
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime + 0.01;
  PITCH[tone].forEach((frequency, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    const t = start + i * 0.12;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  });
}

export type NotificationState = "unsupported" | "default" | "granted" | "denied";

export function notificationState(): NotificationState {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestNotifications(): Promise<NotificationState> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

/** Show a system notification when the terminal isn't the focused window. */
export function notify(title: string, body: string, tag: string, silent: boolean): void {
  if (notificationState() !== "granted" || document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, tag, silent, icon: "/icon.svg" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some platforms only allow notifications from a service worker.
  }
}
