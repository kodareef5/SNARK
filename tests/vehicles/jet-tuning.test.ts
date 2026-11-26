// The jet's numbers as settings (server/settings/rows-server.ts, the Jet sheet; shared/content/tuning.ts vehicles): each
// changes the jet on the server and in every client's content while the server runs, the speeds kept in order, and a
// server at the defaults sends no tuning of the jet at all.

import { expect, test } from "bun:test";
import type { Registry } from "../../shared/content/registry.ts";
import type { JetSpec } from "../../shared/sim/vehicle.ts";
import { Harness } from "../fixtures/net.ts";

function served() {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  const set = (name: string, words: string): string => {
    const why = h.host.setSetting(name, words);
    h.run(300);
    return why;
  };
  return { h, ada, set };
}

const JET = (reg: Registry): number => reg.index.get("core:jet")!;
const spec = (reg: Registry): JetSpec => reg.vehicle[JET(reg)]!.spec as JetSpec;
const arms = (reg: Registry) => reg.vehicle[JET(reg)]!.weapons!;
const item = (reg: Registry, id: string): number => reg.index.get(id)!;

test("a server at the defaults tunes nothing of the jet", () => {
  const { h, ada } = served();
  expect(h.world.reg.tuning).not.toContain("core:jet");
  expect([spec(h.world.reg).topSpeed, arms(h.world.reg).missiles!.count, h.world.reg.damage[item(h.world.reg, "core:jet_missile")]]).toEqual([160, 6, 2400]);
  expect(spec(ada.registry).topSpeed).toBe(160);
  h.host.shutdown();
});

test("the jet's weapons and health follow their settings, on the server and in a client's content", () => {
  const { h, ada, set } = served();
  for (const [name, words] of [["JetMissiles", "10"], ["JetMissileDamage", "5000"], ["JetMissileBlast", "14"], ["JetMissileLockSeconds", "0.8"], ["JetMissileRange", "2400"], ["JetMissileSpeed", "300"], ["JetMissileReloadSeconds", "0.5"], ["JetCannonRounds", "500"], ["JetCannonDamage", "90"], ["JetCannonInterval", "0.05"], ["JetHealth", "6000"]] as const) expect([name, set(name, words)]).toEqual([name, ""]);
  for (const reg of [h.world.reg, ada.registry]) {
    const m = arms(reg).missiles!, c = arms(reg).cannon!;
    expect([m.count, m.lock, m.range, m.speed, m.reload, c.rounds, c.interval]).toEqual([10, 0.8, 2400, 300, 0.5, 500, 0.05]);
    const missile = item(reg, "core:jet_missile"), round = item(reg, "core:cannon_round");
    expect([reg.damage[missile], reg.ammoBlast[missile], reg.ammoSpeed[missile], reg.damage[round]]).toEqual([5000, 14, 300, 90]);
  }
  // A jet made now has the health the setting gives.
  const e = h.host.spawnVehicle("core:jet", 300, 300, 0, 0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  expect(rec.vitals!.max[0]! / 1e6).toBe(6000);
  h.host.shutdown();
});

test("the jet's speeds follow their settings and stay in order: stall under cruise under top, top at most 180", () => {
  const { h, ada, set } = served();
  expect(set("JetTopSpeed", "175")).toBe("");
  expect(set("JetCruiseSpeed", "140")).toBe("");
  expect(set("JetGLimit", "11")).toBe("");
  for (const reg of [h.world.reg, ada.registry]) expect([spec(reg).topSpeed, spec(reg).maxForward, spec(reg).cruiseSpeed, spec(reg).gLimit]).toEqual([175, 175, 140, 11]);
  // Past what a jet may fly at all, a setting is refused; above the top, or a stall under the hover, it is kept where the
  // jet still flies.
  expect(set("JetCruiseSpeed", "400")).not.toBe("");
  expect(set("JetCruiseSpeed", "178")).toBe("");
  expect(set("JetStallSpeed", "5")).toBe("");
  const s = spec(h.world.reg);
  expect([s.cruiseSpeed, s.stallSpeed]).toEqual([174, s.vtolSpeed]);
  expect(s.stallSpeed < s.cruiseSpeed && s.cruiseSpeed < s.topSpeed).toBe(true);
  h.host.shutdown();
});
