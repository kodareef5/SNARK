import { expect, test } from "bun:test";
import { CAST_CATALOGUE } from "../../content/cast/index.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { validateCatalogue, type Catalogue, type Known } from "../../shared/cast/catalogue.ts";
import { EMOTES } from "../../shared/anim/emotes.ts";
import { compileContent } from "../../shared/content/registry.ts";

function known(): Known {
  const reg = compileContent(CORE_CONTENT).registry!;
  const defs = reg.defs.filter((d) => d !== undefined && d !== null);
  return {
    emotes: new Set(EMOTES.map((e) => e.id)),
    items: new Set(defs.filter((d) => d.type === "item").map((d) => d.id)),
    species: new Set(defs.filter((d) => d.type === "species").map((d) => d.id)),
  };
}

test("the catalogue is sound against the game's own emotes, items and species", () => {
  expect(validateCatalogue(CAST_CATALOGUE, known())).toEqual([]);
});

test("the catalogue has a working example of every kind the foundation promises", () => {
  const c = CAST_CATALOGUE;
  const live = c.scenes.filter((s) => s.weight > 0);
  // Singles, couples, groups, a crowd, a queue, a flash mob, a patrol, a hostile scene and a car.
  expect(live.some((s) => s.roles.length === 1 && s.roles[0]!.count[1] === 1)).toBe(true);
  expect(live.some((s) => s.roles.length === 2 && s.tags.includes("social"))).toBe(true);
  expect(live.some((s) => s.roles.some((r) => r.count[1] >= 3 && r.count[1] < 20))).toBe(true);
  expect(live.some((s) => s.tags.includes("crowd") && s.roles.some((r) => r.count[1] >= 200))).toBe(true);
  expect(live.some((s) => s.needs.includes("queue"))).toBe(true);
  expect(live.some((s) => Object.values(s.script).some((steps) => steps.some((st) => st.do === "sync")) && s.tags.includes("crowd"))).toBe(true);
  expect(live.some((s) => s.roles.some((r) => r.archetypes.includes("cast:cop")))).toBe(true);
  expect(live.some((s) => s.hostile)).toBe(true);
  expect(live.some((s) => s.needs.includes("drive"))).toBe(true);
  // Violence is answered: some rows call the police, some watch from a way off, some freeze; police come only to trouble.
  const rows = c.reactions.flatMap((t) => t.rows);
  for (const r of ["call_cop", "watch", "cower", "flee"]) expect([r, rows.some((x) => x.do === r)]).toEqual([r, true]);
  for (const on of ["fight", "gunshot", "danger"]) expect([on, c.reactions.every((t) => t.rows.some((x) => x.on === on))]).toEqual([on, true]);
  expect(c.scenes.find((s) => s.id === "cast:police_response")!.weight).toBe(0);
  // The pick-up's friend rides away in the car.
  expect(c.scenes.find((s) => s.id === "cast:drive_to_meet")!.script.friend!.some((st) => st.do === "ride")).toBe(true);
  // Every look waits for its own art, and says what it should be.
  expect(c.looks.every((l) => l.placeholder && l.note)).toBe(true);
});

test("a broken catalogue is told plainly", () => {
  const bad: Catalogue = {
    looks: [{ id: "cast:x", mesh: "core:human", wear: ["core:nothing"] }],
    archetypes: [{ id: "cast:a", name: "A", tier: "extra", species: "core:unicorn", looks: ["cast:gone"], names: "none", lines: {}, reactions: "cast:r", wants: [], struggles: [], hopes: [] }],
    scenes: [{
      id: "cast:s", name: "S", about: "", roles: [{ role: "r", archetypes: ["cast:a"], count: [1, 1] }, { role: "q", archetypes: ["cast:a"], count: [1, 1] }], place: { tags: ["beach"] },
      script: { r: [{ do: "sync", name: "x" }, { do: "say", line: "hi" }, { do: "emote", emote: "moonwalk" }, { do: "goto", to: { role: "nobody" } }], q: [{ do: "leave", when: { mood: "glad" } }] },
      tags: ["calm"], needs: ["drive"], weight: 1, cooldown: 0, most: 10, hostile: true,
    }],
    reactions: [{ id: "cast:r", rows: [{ on: "talk", do: "say" }] }],
    names: {},
  };
  const out = validateCatalogue(bad, known());
  for (const want of ["wears core:nothing", "species core:unicorn", "look cast:gone", "name pool none", "ends with leave", "has no lines for hi", "moonwalk is no emote", "role nobody", "mood=glad", "sync x", "tagged hostile", "tagged vehicle", "say needs a line"]) {
    expect(out.some((l) => l.includes(want))).toBe(true);
  }
});
