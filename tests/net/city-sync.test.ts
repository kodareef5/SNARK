// What a client is told of a city that breaks: nothing of wear within a stage, a stage as health alone, a form as its
// kind in place, and a blast as one batch a chunk.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import type { Source } from "../../server/combat.ts";
import { FORM_BREACH_A, FORM_HEAP, FORM_OPEN, FORM_WHOLE } from "../../shared/content/breaks.ts";
import { S_CHUNK } from "../../shared/net/protocol.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { STAGE_WHOLE, STAGE_WORN, heapHealth, stageOf } from "../../shared/world/breaking.ts";
import { GONE_BLAST, type StructureStore } from "../../shared/world/structures.ts";
import { GRENADE_REACH, ROCKET_REACH, city, grenade, rifle, rocket, type City } from "../fixtures/city.ts";
import { record } from "../kit/kit.ts";

/** Slots of `chunks` that differ between the two stores: in kind, place, turn or owner, and in health too if `health`. */
function differ(structs: StructureStore, held: StructureStore, chunks: readonly number[], health = true): number {
  let n = 0;
  for (const c of chunks) {
    const [t, u] = [structs.chunks[c]!, held.chunks[c]];
    if (!u) return Infinity;
    for (let s = 0; s < Math.max(t.high, u.high); s++) {
      const kind = t.kind[s] ?? 0;
      const cols = health ? [t.x, t.y, t.z, t.yaw, t.owner, t.hp] : [t.x, t.y, t.z, t.yaw, t.owner];
      const theirs = health ? [u.x, u.y, u.z, u.yaw, u.owner, u.hp] : [u.x, u.y, u.z, u.yaw, u.owner];
      if (kind !== (u.kind[s] ?? 0) || (kind !== 0 && cols.some((col, i) => col[s] !== theirs[i]![s]))) n++;
    }
  }
  return n;
}

/** The chunk messages session `i` has been sent since the last call, as their sizes in bytes. */
function watch(c: City, i: number): () => number[] {
  const end = c.h.ends[i]!;
  const on = end.onMessage!;
  let sizes: number[] = [];
  end.onMessage = (ch, d) => {
    if (d[0] === S_CHUNK) sizes.push(d.length);
    on(ch, d);
  };
  return () => {
    const out = sizes;
    sizes = [];
    return out;
  };
}

/** The chunks of the server's store, once `s` holds each at its version. */
function settled(c: City, s: ClientSession): number[] {
  const structs = c.h.world.structs;
  const whole = (): boolean => structs.held.every((k) => c.h.client(s)?.known[k] === structs.chunks[k]!.version);
  for (let n = 0; n < 100 && !whole(); n++) c.h.run(100);
  expect(whole()).toBe(true);
  c.h.run(300);
  return [...structs.held];
}

const huge = (c: City) => ({ ...rocket(c.h.reg), base: 1e7 });
const sum = (sizes: number[]): number => sizes.reduce((a, b) => a + b, 0);

test("a grenade's wear reaches no client, and a stage crossing is health alone", () => {
  const c = city([{ shape: "wall8", finish: "concrete", x: 120, z: 120 }]);
  const wall = c.refs[0]!;
  const { h } = c;
  const ada = h.join("ada");
  const chunks = settled(c, ada);
  const sent = watch(c, 0);
  const theirs = (): { kind: number; hp: number } => {
    const t = ada.world!.structs.chunks[Math.floor(wall / 65536)]!;
    return { kind: t.kind[wall & 0xffff]!, hp: t.hp[wall & 0xffff]! };
  };
  const kind = h.world.structs.mapKind(Math.floor(wall / 65536), wall & 0xffff);
  for (let k = 0; k < 4; k++) {
    h.host.combat.blast(grenade(h.reg), 120, 1.4, 119.5, GRENADE_REACH);
    h.run(200);
  }
  // Four grenades in, the server's wall is worn by 7,344 and the client has been sent nothing: its health is the map's.
  expect([sent(), theirs().hp, stageOf(h.reg, kind, c.hp(wall))]).toEqual([[], 23400, STAGE_WHOLE]);
  expect(c.hp(wall)).toBeCloseTo(23400 - 4 * 788 * 2.33, 0);
  // Its stage is the server's all the same.
  expect(stageOf(h.reg, kind, theirs().hp)).toBe(stageOf(h.reg, kind, c.hp(wall)));
  h.host.combat.blast(grenade(h.reg), 120, 1.4, 119.5, GRENADE_REACH);
  h.run(200);
  const sizes = sent();
  // The fifth takes it under two thirds: one message, its health alone in place.
  expect([sizes.length, sizes[0]! <= 16, theirs().hp, theirs().kind, stageOf(h.reg, kind, theirs().hp)]).toEqual([1, true, c.hp(wall), kind, STAGE_WORN]);
  expect(differ(h.world.structs, ada.world!.structs, chunks)).toBe(0);
});

