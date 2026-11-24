// Every way a vehicle moves, driven through the shared step that the server and the client's prediction both run: a car,
// a helicopter and its autopilot, a skateboard, a semi with its trailer, and a boat. Each tick every field of the body
// that a later tick reads, what the step reported, and the body's bytes on the wire are written by name, each number as
// its bytes, so a change that moves one bit shows where it began. `bun tests/fixtures/vehicle-traces.ts` prints a line
// a tick; `bun tools/vehicle-traces.ts` compares two versions of the code (planning/workstreams/vehicle-families.md).

import { createHash } from "node:crypto";

import { BOAT_VEHICLE } from "../../content/vehicles/boat.ts";
import { COMPACT_VEHICLE } from "../../content/vehicles/compact.ts";
import { AIR_CARRIER_VEHICLE, AIR_TRAILER_VEHICLE } from "../../content/vehicles/air-freight.ts";
import { HELICOPTER_VEHICLE } from "../../content/vehicles/helicopter.ts";
import { SEMI } from "../../content/vehicles/heavy-road.ts";
import { BOARD } from "../../content/vehicles/skateboard.ts";
import { Body, BTN_CROUCH, BTN_JUMP, BTN_RELOAD, BTN_SPRINT, stepOut } from "../../shared/sim/character.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { stepHitchedBodies, stepRotorBody, stepVehicleBody, vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { vehicleRotation } from "../../shared/sim/vehicle-frame.ts";
import type { VehicleDefinition, WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { hitKind } from "../../shared/world/bends.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { flatWorld } from "./world.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { writeBody } from "../../shared/net/protocol.ts";

/** One tick of one course: its name, the tick, and each field as written by `code`. */
export type TraceLine = [course: string, tick: number, fields: Record<string, string>];

const bytes = new DataView(new ArrayBuffer(8));
/** A value as text that tells every bit: a number as its eight bytes, so -0 and each NaN differ. */
function code(v: unknown): string | null {
  if (typeof v === "number") {
    bytes.setFloat64(0, v);
    return bytes.getBigUint64(0).toString(16).padStart(16, "0");
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return `"${v}"`;
  if (v === null) return "null";
  return null;
}

/** Writes `v` into `out` under `name`, and a plain object's or an array's members under `name.member`. */
function flatten(name: string, v: unknown, out: Record<string, string>): void {
  const c = code(v);
  if (c !== null) out[name] = c;
  else if (ArrayBuffer.isView(v)) (v as unknown as ArrayLike<number>).length !== undefined && Array.from(v as unknown as ArrayLike<number>, (x, i) => flatten(`${name}[${i}]`, x, out));
  else if (Array.isArray(v)) v.forEach((x, i) => flatten(`${name}[${i}]`, x, out));
  else if (v && typeof v === "object") for (const key of Object.keys(v).sort()) flatten(`${name}.${key}`, (v as Record<string, unknown>)[key], out);
}

const wire = new BitWriter(4096);

/** What of a body a later tick reads, and what the last step reported. */
function fields(bodies: Record<string, Body>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [who, b] of Object.entries(bodies)) {
    for (const key of ["x", "y", "z", "vx", "vy", "vz", "yaw", "mode", "grounded", "fuel", "steering", "wheelAngle"] as const) flatten(`${who}.${key}`, b[key], out);
    for (const key of Object.keys(b).sort()) if (key.startsWith("vehicle")) flatten(`${who}.${key}`, b[key as keyof Body], out);
    if (b.skate) flatten(`${who}.skate`, b.skate, out);
    // The body as the wire carries it to every client, which a change of state must not change unasked.
    wire.reset();
    writeBody(wire, b);
    out[`${who}.wire`] = Array.from(wire.bytes(), (x) => x.toString(16).padStart(2, "0")).join("");
  }
  flatten("step", vehicleStep, out);
  flatten("landSpeed", stepOut.landSpeed, out);
  return out;
}

/** A vehicle's body at rest at `x`, `y`, `z`, facing `yaw`. */
function parked(def: VehicleDefinition, x: number, y: number, z: number, yaw = 0, roll = 0): Body {
  const b = new Body(), q = new Float64Array(4);
  b.vehicle = true; b.mode = 1; b.x = x; b.y = y; b.z = z; b.fuel = def.spec.fuelCapacity;
  b.vehicleYaw = yaw; b.vehicleRoll = roll;
  vehicleRotation({ x, y, z, yaw, pitch: 0, roll }, q);
  [b.vehicleQx, b.vehicleQy, b.vehicleQz, b.vehicleQw] = [q[0]!, q[1]!, q[2]!, q[3]!];
  return b;
}

/** Flat ground at `height`, with the sea at 0 where `sea`, and the structures `add` places; its one kind is `half` each way. */
function ground(height: number, sea: boolean, add?: (s: StructureStore) => void, half: readonly [number, number, number] = [5, 2, .5]) {
  const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 2, -64, 1 / 256);
  // The field's floor is at -64 m, and its samples count up from there in 256ths.
  hf.heights.fill((height + 64) * 256);
  hf.seaLevel = sea ? 0 : -Infinity;
  const structs = new StructureStore(dims, new Float32Array([0, half[0]]), new Float32Array([0, half[1]]), new Float32Array([0, half[2]]));
  add?.(structs);
  return { hf, structs };
}

