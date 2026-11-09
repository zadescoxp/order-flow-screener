"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { "data-hint"?: string }>(
  function Button({ className = "", ...props }, ref) {
    return <button ref={ref} type="button" className={`ui-button ${className}`} {...props} />;
  }
);

export function Badge({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`ui-badge ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`ui-select ${className}`} {...props} />;
}

// ─── Segmented control ───────────────────────────────────────────
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "sm",
  ariaLabel,
  accent = false,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  size?: "xs" | "sm" | "md";
  ariaLabel?: string;
  accent?: boolean;
}) {
  return (
    <div className={`segmented segmented-${size} ${accent ? "segmented-accent" : ""}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ─── Panel shell ─────────────────────────────────────────────────
export function Panel({
  title,
  subtitle,
  value,
  icon,
  actions,
  footer,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: string;
  subtitle?: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel ${className}`} aria-label={title}>
      <header className="panel-header">
        <div className="panel-heading">
          {icon && <span className="panel-icon">{icon}</span>}
          <div className="panel-titles">
            <h2 className="panel-title">
              {title}
              {value !== undefined && <span className="panel-value">{value}</span>}
            </h2>
            {subtitle && <span className="panel-subtitle">{subtitle}</span>}
          </div>
        </div>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className={`panel-body ${bodyClassName}`}>{children}</div>
      {footer && <footer className="panel-footer">{footer}</footer>}
    </section>
  );
}

// ─── Stat chip ───────────────────────────────────────────────────
export function Stat({
  label,
  value,
  sub,
  tone,
  title,
  className = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "buy" | "sell" | "warn" | "accent" | "muted" | "vwap" | "poc";
  title?: string;
  className?: string;
}) {
  return (
    <div className={`stat ${className}`} title={title}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</span>
      {sub !== undefined && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

// ─── Popover menu ────────────────────────────────────────────────
// The popover renders in a portal on <body> with fixed positioning, so a
// panel's overflow can't clip it. It sits under its button, flips above
// when there's more room there, and scrolls within the viewport.
const MENU_GAP = 8;
const VIEWPORT_MARGIN = 12;

export function Menu({
  label,
  children,
  align = "right",
  buttonClassName = "",
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  buttonClassName?: string;
  /** Short name shown on hover (for icon-only buttons). */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const r = button.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - MENU_GAP - VIEWPORT_MARGIN;
    const above = r.top - MENU_GAP - VIEWPORT_MARGIN;
    const natural = popoverRef.current?.scrollHeight ?? 0;
    const flip = natural > below && above > below;
    const horizontal: CSSProperties =
      align === "right"
        ? { right: Math.max(VIEWPORT_MARGIN, window.innerWidth - r.right) }
        : { left: Math.max(VIEWPORT_MARGIN, r.left) };
    setPos({
      position: "fixed",
      ...horizontal,
      ...(flip ? { bottom: window.innerHeight - r.top + MENU_GAP } : { top: r.bottom + MENU_GAP }),
      maxHeight: Math.max(160, flip ? above : below),
      maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
    });
  }, [align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    // Re-place on resize, and when anything outside the popover scrolls.
    const reflow = (event: Event) => {
      if (event.type === "scroll" && popoverRef.current?.contains(event.target as Node)) return;
      place();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  }, [open, place]);

  return (
    <div className="menu">
      <Button
        ref={buttonRef}
        className={`${buttonClassName} ${open ? "is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={hint}
        data-hint={open ? undefined : hint}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className={`menu-popover menu-${align} is-portal`}
            role="menu"
            style={pos ?? { position: "fixed", visibility: "hidden" }}
          >
            {children}
          </div>,
          document.body
        )}
    </div>
  );
}

export function MenuCheckbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="menu-item" role="menuitemcheckbox" aria-checked={checked}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="menu-check" aria-hidden />
      <span className="menu-item-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="menu-section">
      <div className="menu-section-title">{title}</div>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
