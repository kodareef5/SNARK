import { expect, test } from "bun:test";
import { HUD_WIDGETS } from "../../client/core/hud/widgets.ts";
import { WIDGET_OWNER, baseKey } from "../../client/core/ui/nodes.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { clashes, drawer, walkHudStates } from "../fixtures/hud-states.ts";

const inside = (bands: readonly { from: number; count: number }[], key: number): boolean =>
  bands.some((b) => key >= b.from && key < b.from + b.count);

test("No two widgets, and no widget and screen, have key bands that meet", () => {
  const all = [
    ...HUD_WIDGETS.flatMap((w) => w.bands.map((b) => ({ ...b, name: "widget " + w.name }))),
    ...new Ui().screens.flatMap((s) => s.bands.map((b) => ({ ...b, name: "screen " + s.name }))),
  ].sort((a, b) => a.from - b.from);
  for (let i = 1; i < all.length; i++) {
    expect(all[i]!.from, `${all[i]!.name} meets ${all[i - 1]!.name}`).toBeGreaterThanOrEqual(all[i - 1]!.from + all[i - 1]!.count);
  }
});

test("Every HUD state draws each key once, and each widget inside its bands", () => {
  const problems: string[] = [];
  let states = 0;
  walkHudStates((app, state) => {
    states++;
    const nodes = app.ui.frame.nodes.slice(0, app.ui.frame.count);
    for (const c of clashes(app, nodes)) problems.push(`${state}: ${c}`);
    for (const n of nodes) {
      if (n.owner > WIDGET_OWNER) continue;
      const w = HUD_WIDGETS[WIDGET_OWNER - n.owner]!;
      if (!inside(w.bands, baseKey(n.key))) problems.push(`${state}: ${drawer(app, n)} drew ${n.key} outside its bands`);
    }
  });
  expect(states).toBeGreaterThan(20);
  expect([...new Set(problems)]).toEqual([]);
});
