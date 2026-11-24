// Air support's settings, each set apart from its default and seen to do what its row says (server/settings/rows-server.ts):
// a call refused while it is off, the carrier's lead and speed, the stillness a delivery waits for, a new rack's stock,
// the reach a rack is worked from, and a drone's health, speed, turn, boost, range and payload.

import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { handleIndex } from "../../shared/ids.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { AIR_ACTION } from "../../shared/sim/air-support.ts";
import { BTN_AIR_REMOTE, BTN_SPRINT } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function waitFor(h: Harness, done: () => boolean, seconds = 60): void {
  for (let at = 0; at < seconds * 10 && !done(); at++) h.run(100);
  expect(done()).toBe(true);
}

/** A driver in a semi's cab on open ground, with no order needed to call, and the settings given first. */
function cab(settings: Record<string, string> = {}) {
  const h = new Harness({ entityRadius: 1, structRadius: 1 }, 35, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(12)) });
  for (const [name, value] of Object.entries({ AirSupportOrderRequired: "False", ...settings })) expect([name, h.host.setSetting(name, value)]).toEqual([name, ""]);
  const pilot = h.join("driver");
  h.run(800);
  const c = h.client(pilot)!, ents = h.world.ents;
  const truck = h.host.spawnVehicle("core:semi", 220, 200, h.host.records.byPid.get(c.pid)!.team);
  const point = [0, 0, 0];
  h.host.urban.door(truck, h.reg.vehicle[ents.kind[truck]!]!.seats[0]!, h.reg.move[ents.kind[c.ent]!]!.radius, point);
  ents.setPosition(c.ent, point[0]!, point[1]!, point[2]!);
  expect(h.host.urban.mount(c, truck)).toBe(RESULT_OK);
  h.run(1500);
  /** The carrier's entity, or -1. */
  const carrier = (): number => {
    const kind = h.reg.index.get("core:air_carrier")!;
    for (let e = 0; e < ents.cap; e++) if (ents.kind[e] === kind && (ents.flags[e]! & 1) !== 0) return e;
    return -1;
  };
  const said = (words: string): boolean => pilot.log.some((l) => l.text.includes(words)) || pilot.airSupport.notice.includes(words);
  return { h, pilot, c, ents, truck, carrier, said };
}

test("a call is refused while air support is off, and brings a carrier once it is on", () => {
  const { h, pilot, carrier, said } = cab({ AirSupportEnabled: "False" });
  try {
    pilot.airCommand(AIR_ACTION.trailer);
    h.run(1000);
    expect([said("Call freight from an authorized semi cab."), carrier()]).toEqual([true, -1]);
    expect(h.host.setSetting("AirSupportEnabled", "True")).toBe("");
    pilot.airCommand(AIR_ACTION.trailer);
    h.run(1000);
    expect(carrier()).toBeGreaterThanOrEqual(0);
  } finally { h.host.shutdown(); }
});

test("the carrier starts as far out as its speed and lead time allow, and comes in at its speed", () => {
  const { h, pilot, ents, truck, carrier } = cab({ AirCarrierSpeed: "20", AirSupportEta: "10" });
  try {
    pilot.airCommand(AIR_ACTION.trailer);
    h.run(200);
    const e = carrier();
    expect(e).toBeGreaterThanOrEqual(0);
    // 20 m/s for 10 s: it appears 200 m out, or nearer where the map's edge stops it.
    const out = Math.hypot(ents.x[e]! - ents.x[truck]!, ents.z[e]! - ents.z[truck]!);
    expect(out).toBeGreaterThan(150);
    expect(out).toBeLessThan(201);
    // Inbound it closes on the rig no faster than its speed.
    h.run(2000);
    const was = [ents.x[e]!, ents.z[e]!];
    h.run(1000);
    const speed = Math.hypot(ents.x[e]! - was[0]!, ents.z[e]! - was[1]!);
    expect(speed).toBeGreaterThan(15);
    expect(speed).toBeLessThan(20.5);
  } finally { h.host.shutdown(); }
});

test("a delivery waits for the semi to stand still as long as its setting says, and a new rack holds its stock", () => {
  const { h, pilot, said } = cab({ AirSupportStop: "8", AirSupportStock: "3" });
  try {
    pilot.airCommand(AIR_ACTION.trailer);
    waitFor(h, () => said("Carrier overhead."), 120);
    const overhead = h.now;
    waitFor(h, () => !!pilot.airSupport.pod, 120);
    // The semi has stood still since it was called, so the carrier lowers once it has been overhead eight seconds.
    expect(h.now - overhead).toBeGreaterThan(8000);
    expect(pilot.airSupport.pods.find((p) => p.id === pilot.airSupport.pod)!.slots).toBe(0b111);
  } finally { h.host.shutdown(); }
});

