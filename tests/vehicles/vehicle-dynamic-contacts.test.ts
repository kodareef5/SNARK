import { expect, test } from "bun:test";
import type { VehicleCollisionPair } from "../../server/vehicle-contacts.ts";
import { Past } from "../../server/history.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { AnimState, bodySeed } from "../../shared/anim/pose.ts";
import { seatOn, SEAT_FLOATS } from "../../shared/anim/seat.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_SPRINT, MF_ROOTED, stanceHeight } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { isWheelVehicle } from "../../shared/sim/vehicle.ts";
import { dynamicState } from "../../shared/sim/vehicle-dynamic.ts";
import { vehicleMassProperties } from "../../shared/sim/vehicle-rigid.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { carMeetsCapsule, carMeetsVehicle } from "../../shared/world/vehicle.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { frozenPack } from "../fixtures/pack.ts";

function camp(players = 2, map = flatMap(4), posed = false) {
  const pack = posed ? frozenPack() : null;
  const h = new Harness({}, 1, 60, { dev: true, clips: pack?.clips ?? NO_CLIPS, rigs: pack?.header.rigs ?? [], map: writeMap(map) });
  const sessions = Array.from({ length: players }, (_, i) => h.join(`driver-${i}`)); h.run(400);
  const clients = sessions.map(s => h.client(s)!), records = clients.map(c => h.host.records.byPid.get(c.pid)!), ents = h.world.ents;
  const events: VehicleCollisionPair[] = [], charges: { pid: number; by: number; points: number }[] = [];
  const pair = h.host.urban.collisionPair.bind(h.host.urban);
  h.host.urban.collisionPair = event => { events.push(event); pair(event); };
  const hurt = h.host.survival.hurt.bind(h.host.survival);
  h.host.survival.hurt = (rec, points, by, cause, impact) => {
    const taken = hurt(rec, points, by, cause, impact); if (taken > 0) charges.push({ pid: rec.pid, by, points: taken }); return taken;
  };
  const input = (i: number, forward = 0, yaw = 0, buttons = 0) => clients[i]!.inputs.set(h.world.tick + 1, 0, forward, yaw, 0, buttons);
  const tick = () => { for (let i = 0; i < clients.length; i++) input(i); h.server.tick(); };
  const putActor = (i: number, x: number, z: number) => { ents.setPosition(clients[i]!.ent, x, 0, z); h.world.history.discontinuity(clients[i]!.ent); };
  const carFor = (i: number, x: number, z: number) => {
    const e = h.host.spawnVehicle("core:compact", x, z, records[i]!.team);
    putActor(i, x + 1.6, z + .12); expect(h.host.urban.mount(clients[i]!, e)).toBe(RESULT_OK); return e;
  };
  const place = (e: number, x: number, z: number, yaw: number, speed: number) => {
    const v = ents.vrow[e]!; ents.setPosition(e, x, 0, z); ents.yaw[e] = Math.round(yaw * 65536 / (2 * Math.PI)) & 65535;
    ents.vehicleYaw[v] = yaw; ents.vehiclePitch[v] = ents.vehicleRoll[v] = 0;
    ents.vehicleQx[v] = ents.vehicleQz[v] = 0; ents.vehicleQy[v] = Math.sin(yaw / 2); ents.vehicleQw[v] = Math.cos(yaw / 2);
    ents.vehiclePitchRate[v] = ents.vehicleYawRate[v] = ents.vehicleRollRate[v] = 0;
    ents.vx[e] = Math.sin(yaw) * speed; ents.vy[e] = 0; ents.vz[e] = Math.cos(yaw) * speed;
    ents.flags[e] = ents.flags[e]! | F_GROUNDED; h.world.history.discontinuity(e);
  };
  const settle = () => { for (let i = 0; i < 25; i++) tick(); };
  const health = (pid: number) => h.host.survival.value(h.host.records.byPid.get(pid)!, V_HEALTH);
  return { h, clients, records, ents, events, charges, input, tick, putActor, carFor, place, settle, health };
}

function overlap(s: ReturnType<typeof camp>, car: number, actor: number): number {
  const { h, ents: e } = s, v = e.vrow[car]!, p = h.reg.move[e.kind[actor]!]!;
  const def = h.reg.vehicle[e.kind[car]!]!; if (!isWheelVehicle(def)) throw new Error("expected a wheeled car");
  return carMeetsCapsule(def.spec, { x: e.x[car]!, y: e.y[car]!, z: e.z[car]!,
    yaw: e.vehicleYaw[v]!, pitch: e.vehiclePitch[v]!, roll: e.vehicleRoll[v]!, qx: e.vehicleQx[v]!, qy: e.vehicleQy[v]!, qz: e.vehicleQz[v]!, qw: e.vehicleQw[v]! },
    e.x[actor]!, e.y[actor]!, e.z[actor]!, p.radius, stanceHeight(p, e.stance[actor]!))?.depth ?? 0;
}

