// The street corners (corners.ts): where two streets cross, each corner's arc lies on both kerbs, its return piece is the
// rule's radius, the ground is painted round it, and a body and a car cross its curb and its ramp as a straight walk's.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURB_RETURN, curbReturnKind, returnMiddle, returnTop } from "../../content/curbs.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { ASPHALT, COMPACT } from "../../content/vehicles/compact.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { createVehicle, stepVehicle } from "../../shared/sim/vehicle.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
import { flatWorld } from "../../tests/fixtures/world.ts";
import { gridAt } from "./base.ts";
import { onReturn, planCorners, roundGround, type ReturnRules } from "./corners.ts";
import { readStreetGraph } from "./street-graph.ts";

const RULES: ReturnRules = { classes: ["S1400", "S1640"], walked: ["S1400"], radius: [[3.5, 4], [5, 6], [99, 8]], least: 3, angles: [30, 150], within: 2.5 };

/** Two streets 8.6 m wide crossing at (50, 50), each 100 m long, as roads.geojson draws them: cut where they meet. */
function crossing(): ReturnType<typeof readStreetGraph> {
  const folder = mkdtempSync(join(tmpdir(), "corners-"));
  mkdirSync(join(folder, "base"));
  const road = (id: string, to: number[]) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [[50, 50], to] }, properties: { id, mtfcc: "S1400", width_m: 8.6 } });
  writeFileSync(join(folder, "base/roads.geojson"), JSON.stringify({ type: "FeatureCollection", features: [road("e", [100, 50]), road("w", [0, 50]), road("n", [50, 100]), road("s", [50, 0])] }));
  const graph = readStreetGraph(folder, (e, n) => [e, n]);
  rmSync(folder, { recursive: true });
  return graph;
}

test("each corner of a crossing turns on a 6 m return whose arc's ends lie on both kerbs, the walks beginning past its straight ends' middles", () => {
  const corners = planCorners(crossing(), RULES);
  expect(corners.length).toBe(4);
  for (const c of corners) {
    expect([c.piece?.kind, c.radius, Math.round((c.angle * 180) / Math.PI)]).toEqual([curbReturnKind(6), 6, 90]);
    // Each end of the arc, a radius from its centre, is half a street from the other street's middle line, and the walk
    // begins along it a half street, a radius and half a straight end from the junction.
    for (const [arm, ux, uz, along] of [[c.a, c.ax, c.az, c.alongA], [c.b, c.bx, c.bz, c.alongB]] as const) {
      const x = c.cx + c.radius * ux - c.x, z = c.cz + c.radius * uz - c.z;
      expect(Math.abs(Math.abs(x * arm.dz - z * arm.dx) - 4.3)).toBeLessThan(1e-9);
      expect(Math.abs(x * arm.dx + z * arm.dz + CURB_RETURN.joint / 2 - along)).toBeLessThan(1e-9);
      expect(Math.abs(along - (4.3 + 6 + CURB_RETURN.joint / 2))).toBeLessThan(1e-9);
    }
  }
});

test("the ground round a corner is street outside its arc and sidewalk behind its curb, and as it was past the arc's ends", () => {
  const corners = planCorners(crossing(), RULES);
  const grid = gridAt([0, 0, 100, 100]);
  const at = (x: number, z: number): number => ((grid.z1 - z) / 2) * grid.nx + (grid.x1 - x) / 2;
  const roads = new Uint8Array(grid.nx * grid.nz), use = new Uint8Array(grid.nx * grid.nz);
  for (let row = 0; row < grid.nz; row++) for (let col = 0; col < grid.nx; col++) {
    const x = grid.x1 - col * 2, z = grid.z1 - row * 2;
    if (Math.abs(x - 50) <= 4.3 || Math.abs(z - 50) <= 4.3) roads[row * grid.nx + col] = 1;
  }
  const painted = roundGround(corners, grid, roads, use, () => true);
  expect(painted.road).toBeGreaterThan(0);
  // The kerbs' corner is (54.3, 54.3) and the arc's centre (60.3, 60.3): (56, 56) is 6.1 m from it, past the face, and
  // (58, 58) 3.3 m, behind the curb; (56, 64) is past the arc's end on the kerb.
  expect([roads[at(56, 56)], roads[at(58, 58)], use[at(58, 58)], roads[at(56, 64)], use[at(56, 64)]]).toEqual([1, 0, 1, 0, 0]);
});

