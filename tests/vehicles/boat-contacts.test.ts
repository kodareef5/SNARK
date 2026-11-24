import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BOAT_ART } from "../../content/vehicles/boat-art.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";
import { Past } from "../../server/history.ts";
import { isBoatVehicle } from "../../shared/sim/vehicle.ts";
import { boatMeetsCapsule, boatMeetsVehicle } from "../../shared/world/boat.ts";

function setup() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2, { seaLevel: 3 })) });
  const session = h.join("boat-contact-pilot"); h.run(400);
  const c = h.client(session)!, actor = h.host.records.byPid.get(c.pid)!, ents = h.world.ents;
  ents.setPosition(c.ent, 56, 1.65, 64);
  const boat = h.host.spawnVehicle("core:boat", 62, 64, actor.team), entry = BOAT_ART.anchors.boarding_water;
  ents.setPosition(c.ent, 62 + entry[0], 1.65, 64 + entry[2]);
  expect(h.host.urban.mount(c, boat)).toBe(RESULT_OK); h.run(1400);
  const health = (e: number) => h.host.survival.value(h.host.records.byPid.get(ents.pid[e]!)!, V_HEALTH);
  const victim = (x: number, y: number, z: number) => {
    const e = h.host.spawnCreature("core:civilian", 95, 95, 1), rec = h.host.records.byPid.get(ents.pid[e]!)!;
    rec.vitals!.max[V_HEALTH] = rec.vitals!.value[V_HEALTH] = 100000 * 1e6;
    h.host.creatures.mind.stay(e, 0xffffffff);
    ents.setPosition(e, x, y, z); h.world.history.untrack(e); h.world.history.track(e); return e;
  };
  return { h, c, actor, ents, boat, contacts: h.host.urban.contacts!, health, victim };
}

test("boat hull sweep uses native combat and driver credit while protecting attached crew and bodies above the hull", () => {
  const { h, c, ents, boat, contacts, health, victim } = setup();
  try {
    const y = ents.y[boat]!, target = victim(64, y + .1, 64), before = health(target), crew = health(c.ent), count = contacts.contacts;
    ents.setPosition(target, 64, y + 5, 64); h.world.history.untrack(target); h.world.history.track(target);
    contacts.capture(boat); ents.setPosition(boat, 63, y, 64); contacts.step();
    expect(health(target)).toBe(before); expect(contacts.contacts).toBe(count);
    ents.setPosition(target, 64, y + .1, 64); h.world.history.untrack(target); h.world.history.track(target);
    ents.setPosition(boat, 62, y, 64); contacts.capture(boat); ents.setPosition(boat, 63, y, 64); ents.vx[boat] = 30;
    expect(contacts.step()).toContain(boat);
    expect(h.host.combat.last.by).toBe(c.pid); expect(health(target)).toBeLessThan(before);
    expect(ents.x[boat]!).toBeLessThan(63); expect(health(c.ent)).toBe(crew); expect(ents.seat[c.ent]).toBe(boat + 1);
  } finally { h.host.shutdown(); }
});

test("an engaged stationary propeller harms an unprotected swimmer, while neutral and the empty cockpit are safe", () => {
  const { h, ents, boat, contacts, health, victim } = setup();
  try {
    const y = ents.y[boat]!, prop = BOAT_ART.propeller.center, target = victim(62 + prop[0], y - .15, 64 + prop[2]), before = health(target);
    ents.vehicleEngineOn[ents.vrow[boat]!] = 1; ents.vehicleRpm[ents.vrow[boat]!] = 2800; ents.vehicleGear[ents.vrow[boat]!] = 0;
    contacts.capture(boat); contacts.step(); expect(health(target)).toBe(before);
    h.world.tick++; ents.vehicleGear[ents.vrow[boat]!] = 1;
    ents.setPosition(target, 62 + prop[0], y - .15, 64 + prop[2]); h.world.history.discontinuity(target);
    contacts.capture(boat); contacts.step();
    expect(health(target)).toBeLessThan(before); h.host.urban.beforeStep();
    expect(ents.vehicleEngineCondition[ents.vrow[boat]!]!).toBeLessThan(1);
    // A standing body's feet above the deck and inside the gunwales do not meet an invented full cabin box.
    const cabin = victim(62, y + .8, 64 - 1.8), cabinHealth = health(cabin);
    ents.vehicleGear[ents.vrow[boat]!] = 0; ents.vehicleEngineOn[ents.vrow[boat]!] = 0;
    contacts.capture(boat); ents.vehicleRollRate[ents.vrow[boat]!] = .1; contacts.step();
    expect(health(cabin)).toBe(cabinHealth);
  } finally { h.host.shutdown(); }
});

