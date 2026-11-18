import { expect, test } from "bun:test";
import { MARINE_FLEET, MARINE_MODELS } from "../../content/vehicles/marine-fleet.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { boatRestY, createBoat, stepBoat, type BoatWorld } from "../../shared/sim/boat.ts";
import { boatDrives, isBoatVehicle } from "../../shared/sim/vehicle.ts";
import { boatMeetsCapsule } from "../../shared/world/boat.ts";
import { boatShapes } from "../../shared/world/vehicle-shapes.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { artTest } from "../fixtures/needs-art.ts";

const sea: BoatWorld = { waterAt: () => 0, groundAt: () => -50, blocked: () => null, penetration: () => null };
const helm = { pilot: true, throttle: 1, steer: 0, neutral: false };

test("all ten boats float at their design waterline, accelerate with a pilot aboard, turn and coast", () => {
  for (const species of MARINE_FLEET) {
    const def = species.vehicle!;
    if (!isBoatVehicle(def)) throw new Error(species.id);
    const p = def.spec, payload = 80;
    expect(boatRestY(p, 0)).toBeCloseTo(-p.draft, 5);
    const boat = createBoat(p, 0, boatRestY(p, 0, payload), 0);
    boat.payloadMass = payload;
    for (let tick = 0; tick < TICK_RATE * 30; tick++) stepBoat(boat, helm, def, sea);
    expect(boat.vz, def.id).toBeGreaterThan(p.maxForward * .88);
    expect(boat.vz, def.id).toBeLessThan(p.maxForward * 1.08);
    expect(boat.fuel).toBeLessThan(p.fuelCapacity);
    for (let tick = 0; tick < TICK_RATE * 2; tick++) stepBoat(boat, { ...helm, steer: .7 }, def, sea);
    expect(boat.yaw, def.id).toBeGreaterThan(.015);
    expect(Math.abs(boat.roll)).toBeLessThan(.5);
    expect(boat.flooding).toBe(0);
    const speed = Math.hypot(boat.vx, boat.vz);
    stepBoat(boat, { ...helm, neutral: true }, def, sea);
    expect(boat.gear).toBe(0);
    expect(Math.hypot(boat.vx, boat.vz)).toBeGreaterThan(speed * .93);
  }
});

test("both catamaran hulls have buoyancy and solid keels separated by open water, and jet propulsion has no exposed blades", () => {
  for (const [i, model] of MARINE_MODELS.entries()) {
    const def = MARINE_FLEET[i]!.vehicle!;
    if (!isBoatVehicle(def)) throw new Error(model.id);
    const drives = boatDrives(def.spec);
    expect(boatShapes(def).filter(s => s.hazard)).toHaveLength(model.family === "pwc" ? 0 : drives.length);
    if (model.family === "pwc") expect(def.spec.propeller.intake![1]).toBeLessThan(model.propeller[1]);
    if (!model.sponsonX) continue;
    expect(drives.map(d => d.propeller.at[0])).toEqual([model.sponsonX, -model.sponsonX]);
    const frame = createBoat(def.spec, 0, 0, 0);
    for (const x of [-model.sponsonX, model.sponsonX]) {
      expect(def.spec.buoyancyPoints.filter(p => p.at[0] === x)).toHaveLength(3);
      expect(boatMeetsCapsule(def, frame, x, model.draft - .15, 0, .12, .3)).toBeTruthy();
    }
    expect(boatMeetsCapsule(def, frame, 0, model.draft - .15, 0, .12, .3)).toBeNull();
    const a = createBoat(def.spec, 0, -model.draft, 0), b = { ...a };
    const starboardDry = { ...sea, waterAt: (x: number, z: number) => x < 0 && z < model.length * -.38 ? -Infinity : 0 };
    a.engineRpm = b.engineRpm = def.spec.maxRpm;
    stepBoat(a, helm, def, sea); stepBoat(b, helm, def, starboardDry);
    expect(b.vz).toBeCloseTo(a.vz * .5, 3);
    expect(b.yawRate).toBeLessThan(a.yawRate);
  }
});

artTest("every new boat ships six native LODs, damage layers, a working helm and matching seat and water sockets", async () => {
  for (const [i, model] of MARINE_MODELS.entries()) {
    const name = model.id.slice(5);
    const pack = parsePack(await Bun.file(new URL(`../../assets/source/core/vehicles/${name}/${name}.snpk`, import.meta.url)).bytes());
    const mesh = pack.header.meshes[0]!, rig = pack.header.rigs[0]!, def = MARINE_FLEET[i]!.vehicle!;
    if (!isBoatVehicle(def)) throw new Error(name);
    expect([mesh.id, rig.id, rig.skeleton]).toEqual([model.id, model.id, model.id]);
    expect(mesh.lods).toHaveLength(6);
    expect(mesh.lods.every((lod, k) => k === 0 || lod.indexCount < mesh.lods[k - 1]!.indexCount)).toBe(true);
    expect(pack.header.materials!.length).toBeGreaterThan(0);
    expect(pack.header.materials!.every(m => (m.layer ?? -1) >= 0)).toBe(true);
    for (const control of [def.steeringWheel, def.outboard, def.propeller, def.secondDrive?.outboard, def.secondDrive?.propeller]) {
      if (control) expect(rig.names).toContain(control.bone);
    }
    const sockets = new Map(rig.sockets!.map(s => [s.name, s]));
    const anchors = { camera_driver: model.camera, boarding_water: model.boarding.water, boarding_ladder: model.boarding.ladder, boarding_deck: model.boarding.deck,
      ...Object.fromEntries(model.seats.map((at, k) => [k ? `seat_${k}` : "seat_driver", at])) };
    for (const [name, at] of Object.entries(anchors)) {
      const s = sockets.get(name)!;
      expect(s.bone).toBe(0);
      [s.x, s.y, s.z].forEach((n, axis) => expect(n).toBeCloseTo(at[axis]!, 4));
    }
    for (const effect of ["wake_left", "wake_right", "spray_left", "spray_right", "engine"]) expect(sockets.has(effect)).toBe(true);
  }
});