test("a form swap is sent in place and is under 20 bytes", () => {
  const c = city([{ shape: "wall8", finish: "limestucco", x: 120, z: 120 }, { shape: "wall8", finish: "limestucco", x: 150, z: 120 }]);
  const wall = c.refs[0]!;
  const { h } = c;
  const ada = h.join("ada");
  const chunks = settled(c, ada);
  const sent = watch(c, 0);
  h.host.combat.blast(rocket(h.reg), 118, 1.4, 119.5, ROCKET_REACH);
  h.run(200);
  const sizes = sent();
  expect([c.form(wall), sizes.length, sizes[0]! < 20]).toEqual([FORM_BREACH_A, 1, true]);
  expect(differ(h.world.structs, ada.world!.structs, chunks)).toBe(0);
  // Nothing fell, so nothing is queued to fall.
  expect(ada.rubble.length).toBe(0);
});

test("a wreck's rung is one small row in place, and blows within a rung are told to nobody", () => {
  const c = city([{ kind: "core:compact_abandoned_white", x: 120, z: 120 }]);
  const car = c.refs[0]!;
  const { h } = c;
  const ada = h.join("ada");
  const chunks = settled(c, ada);
  const sent = watch(c, 0);
  const rec = record(h, ada);
  const pick: Source = { by: rec, x: 120, z: 119, item: h.reg.index.get("core:pick_metal")!, base: 32, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 };
  for (let k = 0; k < 7; k++) h.host.combat.hitStructure(pick, car, 120, 0.5, 120);
  h.run(200);
  expect(sent()).toEqual([]);
  h.host.combat.hitStructure(pick, car, 120, 0.5, 120);
  h.run(200);
  const sizes = sent();
  expect([c.id(car), sizes.length, sizes[0]! < 20]).toEqual(["core:zzzzzzzwreck_compact_abandoned_stripped", 1, true]);
  expect(differ(h.world.structs, ada.world!.structs, chunks)).toBe(0);
  // Cut up, it is taken: a batch with no cause to show, and nothing falls.
  for (let k = 0; k < 16; k++) h.host.combat.hitStructure(pick, car, 120, 0.5, 120);
  h.run(200);
  expect([c.id(car), differ(h.world.structs, ada.world!.structs, chunks, false), ada.rubble.length]).toEqual(["", 0, 0]);
});

test("a blast reaches a client as one batch a chunk with its centre and radius", () => {
  // Either side of the border between two chunks at x = 128: a wall each on the ground, and one over the first.
  const c = city([{ shape: "wall4", finish: "limestucco", x: 125, z: 120 }, { shape: "wall4", finish: "limestucco", x: 131, z: 120 }, { shape: "wall4", finish: "limestucco", x: 125, z: 120, up: 2.8 }, { shape: "wall8", finish: "concrete", x: 128, z: 126 }]);
  const [west, east, over, back] = c.refs as [number, number, number, number];
  const { h } = c;
  expect(Math.floor(west / 65536)).not.toBe(Math.floor(east / 65536));
  // Each of the three is opened first.
  for (const ref of [west, east, over]) for (let k = 0; k < 2; k++) h.host.combat.hitStructure(huge(c), ref, 128, 1, 120);
  expect([west, east, over].map(c.form)).toEqual([FORM_OPEN, FORM_OPEN, FORM_OPEN]);
  const ada = h.join("ada");
  const chunks = settled(c, ada);
  expect(differ(h.world.structs, ada.world!.structs, chunks)).toBe(0);
  const sent = watch(c, 0);
  const heard: number[] = [];
  ada.onStructure = (_was, kind, _x, _y, _z, _hpWas, _hp, cause) => void heard.push(kind, cause);
  const tick = h.world.tick;
  h.host.combat.blast(rocket(h.reg), 128, 1.5, 119.5, ROCKET_REACH);
  h.run(300);
  // The two on the ground are heaps, the one over them is gone, and the wall behind is hurt and stands.
  expect([c.form(west), c.form(east), c.id(over), c.form(back)]).toEqual([FORM_HEAP, FORM_HEAP, "", FORM_WHOLE]);
  // One message a chunk: its heap, and in the first its emptied slot too, in one batch.
  const sizes = sent();
  expect([sizes.length, sizes.every((n) => n <= 36)]).toEqual([2, true]);
  expect(differ(h.world.structs, ada.world!.structs, chunks, false)).toBe(0);
  const heap = ada.world!.structs.chunks[Math.floor(west / 65536)]!;
  expect([heap.hp[west & 0xffff], heap.kind[west & 0xffff]]).toEqual([heapHealth(h.reg, heap.kind[west & 0xffff]!), h.world.structs.chunks[Math.floor(west / 65536)]!.kind[west & 0xffff]!]);
  // Each piece that went is queued with the blast's cause, centre, reach and tick, the heap it left and the map's kind.
  const mapKind = h.reg.index.get("core:zruin_wall4_limestucco")!;
  expect(ada.rubble.length).toBe(3);
  for (const r of ada.rubble) expect([r.cause, r.ox, r.oy, r.oz, r.radius, r.tick, r.map]).toEqual([GONE_BLAST, 128, 1.5, 119.5, ROCKET_REACH, tick, mapKind]);
  expect(ada.rubble.map((r) => r.into !== 0).sort()).toEqual([false, true, true]);
  expect(ada.rubble.every((r) => h.reg.breakForm[r.kind] === FORM_OPEN)).toBe(true);
  // Each is heard to go as a piece destroyed is.
  expect(heard).toEqual([0, GONE_BLAST, 0, GONE_BLAST, 0, GONE_BLAST]);
});