test("stationary boats block a swimmer crossing the real hull without fabricating a full-mass crash", () => {
  const { h, ents, boat, contacts, health, victim } = setup();
  try {
    const y = ents.y[boat]!, target = victim(64, y + .1, 64), hull = health(boat), before = health(target);
    contacts.capture(boat); ents.setPosition(target, 63, y + .1, 64); ents.vx[target] = -30;
    expect(contacts.step()).toContain(boat); h.host.urban.step();
    expect(health(boat)).toBe(hull); expect(health(target)).toBe(before);
    expect(ents.x[target]!).toBeGreaterThan(ents.x[boat]! + 1.59); expect(ents.vx[target]!).toBeGreaterThan(-3);
    const def = h.reg.vehicle[ents.kind[boat]!]!; if (!isBoatVehicle(def)) throw new Error("expected boat");
    const v = ents.vrow[boat]!;
    expect(boatMeetsCapsule(def, { x: ents.x[boat]!, y: ents.y[boat]!, z: ents.z[boat]!, yaw: 0, pitch: 0, roll: 0,
      qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! },
      ents.x[target]!, ents.y[target]!, ents.z[target]!, .3, 1.8)?.depth ?? 0).toBeLessThan(.005);
  } finally { h.host.shutdown(); }
});

test("boat collisions include another vehicle's real hull and cargo mass", () => {
  const { h, ents, boat, contacts, health } = setup();
  try {
    const other = h.host.spawnVehicle("core:boat_rescue", 80, 64, 0), rec = h.host.records.byPid.get(ents.pid[other]!)!;
    expect(other).toBeGreaterThanOrEqual(0);
    h.host.items.mint(rec, h.reg.index.get("core:ingot")!, 100);
    ents.vehiclePayloadMass[ents.vrow[other]!] = h.host.urban.payloadMass(other);
    expect(ents.vehiclePayloadMass[ents.vrow[other]!]!).toBeGreaterThan(0);
    const y = ents.y[boat]!, before = health(other);
    ents.setPosition(other, 64.9, y, 64); contacts.capture(boat); contacts.capture(other);
    ents.setPosition(boat, 63, y, 64); ents.vx[boat] = 30;
    expect(contacts.step()).toContain(boat); expect(ents.x[boat]!).toBeLessThan(63);
    h.host.urban.beforeStep();
    expect(health(other)).toBeLessThan(before);
  } finally { h.host.shutdown(); }
});

test("owned boats exchange finite momentum and are clipped on their captured rigid paths for crew repinning", () => {
  const { h, ents, boat, contacts, health } = setup();
  try {
    h.host.setSetting("serverPVE", "True");
    const other = h.host.spawnVehicle("core:boat_rescue", 80, 64, 0), y = ents.y[boat]!;
    ents.setPosition(other, 65.1, y, 64); contacts.capture(boat); contacts.capture(other);
    const before = health(other);
    ents.setPosition(other, 64, y, 64); ents.vx[other] = -30;
    const changed = contacts.step();
    expect(changed).toContain(boat); expect(changed).toContain(other);
    expect(ents.x[other]! - ents.x[boat]!).toBeGreaterThan(2.59); expect(ents.x[other]!).toBeLessThanOrEqual(65.1);
    const definition = h.reg.vehicle[ents.kind[boat]!]!, otherDef = h.reg.vehicle[ents.kind[other]!]!;
    if (!isBoatVehicle(definition)) throw new Error("expected boat");
    const pose = (e: number) => { const v = ents.vrow[e]!; return { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: 0, pitch: 0, roll: 0,
      qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! }; };
    expect(boatMeetsVehicle(definition, pose(boat), otherDef, pose(other))?.depth ?? 0).toBeLessThan(.005);
    expect(ents.vx[other]!).toBeGreaterThan(-20); expect(ents.vx[other]!).toBeLessThan(-5);
    expect(ents.vx[boat]!).toBeLessThan(-5); expect(health(other)).toBe(before);
    expect(Number.isFinite(ents.vehicleQw[ents.vrow[other]!])).toBe(true);
  } finally { h.host.shutdown(); }
});

