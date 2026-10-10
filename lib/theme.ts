// ─── Theme Tokens ─────────────────────────────────────────────────────────────
// These are applied directly via style.setProperty on document.documentElement
// to avoid any CSS cascade / Tailwind layer specificity issues.

export type Theme = "dark" | "light" | "forest" | "futuristic" | "dark-dull" | "light-dull";

interface ThemeTokens {
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
}

const THEMES: Record<Theme, ThemeTokens> = {
  dark: {
    "--bg-base": "#0a0a0c",
    "--bg-surface": "#0f0f12",
    "--bg-panel": "#111116",
    "--bg-panel-alt": "#13131a",
    "--bg-hover": "#1a1a22",
    "--bg-active": "#1f1f2a",
    "--border": "#1e1e2a",
    "--border-muted": "#161620",
    "--text-primary": "#e8e8f0",
    "--text-secondary": "#7a7a99",
    "--text-muted": "#4a4a66",
    "--text-accent": "#9a9acc",
    "--buy": "#26a69a",
    "--buy-dim": "#1a6e69",
    "--buy-bg": "rgba(38,166,154,0.08)",
    "--buy-border": "rgba(38,166,154,0.3)",
    "--sell": "#ef5350",
    "--sell-dim": "#9e3836",
    "--sell-bg": "rgba(239,83,80,0.08)",
    "--sell-border": "rgba(239,83,80,0.3)",
    "--neutral": "#5c5c80",
    "--highlight": "#7c6af5",
    "--highlight-dim": "rgba(124,106,245,0.2)",
    "--poc": "#f5c842",
  },
  light: {
    "--bg-base": "#f0f0f5",
    "--bg-surface": "#ffffff",
    "--bg-panel": "#f8f8fc",
    "--bg-panel-alt": "#f0f0f8",
    "--bg-hover": "#e4e4f0",
    "--bg-active": "#d8d8ec",
    "--border": "#c8c8dc",
    "--border-muted": "#dcdcec",
    "--text-primary": "#1a1a2e",
    "--text-secondary": "#4a4a70",
    "--text-muted": "#8a8aaa",
    "--text-accent": "#5555aa",
    "--buy": "#1a7a72",
    "--buy-dim": "#0f5550",
    "--buy-bg": "rgba(26,122,114,0.08)",
    "--buy-border": "rgba(26,122,114,0.3)",
    "--sell": "#c0392b",
    "--sell-dim": "#8c2a20",
    "--sell-bg": "rgba(192,57,43,0.08)",
    "--sell-border": "rgba(192,57,43,0.3)",
    "--neutral": "#888899",
    "--highlight": "#5a48d0",
    "--highlight-dim": "rgba(90,72,208,0.15)",
    "--poc": "#b5860e",
  },
  forest: {
    "--bg-base": "#060e08",
    "--bg-surface": "#0a160c",
    "--bg-panel": "#0d1f10",
    "--bg-panel-alt": "#0f2513",
    "--bg-hover": "#14321b",
    "--bg-active": "#1a4022",
    "--border": "#1e4228",
    "--border-muted": "#122b18",
    "--text-primary": "#c8ecd4",
    "--text-secondary": "#7ab890",
    "--text-muted": "#4a7a5c",
    "--text-accent": "#90d4a8",
    "--buy": "#4caf50",
    "--buy-dim": "#357a38",
    "--buy-bg": "rgba(76,175,80,0.10)",
    "--buy-border": "rgba(76,175,80,0.35)",
    "--sell": "#ff5252",
    "--sell-dim": "#b03535",
    "--sell-bg": "rgba(255,82,82,0.10)",
    "--sell-border": "rgba(255,82,82,0.35)",
    "--neutral": "#4a7a5c",
    "--highlight": "#66bb6a",
    "--highlight-dim": "rgba(102,187,106,0.2)",
    "--poc": "#ffd54f",
  },
  futuristic: {
    "--bg-base": "#04040f",
    "--bg-surface": "#08081e",
    "--bg-panel": "#0b0b26",
    "--bg-panel-alt": "#0f0f30",
    "--bg-hover": "#18184a",
    "--bg-active": "#20205e",
    "--border": "#282870",
    "--border-muted": "#18184a",
    "--text-primary": "#dddeff",
    "--text-secondary": "#8888dd",
    "--text-muted": "#5555aa",
    "--text-accent": "#aaaaff",
    "--buy": "#00e5ff",
    "--buy-dim": "#00a0cc",
    "--buy-bg": "rgba(0,229,255,0.08)",
    "--buy-border": "rgba(0,229,255,0.3)",
    "--sell": "#f500ff",
    "--sell-dim": "#aa00bb",
    "--sell-bg": "rgba(245,0,255,0.08)",
    "--sell-border": "rgba(245,0,255,0.3)",
    "--neutral": "#4444aa",
    "--highlight": "#9b59ff",
    "--highlight-dim": "rgba(155,89,255,0.2)",
    "--poc": "#ffea00",
  },
  "dark-dull": {
    "--bg-base": "#1e1e1e",
    "--bg-surface": "#252526",
    "--bg-panel": "#2d2d30",
    "--bg-panel-alt": "#333337",
    "--bg-hover": "#3c3c40",
    "--bg-active": "#48484e",
    "--border": "#3e3e44",
    "--border-muted": "#2e2e34",
    "--text-primary": "#c8c8c8",
    "--text-secondary": "#929292",
    "--text-muted": "#606060",
    "--text-accent": "#aaaaaa",
    "--buy": "#5a8a60",
    "--buy-dim": "#3d5e42",
    "--buy-bg": "rgba(90,138,96,0.10)",
    "--buy-border": "rgba(90,138,96,0.3)",
    "--sell": "#a05050",
    "--sell-dim": "#6e3636",
    "--sell-bg": "rgba(160,80,80,0.10)",
    "--sell-border": "rgba(160,80,80,0.3)",
    "--neutral": "#606060",
    "--highlight": "#7878a0",
    "--highlight-dim": "rgba(120,120,160,0.2)",
    "--poc": "#b8a040",
  },
  "light-dull": {
    "--bg-base": "#e8e8e8",
    "--bg-surface": "#efefef",
    "--bg-panel": "#e2e2e2",
    "--bg-panel-alt": "#d8d8d8",
    "--bg-hover": "#cccccc",
    "--bg-active": "#c0c0c0",
    "--border": "#b0b0b0",
    "--border-muted": "#c8c8c8",
    "--text-primary": "#2a2a2a",
    "--text-secondary": "#555555",
    "--text-muted": "#888888",
    "--text-accent": "#444444",
    "--buy": "#4a7a50",
    "--buy-dim": "#355840",
    "--buy-bg": "rgba(74,122,80,0.10)",
    "--buy-border": "rgba(74,122,80,0.3)",
    "--sell": "#8a3030",
    "--sell-dim": "#602020",
    "--sell-bg": "rgba(138,48,48,0.10)",
    "--sell-border": "rgba(138,48,48,0.3)",
    "--neutral": "#888888",
    "--highlight": "#6060a0",
    "--highlight-dim": "rgba(96,96,160,0.2)",
    "--poc": "#907820",
  },
};

export function applyTheme(theme: Theme): void {
  const tokens = THEMES[theme];
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(tokens)) {
    root.style.setProperty(prop, value);
  }
  root.setAttribute("data-theme", theme);
}

export { THEMES };