test("protected players walking into a driven car cannot pin its tangent travel or damage either side", () => {
  const distances: number[] = [];
  for (const mode of ["clear", "pve", "friendly"]) {
    const s = camp(), { h, ents, clients, records } = s;
    try {
      if (mode === "pve") h.host.setSetting("serverPVE", "True");
      if (mode === "friendly") { records[1]!.team = records[0]!.team; ents.setTeam(clients[1]!.ent, records[0]!.team); }
      const car = s.carFor(0, 64, 52); s.putActor(1, 90, 52); s.settle(); s.place(car, 64, 52, 0, 0);
      s.putActor(1, mode === "clear" ? 90 : 65.6, 52);
      const carPid = ents.pid[car]!, hp = s.health(carPid), actorHP = s.health(clients[1]!.pid), start = ents.z[car]!, met = h.server.players.feet.met;
      let worstOverlap = 0, frozen = 0;
      for (let i = 0; i < 90; i++) {
        const z = ents.z[car]!; s.input(0, 127); s.input(1, mode === "clear" ? 0 : 127, 49152, BTN_SPRINT); h.server.tick();
        worstOverlap = Math.max(worstOverlap, overlap(s, car, clients[1]!.ent));
        if (ents.vz[car]! > 2 && ents.z[car]! - z < .005) frozen++;
      }
      distances.push(ents.z[car]! - start);
      expect(worstOverlap).toBeLessThan(.01); expect(frozen).toBe(0);
      expect(s.health(carPid)).toBe(hp); expect(s.health(clients[1]!.pid)).toBe(actorHP);
      // The walker meets the car in its own step (shared/sim/foot-contact.ts), as the page predicting it does.
      if (mode !== "clear") expect(h.server.players.feet.met - met).toBeGreaterThan(5);
    } finally { h.host.shutdown(); }
  }
  expect(distances[0]!).toBeGreaterThan(20);
  expect(distances[1]!).toBeGreaterThan(distances[0]! * .8); expect(distances[2]!).toBeGreaterThan(distances[0]! * .8);
});

test("a living parasaur moves after a native ram while contact rearm cannot become a brake", () => {
  const s = camp(), { h, ents } = s;
  try {
    const car = s.carFor(0, 64, 52); s.putActor(1, 90, 40); s.settle();
    const dino = h.host.spawnCreature("core:parasaur", 64, 80, 1), pid = ents.pid[dino]!;
    h.host.creatures.mind.stay(dino, 0xffffffff); s.settle();
    const radius = h.reg.move[ents.kind[dino]!]!.radius;
    s.place(car, 64, 80 - radius - 2 - .5, 0, 20);
    const startCar = ents.z[car]!, startDino = ents.z[dino]!; let frozen = 0, maxOverlap = 0;
    for (let i = 0; i < 30; i++) {
      const z = ents.z[car]!; s.tick();
      if (ents.vz[car]! > 2 && ents.z[car]! - z < .005) frozen++;
      maxOverlap = Math.max(maxOverlap, overlap(s, car, dino));
    }
    expect(h.host.records.byPid.get(pid)?.dead).toBe(false);
    expect(ents.z[dino]! - startDino).toBeGreaterThan(1); expect(ents.z[car]! - startCar).toBeGreaterThan(2);
    expect(frozen).toBe(0); expect(maxOverlap).toBeLessThan(.02);
    expect(s.events.length).toBeGreaterThan(1); expect(s.charges.filter(c => c.pid === pid)).toHaveLength(1);
  } finally { h.host.shutdown(); }
});

test("a protected ridden raptor cannot drive a parked car through repeated controller input", () => {
  const s = camp(), { h, ents, clients, records } = s;
  try {
    h.host.setSetting("serverPVE", "True");
    const car = h.host.spawnVehicle("core:compact", 64, 64, records[0]!.team), carPid = ents.pid[car]!;
    s.putActor(0, 90, 40);
    const dino = h.host.spawnCreature("core:raptor", 64, 71, 1), rec = h.host.records.byPid.get(ents.pid[dino]!)!;
    rec.team = records[1]!.team; rec.saddle = h.reg.index.get("core:saddle_raptor")!; ents.setTeam(dino, rec.team);
    h.host.refreshBody(rec); h.host.creatures.claimed(dino); h.host.creatures.mind.stay(dino, 0xffffffff);
    s.putActor(1, 65.5, 71); expect(h.host.riding.mount(clients[1]!, dino)).toBe(RESULT_OK);
    for (let i = 0; i < 40; i++) { s.input(0); s.input(1, 0, 32768); h.server.tick(); }
    expect(clients[1]!.drive).toBe(dino);
    const z = ents.z[car]!, dz = ents.z[dino]!, hp = s.health(carPid), met = h.server.players.feet.met; let peak = 0;
    for (let i = 0; i < 150; i++) {
      s.input(0); s.input(1, 127, 32768, BTN_SPRINT); h.server.tick(); peak = Math.max(peak, Math.abs(ents.vz[car]!));
    }
    expect(h.server.players.feet.met - met).toBeGreaterThan(30); expect(s.events.length).toBe(0); expect(dz - ents.z[dino]!).toBeGreaterThan(2);
    expect(Math.abs(ents.z[car]! - z)).toBeLessThan(.05); expect(peak).toBeLessThan(.1); expect(s.health(carPid)).toBe(hp);
    expect(ents.seat[clients[1]!.ent]).toBe(dino + 1); expect(Math.abs(ents.z[clients[1]!.ent]! - ents.z[dino]!)).toBeLessThan(2);
  } finally { h.host.shutdown(); }
});

