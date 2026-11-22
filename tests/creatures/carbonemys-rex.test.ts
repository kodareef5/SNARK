import { expect } from "bun:test";
import { test } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";
import { writeMap, type MapData } from "../../shared/world/mapfile.ts";
import { BTN_JUMP, BTN_PRIMARY, BTN_USE, MODE_SWIM } from "../../shared/sim/character.ts";
import { V_HEALTH, V_OXYGEN } from "../../shared/sim/vitals.ts";

function mount(species: string, terrain: Partial<MapData> = {}) {
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(4, terrain)) });
  const survivor = h.join("pilot");
  h.run(300);
  h.say(survivor, "enablecheats");
  h.say(survivor, "tp 118 120");
  const client = h.client(survivor)!, owner = h.host.records.byPid.get(client.pid)!;
  const e = h.host.spawnCreature("core:" + species, 120, 120, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const ents = h.world.ents, rec = h.host.records.byPid.get(ents.pid[e]!)!;
  expect(h.host.taming.give(rec, owner, 0, "forced")).toBe(true);
  rec.saddle = h.reg.index.get("core:saddle_" + species)!;
  h.host.refreshBody(rec);
  // Board from the flank through an actual use-key edge on dry ground.
  const pilot = h.pilots[0]!;
  const dx = ents.x[e]! - ents.x[client.ent]!, dz = ents.z[e]! - ents.z[client.ent]!;
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[rec.kind]! * .5 - ents.y[client.ent]! - 1.62, Math.hypot(dx, dz));
  if (terrain.seaLevel === undefined) {
    h.run(150); pilot.buttons = BTN_USE; h.run(100); pilot.buttons = 0;
  } else {
    // A level flooded to the surface puts the rider and turtle at different depths on entry.
    h.host.riding.mount(client, e);
  }
  h.run(400); expect(survivor.driving).toBe(e);
  pilot.yaw = 0; pilot.pitch = 0;
  return { h, e, rec, owner, ents, pilot: h.pilots[0]! };
}

test("the ridden Carbonemys browses a bush into its own inventory and cannot jump on land", () => {
  const first = new Uint32Array(17); first.fill(1, 6);
  const f = mount("carbonemys", { nodes: [{ kinds: ["core:bush"], first, kind: new Uint8Array(1),
    x: Uint16Array.of(56 * 1024), z: Uint16Array.of(58.1 * 1024), yaw: new Uint16Array(1) }] });
  try {
    const { h, e, ents, pilot } = f;
    const berry = h.reg.index.get("core:berry")!;
    const before = ents.stamina[e]!;
    pilot.buttons = BTN_JUMP; h.run(300);
    expect(ents.y[e]).toBeCloseTo(0, 4); expect(ents.stamina[e]!).toBeGreaterThanOrEqual(before);
    pilot.pitch = -.35; pilot.buttons = 0; h.run(3100);
    pilot.buttons = BTN_PRIMARY; h.run(1800);
    expect(h.host.harvest!.hits).toBeGreaterThan(0);
    expect(h.host.items.inv(f.rec).total(berry)).toBeGreaterThan(0);
    expect(h.host.items.inv(f.owner).total(berry)).toBe(0);
  } finally { f.h.host.shutdown(); }
});

test("the Carbonemys rider can dive and surface with the turtle, with independent breath", () => {
  const f = mount("carbonemys", { seaLevel: 8 });
  try {
    const { h, ents, e, pilot } = f;
    const health = h.host.survival.value(f.rec, V_HEALTH);
    pilot.buttons = BTN_JUMP; h.run(3000);
    expect(ents.mode[e]).toBe(MODE_SWIM);
    const surface = ents.y[e]!;
    pilot.buttons = 0; pilot.pitch = -1; pilot.moveZ = 1; h.run(2000);
    expect(ents.y[e]!).toBeLessThan(surface - 2.5);
    expect(h.host.survival.value(f.rec, V_OXYGEN)).toBe(0);
    expect(h.host.survival.value(f.owner, V_OXYGEN)).toBeLessThan(100);
    expect(h.host.survival.value(f.rec, V_HEALTH)).toBe(health);
    const deep = ents.y[e]!;
    pilot.moveZ = 0; pilot.buttons = BTN_JUMP; h.run(3200);
    expect(ents.y[e]!).toBeGreaterThan(deep + 2);
    expect(h.host.riding.riderOf(e)?.pid).toBe(f.owner.pid);
  } finally { f.h.host.shutdown(); }
});

test("aiming the Rex bite at a real fallen animal harvests its carcass into the mount", () => {
  const f = mount("rex");
  try {
    const { h, ents, e, pilot } = f;
    const prey = h.host.spawnCreature("core:dodo", 120, 122.7, 1);
    expect(prey).toBeGreaterThanOrEqual(0);
    const dodo = h.host.records.byPid.get(ents.pid[prey]!)!;
    h.host.survival.hurt(dodo, 10000, 0); h.run(2200);
    const body = [...h.host.corpses.bodies.values()].find(b => b.kind === dodo.kind)!;
    const middle = h.host.corpses.middle(body);
    const dx = middle.x - ents.x[e]!, dz = middle.z - ents.z[e]!;
    pilot.yaw = Math.atan2(dx, dz);
    pilot.pitch = Math.atan2(middle.y - ents.y[e]! - h.reg.move[f.rec.kind]!.eyeHeight, Math.hypot(dx, dz));
    h.run(600); pilot.buttons = BTN_PRIMARY; h.run(1200);
    expect(h.host.corpses.blows).toBeGreaterThan(0);
    const loot = ["core:hide", "core:meat"].map(id => h.reg.index.get(id)!);
    expect(loot.some(id => h.host.items.inv(f.rec).total(id) > 0)).toBe(true);
    expect(loot.every(id => h.host.items.inv(f.owner).total(id) === 0)).toBe(true);
  } finally { f.h.host.shutdown(); }
});