/** A survivor beside a rack of six loaded bays they own, open, `apart` metres off its side; the settings given first. */
function rack(settings: Record<string, string>, apart = 5) {
  const h = new Harness({ entityRadius: 1, structRadius: 1 }, 7, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(12)) });
  for (const [name, value] of Object.entries(settings)) expect([name, h.host.setSetting(name, value)]).toEqual([name, ""]);
  const pilot = h.join("operator"), target = h.join("target");
  h.run(800);
  const c = h.client(pilot)!, ents = h.world.ents, actor = h.host.records.byPid.get(c.pid)!;
  ents.setPosition(c.ent, 300, 0, 300);
  h.world.history.discontinuity(c.ent);
  ents.setPosition(h.ent(target), 300, 0, 260);
  h.world.history.discontinuity(h.ent(target));
  const trailer = h.host.spawnVehicle("core:air_trailer", 300 + apart, 300, actor.team, 0);
  h.host.airSupport.begin(JSON.stringify({ next: 2, calls: [], cooldown: [], racks: [{
    id: 1, pid: ents.pid[trailer]!, open: 1, opening: true, slots: 63, selected: 0, owner: c.pid, team: actor.team,
  }] }));
  h.run(600);
  /** Launches bay `bay`, and returns the flight as the server keeps it, or undefined if none took off. */
  const launch = (bay: number) => {
    pilot.airCommand(AIR_ACTION.launch, 1, bay);
    h.run(800);
    return h.host.airSupport.flights.camera(c);
  };
  return { h, pilot, target, c, ents, launch };
}

test("a rack is worked from within its reach, and not from past it", () => {
  const near = rack({ AirSupportReach: "10" });
  try {
    expect(near.launch(0)).toBeDefined();
  } finally { near.h.host.shutdown(); }
  // The same place with a reach of 2 m, the least it may be: the rack's side is further than that.
  const short = rack({ AirSupportReach: "2" });
  try {
    expect(short.launch(0)).toBeUndefined();
    expect(short.pilot.airCamera.id).toBe(0);
  } finally { short.h.host.shutdown(); }
});

test("a drone takes off with its health, flies at its speed and turns no faster than its turn rate", () => {
  const { h, c, launch } = rack({ AirDroneHealth: "37", AirDroneSpeed: "10", AirDroneTurnRate: "30" });
  try {
    const f = launch(0)!;
    expect(f).toBeDefined();
    const drone = h.host.records.byPid.get(h.world.ents.pid[handleIndex(f.ent)]!)!;
    // The content gives it more; the setting cuts it down.
    expect(Math.round(drone.vitals!.at(V_HEALTH, h.world.tick) / 1e6)).toBe(37);
    // Past its release it covers its speed in a second, along its pitch.
    const was = [f.x, f.y, f.z];
    h.run(1000);
    expect(Math.hypot(f.x - was[0]!, f.y - was[1]!, f.z - was[2]!)).toBeCloseTo(10, 0);
    // Asked to face the other way, it has turned at most 30 degrees a second.
    const pilot = h.pilots[0]!;
    const from = f.yaw;
    pilot.yaw = from + Math.PI;
    pilot.buttons = BTN_AIR_REMOTE;
    h.run(1000);
    const turned = Math.abs(Math.atan2(Math.sin(f.yaw - from), Math.cos(f.yaw - from))) * 180 / Math.PI;
    expect(turned).toBeGreaterThan(20);
    expect(turned).toBeLessThan(31 + 0.2 * 30);
    void c;
  } finally { h.host.shutdown(); }
});

test("a boosting drone burns its boost rate, and its link drops past its range", () => {
  const { h, pilot, launch } = rack({ AirDroneFuel: "100", AirDroneBurn: "1", AirDroneBoostBurn: "20", AirDroneRange: "50" });
  try {
    const f = launch(0)!;
    const keys = h.pilots[0]!;
    keys.yaw = f.yaw;
    keys.buttons = BTN_AIR_REMOTE | BTN_SPRINT;
    h.run(300);
    const fuel = f.fuel;
    h.run(1000);
    // 20 units a second of a 100 unit tank: a fifth gone in a second, where cruising would take a hundredth.
    expect(fuel - f.fuel).toBeCloseTo(0.2, 1);
    waitFor(h, () => pilot.airCamera.id === 0, 20);
    expect(pilot.airSupport.notice).toContain("out of range");
  } finally { h.host.shutdown(); }
});

test("a drone's payload does its damage within its radius, and none past it", () => {
  const blast = (damage: string) => {
    const { h, pilot, target, ents, launch } = rack({ AirDroneSpeed: "3", AirDroneDamage: damage, AirDroneRadius: "3" });
    try {
      const f = launch(0)!;
      const near = h.host.records.byPid.get(h.client(target)!.pid)!;
      // One survivor 1.5 m from the drone and another, its operator, 6 m off: inside the radius and past it.
      ents.setPosition(h.ent(target), f.x + 1.5, f.y - 0.9, f.z);
      h.world.history.discontinuity(h.ent(target));
      const c = h.client(pilot)!, operator = h.host.records.byPid.get(c.pid)!;
      ents.setPosition(c.ent, f.x - 6, f.y - 0.9, f.z);
      h.world.history.discontinuity(c.ent);
      const [nearWas, farWas] = [h.host.survival.value(near, V_HEALTH), h.host.survival.value(operator, V_HEALTH)];
      pilot.airCommand(AIR_ACTION.payload, pilot.airCamera.id);
      h.run(600);
      return { near: nearWas - h.host.survival.value(near, V_HEALTH), far: farWas - h.host.survival.value(operator, V_HEALTH) };
    } finally { h.host.shutdown(); }
  };
  const light = blast("20"), heavy = blast("60");
  expect([light.near > 0, light.far, heavy.far]).toEqual([true, 0, 0]);
  // Three times the damage takes three times the health from the same place.
  expect(heavy.near / light.near).toBeCloseTo(3, 0);
});
