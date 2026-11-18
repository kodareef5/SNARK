// An obelisk as a map sets it down (shared/world/obelisks.ts).
import { expect, test } from "bun:test";
import { OBELISK, OBELISK_PIECES, TRAVEL_TERMINAL, obeliskStatics } from "../../shared/world/obelisks.ts";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { aperture, eyePhase, eyePower, eyeRadiance, writeEyeSky } from "../../client/core/render/tide-eye.ts";
import { parseMap, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { LENS_HEIGHT, type TideEyeSite } from "../../shared/world/tide-eye.ts";
import { flatMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";

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