test("mirror head-on crashes charge each vehicle once independently of spawn order and protect occupants", () => {
  const damage: number[][] = [];
  for (const reverse of [false, true]) {
    const s = camp(), { h, ents, clients } = s;
    try {
      let a: number, b: number;
      if (reverse) { b = s.carFor(1, 75, 50); a = s.carFor(0, 64, 50); }
      else { a = s.carFor(0, 64, 50); b = s.carFor(1, 75, 50); }
      const passengers = [a, b].map(e => {
        const npc = h.host.spawnCreature("core:civilian", ents.x[e]! - 1.25, 50.12, 1);
        expect(h.host.urban.seatNpc(npc, e, "passenger")).toBe(RESULT_OK); return ents.pid[npc]!;
      });
      s.settle(); s.place(a, 64, 77.45, 0, 20); s.place(b, 64, 82.55, Math.PI, 20);
      const pids = [ents.pid[a]!, ents.pid[b]!], hp = pids.map(s.health), occupants = [...clients.map(c => c.pid), ...passengers], occupantHP = occupants.map(s.health);
      for (let i = 0; i < 40; i++) s.tick();
      damage.push(pids.map((pid, i) => hp[i]! - s.health(pid)));
      for (const pid of pids) expect(s.charges.filter(c => c.pid === pid)).toHaveLength(1);
      expect(occupants.map(s.health)).toEqual(occupantHP);
      expect(damage.at(-1)![0]!).toBeCloseTo(damage.at(-1)![1]!, 3);
      expect(s.events.filter(event => event.fresh)).toHaveLength(1);
    } finally { h.host.shutdown(); }
  }
  expect(damage[0]![0]!).toBeGreaterThan(100); expect(damage[0]![0]!).toBeCloseTo(damage[1]![0]!, 3);
});

test("occupied or already moving foreign vehicles retain finite mass through protected PvE rams", () => {
  for (const kind of ["core:compact", "core:helicopter"]) for (const occupied of [false, true]) {
    const s = camp(), { h, ents, records } = s;
    try {
      h.host.setSetting("serverPVE", "True"); const car = s.carFor(0, 64, 52); s.putActor(1, 90, 40); s.settle();
      const other = h.host.spawnVehicle(kind, 64, 80, records[1]!.team, Math.PI), pid = ents.pid[other]!; s.settle();
      if (occupied) {
        const seat = h.reg.vehicle[ents.kind[other]!]!.seats.find(seat => !seat.driver)!;
        const door: number[] = [];
        h.host.urban.door(other, seat, h.reg.move[h.reg.index.get("core:civilian")!]!.radius, door);
        const npc = h.host.spawnCreature("core:civilian", door[0]!, door[2]!, 1);
        h.host.records.byPid.get(ents.pid[npc]!)!.team = records[1]!.team; ents.setTeam(npc, records[1]!.team);
        ents.setPosition(npc, door[0]!, door[1]!, door[2]!); h.world.history.discontinuity(npc);
        expect(h.host.urban.seatNpc(npc, other, seat.id)).toBe(RESULT_OK);
        s.settle(); expect(ents.seat[npc]).toBe(other + 1);
      }
      const hp = s.health(pid), half = h.reg.vehicle[ents.kind[other]!]!.spec.halfLength; let travel = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        s.place(other, 64, 80, Math.PI, occupied ? 0 : -2); s.place(car, 64, 80 - half - 2 - .7, 0, 25);
        for (let i = 0; i < 25; i++) s.tick();
        travel = Math.max(travel, Math.abs(ents.z[other]! - 80));
      }
      expect(travel).toBeGreaterThan(.1); expect(s.health(pid)).toBe(hp); expect(s.charges.filter(c => c.pid === pid)).toHaveLength(0);
    } finally { h.host.shutdown(); }
  }
});

test("fixed dummy and helicopter-tail contacts cannot preserve unusable forward speed at a fixed car pose", () => {
  for (const kind of ["core:dummy", "core:helicopter"]) {
    const s = camp(), { h, ents } = s;
    try {
      const car = s.carFor(0, 64, 52); s.putActor(1, 90, 40); s.settle();
      const other = kind === "core:dummy" ? h.host.spawnCreature(kind, 64, 80, 1) : h.host.spawnVehicle(kind, 64, 80, 0);
      s.settle(); const half = kind === "core:dummy" ? .4 : h.reg.vehicle[ents.kind[other]!]!.spec.halfLength;
      s.place(car, 64, 80 - half - 2 - .6, 0, 20); const z = ents.z[car]!; let frozen = 0;
      for (let i = 0; i < 45; i++) { const before = ents.z[car]!; s.tick(); if (ents.vz[car]! > 2 && Math.abs(ents.z[car]! - before) < .005) frozen++; }
      expect(s.events.length).toBeGreaterThan(0); expect(frozen).toBeLessThan(2);
      if (kind === "core:dummy") { expect(ents.vz[other]).toBe(0); expect(ents.z[other]).toBe(80); }
      else expect(ents.z[car]! - z).toBeGreaterThan(3);
    } finally { h.host.shutdown(); }
  }
});

test("a fatal large-dinosaur ram still charges the surviving car after the dinosaur record disappears", () => {
  const s = camp(), { h, ents } = s;
  try {
    const car = s.carFor(0, 64, 52); s.putActor(1, 90, 40); s.settle();
    const dino = h.host.spawnCreature("core:parasaur", 64, 80, 1), pid = ents.pid[dino]!, carPid = ents.pid[car]!;
    h.host.creatures.mind.stay(dino, 0xffffffff); s.settle();
    s.place(car, 64, 80 - h.reg.move[ents.kind[dino]!]!.radius - 2 - .6, 0, 30);
    const hp = s.health(carPid); s.tick();
    expect(h.host.records.entOf.has(pid)).toBe(false);
    expect(s.events.some(e => e.b.pid === pid && e.a.deltaSpeed > 5)).toBe(true);
    s.tick(); expect(s.health(carPid)).toBeLessThan(hp - 10);
    expect(s.charges.filter(c => c.pid === carPid)).toHaveLength(1);
  } finally { h.host.shutdown(); }
});

