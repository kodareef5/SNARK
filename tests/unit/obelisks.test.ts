// An obelisk as a map sets it down (shared/world/obelisks.ts).
import { expect, test } from "bun:test";
import { OBELISK, OBELISK_PIECES, TRAVEL_TERMINAL, obeliskStatics } from "../../shared/world/obelisks.ts";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { aperture, eyePhase, eyePower, eyeRadiance, shutterOpening, writeEyeSky } from "../../client/core/render/tide-eye.ts";
import { parseMap, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { LENS_HEIGHT, type TideEyeSite } from "../../shared/world/tide-eye.ts";
import { flatMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";

import { placeCamera } from "../../tools/mapworld/obelisk-cameras.ts";
import { placeObelisks, gradeTransferDecks } from "../../tools/mapworld/places.ts";
import { gridAt } from "../../tools/mapworld/base.ts";
import { S, type Ground, type World } from "../../tools/mapworld/ground.ts";

const reg = coreRegistry();

test("an obelisk stands on the ground, three pieces high, with its terminal on the ground a step in front of it along its facing", () => {
  const ground = (x: number, z: number): number => x * 0.01 + z * 0.02;
  const pieces = obeliskStatics(reg, { name: "north", x: 300, z: 200, yaw: 16384 }, ground);
  expect(pieces.map((p) => p.kind)).toEqual([...Array<string>(OBELISK_PIECES).fill(OBELISK), TRAVEL_TERMINAL]);
  const [low, , top, terminal] = pieces;
  expect([low!.y, top!.y + 15]).toEqual([ground(300, 200) + 15, ground(300, 200) + 90]);
  // A quarter turn faces +x: the terminal stands 3 + 1.5 + 0.3 m out that way, on the ground there.
  expect([terminal!.x, terminal!.z, terminal!.y].map((v) => Math.round(v * 1000) / 1000)).toEqual([304.8, 200, Math.round((ground(304.8, 200) + 0.6) * 1000) / 1000]);
});

test("a Tide Eye streams its site in the map head and keeps the deck centre and the lens opening clear", () => {
  const site = { name: "Virginia Key", color: "blue", x: 64, z: 64, y: 3.5, yaw: 0, radius: 70 } as const;
  const bytes = writeMap(flatMap(4, { tideEyes: [site] }));
  expect(readHead(bytes).tideEyes).toEqual([site]);
  expect(parseMap(bytes).tideEyes).toEqual([site]);
  expect(readHead(writeMap(flatMap(4))).tideEyes).toBeUndefined();
  expect(() => writeMap(flatMap(4, { tideEyes: [{ ...site, radius: 0 }] }))).toThrow("invalid Tide Eye");
  const parts = obeliskStatics(reg, site, () => site.y);
  const terminal = parts.pop()!;
  expect([terminal.kind, terminal.x, terminal.z]).toEqual([TRAVEL_TERMINAL, site.x, site.z]);
  expect(parts.length).toBeGreaterThan(30);
  for (const p of parts) {
    const k = reg.index.get(p.kind)!;
    expect(p.y - reg.halfY[k]!).toBeGreaterThan(site.y + 250);
    const inPupil = Math.abs(p.y - site.y - LENS_HEIGHT) < reg.halfY[k]! + 10 && Math.abs(p.x - site.x) < reg.halfX[k]! + 10;
    expect(inPupil).toBe(false);
  }
});

test("three observers share each site's ignition clock, and the sky optics follow the landmark through parallax", () => {
  const blue = { name: "Blue", color: "blue", x: 3000, z: 4000, y: 4, yaw: 0, radius: 70 } as const;
  expect([blue, { ...blue, color: "red" }, { ...blue, color: "green" }].map(site => eyePhase(15, site as TideEyeSite))).toEqual([15, 55, 95]);
  expect([aperture(2), eyePower(15), aperture(32), eyePower(32)]).toEqual([0, 1, 1, 0]);
  const frame = new Float32Array(FRAME_FLOATS);
  writeEyeSky(frame, [blue], 15, 0, 0, 0);
  expect([...frame.slice(FRAME.eyes, FRAME.eyes + 4)]).toEqual([3000, 3450, 4000, 15]);
  const ray = [3 / Math.sqrt(26), 1 / Math.sqrt(26), 4 / Math.sqrt(26)];
  const light = new Float64Array(3);
  eyeRadiance(frame, ray, light);
  expect(light[2]!).toBeGreaterThan(light[0]!);
  const skyDistance = Math.hypot(3000, 3450, 4000);
  expect(eyeRadiance(frame, [3000 / skyDistance, 3450 / skyDistance, 4000 / skyDistance], light)).toBeCloseTo(0.22, 3);
  expect(eyeRadiance(frame, [-1, 0, 0], light)).toBe(1);
  writeEyeSky(frame, [blue], 135, 10, 2000, 30);
  expect([...frame.slice(FRAME.eyes, FRAME.eyes + 4)]).toEqual([2990, 1450, 3970, 15]);
  writeEyeSky(frame, [blue], 2, 0, 0, 0);
  expect(frame.slice(FRAME.eyes).every(v => v === 0)).toBe(true);
});

test("a rebuilt Wynwood keeps its Sextant bow and transfer point, while an older red header keeps the fork", () => {
  const old = { name: "Wynwood", color: "red", x: 192, y: 5, z: 192, yaw: 0, radius: 64 } as const;
  const site = { ...old, form: "sextant" } as const;
  const blue = { ...old, name: "Virginia Key", color: "blue", x: 32 } as const;
  const bytes = writeMap(flatMap(8, { tideEyes: [blue, site] }));
  expect(readHead(bytes).tideEyes).toEqual([blue, site]);
  expect(parseMap(bytes).tideEyes).toEqual([blue, site]);
  expect(readHead(writeMap(flatMap(8, { tideEyes: [old] }))).tideEyes).toEqual([old]);
  const parts = obeliskStatics(reg, site, () => site.y);
  const fork = obeliskStatics(reg, old, () => site.y);
  expect(parts.at(-1)).toEqual(fork.at(-1));
  // At the axle height only the far rim and the keel are solid. The middle is open sky.
  const axle = parts.filter(p => Math.abs(p.y - (site.y + 496)) < 12);
  expect(axle.some(p => p.x < site.x - 140)).toBe(true);
  expect(axle.some(p => Math.abs(p.x - site.x) < 20)).toBe(true);
  expect(axle.some(p => p.x < site.x - 45 && p.x > site.x - 125)).toBe(false);
  expect(fork.some(p => p.x < site.x - 140)).toBe(false);
});

test("the Sextant's moving white index leads an open red arc above the player's flight ceiling", () => {
  const site = { name: "Wynwood", form: "sextant", color: "red", x: 200, z: 340, y: 5, yaw: 0, radius: 64 } as const;
  const frame = new Float32Array(FRAME_FLOATS);
  writeEyeSky(frame, [site], 95.5, site.x + 19, 0, site.z);
  expect([...frame.slice(FRAME.eyes, FRAME.eyes + 4)]).toEqual([0, 3450, 0, 135.5]);
  const theta = 0.54 * (15.5 - 9);
  const radius = 1.09 + 0.055 * Math.sin(2 * theta) - 0.014 * Math.sin(9 * theta - 15.5 * 0.64);
  const x = 1000 * radius * Math.cos(theta), z = 1000 * radius * Math.sin(theta) / 1.16;
  const length = Math.hypot(x, 3450, z);
  const light = new Float64Array(3);
  expect(eyeRadiance(frame, [x / length, 3450 / length, z / length], light)).toBe(1);
  expect(light[2]!).toBeGreaterThan(2);
  writeEyeSky(frame, [site], 85, site.x, 0, site.z);
  expect(frame.slice(FRAME.eyes).every(v => v === 0)).toBe(true);
});

test("the Lantern streams on rebuilt maps with three banks of shutters, solid uprights and an open deck", () => {
  const old = { name: "Golf Club", color: "green", x: 192, z: 192, y: 2.1, yaw: 0, radius: 64 } as const;
  const site = { ...old, form: "lantern" } as const;
  const eyes = [site, { ...old, name: "Wynwood", form: "sextant", color: "red" }, old] as const;
  const bytes = writeMap(flatMap(8, { tideEyes: [...eyes] }));
  expect(readHead(bytes).tideEyes).toEqual([...eyes]);
  expect(parseMap(bytes).tideEyes).toEqual([...eyes]);
  const pieces = obeliskStatics(reg, site, () => site.y);
  expect(pieces.pop()).toEqual(obeliskStatics(reg, old, () => old.y).at(-1));
  const across = pieces.filter(p => Math.abs(p.y - site.y - 270 - 168) < 12);
  expect(across).toHaveLength(3);
  expect(across.every(p => Math.hypot(p.x-site.x,p.z-site.z) > 45)).toBe(true);
  const openness = (t: number) => [0,1,2].map(bank => shutterOpening(t,bank));
  expect(openness(2)).toEqual([0,0,0]);
  expect(openness(8)[0]!).toBeGreaterThan(openness(8)[1]!);
  expect(openness(8)[1]!).toBeGreaterThan(openness(8)[2]!);
  expect(openness(16)).toEqual([1,1,1]);
  expect(openness(119)[0]!).toBeGreaterThan(openness(119)[2]!);
});

test("the Lantern curtains surround a dark centre, with green folds above the flight ceiling", () => {
  const site = { name: "Golf", color: "green", form: "lantern", x: 0, y: 3, z: 0, radius: 64, yaw: 0 } as const;
  const frame = new Float32Array(FRAME_FLOATS);
  writeEyeSky(frame, [site], 55.5, 0, 3000, 0);
  expect([...frame.slice(FRAME.eyes,FRAME.eyes+4)]).toEqual([0,450,0,255.5]);
  const middle = new Float64Array(3);
  expect(eyeRadiance(frame,[0,1,0],middle)).toBeCloseTo(.18,3);
  expect(middle[1]).toBe(0);
  const ring = Array.from({length: 90}, (_, i) => {
    const a = i * Math.PI / 45, length = Math.hypot(1000,450), light = new Float64Array(3);
    eyeRadiance(frame,[1000*Math.cos(a)/length,450/length,1000*Math.sin(a)/length],light);
    return light[1]! - light[0]!;
  });
  expect(Math.max(...ring)).toBeGreaterThan(1);
  expect(Math.min(...ring)).toBeLessThan(.3);
});

test("a transfer deck and its graded edge stay clear of a road and an inland lake", () => {
  const grid = gridAt([-128, -128, 128, 128]);
  const n = grid.nx * grid.nz, height = new Float32Array(n), surface = new Uint8Array(n).fill(S.GREEN), body = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const col = i % grid.nx;
    height[i] = 2 + col / 20;
    if (col >= 48 && col <= 80) surface[i] = S.STREET;
    if (col > 80) body[i] = 1;
  }
  const at: [number, number] = [64, 64];
  const world = { obelisks: [{ name: "Test", at, face: [64, 65], color: "blue" }] } as unknown as World;
  const ground = { grid, height, surface, water: new Uint8Array(n), lakes: { body } } as unknown as Ground;
  const [site] = placeObelisks(ground, world, (c, r) => [c, r], new Uint8Array(n));
  const col = (grid.x1 - site!.x) / 2;
  expect(site!.radius).toBeGreaterThanOrEqual(16);
  expect(col + (site!.radius! + 4) / 2).toBeLessThan(48);
  const before = height.slice();
  gradeTransferDecks(ground, [site!], 0, .25);
  expect(height).not.toEqual(before);
  expect(height.filter((_, i) => surface[i] === S.STREET || body[i]! > 0)).toEqual(before.filter((_, i) => surface[i] === S.STREET || body[i]! > 0));
});

test("review cameras track the generated site and can watch from a named spawn", () => {
  const head = { tideEyes: [{ name: "Wynwood", x: 170, z: 230, y: 2, yaw: 0, color: "red", radius: 28 }], spawns: [{ name: "Bayfront Park", x: 45, z: 68, yaw: 0 }] } as const;
  const view = { obelisk: "Wynwood", x: 4, z: -2, look: [1, 2, 400] as [number, number, number] };
  expect(placeCamera(view, head)).toMatchObject({ x: 174, z: 228, look: [171, 232, 400] });
  expect(placeCamera({ ...view, fromSpawn: "Bayfront Park" }, head)).toMatchObject({ x: 49, z: 66, look: [171, 232, 400] });
  expect(() => placeCamera(view, { spawns: [] })).toThrow("Wynwood");
});