/** Every course, in order, each line as it is made. */
export function vehicleTraces(line: (l: TraceLine) => void): void {
  // A car: driven, turned and braked on flat ground, then into a wall and out backwards, then into the sea.
  for (const course of ["drive", "wall", "water"] as const) {
    const world = ground(course === "water" ? -2 : 0, course === "water", course === "wall" ? (s) => s.add(1, 64, 2, 84, 0, 0, 100) : undefined);
    const b = parked(COMPACT_VEHICLE, 64, course === "water" ? -1.5 : 0, 64);
    for (let tick = 0; tick < 300; tick++) {
      const throttle = course === "wall" ? (tick < 150 ? 127 : -90) : tick < 200 ? 90 : 0;
      const steer = course === "drive" && tick > 60 && tick < 140 ? 50 : 0;
      stepVehicleBody(world, b, steer, throttle, course === "drive" && tick >= 240 ? BTN_JUMP : 0, COMPACT_VEHICLE);
      line([`car/${course}`, tick, fields({ car: b })]);
    }
  }

  // A helicopter: climb, fly ahead, hover, come down to land; then one let down onto the sea.
  for (const course of ["flight", "water"] as const) {
    const world = ground(course === "water" ? -8 : 0, course === "water");
    const b = parked(HELICOPTER_VEHICLE, 64, course === "water" ? 6 : 0, 40);
    for (let tick = 0; tick < 600; tick++) {
      const climb = course === "water" ? (tick < 60 ? BTN_JUMP : BTN_CROUCH) : tick < 150 ? BTN_JUMP : tick > 330 ? BTN_CROUCH : 0;
      const ahead = course === "flight" && tick >= 150 && tick < 270 ? 127 : 0;
      stepVehicleBody(world, b, 0, ahead, climb | (tick > 270 && tick < 330 ? BTN_SPRINT : 0), HELICOPTER_VEHICLE);
      line([`rotor/${course}`, tick, fields({ heli: b })]);
    }
  }

  // The air carrier on its autopilot, which steps the rotor from an analog order, not from buttons.
  {
    const world = ground(0, false);
    const b = parked(AIR_CARRIER_VEHICLE, 64, 0, 40);
    for (let tick = 0; tick < 400; tick++) {
      const order = { right: tick > 200 ? .3 : 0, forward: tick > 120 ? .6 : 0, yaw: tick > 260 ? -.4 : 0, climb: tick < 120 ? 1 : 0, brake: tick > 340, cruise: false, direct: false, pilot: true };
      stepRotorBody(world, b, order, AIR_CARRIER_VEHICLE);
      line(["rotor/autopilot", tick, fields({ carrier: b })]);
    }
  }

  // A skateboard: pushed along, popped into a kickflip and landed, carved, then dropped onto a kerb to grind it, then
  // popped low into a flip, and last dropped from a height to bail.
  {
    const w = flatWorld();
    const kind = w.kind(hitKind(false, 2, 8));
    for (const x of [32, 40]) w.structs.add(kind, x, .075, 40, 0, 0, 16000);
    const b = Object.assign(new Body(), { vehicle: true, x: 34, z: 20, grounded: true });
    for (let tick = 0; tick < 420; tick++) {
      if (tick === 200) Object.assign(b, { grounded: false, vy: -1, x: 34, y: .25, z: 38.77, vx: 6, vehicleYaw: Math.PI / 2 });
      // Dropped from a height: a landing too hard to ride, a bail.
      if (tick === 370) Object.assign(b, { grounded: false, y: 6, vy: -12 });
      const keys = tick < 60 ? BTN_SPRINT
        : tick >= 80 && tick < 84 ? BTN_JUMP : tick === 84 ? BTN_RELOAD
        : tick >= 200 && tick < 320 ? BTN_SPRINT
        : tick === 340 ? BTN_JUMP : tick === 341 ? BTN_RELOAD : 0;
      stepVehicleBody(w, b, tick > 120 && tick < 160 ? 60 : 0, tick < 120 ? 127 : 0, keys, BOARD);
      line(["board", tick, fields({ board: b })]);
    }
  }

  // A semi with its trailer: settled, driven on, turned, reversed; then the tractor slow on its side, the trailer upright.
  {
    const tractorDef = SEMI.species.vehicle as WheelVehicleDefinition, trailerDef = AIR_TRAILER_VEHICLE;
    for (const course of ["drive", "side"] as const) {
      const world = ground(0, false);
      const roll = course === "side" ? Math.PI / 2 : 0;
      const tractor = parked(tractorDef, 100, course === "side" ? tractorDef.spec.halfWidth : 0, 30, 0, roll);
      const trailer = parked(trailerDef, 100, 0, 30 + tractorDef.spec.fifthWheel![2] - trailerDef.spec.kingpin![2]);
      for (let tick = 0; tick < 420; tick++) {
        const throttle = course === "side" ? (tick > 30 ? 20 : 0) : tick < 90 ? 0 : tick < 330 ? 110 : -100;
        const steer = course === "drive" && tick > 200 && tick < 300 ? 127 : 0;
        stepHitchedBodies(world, tractor, steer, throttle, 0, tractorDef, trailer, trailerDef);
        line([`hitch/${course}`, tick, fields({ tractor, trailer })]);
      }
    }
  }

  // A boat through the same step as every vehicle: away from rest into a long wall, idled against it, backed off and turned.
  {
    const world = ground(-8, true, (s) => s.add(1, 100, 0, 116, 0, 0, 100), [50, 4, .05]);
    const spec = BOAT_VEHICLE.spec;
    const b = parked(BOAT_VEHICLE, 96, boatRestY(spec, 0), 60);
    b.grounded = false;
    for (let tick = 0; tick < 500; tick++) {
      const throttle = tick < 200 ? 127 : tick < 260 ? 0 : -127;
      const steer = tick > 400 && tick < 470 ? -70 : 0;
      stepVehicleBody(world, b, steer, throttle, tick >= 200 && tick < 260 ? BTN_JUMP : 0, BOAT_VEHICLE);
      line(["boat", tick, fields({ boat: b })]);
    }
  }
}

/** Every course in one hash, which tools/simhash.ts compares between JavaScriptCore and V8. */
export function vehicleTracesHash(): string {
  const hash = createHash("sha256");
  vehicleTraces((l) => hash.update(JSON.stringify(l)));
  return hash.digest("hex");
}

if (import.meta.main) vehicleTraces((l) => console.log(JSON.stringify(l)));