test("a slow spinning car uses its struck corner's closing speed instead of its whole rotation bound", () => {
  const s = camp(), { h, ents, clients } = s;
  try {
    const car = s.carFor(0, 64, 52); s.putActor(1, 64, 80); s.settle();
    s.place(car, 64, 80 - .4 - 2 - 4 / 30 * .8 - .02, 0, 4);
    ents.vehicleYawRate[ents.vrow[car]!] = 8;
    const hp = s.health(clients[1]!.pid);
    for (let i = 0; i < 3; i++) s.tick();
    expect(s.events.length).toBeGreaterThan(0);
    expect(s.health(clients[1]!.pid)).toBeGreaterThan(hp - 20);
    expect(s.charges.filter(c => c.pid === clients[1]!.pid)).toHaveLength(1);
  } finally { h.host.shutdown(); }
});

test("a native T-bone charges each side once with matching results in either spawn order", () => {
  const results: number[][] = [];
  for (const reverse of [false, true]) {
    const s = camp(), { h, ents, records } = s;
    try {
      let car: number, parked: number;
      if (reverse) { parked = h.host.spawnVehicle("core:compact", 64, 80, records[1]!.team, Math.PI / 2); car = s.carFor(0, 64, 52); }
      else { car = s.carFor(0, 64, 52); parked = h.host.spawnVehicle("core:compact", 64, 80, records[1]!.team, Math.PI / 2); }
      s.putActor(1, 90, 40); s.settle(); s.place(car, 64, 80 - .9 - 2 - .55, 0, 20);
      const pids = [ents.pid[car]!, ents.pid[parked]!], hp = pids.map(s.health);
      for (let i = 0; i < 40; i++) s.tick();
      results.push(pids.map((pid, i) => hp[i]! - s.health(pid)));
      for (const pid of pids) expect(s.charges.filter(c => c.pid === pid)).toHaveLength(1);
      expect(ents.z[parked]!).toBeGreaterThan(81);
    } finally { h.host.shutdown(); }
  }
  expect(results[0]![0]!).toBeCloseTo(results[1]![0]!, 2); expect(results[0]![1]!).toBeCloseTo(results[1]![1]!, 2);
});

test("native car contacts identify an active rotor or propeller on either canonical side", () => {
  for (const kind of ["core:helicopter", "core:boat"]) for (const reverse of [false, true]) for (const active of [false, true]) {
    const source = flatMap(4, { seaLevel: kind === "core:boat" ? 3 : -Infinity }), side = Math.sqrt(source.heights.length);
    // The boat starts in native deep water, the car on the adjacent bank; their impact poses are airborne.
    if (kind === "core:boat") for (let row = 0; row < side; row++) for (let col = 38; col < side; col++) source.heights[row * side + col] = 36 * 256;
    const s = camp(1, source), { h, ents, records } = s;
    try {
      s.putActor(0, 90, 40);
      let car: number, hazard: number;
      if (reverse) { hazard = h.host.spawnVehicle(kind, 64, 64, records[0]!.team); car = h.host.spawnVehicle("core:compact", 80, 64, records[0]!.team); }
      else { car = h.host.spawnVehicle("core:compact", 80, 64, records[0]!.team); hazard = h.host.spawnVehicle(kind, 64, 64, records[0]!.team); }
      expect(car).toBeGreaterThanOrEqual(0); expect(hazard).toBeGreaterThanOrEqual(0);
      const heli = kind === "core:helicopter";
      s.place(car, heli ? 68 : 64, heli ? 64 : 58.3, 0, 0); s.place(hazard, 64, 64, 0, 0);
      ents.setPosition(car, ents.x[car]!, heli ? 12 : 9.5, ents.z[car]!); ents.setPosition(hazard, 64, 10, 64);
      for (const e of [car, hazard]) { ents.flags[e] = ents.flags[e]! & ~F_GROUNDED; h.world.history.discontinuity(e); }
      const v = ents.vrow[hazard]!;
      ents.vehicleRotorRpm[v] = active ? 410 : 0; ents.vehicleRpm[v] = active ? 2000 : 0;
      ents.vehicleEngineOn[v] = active ? 1 : 0; ents.vehicleGear[v] = active ? 1 : 0;
      s.tick();
      expect(s.events).toHaveLength(1);
      const event = s.events[0]!, hazardIsA = event.a.entity === hazard;
      expect(hazardIsA).toBe(reverse);
      expect(hazardIsA ? event.rotorA : event.rotorB).toBe(active && heli);
      expect(hazardIsA ? event.propellerA : event.propellerB).toBe(active && !heli);
      expect(hazardIsA ? event.rotorB : event.rotorA).toBe(false);
      expect(hazardIsA ? event.propellerB : event.propellerA).toBe(false);
    } finally { h.host.shutdown(); }
  }
});

