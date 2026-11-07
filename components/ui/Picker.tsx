"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icons";

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  sub?: string;
  icon?: ReactNode;
  disabled?: boolean;
  keywords?: string;
}

/** Pill button that opens a searchable list; replaces native selects where options need icons. */
export function Picker<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  searchable = false,
  className = "",
  renderValue,
  width = 280,
}: {
  value: T;
  options: PickerOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  searchable?: boolean;
  className?: string;
  renderValue?: (option: PickerOption<T> | undefined) => ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.sub ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    requestAnimationFrame(() => input.current?.focus());
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (option: PickerOption<T> | undefined) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const toggle = () => {
    if (!open) {
      setQuery("");
      setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    }
    setOpen((v) => !v);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") { setOpen(false); event.preventDefault(); }
    else if (event.key === "ArrowDown") { setActive((i) => Math.min(filtered.length - 1, i + 1)); event.preventDefault(); }
    else if (event.key === "ArrowUp") { setActive((i) => Math.max(0, i - 1)); event.preventDefault(); }
    else if (event.key === "Enter") { choose(filtered[active]); event.preventDefault(); }
  };

  return (
    <div className="picker" ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        className={`ui-button picker-button ${className} ${open ? "is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${current?.label ?? value}`}
        onClick={toggle}
      >
        {renderValue ? renderValue(current) : (
          <>
            {current?.icon}
            <span className="picker-label">{current?.label ?? value}</span>
          </>
        )}
        <span className="picker-chevron"><Icon.Chevron /></span>
      </button>
      {open && (
        <div className="picker-popover" style={{ width }} role="dialog" aria-label={ariaLabel}>
          {searchable && (
            <label className="picker-search">
              <Icon.Search />
              <input
                ref={input}
                value={query}
                placeholder="Search"
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                aria-label={`Search ${ariaLabel.toLowerCase()}`}
              />
              <kbd>esc</kbd>
            </label>
          )}
          <div className="picker-list" role="listbox" ref={list} aria-label={ariaLabel}>
            {filtered.length === 0 && <div className="picker-empty">No matches</div>}
            {filtered.map((option, index) => (
              <button
                type="button"
                key={option.value}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={`picker-option ${index === active ? "is-active" : ""} ${option.value === value ? "is-selected" : ""}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                {option.icon}
                <span className="picker-option-text">
                  <span>{option.label}</span>
                  {option.sub && <small>{option.sub}</small>}
                </span>
                {option.value === value && <span className="picker-check" aria-hidden>●</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
