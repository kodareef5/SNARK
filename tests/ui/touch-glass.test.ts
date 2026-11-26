import { expect, test } from "bun:test";
import type { Pen } from "../../client/core/ui/nodes.ts";
import { glass, paintFan, paintPlate, paintShelf, paintWheel, repaint, turn, type FanView } from "../../client/core/ui/touch-glass.ts";

/** A pen that counts what it is asked to draw. */
function pen(): { pen: Pen; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const count = (name: string) => (..._: unknown[]) => { calls[name] = (calls[name] ?? 0) + 1; return { addColorStop() {} }; };
  const target = { fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, globalCompositeOperation: "source-over" } as Record<string, unknown>;
  return { calls, pen: new Proxy(target, { get: (t, name: string) => name in t ? t[name] : count(name) }) as unknown as Pen };
}

test("The wheel paints a cell for each station and lights one, shut or open", () => {
  for (const reveal of [0, 1]) for (const count of [3, 6, 7]) {
    const { pen: p, calls } = pen();
    paintWheel(p, 144, count, .3, reveal);
    expect(calls.fill).toBeGreaterThan(count);
    expect(p.globalAlpha).toBe(1);
  }
});

test("The fan paints shut, open and nested, with three leaves or four", () => {
  const view: FanView = { width: 228, height: 380, rootR: 106, openness: 0, level: 0, families: 3, rootPhase: 0, leaves: 3, leafPhase: 0, depth: -1, group: 0 };
  const strokes = (v: FanView): number => { const { pen: p, calls } = pen(); paintFan(p, v); expect(p.globalAlpha).toBe(1); return calls.stroke ?? 0; };
  const shut = strokes(view), open = strokes({ ...view, openness: 1, depth: 0 });
  const nested = strokes({ ...view, openness: 1, level: 1, depth: 1, leaves: 4, leafPhase: 1.4 });
  expect(open).toBeGreaterThan(shut);
  expect(nested).toBeGreaterThan(open);
});

test("A picture is painted again only when what it shows changes", () => {
  const g = glass();
  repaint(g, 100, 18, "a", (c) => paintShelf(c, 100, 18));
  const first = g.image.version;
  repaint(g, 100, 18, "a", (c) => paintShelf(c, 100, 18));
  expect(g.image.version).toBe(first);
  repaint(g, 120, 8, "b", (c) => paintPlate(c, 120, 8, .2, .1));
  expect([g.image.version, g.image.width, g.image.height]).toEqual([first + 1, 240, 16]);
  const { pen: p, calls } = pen();
  g.image.paint!(p);
  expect(calls.scale).toBe(1);
  expect(p.globalCompositeOperation).toBe("source-over");
});

test("A ring turns the short way round", () => {
  expect([turn(0, 9, 10), turn(9, 0, 10), turn(1, 3, 7), turn(6.6, 0, 7)]).toEqual([-1, 1, 2, expect.closeTo(.4, 5)]);
});
