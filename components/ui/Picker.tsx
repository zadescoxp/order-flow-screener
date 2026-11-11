"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icons";

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  sub?: string;
  icon?: ReactNode;
  disabled?: boolean;
  keywords?: string;
  group?: string; // consecutive options with the same group get one heading
  trailing?: ReactNode; // right-aligned detail, e.g. venue count
}

const compact = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Case-insensitive search that also ignores separators, so "xauusd",
 * "XAU/USD", "eur usd" and "eur-usd" all match the same option. Every
 * whitespace-separated word must match somewhere.
 */
export function matchesSearch(query: string, haystack: string): boolean {
  const text = haystack.toLowerCase();
  const textCompact = compact(haystack);
  const whole = compact(query);
  if (whole && textCompact.includes(whole)) return true;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => text.includes(word) || (compact(word) !== "" && textCompact.includes(compact(word))));
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
    if (!query.trim()) return options;
    return options.filter((o) => matchesSearch(query, `${o.label} ${o.sub ?? ""} ${o.keywords ?? ""}`));
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
                // Focus on open so the first keystroke lands in the search.
                autoFocus
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
              <Fragment key={option.value}>
              {option.group && option.group !== filtered[index - 1]?.group && (
                <div className="picker-group" role="presentation">{option.group}</div>
              )}
              <button
                type="button"
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
                {option.trailing && <span className="picker-trailing">{option.trailing}</span>}
                {option.value === value && <span className="picker-check" aria-hidden>●</span>}
              </button>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