test("construction reserves the boat's deck and motor while leaving clear air above its open cockpit", () => {
  const { h, ents, boat } = setup();
  try {
    const build = h.host.build as unknown as { bodyIn(kind: number, x: number, y: number, z: number, yaw: number, tw: number): number };
    const ceiling = h.reg.index.get("core:ceiling")!, pillar = h.reg.index.get("core:pillar_wood")!, y = ents.y[boat]!;
    expect(build.bodyIn(ceiling, 62, y + .5, 62.2, 0, 0)).toBe(boat);
    expect(build.bodyIn(ceiling, 62, y + 1.9, 62.2, 0, 0)).toBe(-1);
    expect(build.bodyIn(pillar, 62, y + .8, 60.3, 0, 0)).toBe(boat);
    expect(build.bodyIn(pillar, 66, y + .8, 60.3, 0, 0)).toBe(-1);
  } finally { h.host.shutdown(); }
});

test("rewound boat targeting uses its remembered quaternion and steering, with no history allocation for ordinary actors", () => {
  const { h, ents, boat } = setup();
  try {
    const history = h.world.history, tick = h.world.tick, past = new Past(), q = Math.SQRT1_2;
    ents.setPosition(boat, 62, 3, 64); ents.vehicleQx[ents.vrow[boat]!] = ents.vehicleQy[ents.vrow[boat]!] = 0;
    ents.vehicleQz[ents.vrow[boat]!] = ents.vehicleQw[ents.vrow[boat]!] = q; ents.vehicleRoll[ents.vrow[boat]!] = Math.PI / 2; ents.steering[ents.vrow[boat]!] = .4;
    history.record(tick);
    ents.vehicleQz[ents.vrow[boat]!] = ents.vehicleRoll[ents.vrow[boat]!] = ents.steering[ents.vrow[boat]!] = 0; ents.vehicleQw[ents.vrow[boat]!] = 1;
    history.record(tick + 1); h.world.tick += 2;
    expect(history.at(tick, boat, past)).toBe(true); expect(past.qz).toBeCloseTo(q, 6); expect(past.steering).toBeCloseTo(.4, 6);
    expect(history.sample(tick + .5, boat, past)).toBe(true);
    expect(past.qz).toBeCloseTo(Math.sin(Math.PI / 8), 6); expect(past.steering).toBeCloseTo(.2, 6);
    expect(h.host.combat.castBodies(-1, 61.6, 7, 62.2, 0, -1, 0, 6, 0, tick)).toBe(boat);
    expect(h.host.combat.t).toBeCloseTo(2.7, 4);
    expect(h.host.combat.castBodies(-1, 61.6, 7, 62.2, 0, -1, 0, 6)).toBe(boat);
    expect(h.host.combat.t).toBeCloseTo(3.27, 4);
    const bytes = history.bytes; history.untrack(boat);
    expect(bytes - history.bytes).toBe(16 * 7 * 4);
  } finally { h.host.shutdown(); }
});

