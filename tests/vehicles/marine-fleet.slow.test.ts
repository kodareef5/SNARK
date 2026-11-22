import { expect, test } from "bun:test";
import { MARINE_MODELS } from "../../content/vehicles/marine-fleet.ts";
import type { MarineModel } from "../../content/vehicles/marine-model.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { fleetMarina } from "../../tools/boat/marina.ts";
import { Harness } from "../fixtures/net.ts";

function useFromDock(h: Harness, player: number, e: number, m: MarineModel): void {
  const c = h.client(h.sessions[player]!)!, pilot = h.pilots[player]!, ents = h.world.ents;
  const x = ents.x[e]! + m.boarding.water[0], z = ents.z[e]! + m.boarding.water[2] - 1.2;
  ents.setPosition(c.ent, x, .55, z); c.ownDirty = true; h.run(160);
  expect(ents.flags[c.ent]! & F_GROUNDED).not.toBe(0);
  const eye = ents.y[c.ent]! + stanceEye(h.reg.move[ents.kind[c.ent]!]!, ents.stance[c.ent]!);
  // Aim slightly inside the closest stern surface. The server receives only ordinary look and use inputs.
  const localEye = [x - ents.x[e]!, eye - ents.y[e]!, z - ents.z[e]!];
  const aims = m.boxes.map(b => b.at.map((v, k) => Math.max(v - b.half[k]! + .015, Math.min(v + b.half[k]! - .015, localEye[k]!)) - localEye[k]!));
  const [dx, dy, dz] = aims.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0]!;
  pilot.yaw = Math.atan2(dx!, dz!); pilot.pitch = Math.atan2(dy!, Math.hypot(dx!, dz!));
  pilot.buttons = BTN_USE; h.run(100); pilot.buttons = 0; h.run(1250);
}

test("all ten berths fit their assigned hulls together in the marina", () => {
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(fleetMarina()) });
  try {
    const boats = [...h.host.records.byPid.values()].filter(r => h.reg.vehicle[r.kind]?.movement === "boat");
    expect(boats.map(r => h.reg.ids[r.kind]).sort()).toEqual(MARINE_MODELS.map(m => m.id).sort());
  } finally { h.host.shutdown(); }
});

for (const m of MARINE_MODELS) test(`${m.label} boards and exits from its assigned berth using the normal controls`, () => {
  const map = fleetMarina();
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap({ ...map, vehicles: map.vehicles!.filter(v => v.kind === m.id) }) });
  try {
    const first = h.join("marina-pilot"); h.run(300);
    const c = h.client(first)!, pilot = h.pilots[0]!, ents = h.world.ents;
    const rec = [...h.host.records.byPid.values()].find(r => h.reg.ids[r.kind] === m.id)!;
    const e = h.host.records.entOf.get(rec.pid)!;
    useFromDock(h, 0, e, m);
    expect(c.drive).toBe(e);
    expect(ents.seatSlot[c.ent]).toBe(1);
    pilot.buttons = BTN_USE; h.run(100); pilot.buttons = 0; h.run(1200);
    expect(c.drive).toBe(-1);
    expect(ents.seat[c.ent]).toBe(0);
    if (m.id === "core:lagoon") {
      useFromDock(h, 0, e, m);
      const second = h.join("marina-passenger"); h.run(300);
      useFromDock(h, 1, e, m);
      const passenger = h.client(second)!;
      expect(ents.seatSlot[passenger.ent]).toBe(2);
      const start = ents.z[e]!;
      pilot.moveZ = 127; pilot.moveX = 24; h.run(4200);
      expect(ents.z[e]! - start).toBeGreaterThan(2);
      expect(ents.vehicleYaw[ents.vrow[e]!]!).toBeLessThan(-.01);
      expect(ents.seat[passenger.ent]).toBe(e + 1);
      expect(first.driving).toBe(e);
    }
  } finally { h.host.shutdown(); }
});

test("a returning swimmer in Lagoon's open tunnel keeps their position, and a swimmer inside its keel is moved clear", () => {
  const map = fleetMarina(), m = MARINE_MODELS.find(m => m.id === "core:lagoon")!;
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap({ ...map, vehicles: map.vehicles!.filter(v => v.kind === m.id) }) });
  try {
    const session = h.join("returning-swimmer"); h.run(300);
    const actor = h.client(session)!.ent, ents = h.world.ents;
    const rec = [...h.host.records.byPid.values()].find(r => h.reg.ids[r.kind] === m.id)!;
    const e = h.host.records.entOf.get(rec.pid)!, cx = ents.x[e]!, cz = ents.z[e]!;
    ents.setPosition(actor, cx, -1.35, cz);
    h.host.urban.settle(actor);
    expect([ents.x[actor], ents.z[actor]]).toEqual([cx, cz]);
    const keel = cx + m.sponsonX!;
    ents.setPosition(actor, keel, -1.35, cz);
    h.host.urban.settle(actor);
    expect(Math.hypot(ents.x[actor]! - keel, ents.z[actor]! - cz)).toBeGreaterThan(1);
  } finally { h.host.shutdown(); }
});

test("a destroyed flagship releases its pilot to water from the raised helm and retains its hull and cargo as salvage", () => {
  const map = fleetMarina(), m = MARINE_MODELS.find(m => m.id === "core:sovereign")!;
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap({ ...map, vehicles: map.vehicles!.filter(v => v.kind === m.id) }) });
  try {
    const session = h.join("flagship-pilot"); h.run(350);
    const c = h.client(session)!, ents = h.world.ents;
    const rec = [...h.host.records.byPid.values()].find(r => h.reg.ids[r.kind] === m.id)!;
    const e = h.host.records.entOf.get(rec.pid)!, item = h.reg.index.get("core:stone")!;
    useFromDock(h, 0, e, m);
    expect(c.drive).toBe(e);
    h.host.items.mint(rec, item, 3);
    h.host.survival.hurt(rec, 1e6, 0); h.run(120);
    expect(c.drive).toBe(-1);
    expect(ents.seat[c.ent]).toBe(0);
    expect(ents.y[c.ent]!).toBeLessThan(h.world.hf.waterAt(ents.x[c.ent]!, ents.z[c.ent]!));
    const wreck = [...h.host.corpses.bodies.values()].find(b => b.kind === rec.kind)!;
    expect(wreck.wreck).toBeTruthy();
    expect(h.host.items.inv(wreck.rec).total(item)).toBe(3);
  } finally { h.host.shutdown(); }
});
