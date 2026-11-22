// A sight's gaze (server/gaze.ts, D1079): each session's cone widens its own view along its look, and what it is on lives.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { CONE_CHUNKS, WAKE_MOST } from "../../server/gaze.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, TICK_RATE, chunkAt } from "../../shared/coords.ts";
import { CMD_GAZE, GAZE_TICKS } from "../../shared/net/protocol.ts";
import { BTN_SECONDARY, stanceEye } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

/** The core content with a glass of eight times that the long rifle takes, as a sniper's scope will be. */
function withGlass(): Registry {
  const rifle = CORE_CONTENT.find((d) => d.id === "core:rifle" && d.type === "item") as ItemDef;
  const glass: ItemDef = { type: "item", class: "attachment", id: "core:test_glass", stack: 1, weight: 0.5, color: 11, attachment: "scope", optic: { min: 8 } };
  const fits: ItemDef = { ...rifle, weapon: { ...rifle.weapon!, fits: [...(rifle.weapon!.fits ?? []), "core:test_glass"] } };
  const made = compileContent([...CORE_CONTENT.filter((d) => d !== rifle), fits as Def, glass as Def]);
  expect(made.errors).toEqual([]);
  return made.registry!;
}

const MID = 24 * CHUNK_SIZE;
/** How far off the creatures stand, along +Z from one and -Z from the other. */
const OFF = 1300;

test("two survivors side by side looking two ways through their glasses each see a creature 1.3 km off move, and not the other's; nothing proven, nothing seen", () => {
  const registry = withGlass();
  const h = new Harness({}, 7, 30, { dev: true, map: writeMap(flatMap(48)) }, registry);
  const at = (name: string): number => registry.index.get(name)!;
  const ada = h.join("ada");
  const bob = h.join("bob");
  const cat = h.join("cat");
  h.run(1000);
  for (const s of [ada, bob, cat]) s.text("enablecheats");
  h.run(300);
  ada.text(`tp ${MID} ${MID}`);
  bob.text(`tp ${MID + 2} ${MID}`);
  cat.text(`tp ${MID - 2} ${MID}`);
  h.run(1000);
  const items = h.host.items;
  for (const s of [ada, bob]) {
    const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
    items.mint(rec, at("core:rifle"), 1);
    items.mint(rec, at("core:test_glass"), 1);
    h.run(200);
    const slot = takeInHand(h, s, at("core:rifle"));
    expect(items.attach(rec, slot, items.inv(rec).item.indexOf(at("core:test_glass")))).toBe(true);
  }
  // Ada looks north, Bob south.
  const [pa, pb, pc] = [h.pilots[0]!, h.pilots[1]!, h.pilots[2]!];
  [pa.yaw, pb.yaw, pc.yaw] = [0, Math.PI, 0];
  h.run(500);
  const north = h.host.spawnCreature("core:dodo", MID, MID + OFF, 10);
  const south = h.host.spawnCreature("core:dodo", MID, MID - OFF, 10);
  const ents = h.world.ents;
  const chunkOf = (e: number): number => chunkAt(h.world.dims, ents.x[e]!, ents.z[e]!);
  expect([h.host.creatures.isChunkAwake(chunkOf(north)), h.host.creatures.isChunkAwake(chunkOf(south))]).toEqual([false, false]);
  const gaze = (s: ClientSession, zoom: number, focus: number): void => void s.command(CMD_GAZE, (w) => (w.u16(zoom * 16), w.u16(focus), w.u16(0)));
  const seen = (s: ClientSession): number[] => {
    const r = new RemoteSample();
    s.sampleRemote(r);
    return [...r.id.subarray(0, r.count)];
  };
  // Unaimed, nobody's view reaches them.
  for (const s of [ada, bob, cat]) expect(seen(s).filter((e) => e === north || e === south)).toEqual([]);
  // A claim with the sight not raised shows nothing, and ends once it has gone unraised a while (D1084).
  gaze(ada, 8, OFF);
  h.run(500);
  expect([h.host.gaze.count, seen(ada).includes(north)]).toEqual([1, false]);
  h.run(2000);
  expect(h.host.gaze.count).toBe(0);
  // Raised now, each looking a little down at its own creature, as one aiming at it does.
  for (const p of [pa, pb, pc]) {
    p.buttons |= BTN_SECONDARY;
    p.pitch = -Math.atan2(stanceEye(h.reg.move[h.reg.index.get("core:survivor")!]!, 0), OFF);
  }
  // Each looks through its glass at its own creature, Cat through nothing: the server holds Cat's claim to what it has.
  // What each says it is on goes unheard: the server finds it along the survivor's own look.
  const looking = (ms: number): void => {
    for (let t = 0; t < ms; t += 1000) {
      gaze(ada, 8, 50);
      gaze(bob, 8, 50);
      gaze(cat, 8, 50);
      h.run(1000);
    }
  };
  const from = { n: [ents.x[north]!, ents.z[north]!], s: [ents.x[south]!, ents.z[south]!] };
  looking(20000);
  expect(h.host.gaze.count).toBe(2);
  // What a cone holds is seen, so nothing may come or go there unseen (the cast's seen(), D1079); to the side it is not.
  expect([h.host.gaze.seen(MID, MID + OFF), h.host.gaze.seen(MID, MID - OFF), h.host.gaze.seen(MID + OFF, MID)]).toEqual([true, true, false]);
  expect([h.host.creatures.isChunkAwake(chunkOf(north)), h.host.creatures.isChunkAwake(chunkOf(south))]).toEqual([true, true]);
  expect([seen(ada).includes(north), seen(ada).includes(south)]).toEqual([true, false]);
  expect([seen(bob).includes(south), seen(bob).includes(north)]).toEqual([true, false]);
  expect(seen(cat).filter((e) => e === north || e === south)).toEqual([]);
  // Awake, they live: each has wandered from where it was set down.
  expect(Math.hypot(ents.x[north]! - from.n[0]!, ents.z[north]! - from.n[1]!)).toBeGreaterThan(0.5);
  expect(Math.hypot(ents.x[south]! - from.s[0]!, ents.z[south]! - from.s[1]!)).toBeGreaterThan(0.5);
  // Ada's view, as sampled, moves with hers.
  const r = new RemoteSample();
  ada.sampleRemote(r);
  const k = [...r.id.subarray(0, r.count)].indexOf(north);
  expect(Math.hypot(r.x[k]! - ents.x[north]!, r.z[k]! - ents.z[north]!)).toBeLessThan(3);
  // A ridge 60 m high raised between Ada and her creature hides it: the cone sends nothing the ground hides.
  const hf = h.world.hf, saved = hf.heights.slice();
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) if (Math.abs(j * hf.cell - (MID + 500)) < 20) hf.heights[j * hf.nx + i] = Math.round((60 - hf.minY) / hf.stepY);
  looking(2000);
  expect([seen(ada).includes(north), seen(bob).includes(south)]).toEqual([false, true]);
  hf.heights.set(saved);
  // Lowered, the gazes last GAZE_TICKS and go: the creatures leave the views and sleep.
  gaze(ada, 0, 0);
  h.run(((GAZE_TICKS + TICK_RATE) * 1000) / TICK_RATE);
  expect(h.host.gaze.count).toBe(0);
  expect([h.host.creatures.isChunkAwake(chunkOf(north)), h.host.creatures.isChunkAwake(chunkOf(south))]).toEqual([false, false]);
  h.run(1000);
  expect(seen(ada).includes(north)).toBe(false);
  expect(seen(bob).includes(south)).toBe(false);
  expect([CONE_CHUNKS, WAKE_MOST]).toEqual([48, 64]);
});