test("a client that arrives a minute later holds the same kinds", () => {
  const c = city([
    { shape: "wall8", finish: "limestucco", x: 100, z: 100 }, { shape: "wall8", finish: "limestucco", x: 120, z: 100 }, { shape: "wall8", finish: "limestucco", x: 140, z: 100 },
    { shape: "wall8", finish: "limestucco", x: 160, z: 100, up: 9 }, { shape: "wall8", finish: "concrete", x: 100, z: 140 }, { shape: "zwin", finish: "limestucco", x: 140, z: 140 },
  ]);
  const [breached, opened, heaped, gone, worn, window] = c.refs as [number, number, number, number, number, number];
  const { h } = c;
  const ada = h.join("ada");
  const chunks = settled(c, ada);
  const blast = (ref: number, times: number): void => {
    const p = c.at(ref);
    for (let k = 0; k < times; k++) {
      h.host.combat.blast(huge(c), p.x - 2, p.y, p.z - 0.5, 3);
      h.run(100);
    }
  };
  blast(breached, 1);
  blast(opened, 2);
  blast(heaped, 3);
  blast(gone, 3);
  h.host.combat.blast(grenade(h.reg), 100, 1.4, 139.5, GRENADE_REACH);
  h.host.combat.hitStructure(rifle(h.reg), window, 140, 2, 140);
  expect([c.form(breached), c.form(opened), c.form(heaped), c.id(gone), c.form(worn), c.form(window)]).toEqual([FORM_BREACH_A, FORM_OPEN, FORM_HEAP, "", FORM_WHOLE, FORM_WHOLE]);
  h.run(500);
  // Ada saw it happen: every kind is the server's. The wear and the one bullet were told to nobody.
  expect(differ(h.world.structs, ada.world!.structs, chunks, false)).toBe(0);
  expect(differ(h.world.structs, ada.world!.structs, chunks)).toBe(2);
  expect(ada.rubble.length).toBe(2);
  h.run(61_000);
  const bob = h.join("bob");
  const carl = h.join("carl", {}, { statics: false });
  const sent = watch(c, 1);
  settled(c, bob);
  settled(c, carl);
  // Both hold the server's rows, health and all, and neither is shown anything fall.
  expect([differ(h.world.structs, bob.world!.structs, chunks), differ(h.world.structs, carl.world!.structs, chunks)]).toEqual([0, 0]);
  expect([bob.rubble.length, carl.rubble.length]).toEqual([0, 0]);
  // With the map, the six changed slots cost Bob their rows in place: no place, no turn.
  expect(sum(sent())).toBeLessThan(120);
});

test("breaks that pile up in one tick end on a client as they did on the server", () => {
  const c = city([{ shape: "wall4", finish: "limestucco", x: 120, z: 120 }, { shape: "wall4", finish: "limestucco", x: 140, z: 120 }, { shape: "wall4", finish: "limestucco", x: 160, z: 120 }]);
  const [cleared, fast, mined] = c.refs as [number, number, number];
  const { h } = c;
  for (const ref of [cleared, mined]) for (let k = 0; k < 2; k++) h.host.combat.hitStructure(huge(c), ref, 0, 1, 0);
  const ada = h.join("ada");
  const chunks = settled(c, ada);
  // Before the server next sends: one wall falls to a heap and the heap is blown away; one goes from whole to a heap;
  // and one falls to a heap that is then worn by a blast at its edge.
  for (let k = 0; k < 2; k++) h.host.combat.blast(huge(c), 120, 1.4, 119.5, 3);
  for (let k = 0; k < 3; k++) h.host.combat.blast(huge(c), 140, 1.4, 119.5, 3);
  h.host.combat.blast(huge(c), 160, 1.4, 119.5, 3);
  h.host.combat.blast({ ...grenade(h.reg), base: 1 }, 160, 1.4, 118, 3);
  expect([c.id(cleared), c.form(fast), c.form(mined), c.hp(mined) < heapHealth(h.reg, h.world.structs.chunks[Math.floor(mined / 65536)]!.kind[mined & 0xffff]!)]).toEqual(["", FORM_HEAP, FORM_HEAP, true]);
  h.run(500);
  // Every kind is the server's. The heap's wear was told to nobody.
  expect(differ(h.world.structs, ada.world!.structs, chunks, false)).toBe(0);
  expect(differ(h.world.structs, ada.world!.structs, chunks)).toBe(1);
  // What went as a batch alone is queued to fall: the wall that fell and was cleared, twice, and the one worn after.
  expect(ada.rubble.map((r) => `${h.reg.breakForm[r.kind]} ${r.into !== 0} ${r.x}`).sort()).toEqual([`${FORM_OPEN} true 120`, `${FORM_OPEN} true 160`, `${FORM_HEAP} false 120`]);
});