test("mixed rotor and propeller pairs preserve each side's hazard wear in either spawn order", () => {
  for (const kinds of [["core:helicopter", "core:helicopter"], ["core:helicopter", "core:boat"], ["core:boat", "core:boat"]]) {
    for (const reverse of [false, true]) for (let active = 0; active < 4; active++) {
      const source = flatMap(4, { seaLevel: 3 }), side = Math.sqrt(source.heights.length);
      for (let row = 0; row < side; row++) for (let col = 38; col < side; col++) source.heights[row * side + col] = 36 * 256;
      const s = camp(1, source), { h, ents } = s;
      try {
        s.putActor(0, 110, 40);
        const spawn = (i: number) => h.host.spawnVehicle(kinds[i]!, kinds[i] === "core:boat" ? 64 : 80 + i * 16, 64 + i * 16, 0);
        let a: number, b: number;
        if (reverse) { b = spawn(1); a = spawn(0); } else { a = spawn(0); b = spawn(1); }
        expect(a).toBeGreaterThanOrEqual(0); expect(b).toBeGreaterThanOrEqual(0);
        const bothBoats = kinds[0] === "core:boat", bothHelis = kinds[1] === "core:helicopter";
        s.place(a, 64, 64, 0, 0); s.place(b, bothBoats ? 64 : bothHelis ? 72 : 68, bothBoats ? 56.2 : bothHelis ? 64 : 67.6, bothBoats ? Math.PI : 0, 0);
        const bodies = [a, b], pids = bodies.map(e => ents.pid[e]!), hp = pids.map(s.health);
        bodies.forEach((e, i) => {
          ents.setPosition(e, ents.x[e]!, i === 1 && !bothHelis && !bothBoats ? 13.07 : 10, ents.z[e]!);
          ents.flags[e] = ents.flags[e]! & ~F_GROUNDED; h.world.history.discontinuity(e);
          const v = ents.vrow[e]!, on = (active & (1 << i)) !== 0;
          ents.vehicleRotorRpm[v] = on ? 410 : 0; ents.vehicleRpm[v] = on ? 2000 : 0;
          ents.vehicleEngineOn[v] = on ? 1 : 0; ents.vehicleGear[v] = on ? 1 : 0;
        });
        s.tick(); expect(s.events).toHaveLength(1);
        const event = s.events[0]!;
        bodies.forEach((e, i) => {
          const first = event.a.entity === e, on = (active & (1 << i)) !== 0;
          expect(first ? event.rotorA : event.rotorB).toBe(on && kinds[i] === "core:helicopter");
          expect(first ? event.propellerA : event.propellerB).toBe(on && kinds[i] === "core:boat");
          expect(first ? event.hazardFreshA : event.hazardFreshB).toBe(on);
        });
        h.world.tick++; h.host.urban.beforeStep();
        pids.forEach((pid, i) => {
          const on = (active & (1 << i)) !== 0;
          expect(s.charges.filter(c => c.pid === pid)).toHaveLength(on ? 1 : 0);
          expect(hp[i]! - s.health(pid)).toBeCloseTo(on ? kinds[i] === "core:helicopter" ? 45 : 20 : 0, 4);
        });
      } finally { h.host.shutdown(); }
    }
  }
});

test("pending boarding excludes only its approved host and ends when the transition is cancelled", () => {
  const s = camp(1), { h, ents, clients, records } = s;
  try {
    const c = clients[0]!, heli = h.host.spawnVehicle("core:helicopter", 64, 64, records[0]!.team);
    const entry = h.reg.vehicle[ents.kind[heli]!]!.seats[0]!.entry;
    s.putActor(0, 64 + entry[0], 64 + entry[2]);
    expect(h.host.urban.mount(c, heli)).toBe(RESULT_OK);
    for (let i = 0; i < 8; i++) s.tick();
    expect(h.host.urban.boarding(c.ent, heli)).toBe(true);
    expect(s.events.filter(e => e.a.entity === heli && e.b.entity === c.ent)).toHaveLength(0);
    const car = h.host.spawnVehicle("core:compact", 90, 64, 0);
    s.place(car, ents.x[c.ent]!, ents.z[c.ent]! + 1, 0, 0); s.tick();
    expect(s.events.some(e => e.a.entity === car && e.b.entity === c.ent)).toBe(true);
    h.host.urban.dismount(c); expect(h.host.urban.boarding(c.ent, heli)).toBe(false);
    s.place(car, 90, 64, 0, 0); s.place(heli, 64, 64, 0, 0); s.putActor(0, 65.3, 64.65);
    s.events.length = 0; s.tick();
    expect(s.events.some(e => e.a.entity === heli && e.b.entity === c.ent)).toBe(true);
  } finally { h.host.shutdown(); }
});

