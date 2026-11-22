import { expect, test } from "bun:test";
import { MARINE_FLEET, MARINE_MODELS } from "../../content/vehicles/marine-fleet.ts";
import { HARBOUR_WRECK_FORMS, formMesh } from "../../content/vehicles/harbour-wrecks.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { boatRestY, createBoat, stepBoat, type BoatState, type BoatWorld } from "../../shared/sim/boat.ts";
import { boatDrives, isBoatVehicle, type BoatVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { boatMeetsCapsule } from "../../shared/world/boat.ts";
import { boatShapes } from "../../shared/world/vehicle-shapes.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { artTest } from "../fixtures/needs-art.ts";

const sea: BoatWorld = { waterAt: () => 0, groundAt: () => -50, blocked: () => null, penetration: () => null };
const helm = { pilot: true, throttle: 1, steer: 0, neutral: false };

const speedOf = (b: BoatState): number => Math.hypot(b.vx, b.vz);
const afloat = (def: BoatVehicleDefinition): BoatState => { const b = createBoat(def.spec, 0, boatRestY(def.spec, 0, 80), 0); b.payloadMass = 80; return b; };
const run = (b: BoatState, def: BoatVehicleDefinition, seconds: number, input: Partial<typeof helm> = {}): BoatState => {
  for (let tick = 0; tick < TICK_RATE * seconds; tick++) stepBoat(b, { ...helm, ...input }, def, sea);
  return b;
};
/** Degrees turned, summed through every wrap of the heading. */
const turned = (b: BoatState, def: BoatVehicleDefinition, seconds: number, input: Partial<typeof helm>): { degrees: number; lean: number; capsized: boolean } => {
  let degrees = 0, lean = 0, capsized = false, last = b.yaw;
  for (let tick = 0; tick < TICK_RATE * seconds; tick++) {
    capsized = stepBoat(b, { ...helm, ...input }, def, sea).capsized || capsized;
    degrees += ((b.yaw - last + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI; last = b.yaw;
    lean = Math.max(lean, Math.abs(b.roll) * 180 / Math.PI);
  }
  return { degrees: Math.abs(degrees), lean, capsized };
};
const fleet = MARINE_FLEET.map((s): BoatVehicleDefinition => { const v = s.vehicle!; if (!isBoatVehicle(v)) throw new Error(s.id); return v; });
/** Each vessel driven on open water with one pilot aboard: flat out, off the line, round at full helm, and stopped astern. */
const sheet = new Map(fleet.map(def => {
  const trace: number[] = [], top = afloat(def);
  for (let tick = 0; tick < TICK_RATE * 90; tick++) { stepBoat(top, helm, def, sea); trace.push(speedOf(top)); }
  const flat = speedOf(top), half = trace.findIndex(v => v >= flat / 2) / TICK_RATE;
  const careless = turned(structuredClone(top), def, 6, { steer: 1 }), dock = turned(afloat(def), def, 10, { throttle: .25, steer: 1 }).degrees;
  const astern = structuredClone(top), from = [astern.x, astern.z];
  while (astern.vx * Math.sin(astern.yaw) + astern.vz * Math.cos(astern.yaw) > .3) stepBoat(astern, { ...helm, throttle: -1 }, def, sea);
  const circle = run(structuredClone(top), def, 8, { steer: 1 }), radius = speedOf(circle) / Math.abs(circle.yawRate);
  return [def.id.slice(5), { def, flat, half, careless, dock, radius, stop: Math.hypot(astern.x - from[0]!, astern.z - from[1]!), tank: def.spec.fuelCapacity / def.spec.fuelPerSecond }];
}));
const of = (id: string) => sheet.get(id)!;
const ids = [...sheet.keys()];
const most = (by: (s: ReturnType<typeof of>) => number) => ids.reduce((a, b) => by(of(b)) > by(of(a)) ? b : a);
const least = (by: (s: ReturnType<typeof of>) => number) => ids.reduce((a, b) => by(of(b)) < by(of(a)) ? b : a);

test("all ten boats float at their design waterline, reach their stated speed flat out with a pilot aboard, turn and coast", () => {
  for (const def of fleet) {
    const p = def.spec, { flat } = of(def.id.slice(5));
    expect(boatRestY(p, 0)).toBeCloseTo(-p.draft, 5);
    expect(flat, def.id).toBeGreaterThan(p.maxForward * .9);
    expect(flat, def.id).toBeLessThan(p.maxForward * 1.06);
    const boat = run(afloat(def), def, 30);
    expect(boat.fuel).toBeLessThan(p.fuelCapacity);
    const half = turned(boat, def, 2, { steer: .5 });
    expect(half.degrees, def.id).toBeGreaterThan(1);
    expect(half.capsized, def.id).toBe(false);
    expect(boat.flooding).toBe(0);
    const speed = speedOf(boat);
    stepBoat(boat, { ...helm, neutral: true }, def, sea);
    expect(boat.gear).toBe(0);
    expect(speedOf(boat)).toBeGreaterThan(speed * .93);
  }
});

test("a yacht or the big catamaran comes half round from rest at full helm within three of its lengths of water", () => {
  for (const id of ["solstice", "meridian", "belvedere", "sovereign", "lagoon"]) {
    const { def } = of(id), p = def.spec, b = afloat(def);
    // The width of water its hull sweeps, as the wiki measures it (tools/wiki/handling.ts, turnAbout).
    let degrees = 0, last = b.yaw, left = 0, right = 0;
    for (let tick = 0; tick < TICK_RATE * 120 && degrees < 180; tick++) {
      stepBoat(b, { ...helm, steer: 1 }, def, sea);
      degrees += Math.abs(((b.yaw - last + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI); last = b.yaw;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const x = b.x + u * p.halfWidth * Math.cos(b.yaw) + v * p.halfLength * Math.sin(b.yaw);
        left = Math.min(left, x); right = Math.max(right, x);
      }
    }
    expect(degrees, id).toBeGreaterThanOrEqual(180);
    expect(right - left, id).toBeLessThan(3 * p.halfLength * 2);
  }
});

test("each vessel drives as what it is: the order of their speed, pick-up, turning, lean, stopping and range", () => {
  // The offshore boats are the fastest things on the water; the jon boat the slowest.
  expect([...ids].sort((a, b) => of(b).flat - of(a).flat).slice(0, 2)).toEqual(["needle", "thunderbolt"]);
  expect(least(s => s.flat)).toBe("jon_boat");
  // The jet ski is off the line first; the yachts gather way the more slowly the heavier they are, the 32 m one last.
  expect(least(s => s.half)).toBe("riptide");
  const yachts = ["solstice", "meridian", "belvedere", "sovereign"];
  for (const [a, b] of yachts.slice(1).map((y, i) => [yachts[i]!, y] as const)) {
    expect(of(a).half).toBeLessThan(of(b).half);
    // And turn wider.
    expect(of(a).radius).toBeLessThan(of(b).radius);
    expect(of(a).dock).toBeGreaterThan(of(b).dock);
  }
  expect(most(s => s.half)).toBe("sovereign");
  expect(most(s => s.radius)).toBe("sovereign");
  // The jet ski turns tightest at speed and spins on the spot at rest; the jon boat skitters round inside every yacht.
  expect(least(s => s.radius)).toBe("riptide");
  expect(most(s => s.dock)).toBe("riptide");
  expect(of("jon_boat").radius).toBeLessThan(Math.min(...yachts.map(y => of(y).radius)) / 3);
  // Full helm flat out: the offshore boats heel furthest of anything but the jet ski, the needle over to its beam ends;
  // the catamarans stay flatter than any monohull of their speed, and the yachts barely lean.
  const lean = (id: string) => of(id).careless.lean;
  expect(of("needle").careless.capsized).toBe(true);
  expect(lean("needle")).toBeGreaterThan(lean("thunderbolt"));
  expect(lean("thunderbolt")).toBeGreaterThan(30);
  expect(lean("riptide")).toBeGreaterThan(30);
  for (const cat of ["manta", "lagoon"]) expect(lean(cat)).toBeLessThan(5);
  for (const y of yachts) expect(lean(y)).toBeLessThan(5);
  expect(lean("manta")).toBeLessThan(lean("riptide") / 10);
  // Nothing else capsizes at full helm flat out.
  expect(ids.filter(id => of(id).careless.capsized)).toEqual(["needle"]);
  // The jon boat stops shortest from flat out; the needle, from the highest speed, runs on furthest.
  expect(least(s => s.stop)).toBe("jon_boat");
  expect(most(s => s.stop)).toBe("needle");
  // The needle empties its tank soonest; the big catamaran and the superyacht go longest on theirs.
  expect(least(s => s.tank)).toBe("needle");
  expect([...ids].sort((a, b) => of(b).tank - of(a).tank).slice(0, 2).sort()).toEqual(["lagoon", "sovereign"]);
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

artTest("every wreck form is built on its vessel's rig and layout, with its own pictures, and a burnt one has lost what burns", async () => {
  const read = async (name: string) => parsePack(await Bun.file(new URL(`../../assets/source/core/vehicles/${name}/${name}.snpk`, import.meta.url)).bytes());
  const forms: Record<string, Record<string, { burnt?: boolean }>> = await Bun.file(new URL("../../assets/source/core/vehicles/marine/forms.json", import.meta.url)).json();
  for (const model of MARINE_MODELS) {
    const name = model.id.slice(5), vessel = await read(name);
    for (const form of HARBOUR_WRECK_FORMS) {
      const id = formMesh(model.id, form), pack = await read(id.slice(5)), mesh = pack.header.meshes[0]!, rig = pack.header.rigs[0]!;
      expect([mesh.id, rig.skeleton]).toEqual([id, model.id]);
      expect(rig.names).toEqual(vessel.header.rigs[0]!.names);
      expect(mesh.lods).toHaveLength(6);
      expect(pack.header.materials!.map(m => m.id.split("/").at(-1)!.replace(/_(worn|wrecked)$/, ""))).toEqual(vessel.header.materials!.map(m => m.id.split("/").at(-1)!));
      if (forms[name]![form]!.burnt) expect(mesh.lods[0]!.indexCount).toBeLessThan(vessel.header.meshes[0]!.lods[0]!.indexCount);
    }
  }
});
