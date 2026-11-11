import { badgePosition, badgeSize, badgeStyle, drawVenueBadge, MIN_TRADE_BADGE_RADIUS, selectBadged } from "@/lib/render/venueBadges";
import type { Palette } from "@/hooks/useCanvas";

const palette = { bgPanel: "#111215" } as Palette;

function fakeContext() {
  const calls: { method: string; args: unknown[]; fillStyle?: unknown }[] = [];
  const ctx: Record<string, unknown> = { fillStyle: "", font: "", textAlign: "", textBaseline: "" };
  for (const method of ["save", "restore", "beginPath", "arc", "roundRect", "fill", "clip", "drawImage", "fillText"]) {
    ctx[method] = (...args: unknown[]) => calls.push({ method, args, fillStyle: ctx.fillStyle });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("venue badges", () => {
  it("keeps badges large enough to recognise and caps them on big bubbles", () => {
    expect(badgeSize(3)).toBe(18);
    expect(badgeSize(14)).toBe(21);
    expect(badgeSize(200)).toBe(24);
  });

  it("maps venue ids to brand styles without white tiles", () => {
    for (const venue of ["binance-futures", "bybit-spot", "okx-futures", "bitget-spot", "coinbase-spot", "deribit", "hyperliquid"]) {
      expect(badgeStyle(venue).tile.toLowerCase()).not.toBe("#ffffff");
    }
    expect(badgeStyle("binance-spot")).toBe(badgeStyle("binance-futures"));
    expect(badgeStyle("deribit").glyph).toBe("/venues/mono/deribit.png");
  });

  it("pins the badge to the bubble's top-right edge", () => {
    const { ctx } = fakeContext();
    const hit = drawVenueBadge(ctx, "deribit", 100, 100, 10, palette);
    expect(hit.x).toBeGreaterThan(100);
    expect(hit.y).toBeLessThan(100);
    expect(hit.r).toBeGreaterThan(badgeSize(10) / 2);
  });

  it("badges liquidations first and never overlaps badges", () => {
    const bubbles = [
      { id: "small-print", x: 10, y: 10, r: MIN_TRADE_BADGE_RADIUS - 1, kind: "trade" as const },
      { id: "big-print", x: 100, y: 100, r: 12, kind: "trade" as const },
      { id: "liq", x: 102, y: 101, r: 6, kind: "liquidation" as const },
      { id: "far-print", x: 300, y: 100, r: 9, kind: "trade" as const },
    ];
    const chosen = selectBadged(bubbles).map((b) => b.id);
    // The small print is below the size threshold; the big print's badge
    // would collide with the liquidation's, which takes priority.
    expect(chosen).toEqual(["liq", "far-print"]);

    const spots = selectBadged(bubbles).map((b) => badgePosition(b.x, b.y, b.r));
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y)).toBeGreaterThanOrEqual(spots[i].r + spots[j].r);
      }
    }
  });

  it.each([
    ["hyperliquid", "H"],
    ["deribit", "D"],
  ])("draws a letter for %s when no glyph is available yet", (venue, letter) => {
    const { ctx, calls } = fakeContext();
    drawVenueBadge(ctx, venue, 50, 50, 6, palette);
    expect(calls.some((c) => c.method === "drawImage")).toBe(false);
    expect(calls.find((c) => c.method === "fillText")?.args[0]).toBe(letter);
  });
});
