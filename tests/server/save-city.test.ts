// A city that broke is saved as what differs from the map: each form, each heap and each piece's health, wear told to
// no client included.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Source } from "../../server/combat.ts";
import { FORM_BREACH_A, FORM_HEAP, FORM_OPEN, FORM_WHOLE } from "../../shared/content/breaks.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { GRENADE_REACH, city, grenade, rifle, rocket } from "../fixtures/city.ts";
import { Harness } from "../fixtures/net.ts";
import { record, survivor } from "../kit/kit.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-savecity-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Each slot of each chunk as a save keeps it: its kind, owner and health, an emptied map slot as kind 0. */
function tables(structs: StructureStore): Record<number, number[][]> {
  const out: Record<number, number[][]> = {};
  for (const c of structs.held) {
    const t = structs.chunks[c]!;
    out[c] = Array.from({ length: t.high }, (_, s) => [s, t.kind[s]!, t.owner[s]!, t.hp[s]!]);
  }
  return out;
}

test("a saved world loads to the same forms, heaps and health", () => {
  const db = join(dir, "city.db");
  const c = city([
    { shape: "wall8", finish: "limestucco", x: 100, z: 100 }, { shape: "wall8", finish: "limestucco", x: 120, z: 100 }, { shape: "wall8", finish: "limestucco", x: 140, z: 100 },
    { shape: "wall8", finish: "limestucco", x: 160, z: 100, up: 9 }, { shape: "wall8", finish: "concrete", x: 100, z: 140 }, { shape: "zwin", finish: "limestucco", x: 140, z: 140 },
    { shape: "wall4", finish: "limestucco", x: 180, z: 140 }, { shape: "wall8", finish: "concrete", x: 200, z: 200 },
  ], 4, { dbPath: db });
  const [breached, opened, heaped, gone, worn, window, mined, untouched] = c.refs as [number, number, number, number, number, number, number, number];
  const { h } = c;
  const huge = { ...rocket(h.reg), base: 1e7 };
  const blast = (ref: number, times: number): void => {
    const p = c.at(ref);
    for (let k = 0; k < times; k++) h.host.combat.blast(huge, p.x - 2, p.y, p.z - 0.5, 3);
  };
  blast(breached, 1);
  blast(opened, 2);
  blast(heaped, 3);
  blast(gone, 3);
  blast(mined, 3);
  // Wear within a stage and a bullet into glass: told to no client, and saved all the same.
  h.host.combat.blast(grenade(h.reg), 100, 1.4, 139.5, GRENADE_REACH);
  h.host.combat.hitStructure(rifle(h.reg), window, 140, 2, 140);
  const ada = record(h, survivor(h, "ada"));
  const pick: Source = { by: ada, x: 180, z: 139, item: h.reg.index.get("core:pick")!, base: 16, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 };
  for (let k = 0; k < 3; k++) h.host.combat.hitStructure(pick, mined, 180, 1, 140);
  expect([c.form(breached), c.form(opened), c.form(heaped), c.id(gone), c.form(worn), c.form(window), c.form(mined), c.hp(mined)]).toEqual([FORM_BREACH_A, FORM_OPEN, FORM_HEAP, "", FORM_WHOLE, FORM_WHOLE, FORM_HEAP, 15]);
  expect([c.hp(worn) < c.full(worn), c.hp(window)]).toEqual([true, 9720]);
  h.run(2500);
  const before = tables(h.world.structs);
  const store = h.host.persistence!.store;
  const rows = store.db.query("SELECT chunk, length(data) AS n FROM chunk_structs ORDER BY chunk").all() as { chunk: number; n: number }[];
  // Only chunks that differ from the map are saved, the one worn in silence among them, and each in a few bytes a slot.
  const changed = h.world.structs.held.filter((k) => !h.world.structs.asPlaced(k));
  expect(rows.map((r) => r.chunk)).toEqual(changed);
  expect(changed.includes(Math.floor(worn / 65536)) && !changed.includes(Math.floor(untouched / 65536))).toBe(true);
  expect(rows.reduce((n, r) => n + r.n, 0)).toBeLessThan(120);
  h.host.shutdown();

  const again = new Harness({}, 1, 30, { dev: true, dbPath: db, map: c.map });
  expect(tables(again.world.structs)).toEqual(before);
  // The loaded world goes on from there: the worn wall's next hits count from its saved health.
  const t = again.world.structs.chunks[Math.floor(worn / 65536)]!;
  const was = t.hp[worn & 0xffff]!;
  again.host.combat.blast(grenade(again.reg), 100, 1.4, 139.5, GRENADE_REACH);
  expect(was - t.hp[worn & 0xffff]!).toBeCloseTo(788 * 2.33, 0);
  again.host.shutdown();
});

test("a salvaged wreck is saved as what differs from the map, and is salvaged on from there", () => {
  const db = join(dir, "wrecks.db");
  const kind = "core:compact_abandoned_white";
  const c = city([{ kind, x: 40, z: 40 }, { kind, x: 40, z: 200 }, { kind, x: 200, z: 40 }, { kind, x: 200, z: 200 }], 4, { dbPath: db });
  const [stripped, worn, taken, untouched] = c.refs as [number, number, number, number];
  const { h } = c;
  const pick = (on: Harness): Source => ({ by: record(on, survivor(on, "ada")), x: 0, z: 0, item: on.reg.index.get("core:pick_metal")!, base: 32, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 });
  const src = pick(h);
  const blows = (ref: number, n: number): void => { for (let k = 0; k < n; k++) h.host.combat.hitStructure(src, ref, c.at(ref).x, 0.5, c.at(ref).z); };
  blows(stripped, 8);
  blows(worn, 3);
  blows(taken, 24);
  expect([c.id(stripped), c.id(worn), Math.round(c.hp(worn)), c.id(taken)]).toEqual(["core:zzzzzzzwreck_compact_abandoned_stripped", kind, 7000, ""]);
  h.run(2500);
  const before = tables(h.world.structs);
  const rows = h.host.persistence!.store.db.query("SELECT chunk, length(data) AS n FROM chunk_structs ORDER BY chunk").all() as { chunk: number; n: number }[];
  // A chunk a wreck: the three that differ are saved, in a few bytes each.
  expect(rows.map((r) => r.chunk)).toEqual([stripped, worn, taken].map((ref) => Math.floor(ref / 65536)).sort((a, b) => a - b));
  expect(rows.every((r) => r.n < 16) && !rows.some((r) => r.chunk === Math.floor(untouched / 65536))).toBe(true);
  h.host.shutdown();

  const again = new Harness({}, 1, 30, { dev: true, dbPath: db, map: c.map });
  expect(tables(again.world.structs)).toEqual(before);
  // Blows told to nobody were kept: five more strip the worn one.
  const more = pick(again);
  for (let k = 0; k < 5; k++) again.host.combat.hitStructure(more, worn, 40, 0.5, 200);
  const t = again.world.structs.chunks[Math.floor(worn / 65536)]!;
  expect(again.reg.ids[t.kind[worn & 0xffff]!]).toBe("core:zzzzzzzwreck_compact_abandoned_stripped");
  again.host.shutdown();
});
