// ─── Theme Tokens ─────────────────────────────────────────────────────────────
// Applied directly via style.setProperty on document.documentElement so canvas
// renderers and CSS read the same values without cascade surprises.

export type Theme = "dark" | "light" | "forest" | "futuristic" | "dark-dull" | "light-dull";

export interface ThemeTokens {
  "--bg-base": string;
  "--bg-surface": string;
  "--bg-panel": string;
  "--bg-panel-alt": string;
  "--bg-hover": string;
  "--bg-active": string;
  "--border": string;
  "--border-muted": string;
  "--text-primary": string;
  "--text-secondary": string;
  "--text-muted": string;
  "--text-accent": string;
  "--buy": string;
  "--buy-dim": string;
  "--buy-bg": string;
  "--buy-border": string;
  "--sell": string;
  "--sell-dim": string;
  "--sell-bg": string;
  "--sell-border": string;
  "--neutral": string;
  "--highlight": string;
  "--highlight-dim": string;
  "--poc": string;
  "--vwap": string;
  "--warn": string;
  "--grid": string;
  "--shadow": string;
  "--accent": string;
  "--on-accent": string;
}

const THEMES: Record<Theme, ThemeTokens> = {
  dark: {
    "--bg-base": "#08090b",
    "--bg-surface": "#0c0d10",
    "--bg-panel": "#111215",
    "--bg-panel-alt": "#16171b",
    "--bg-hover": "#1b1c21",
    "--bg-active": "#24252b",
    "--border": "#202127",
    "--border-muted": "#18191e",
    "--text-primary": "#f2f3f5",
    "--text-secondary": "#a2a5ae",
    "--text-muted": "#646772",
    "--text-accent": "#e4fb8c",
    "--buy": "#2fd897",
    "--buy-dim": "#1d8a61",
    "--buy-bg": "rgba(47,216,151,0.10)",
    "--buy-border": "rgba(47,216,151,0.35)",
    "--sell": "#ff5c74",
    "--sell-dim": "#a33a4b",
    "--sell-bg": "rgba(255,92,116,0.10)",
    "--sell-border": "rgba(255,92,116,0.35)",
    "--neutral": "#6e717b",
    "--highlight": "#d7f75b",
    "--highlight-dim": "rgba(215,247,91,0.13)",
    "--poc": "#ffc857",
    "--vwap": "#a68bff",
    "--warn": "#ff9f43",
    "--grid": "rgba(255,255,255,0.045)",
    "--shadow": "rgba(0,0,0,0.55)",
    "--accent": "#d7f75b",
    "--on-accent": "#0a0b0d",
  },
  light: {
    "--bg-base": "#eef1f6",
    "--bg-surface": "#ffffff",
    "--bg-panel": "#fbfcfe",
    "--bg-panel-alt": "#f3f5f9",
    "--bg-hover": "#e9edf4",
    "--bg-active": "#dfe5ef",
    "--border": "#d5dbe6",
    "--border-muted": "#e5e9f0",
    "--text-primary": "#141a26",
    "--text-secondary": "#4b566b",
    "--text-muted": "#8a93a6",
    "--text-accent": "#2756c7",
    "--buy": "#0c9c72",
    "--buy-dim": "#08704f",
    "--buy-bg": "rgba(12,156,114,0.09)",
    "--buy-border": "rgba(12,156,114,0.35)",
    "--sell": "#d63a43",
    "--sell-dim": "#a1262d",
    "--sell-bg": "rgba(214,58,67,0.09)",
    "--sell-border": "rgba(214,58,67,0.35)",
    "--neutral": "#8a93a6",
    "--highlight": "#2f6fec",
    "--highlight-dim": "rgba(47,111,236,0.12)",
    "--poc": "#b8860b",
    "--vwap": "#8a3ffc",
    "--warn": "#c76a00",
    "--grid": "rgba(20,30,60,0.06)",
    "--shadow": "rgba(20,30,60,0.12)",
    "--accent": "#2f6fec",
    "--on-accent": "#ffffff",
  },
  forest: {
    "--bg-base": "#060d09",
    "--bg-surface": "#09140d",
    "--bg-panel": "#0c1a11",
    "--bg-panel-alt": "#0f2015",
    "--bg-hover": "#142b1c",
    "--bg-active": "#1a3724",
    "--border": "#1c3826",
    "--border-muted": "#12271a",
    "--text-primary": "#d3ecdc",
    "--text-secondary": "#8bb89b",
    "--text-muted": "#557a62",
    "--text-accent": "#9fe0b6",
    "--buy": "#4cd07d",
    "--buy-dim": "#2f8a51",
    "--buy-bg": "rgba(76,208,125,0.10)",
    "--buy-border": "rgba(76,208,125,0.35)",
    "--sell": "#ff6b5e",
    "--sell-dim": "#b0443b",
    "--sell-bg": "rgba(255,107,94,0.10)",
    "--sell-border": "rgba(255,107,94,0.35)",
    "--neutral": "#557a62",
    "--highlight": "#9be46a",
    "--highlight-dim": "rgba(116,211,154,0.16)",
    "--poc": "#ffd54f",
    "--vwap": "#7fd1ff",
    "--warn": "#ffb74d",
    "--grid": "rgba(120,200,150,0.06)",
    "--shadow": "rgba(0,0,0,0.5)",
    "--accent": "#9be46a",
    "--on-accent": "#06140b",
  },
  futuristic: {
    "--bg-base": "#04040f",
    "--bg-surface": "#08081c",
    "--bg-panel": "#0b0b24",
    "--bg-panel-alt": "#0f0f2e",
    "--bg-hover": "#171744",
    "--bg-active": "#1f1f58",
    "--border": "#25256a",
    "--border-muted": "#171744",
    "--text-primary": "#e1e2ff",
    "--text-secondary": "#9a9ae6",
    "--text-muted": "#5f5fae",
    "--text-accent": "#b4b4ff",
    "--buy": "#00e5ff",
    "--buy-dim": "#00a0cc",
    "--buy-bg": "rgba(0,229,255,0.09)",
    "--buy-border": "rgba(0,229,255,0.35)",
    "--sell": "#ff3df5",
    "--sell-dim": "#aa22a4",
    "--sell-bg": "rgba(255,61,245,0.09)",
    "--sell-border": "rgba(255,61,245,0.35)",
    "--neutral": "#4a4aa8",
    "--highlight": "#9b6bff",
    "--highlight-dim": "rgba(155,107,255,0.2)",
    "--poc": "#ffea00",
    "--vwap": "#7dffb3",
    "--warn": "#ffaa33",
    "--grid": "rgba(140,140,255,0.07)",
    "--shadow": "rgba(0,0,0,0.6)",
    "--accent": "#9b6bff",
    "--on-accent": "#ffffff",
  },
  "dark-dull": {
    "--bg-base": "#1b1b1d",
    "--bg-surface": "#222225",
    "--bg-panel": "#26262a",
    "--bg-panel-alt": "#2c2c31",
    "--bg-hover": "#34343a",
    "--bg-active": "#3d3d44",
    "--border": "#38383f",
    "--border-muted": "#2e2e34",
    "--text-primary": "#d0d0d2",
    "--text-secondary": "#9a9aa0",
    "--text-muted": "#67676e",
    "--text-accent": "#b4b4c0",
    "--buy": "#6aa874",
    "--buy-dim": "#456e4c",
    "--buy-bg": "rgba(106,168,116,0.10)",
    "--buy-border": "rgba(106,168,116,0.32)",
    "--sell": "#c06464",
    "--sell-dim": "#804242",
    "--sell-bg": "rgba(192,100,100,0.10)",
    "--sell-border": "rgba(192,100,100,0.32)",
    "--neutral": "#67676e",
    "--highlight": "#8c8cc0",
    "--highlight-dim": "rgba(140,140,192,0.18)",
    "--poc": "#c9ad4b",
    "--vwap": "#b08cd0",
    "--warn": "#d09040",
    "--grid": "rgba(255,255,255,0.04)",
    "--shadow": "rgba(0,0,0,0.4)",
    "--accent": "#c9d48a",
    "--on-accent": "#1b1b1d",
  },
  "light-dull": {
    "--bg-base": "#e4e4e4",
    "--bg-surface": "#eeeeee",
    "--bg-panel": "#f2f2f2",
    "--bg-panel-alt": "#e8e8e8",
    "--bg-hover": "#dcdcdc",
    "--bg-active": "#d0d0d0",
    "--border": "#c4c4c4",
    "--border-muted": "#d6d6d6",
    "--text-primary": "#262626",
    "--text-secondary": "#555555",
    "--text-muted": "#8a8a8a",
    "--text-accent": "#3a3a6a",
    "--buy": "#3f7f4a",
    "--buy-dim": "#2f5f38",
    "--buy-bg": "rgba(63,127,74,0.10)",
    "--buy-border": "rgba(63,127,74,0.32)",
    "--sell": "#9a3a3a",
    "--sell-dim": "#702828",
    "--sell-bg": "rgba(154,58,58,0.10)",
    "--sell-border": "rgba(154,58,58,0.32)",
    "--neutral": "#8a8a8a",
    "--highlight": "#5a5aa0",
    "--highlight-dim": "rgba(90,90,160,0.15)",
    "--poc": "#8f7419",
    "--vwap": "#7a4aa0",
    "--warn": "#a8661a",
    "--grid": "rgba(0,0,0,0.05)",
    "--shadow": "rgba(0,0,0,0.12)",
    "--accent": "#5a5aa0",
    "--on-accent": "#ffffff",
  },
};

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "Midnight" },
  { value: "light", label: "Daylight" },
  { value: "forest", label: "Forest" },
  { value: "futuristic", label: "Neon" },
  { value: "dark-dull", label: "Graphite" },
  { value: "light-dull", label: "Paper" },
];

export function isLightTheme(theme: Theme): boolean {
  return theme === "light" || theme === "light-dull";
}

export function applyTheme(theme: Theme): void {
  const tokens = THEMES[theme] ?? THEMES.dark;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(tokens)) {
    root.style.setProperty(prop, value);
  }
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = isLightTheme(theme) ? "light" : "dark";
}

export { THEMES };