test("the server's wake is counted by distinct chunks: two survivors watching one place hold its nine once, and it sleeps when the last looks away", () => {
  const registry = withGlass();
  const h = new Harness({}, 7, 30, { dev: true, map: writeMap(flatMap(48)) }, registry);
  const at = (name: string): number => registry.index.get(name)!;
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(1000);
  for (const s of [ada, bob]) s.text("enablecheats");
  h.run(300);
  ada.text(`tp ${MID} ${MID}`);
  bob.text(`tp ${MID + 2} ${MID}`);
  h.run(1000);
  for (const s of [ada, bob]) {
    const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
    h.host.items.mint(rec, at("core:rifle"), 1);
    h.host.items.mint(rec, at("core:test_glass"), 1);
    h.run(200);
    const slot = takeInHand(h, s, at("core:rifle"));
    expect(h.host.items.attach(rec, slot, h.host.items.inv(rec).item.indexOf(at("core:test_glass")))).toBe(true);
  }
  const eye = stanceEye(h.reg.move[h.reg.index.get("core:survivor")!]!, 0);
  const [pa, pb] = [h.pilots[0]!, h.pilots[1]!];
  for (const p of [pa, pb]) [p.yaw, p.pitch, p.buttons] = [0, -Math.atan2(eye, OFF), p.buttons | BTN_SECONDARY];
  const gaze = (s: ClientSession, zoom: number): void => void s.command(CMD_GAZE, (w) => (w.u16(zoom * 16), w.u16(0), w.u16(0)));
  for (let t = 0; t < 3; t++) {
    gaze(ada, 8);
    gaze(bob, 8);
    h.run(1000);
  }
  expect([h.host.gaze.count, h.host.gaze.awake]).toEqual([2, 9]);
  // Ada looks away: Bob still holds the place, at no more cost.
  gaze(ada, 0);
  h.run(500);
  expect([h.host.gaze.count, h.host.gaze.awake]).toEqual([1, 9]);
  gaze(bob, 0);
  h.run(500);
  expect([h.host.gaze.count, h.host.gaze.awake]).toEqual([0, 0]);
});
