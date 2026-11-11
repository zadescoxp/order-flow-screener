/**
 * @jest-environment node
 */
import { useLayoutStore, MAX_SAVED_LAYOUTS } from "@/lib/store/layoutStore";
import { GRID_PRESETS } from "@/lib/layout/gridPanels";

const initial = useLayoutStore.getState();
beforeEach(() => useLayoutStore.setState(initial, true));

describe("layout store", () => {
  it("adds a panel into free space and removes it again", () => {
    const store = useLayoutStore.getState();
    store.applyPreset("scalper");
    store.addPanel("cvd");
    const added = useLayoutStore.getState().layout.find((i) => i.i === "cvd");
    expect(added).toBeDefined();
    store.addPanel("cvd"); // no duplicates
    expect(useLayoutStore.getState().layout.filter((i) => i.i === "cvd")).toHaveLength(1);
    store.removePanel("cvd");
    expect(useLayoutStore.getState().layout.some((i) => i.i === "cvd")).toBe(false);
  });

  it("saves, tracks changes, overwrites by name and loads layouts", () => {
    const store = useLayoutStore.getState();
    store.applyPreset("focus");
    const id = store.saveAs("  My   desk ")!;
    expect(useLayoutStore.getState().saved[0]).toMatchObject({ id, name: "My desk" });
    expect(useLayoutStore.getState().dirty).toBe(false);

    store.removePanel("volumeZ");
    expect(useLayoutStore.getState().dirty).toBe(true);
    expect(store.saveAs("my desk")).toBe(id); // same name, case-insensitive: overwrite
    expect(useLayoutStore.getState().saved).toHaveLength(1);
    expect(useLayoutStore.getState().dirty).toBe(false);

    store.applyPreset("order-flow");
    store.load(id);
    const state = useLayoutStore.getState();
    expect(state.mode).toBe("grid");
    expect(state.layout.map((i) => i.i).sort()).toEqual(["cvd", "footprint"]);
  });

  it("rejects empty names and caps the number of saved layouts", () => {
    const store = useLayoutStore.getState();
    expect(store.saveAs("   ")).toBeNull();
    for (let n = 0; n < MAX_SAVED_LAYOUTS; n++) expect(store.saveAs(`Layout ${n}`)).not.toBeNull();
    expect(store.saveAs("One too many")).toBeNull();
  });

  it("deleting the active layout keeps the working copy", () => {
    const store = useLayoutStore.getState();
    store.applyPreset(GRID_PRESETS[1].id);
    const id = store.saveAs("Liquidity copy")!;
    store.remove(id);
    const state = useLayoutStore.getState();
    expect(state.saved).toHaveLength(0);
    expect(state.activeId).toBeNull();
    expect(state.layout.length).toBe(GRID_PRESETS[1].layout.length);
  });
});