test("a real ram moves a living ridden parasaur and repins its posed rider before history is recorded", () => {
  const s = camp(2, flatMap(4), true), { h, ents, clients, records } = s;
  try {
    const car = s.carFor(0, 64, 52); s.putActor(1, 90, 40); s.settle();
    const mount = h.host.spawnCreature("core:parasaur", 64, 80, 1), rec = h.host.records.byPid.get(ents.pid[mount]!)!, rider = clients[1]!;
    rec.team = records[1]!.team; rec.saddle = h.reg.index.get("core:saddle_parasaur")!; ents.setTeam(mount, rec.team);
    h.host.refreshBody(rec); h.host.creatures.claimed(mount); h.host.creatures.mind.stay(mount, 0xffffffff);
    s.putActor(1, 62, 80); expect(h.host.riding.mount(rider, mount)).toBe(RESULT_OK); s.settle();
    expect(rider.drive).toBe(mount); expect(h.host.combat.vehicleDisplaces(records[0]!, h.host.records.byPid.get(ents.pid[car]!)!, rec)).toBe(true);
    const anim = h.world.anims[ents.kind[mount]!]!, seat = h.reg.saddleSeats[rec.saddle]![0]!;
    expect(anim.rig!.sockets.has(seat.socket!)).toBe(true); // Use the frozen authored saddle socket, not the anchor fallback.
    const frame = new Float64Array(SEAT_FLOATS), st = new AnimState(), past = new Past();
    const radius = h.reg.move[ents.kind[mount]!]!.radius, startZ = ents.z[mount]!, hp = s.health(rec.pid), riderHP = s.health(rider.pid);
    s.place(car, 64, startZ - radius - 2 - .5, 0, 15);
    let contactTicks = 0, postImpactTicks = 0, peakSpeed = 0;
    for (let i = 0; i < 30; i++) {
      const previous = s.events.length; s.tick();
      if (s.events.slice(previous).some(e => e.b.entity === mount && e.impulse > 0)) contactTicks++;
      if (contactTicks === 0) continue;
      postImpactTicks++; peakSpeed = Math.max(peakSpeed, Math.hypot(ents.vx[mount]!, ents.vy[mount]!, ents.vz[mount]!));
      st.unpack(ents.anim[mount]!, ents.cue[mount]!); st.seed = bodySeed(mount);
      seatOn(anim, seat, st, h.world.tick, ents.x[mount]!, ents.y[mount]!, ents.z[mount]!, ents.yaw[mount]! * Math.PI * 2 / 65536, frame);
      expect(Math.hypot(ents.x[rider.ent]! - frame[0]!, ents.y[rider.ent]! - frame[1]!, ents.z[rider.ent]! - frame[2]!)).toBeLessThan(.00002);
      expect([ents.vx[rider.ent], ents.vy[rider.ent], ents.vz[rider.ent]]).toEqual([ents.vx[mount], ents.vy[mount], ents.vz[mount]]);
      expect(ents.seat[rider.ent]).toBe(mount + 1); expect(ents.seatGen[rider.ent]).toBe(ents.gen[mount]); expect(rider.drive).toBe(mount);
      expect(h.world.history.at(h.world.tick, rider.ent, past)).toBe(true);
      expect([past.x, past.y, past.z]).toEqual([ents.x[rider.ent], ents.y[rider.ent], ents.z[rider.ent]]);
      expect([past.hostX, past.hostY, past.hostZ]).toEqual([ents.x[mount], ents.y[mount], ents.z[mount]]);
      expect(past.hostYaw).toBe(ents.yaw[mount]); expect(past.hostAnim).toBe(ents.anim[mount]); expect(past.hostCue).toBe(ents.cue[mount]);
    }
    expect(contactTicks).toBeGreaterThan(0); expect(postImpactTicks).toBeGreaterThan(20); expect(peakSpeed).toBeGreaterThan(1);
    expect(ents.z[mount]! - startZ).toBeGreaterThan(.5); expect(rec.dead).toBe(false);
    expect(s.health(rec.pid)).toBeGreaterThan(0); expect(s.health(rec.pid)).toBeLessThan(hp); expect(s.health(rider.pid)).toBe(riderHP);
  } finally { h.host.shutdown(); }
});