test("a return's walked parts are its walk's top round the arc, the ramp falling at its middle", () => {
  for (const radius of [4, 6, 8]) {
    const def = CORE_CONTENT.find((d) => d.id === curbReturnKind(radius))!;
    const shape = CORE_CONTENT.find((d) => d.type === "shape" && def.type === "structure" && d.id === def.shape)!;
    if (shape.type !== "shape") throw new Error(String(radius));
    const tops = shape.hulls!.flatMap((h) => h.corners.filter((c) => c[1] > -0.07).map((c) => c[1]));
    expect([radius, shape.hulls!.length, Math.max(...tops), Math.min(...tops) < 0.075 - 0.12]).toEqual([radius, 12, 0.075, true]);
    expect(returnTop(radius, Math.PI / 4, radius)).toBeCloseTo(CURB_RETURN.height - CURB_RETURN.drop, 9);
    expect(returnTop(radius, 0, radius)).toBe(CURB_RETURN.height);
  }
  // Every return sorts after every core id there was before it, so no index moves; only kinds added since sort after it:
  // the moored hulls and the docks (content/docks.ts), the street cars (content/vehicles/wrecks.ts) and the bent sections
  // (content/bends.ts).
  const later = (id: string): boolean => /^core:(zzzzhull|zzzzdock|zzzzroad_|zzzzzbend)/.test(id);
  const ids = CORE_CONTENT.map((d) => d.id).sort().filter((id) => !later(id));
  expect(ids.slice(-6).every((id) => id.startsWith("core:zzzcurb"))).toBe(true);
  expect(CORE_CONTENT.map((d) => d.id).sort().slice(ids.length).every(later)).toBe(true);
});

/** A 6 m return in a flat world, its kerbs' corner at (100, 100) and the block toward +x and +z. */
function laid(): { w: ReturnType<typeof flatWorld>; piece: { kind: string; x: number; y: number; z: number; yaw: number } } {
  const w = flatWorld(4); const [m] = returnMiddle(6);
  const piece = { kind: curbReturnKind(6), x: 100 + m, y: CURB_RETURN.height / 2, z: 100 + m, yaw: 0 };
  w.structs.add(w.kind(piece.kind), piece.x, piece.y, piece.z, 0, 0, 1);
  return { w, piece };
}

test("a body steps up a return's curb and walks down its ramp to the road, and a car crosses its curb straight and slantwise and over its ramp", () => {
  for (const walker of ["core:survivor", "core:trike", "core:raptor"]) {
    // Up the curb a fifth of the way round, where the walk is full height, onto the walk.
    const { w, piece } = laid(); const params = w.reg.move[w.kind(walker)]!; const b = new Body();
    [b.x, b.z, b.y, b.grounded] = [105, 97, 0, true];
    for (let tick = 0; tick < 200 && b.z < 101.6; tick++) stepBody(w, b, 0, 90, 0, 0, 0, params, TICK_DT);
    expect([walker, b.z > 101.6, Math.abs(b.y - 0.15) < 0.02, Math.abs(b.y - onReturn(piece, b.x, b.z)!.top) < 0.02]).toEqual([walker, true, true, true]);
    // From the back of the walk at the arc's middle, down the ramp, out onto the road.
    const r = 6 - CURB_RETURN.walk + 0.2, c = Math.SQRT1_2;
    [b.x, b.z, b.y, b.grounded, b.vx, b.vy, b.vz] = [106 - r * c, 106 - r * c, 0.15, true, 0, 0, 0];
    const yaw = Math.round((Math.atan2(-1, -1) * 65536) / (2 * Math.PI)) & 65535;
    for (let tick = 0; tick < 200 && b.x > 99; tick++) stepBody(w, b, 0, 90, yaw, 0, 0, params, TICK_DT);
    expect([walker, b.x <= 99, Math.abs(b.y) < 0.02]).toEqual([walker, true, true]);
  }
  const coast = { throttle: 0.3, steer: 0, brake: 0, handbrake: false, neutral: false };
  for (const [x, z, yaw] of [[105, 88, 0], [100, 88, Math.PI / 8], [94, 94, Math.PI / 4]] as const) {
    const { w } = laid(); const world = new StaticVehicleWorld({ hf: w.hf, structs: w.structs }, () => ASPHALT);
    const car = createVehicle(COMPACT, x, 0, z, yaw); car.vx = 8 * Math.sin(yaw); car.vz = 8 * Math.cos(yaw);
    for (let tick = 0; tick < 150; tick++) stepVehicle(car, coast, COMPACT, world);
    expect([x, z, car.z > 103.5]).toEqual([x, z, true]);
  }
});
