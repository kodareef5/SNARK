import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { ARMOR_COVERS, armorCovers } from "../../content/items/armor-covers.ts";
import { compileContent } from "../../shared/content/registry.ts";

test("every armour piece hides the zones its set's table lists for its slot", () => {
  const reg = compileContent(CORE_CONTENT).registry!;
  let pieces = 0;
  reg.defs.forEach((d, i) => {
    if (d?.type !== "item" || !d.wear) return;
    pieces++;
    expect(Object.keys(ARMOR_COVERS), d.id).toContain(d.wear.set);
    expect(reg.wearZones[i], d.id).toBe(armorCovers(d.wear.set, d.wear.slot).reduce((m, z) => (m | (1 << z)) >>> 0, 0));
  });
  expect(pieces).toBeGreaterThan(40);
});

test("a piece's covers must name skin zones", () => {
  const def = { type: "item", class: "armor", id: "test:odd", stack: 1, color: 1, wear: { slot: "hands", armor: 1, uses: 1, set: "cloth", colors: [1, 1, 1], covers: [99] } };
  const { errors } = compileContent([...CORE_CONTENT, def as never]);
  expect(errors.join("\n")).toContain("test:odd: wear.covers lists skin zones");
});
