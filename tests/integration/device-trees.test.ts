// The device probe's tree order on a terrain server's link: the page stands in each wood on medium and high, draws each
// order in its windows, reads them back, and judges them by the server's count of its view. Beside device.test.ts and
// device-terrain.test.ts, on the page they share (tests/fixtures/device.ts).

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DeviceProbe, TREE_TIERS, WOODS } from "../../client/core/device.ts";
import { deviceTable } from "../../client/core/devicetext.ts";
import { lacking } from "../../tools/device.ts";
import { TIMING, TOKEN, browser, client, renderer, run, settle } from "../fixtures/device.ts";

test("the tree order is offered by the terrain server's link, stands in each wood on medium and high, draws each order in its windows and then reads them back, and judges them by the server's count of its view", async () => {
  const { h, pack, app, expected } = client();
  const offers = async (tests?: string): Promise<boolean> => {
    const shown = browser({ expected, ...(tests ? { tests } : {}) });
    void new DeviceProbe(TOKEN, shown.b, TIMING).before();
    await settle();
    return shown.page.text.includes('data-mode="trees"');
  };
  expect([await offers(), await offers("terrain,trees,soak,governed")]).toEqual([false, true]);
  const card = renderer();
  let reads = 0;
  card.r.readPixel = () => (reads++, [0, 0, 0]);
  const [stood, views] = [[] as number[], [] as string[]];
  const counts = TREE_TIERS.flatMap((tier) => WOODS.map((wood) => ({ wood, tier, cut: 20, front: 0.2, old: 2, first: 19.8 })));
  // The server stands the body where it is, and answers the third time it is asked that it has counted.
  const stand = (k: number): number[] => (stood.push(k), [app.session.own.x, app.session.own.z]);
  const layers = (path: string): unknown => (views.push(path), views.length < 3 ? { state: "counting" } : { state: "done", counts });
  const { b } = browser({ clock: () => h.now + card.spent(), expected, mode: "trees", tests: "terrain,trees", stand, layers });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  await probe.before();
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, card.r);
  // The order each frame was drawn in while the rung read its frames back, or did not.
  const drawn = new Set<string>();
  await run(probe, h, app, card.r, 120000, { each: () => void (probe.report.stage.startsWith("trees ") && drawn.add(`${app.scene!.cutouts} ${probe.report.stage.endsWith("read back")}`)) });
  const r = probe.report;
  expect([r.done, r.errors, r.mode, r.probes, r.gpuTests]).toEqual([true, [], "trees", null, null]);
  const t = r.trees!;
  expect(t.rungs.map((g) => `${g.wood} ${g.tier}`)).toEqual(["young medium", "elder medium", "young high", "elder high"]);
  expect(stood).toEqual([0, 1, 0, 1]);
  expect([views[0], views.length, t.counted, t.counts.length, t.view]).toEqual(["layers/390/844/70", 3, "", 4, [390, 844, 70]]);
  for (const g of t.rungs) {
    expect([g.invalid, g.orders.map((o) => `${o.order}${o.small ? " small" : ""}`)]).toEqual(["", ["last", "made", "first", "none", "first small", "none small"]]);
    for (const o of g.orders) expect([o.frames > 5, o.means.length, o.reads.length]).toEqual([!o.small, o.small ? 0 : 2, o.small || o.order === "made" ? 2 : 3]);
    // The wood as the frame's budget draws it, first and last, and its frames apart from those drawn whole.
    expect([g.budget!.frames > 5, g.budget!.means.length, g.budget!.allowed, g.budget!.tris > 0]).toEqual([true, 2, tierOf(g.tier).budget.triangles, true]);
    // At half the tier's pixel ratio, as the page sizes its canvas: 1.5 and 2 of this phone's 3.
    const half = g.tier === "medium" ? 0.75 : 1;
    expect(g.orders.filter((o) => o.small).map((o) => o.canvas)).toEqual([[Math.floor(390 * half), Math.floor(844 * half)], [Math.floor(390 * half), Math.floor(844 * half)]]);
    expect(g.verdict).not.toBe("");
  }
  expect([...drawn].sort()).toEqual(["first false", "first true", "last false", "last true", "made false", "made true", "none false", "none true"]);
  expect(reads).toBeGreaterThan(4 * 15 * 3);
  // The SURFACE pass alone was timed. This pack has no pictures, so nothing was cut out, and nothing is judged.
  expect([t.surface?.name, t.surface?.slope !== null]).toEqual(["surface", true]);
  expect(t.verdict).toStartWith("not judged: young medium nothing was drawn with its materials");
  expect(lacking(r, "trees")).toEqual(["nothing was drawn with its materials on medium, which has them", "nothing was drawn with its materials on high, which has them"]);
  // After it the game draws its cut-outs last again, and its frame within its budget.
  expect([app.scene!.cutouts, app.scene!.budget.on]).toEqual(["last", true]);
  expect(t.budget).toStartWith("the budget: the young wood on medium ");
  const table = deviceTable(r);
  expect(table.some((line) => line.startsWith("verdict   "))).toBe(true);
  expect(table.some((line) => /^elder +high +made +\d+ /.test(line))).toBe(true);
});
