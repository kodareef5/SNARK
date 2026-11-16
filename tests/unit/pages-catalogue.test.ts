import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { buildCatalogue, buildServers } from "../../tools/pages/catalogue.ts";

const catalogue = buildCatalogue();

test("public catalogue covers supported game definitions and every relationship resolves", () => {
  const supported = CORE_CONTENT.filter((d) => d.type === "species" || d.type === "item" || d.type === "engram" || d.type === "structure");
  expect(catalogue.map((d) => d.id).sort()).toEqual(supported.map((d) => d.id).sort());
  const ids = new Set(catalogue.map((e) => e.id));
  for (const entry of catalogue) {
    expect(entry.label.length).toBeGreaterThan(0);
    expect(entry.facts.every((f) => !f.value.includes("undefined") && !f.value.includes("NaN"))).toBe(true);
    for (const relation of entry.links) expect(ids.has(relation.id)).toBe(true);
  }
  expect(catalogue.find((d) => d.id === "core:pteranodon")?.modelId).toBe("core:pteranodon");
  expect(catalogue.find((d) => d.id === "core:compact")?.kind).toBe("vehicles");
  expect(catalogue.find((d) => d.id === "core:survivor")?.kind).toBe("characters");
});

test("adding an item and engram creates facts, ingredient backlinks and an unlock without wiki edits", () => {
  const added: Def[] = [
    { type: "item", class: "resource", id: "guide:alloy", label: "test alloy", stack: 25, weight: 2, craft: { needs: [{ item: "core:wood", count: 3 }], seconds: 4, xp: 1 } },
    { type: "engram", id: "guide:learn_alloy", label: "test alloy", item: "guide:alloy", cost: 3, level: 2 },
  ];
  const entries = buildCatalogue([...CORE_CONTENT, ...added]);
  const alloy = entries.find((d) => d.id === "guide:alloy")!;
  expect(alloy.facts).toContainEqual({ label: "Weight", value: "2", unit: "kg" });
  expect(alloy.links).toContainEqual({ id: "core:wood", label: "Wood", relation: "Needs 3" });
  expect(alloy.links).toContainEqual({ id: "guide:learn_alloy", label: "Test Alloy", relation: "Unlocked by" });
  expect(entries.find((d) => d.id === "core:wood")!.links).toContainEqual({ id: "guide:alloy", label: "Test Alloy", relation: "Used to craft" });
});

test("default server previews show known defaults without pretending to know players or capacity", () => {
  const servers = buildServers();
  expect(servers.length).toBe(CORE_CONTENT.filter((d) => d.type === "map").length);
  for (const s of servers) {
    expect([s.sampledAt, s.capacity]).toEqual([null, null]);
    expect(s.players).toEqual([]);
    expect(s.settings.some((r) => r.key === "TamingSpeedMultiplier" && r.value === r.default)).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/ServerPassword|AdminPassword|RCON|savePath|accountId/);
  }
});