test("native propeller engagement has its own cooldown and preserves protected swimmers and seated crew", () => {
  for (const protectedTarget of [false, true]) {
    const { h, c, actor, ents, boat, health, victim } = setup();
    try {
      const y = ents.y[boat]!, prop = BOAT_ART.propeller.center, target = victim(62, y - .15, 64 + prop[2]);
      const targetRec = h.host.records.byPid.get(ents.pid[target]!)!, boatHP = health(boat), crewHP = health(c.ent), before = health(target);
      if (protectedTarget) { h.host.setSetting("serverPVE", "True"); targetRec.team = actor.team + 1; ents.setTeam(target, targetRec.team); }
      const hits: number[] = [], base = h.world.tick, hurt = h.host.survival.hurt.bind(h.host.survival);
      h.host.survival.hurt = (rec, points, by, cause, impact) => {
        const taken = hurt(rec, points, by, cause, impact); if (rec === targetRec && taken > 0) hits.push(h.world.tick - base); return taken;
      };
      for (let i = 0; i < 35; i++) {
        // Repeat the same physical encounter. Each sample still runs the real input/controller/contact/Combat host tick.
        const active = i !== 0 && i !== 8, v = ents.vrow[boat]!;
        ents.setPosition(boat, 62, y, 64); ents.vx[boat] = ents.vy[boat] = ents.vz[boat] = 0;
        ents.vehicleQx[v] = ents.vehicleQy[v] = ents.vehicleQz[v] = 0; ents.vehicleQw[v] = 1;
        ents.vehicleYaw[v] = ents.vehiclePitch[v] = ents.vehicleRoll[v] = 0;
        ents.vehicleYawRate[v] = ents.vehiclePitchRate[v] = ents.vehicleRollRate[v] = 0;
        ents.vehicleEngineOn[v] = 1; ents.vehicleRpm[v] = 2800; ents.vehicleGear[v] = active ? 1 : 0;
        ents.setPosition(target, 62, y - .15, 64 + prop[2]); ents.vx[target] = ents.vy[target] = ents.vz[target] = 0;
        h.world.history.discontinuity(boat); h.world.history.discontinuity(target);
        c.inputs.set(h.world.tick + 1, 0, active ? 127 : 0, 0, 0, 0); h.server.tick();
      }
      expect(hits).toEqual(protectedTarget ? [] : [2, 17, 32]);
      expect(health(c.ent)).toBe(crewHP); expect(c.drive).toBe(boat); expect(ents.seat[c.ent]).toBe(boat + 1);
      if (protectedTarget) { expect(health(target)).toBe(before); expect(health(boat)).toBe(boatHP); }
      else { expect(health(target)).toBeLessThan(before - 500); expect(health(boat)).toBeLessThan(boatHP); }
    } finally { h.host.shutdown(); }
  }
});

test("Sovereign's bow displaces an actor on a level and a steeply pitched hull", () => {
  for (const pitch of [0, -Math.PI / 3]) {
    const { h, actor, ents, contacts, victim } = setup();
    try {
      const x = 98, z = 62, ship = h.host.spawnVehicle("core:sovereign", x, z, actor.team);
      expect(ship).toBeGreaterThanOrEqual(0);
      const v = ents.vrow[ship]!, y = 22;
      ents.setPosition(ship, x, y, z);
      ents.vehiclePitch[v] = pitch;
      ents.vehicleQx[v] = Math.sin(pitch / 2);
      ents.vehicleQw[v] = Math.cos(pitch / 2);
      // The last segment of the stem is narrow. Start its port side clear of the actor and sweep across.
      const bowZ = 15.3, bowY = 2.5;
      const target = victim(x + 1.18, y + bowY * Math.cos(pitch) - bowZ * Math.sin(pitch),
        z + bowY * Math.sin(pitch) + bowZ * Math.cos(pitch));
      const count = contacts.contacts;
      ents.vx[ship] = 24;
      contacts.capture(ship);
      ents.setPosition(ship, x + .8, y, z);
      expect(contacts.step()).toContain(target);
      expect(contacts.contacts).toBe(count + 1);
      expect(ents.vx[target]!).toBeGreaterThan(1);
    } finally { h.host.shutdown(); }
  }
});

test("a captured personal watercraft crossing a parked launch remains a swept target", () => {
  const { h, actor, ents, boat, contacts } = setup();
  try {
    const ski = h.host.spawnVehicle("core:riptide", 53, 65, actor.team);
    expect(ski).toBeGreaterThanOrEqual(0);
    // The lower-handle launch initiates the pair. The whole jet ski crosses between two disjoint endpoint poses.
    ents.setPosition(ski, 57.2, ents.y[boat]! + .5, 65);
    ents.vx[ski] = 240;
    const events: [number, number, number][] = [];
    const pair = h.host.urban.collisionPair.bind(h.host.urban);
    h.host.urban.collisionPair = event => {
      events.push([event.a.entity, event.b.entity, event.impulse]);
      pair(event);
    };
    contacts.capture(boat); contacts.capture(ski);
    ents.setPosition(ski, 65.2, ents.y[ski]!, 65);
    expect(contacts.step()).toContain(ski);
    expect(events).toHaveLength(1);
    expect(events[0]!.slice(0, 2)).toEqual([boat, ski]);
    expect(events[0]![2]).toBeGreaterThan(0);
  } finally { h.host.shutdown(); }
});
