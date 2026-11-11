"use client";

import { useState } from "react";
import { useLayoutStore, MAX_SAVED_LAYOUTS } from "@/lib/store/layoutStore";
import { GRID_PRESETS } from "@/lib/layout/gridPanels";
import { Icon } from "@/components/ui/Icons";
import { Menu, MenuSection, Segmented } from "@/components/ui/Primitives";

// Layout mode, presets and saved layouts. Saved layouts persist in this
// browser; the working grid is saved automatically as it changes.

export default function LayoutMenu() {
  const mode = useLayoutStore((s) => s.mode);
  const editing = useLayoutStore((s) => s.editing);
  const saved = useLayoutStore((s) => s.saved);
  const activeId = useLayoutStore((s) => s.activeId);
  const dirty = useLayoutStore((s) => s.dirty);
  const setMode = useLayoutStore((s) => s.setMode);
  const setEditing = useLayoutStore((s) => s.setEditing);
  const applyPreset = useLayoutStore((s) => s.applyPreset);
  const saveAs = useLayoutStore((s) => s.saveAs);
  const saveActive = useLayoutStore((s) => s.saveActive);
  const load = useLayoutStore((s) => s.load);
  const remove = useLayoutStore((s) => s.remove);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const active = saved.find((s) => s.id === activeId);
  const isGrid = mode === "grid";

  const submit = () => {
    if (!name.trim()) return setError("Give the layout a name");
    const exists = saved.some((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (!exists && saved.length >= MAX_SAVED_LAYOUTS) return setError(`Up to ${MAX_SAVED_LAYOUTS} layouts; delete one first`);
    saveAs(name);
    setName("");
    setError(null);
  };

  return (
    <Menu
      hint="Layout"
      label={
        <>
          <Icon.Grid />
          <span className="hide-compact">{isGrid ? (active ? active.name : "Grid") : "Layout"}</span>
          {isGrid && dirty && <span className="layout-dirty" aria-label="Unsaved changes" />}
        </>
      }
    >
      <div className="layout-menu">
        <div className="layout-menu-row">
          <Segmented
            size="xs"
            value={mode}
            onChange={setMode}
            options={[
              { value: "classic", label: "Classic", title: "Fixed terminal layout" },
              { value: "grid", label: "Grid", title: "Your own arrangement of panels" },
            ]}
            ariaLabel="Layout mode"
          />
          {isGrid && (
            <button type="button" className={`ui-button chip ${editing ? "is-active" : ""}`} onClick={() => setEditing(!editing)}>
              {editing ? "Done editing" : "Edit layout"}
            </button>
          )}
        </div>

        {isGrid && (
          <>
            <MenuSection title="Start from a preset">
              <div className="layout-presets">
                {GRID_PRESETS.map((preset) => (
                  <button key={preset.id} type="button" className="layout-preset" onClick={() => applyPreset(preset.id)} title={`${preset.description}. Replaces the current grid.`}>
                    <PresetThumb layout={preset.layout} />
                    <span>{preset.name}</span>
                  </button>
                ))}
              </div>
            </MenuSection>

            <MenuSection title={`Saved layouts · ${saved.length}/${MAX_SAVED_LAYOUTS}`}>
              {saved.length === 0 && <div className="layout-empty">Save the current grid to switch back to it later.</div>}
              {saved.map((entry) => (
                <div key={entry.id} className={`layout-saved ${entry.id === activeId ? "is-active" : ""}`}>
                  <button type="button" className="layout-saved-load" onClick={() => load(entry.id)}>
                    <PresetThumb layout={entry.layout} />
                    <span className="layout-saved-name">{entry.name}</span>
                    {entry.id === activeId && <small>{dirty ? "edited" : "in use"}</small>}
                  </button>
                  <button type="button" className="layout-saved-delete" aria-label={`Delete ${entry.name}`} title="Delete" onClick={() => remove(entry.id)}>
                    <Icon.Close />
                  </button>
                </div>
              ))}
              {active && dirty && (
                <button type="button" className="ui-button chip is-primary layout-update" onClick={saveActive}>
                  Save changes to “{active.name}”
                </button>
              )}
            </MenuSection>

            <form
              className="layout-save"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                value={name}
                maxLength={32}
                placeholder="Name this layout"
                aria-label="Layout name"
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
              />
              <button type="submit" className="ui-button chip">Save as</button>
            </form>
            {error && <div className="layout-error">{error}</div>}
            <div className="layout-footnote">Layouts are stored in this browser. Your current grid is kept automatically.</div>
          </>
        )}
      </div>
    </Menu>
  );
}

/** Miniature of a layout on a 12×24 grid. */
function PresetThumb({ layout }: { layout: readonly { i: string; x: number; y: number; w: number; h: number }[] }) {
  const rows = Math.max(24, ...layout.map((item) => item.y + item.h));
  return (
    <svg className="layout-thumb" viewBox={`0 0 12 ${rows}`} preserveAspectRatio="none" aria-hidden>
      {layout.map((item) => (
        <rect
          key={item.i}
          x={item.x + 0.25}
          y={item.y + 0.4}
          width={item.w - 0.5}
          height={item.h - 0.8}
          rx={0.6}
          className={item.i === "footprint" ? "is-main" : ""}
        />
      ))}
    </svg>
  );
}