test("legal high-speed diagonal car motion resolves a real native impact without crossing or gaining energy", () => {
  for (const component of [95, 120]) {
    const s = camp(), { h, ents } = s;
    try {
      const a = s.carFor(0, 64, 52), b = s.carFor(1, 80, 52); s.settle();
      const distance = component === 120 ? 7 : 6;
      s.place(a, 60, 70, Math.PI / 4, component * Math.SQRT2);
      s.place(b, 60 + distance / Math.SQRT2, 70 + distance / Math.SQRT2, Math.PI * 1.25, component * Math.SQRT2);
      const bodies = [a, b], records = bodies.map(e => h.host.records.byPid.get(ents.pid[e]!)!), hp = records.map(r => s.health(r.pid));
      const energy = (e: number) => {
        const v = ents.vrow[e]!, state = dynamicState(); state.payloadMass = ents.vehiclePayloadMass[v]!;
        const p = vehicleMassProperties(h.reg.vehicle[ents.kind[e]!]!.spec, state);
        return .5 * (p.mass * (ents.vx[e]! ** 2 + ents.vy[e]! ** 2 + ents.vz[e]! ** 2) + p.ix * ents.vehiclePitchRate[v]! ** 2 + p.iy * ents.vehicleYawRate[v]! ** 2 + p.iz * ents.vehicleRollRate[v]! ** 2);
      };
      const before = energy(a) + energy(b);
      s.tick(); expect(s.events).toHaveLength(1);
      const event = s.events[0]!;
      expect(event.signedClosingSpeed).toBeGreaterThan(component); expect(event.impulse).toBeGreaterThan(0);
      expect(Number.isFinite(event.signedClosingSpeed + event.impulse)).toBe(true);
      const after = energy(a) + energy(b); expect(Number.isFinite(after)).toBe(true); expect(after).toBeLessThan(before);
      expect(((ents.x[b]! - ents.x[a]!) + (ents.z[b]! - ents.z[a]!)) / Math.SQRT2).toBeGreaterThan(3.99);
      const pose = (e: number) => { const v = ents.vrow[e]!; return { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[v]!, pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!,
        qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! }; };
      const definition = h.reg.vehicle[ents.kind[a]!]!; if (!isWheelVehicle(definition)) throw new Error("expected car");
      expect(carMeetsVehicle(definition.spec, pose(a), h.reg.vehicle[ents.kind[b]!]!, pose(b))?.depth ?? 0).toBeLessThan(.005);
      h.world.tick++; h.host.urban.beforeStep(); // Apply the actual queued crash charge, including a fatal crash at this extreme speed.
      records.forEach((r, i) => { const value = h.host.survival.value(r, V_HEALTH); expect(Number.isFinite(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(hp[i]!); });
    } finally { h.host.shutdown(); }
  }
});

test("explicit high-velocity teleports invalidate both source and target captures, including untrack/retrack", () => {
  for (const reverse of [false, true]) for (const retrack of [false, true]) {
    const s = camp(), { h, ents } = s;
    try {
      let a: number, b: number;
      if (reverse) { b = s.carFor(1, 80, 52); a = s.carFor(0, 64, 52); }
      else { a = s.carFor(0, 64, 52); b = s.carFor(1, 80, 52); }
      s.settle(); s.place(a, 60, 70, 0, 120); s.place(b, 63, 72, 0, 0);
      const pids = [ents.pid[a]!, ents.pid[b]!], hp = pids.map(s.health), prior = h.server.onBeforeStep;
      h.server.onBeforeStep = () => {
        prior?.(); // Capture is native, then an administrative relocation interrupts that same tick's path.
        const oldEpoch = h.world.history.motionEpoch(a);
        ents.setPosition(a, 66, 0, 70); h.world.history.discontinuity(a);
        if (retrack) { h.world.history.untrack(a); h.world.history.track(a); }
        expect(h.world.history.motionEpoch(a)).not.toBe(oldEpoch);
      };
      s.tick(); h.server.onBeforeStep = prior;
      expect(ents.x[a]!).toBeCloseTo(66, 4); expect(ents.z[a]!).toBeGreaterThan(73.9); expect(ents.vz[a]!).toBeGreaterThan(119);
      expect(s.events).toHaveLength(0); expect(ents.x[b]!).toBeCloseTo(63, 4); expect(ents.z[b]!).toBeCloseTo(72, 4);
      h.world.tick++; h.host.urban.beforeStep(); expect(pids.map(s.health)).toEqual(hp);
    } finally { h.host.shutdown(); }
  }
});

test("an unqualified position jump cannot remain as another car's swept target", () => {
  for (const reverse of [false, true]) {
    const s = camp(), { h, ents } = s;
    try {
      let a: number, b: number;
      if (reverse) { b = s.carFor(1, 80, 52); a = s.carFor(0, 64, 52); }
      else { a = s.carFor(0, 64, 52); b = s.carFor(1, 80, 52); }
      s.settle(); s.place(a, 60, 70, 0, 120); s.place(b, 70, 72, 0, 0);
      const prior = h.server.onBeforeStep;
      h.server.onBeforeStep = () => { prior?.(); ents.setPosition(a, 80, 0, 70); };
      s.tick(); h.server.onBeforeStep = prior;
      expect(s.events).toHaveLength(0);
      expect(ents.x[a]!).toBeCloseTo(80, 4); expect(ents.z[a]!).toBeGreaterThan(73.9);
      expect(ents.x[b]!).toBeCloseTo(70, 4); expect(ents.z[b]!).toBeCloseTo(72, 4);
    } finally { h.host.shutdown(); }
  }
});

test("pressing movable bodies against a real wall cannot store speed or phantom damage, and reverse or tangent escape remains free", () => {
  for (const kind of ["core:dodo", "core:grazer", "player"]) {
    const s = camp(), { h, ents, clients } = s;
    try {
      const car = s.carFor(0, 64, 52); s.putActor(1, 90, 40); s.settle();
      const wall = h.reg.index.get("core:wall")!, wallZ = 85;
      for (const x of [61, 64, 67]) h.world.structs.add(wall, x, 1.5, wallZ, 0, 0, 1e6);
      const bodyKind = h.reg.index.get(kind === "player" ? "core:survivor" : kind)!, radius = h.reg.move[bodyKind]!.radius;
      const bodyZ = wallZ - .15 - radius - .3;
      let actor: number;
      if (kind === "player") { s.putActor(1, 64, bodyZ); actor = clients[1]!.ent; }
      else { actor = h.host.spawnCreature(kind, 64, bodyZ, 1); ents.mflags[actor] = ents.mflags[actor]! | MF_ROOTED; }
      for (let i = 0; i < 3; i++) s.tick();
      s.place(car, 64, ents.z[actor]! - radius - 2 - .05, 0, 0);
      const carPid = ents.pid[car]!, actorPid = ents.pid[actor]!, hp = s.health(carPid), bodyHP = s.health(actorPid), start = ents.z[car]!;
      let frozen = 0, overlapDepth = 0, lateSpeed = 0;
      for (let i = 0; i < 240; i++) {
        const z = ents.z[car]!; s.input(0, 127); s.input(1); h.server.tick();
        const speed = Math.abs(ents.vz[car]!);
        if (speed > 1 && Math.abs(ents.z[car]! - z) < speed / 30 * .1) frozen++;
        if (i > 30) lateSpeed = Math.max(lateSpeed, speed);
        overlapDepth = Math.max(overlapDepth, overlap(s, car, actor));
      }
      expect(s.events.length).toBeGreaterThan(100); expect(frozen).toBe(0); expect(lateSpeed).toBeLessThan(.5);
      expect(ents.z[car]! - start).toBeGreaterThan(.1); expect(ents.z[car]! - start).toBeLessThan(.6);
      expect(overlapDepth).toBeLessThan(.01); expect(s.health(carPid)).toBe(hp); expect(s.health(actorPid)).toBe(bodyHP);
      expect(s.charges.filter(c => c.pid === carPid || c.pid === actorPid)).toHaveLength(0);
      const stopped = ents.z[car]!, actorX = ents.x[actor]!;
      for (let i = 0; i < 60; i++) {
        s.input(0, kind === "player" ? 127 : -127);
        s.input(1, kind === "player" ? 127 : 0, 16384, BTN_SPRINT); h.server.tick();
      }
      if (kind === "player") {
        expect(ents.x[actor]! - actorX).toBeGreaterThan(10);
        expect(ents.z[car]! - stopped).toBeGreaterThan(.5); expect(ents.z[car]!).toBeLessThan(wallZ - 1.9);
      } else expect(stopped - ents.z[car]!).toBeGreaterThan(2);
      expect(s.health(carPid)).toBe(hp); expect(s.charges.filter(c => c.pid === carPid)).toHaveLength(0);
    } finally { h.host.shutdown(); }
  }
});

test("only protected parked empty foreign cars resist a native shove into a wall or water in either spawn order", () => {
  for (const pve of [false, true]) for (const scene of ["wall", "water"]) for (const reverse of [false, true]) for (const speed of pve ? [0, 30] : [30]) {
    const map = flatMap(4, { seaLevel: scene === "water" ? 3 : -Infinity }), side = Math.sqrt(map.heights.length);
    for (let z = 0; z < side; z++) for (let x = 38; x < side; x++) map.heights[z * side + x] = 36 * 256;
    const s = camp(2, map), { h, ents, clients, records } = s;
    try {
      h.host.setSetting("serverPVE", pve ? "True" : "False");
      if (scene === "wall") for (const dz of [-3, 0, 3]) h.world.structs.add(h.reg.index.get("core:wall")!, 80, 5.5, 120 + dz, 16384, 0, 1e6);
      let car: number, parked: number;
      if (reverse) { parked = h.host.spawnVehicle("core:compact", 82, 120, records[1]!.team); car = h.host.spawnVehicle("core:compact", 112, 120, records[0]!.team); }
      else { car = h.host.spawnVehicle("core:compact", 112, 120, records[0]!.team); parked = h.host.spawnVehicle("core:compact", 82, 120, records[1]!.team); }
      ents.setPosition(clients[0]!.ent, 113.6, 4, 120.12); h.world.history.discontinuity(clients[0]!.ent);
      expect(h.host.urban.mount(clients[0]!, car)).toBe(RESULT_OK);
      ents.setPosition(clients[1]!.ent, 92, 4, 150); h.world.history.discontinuity(clients[1]!.ent);
      for (let i = 0; i < 40; i++) s.tick();
      const start = 82 + .9 + 2 + (speed ? speed / 30 + .3 : .05);
      s.place(car, start, 120, -Math.PI / 2, speed); ents.setPosition(car, start, 4, 120); h.world.history.discontinuity(car);
      expect(h.host.urban.parked(parked)).toBe(true);
      const pid = ents.pid[parked]!, carPid = ents.pid[car]!, hp = s.health(pid), carHP = s.health(carPid), v = ents.vrow[parked]!;
      let maxSpeed = 0, minY = Infinity;
      for (let i = 0; i < 240; i++) {
        s.input(0, speed ? 0 : 127); s.input(1); h.server.tick();
        maxSpeed = Math.max(maxSpeed, Math.hypot(ents.vx[parked]!, ents.vy[parked]!, ents.vz[parked]!));
        minY = Math.min(minY, ents.y[parked]!);
      }
      expect(s.events.length).toBeGreaterThan(0);
      if (pve) {
        expect(Math.abs(ents.x[parked]! - 82)).toBeLessThan(.01); expect(Math.abs(ents.z[parked]! - 120)).toBeLessThan(.01);
        expect(minY).toBeGreaterThan(3.95); expect(maxSpeed).toBeLessThan(.15);
        expect(s.health(pid)).toBe(hp); expect(s.health(carPid)).toBe(carHP);
        expect(ents.vehicleEngineCondition[v]).toBe(1); expect(ents.vehicleHullCondition[v]).toBe(1); expect(ents.vehicleFlooding[v]).toBe(0);
        expect(s.events.some(e => e.a.pid === pid ? e.protectedA : e.b.pid === pid && e.protectedB)).toBe(true);
        expect(s.charges.filter(c => c.pid === pid || c.pid === carPid)).toHaveLength(0);
      } else {
        expect(maxSpeed).toBeGreaterThan(5); expect(82 - ents.x[parked]!).toBeGreaterThan(.5);
        expect(s.events.some(e => e.protectedA || e.protectedB)).toBe(false);
        if (scene === "water") expect(ents.vehicleFlooding[v]).toBeGreaterThan(.05);
        else expect(s.health(pid)).toBeLessThan(hp - 20);
      }
    } finally { h.host.shutdown(); }
  }
});
