import { expect, test } from "bun:test";
import { COMPACT } from "../../content/vehicles/compact.ts";
import { mapHeightfield, parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { evaluateBridgeEntrances, type EntranceReport } from "../../tools/mapworld/bridge-entrances.ts";
import { flatMap } from "../fixtures/map.ts";

test("packed entrance wheel paths expose a side-cell hole missed by the retained centre tracks", () => {
  const slabs = [62, 66].map(z => ({ kind: "core:zruin_floor4_concrete", x: 64, y: 3.8, z, yaw: 0 }));
  const source = flatMap(2, { statics: slabs });
  const hf = mapHeightfield(source);
  hf.heights.fill((4 - hf.minY) / hf.stepY);
  // The original ±1.5 m centre paths stay above the intact row. The right wheel of the outer lane
  // crosses the next triangle, whose low corner makes a real step into the slab.
  hf.setSample(31, 34, 0);
  const map = parseMap(writeMap(source), false);
  const entrance: EntranceReport["entrances"][number] = { id: 1, name: null, x: 64, y: 4, z: 64,
    dx: 1, dz: 0, width: 8, slabs };
  const report: EntranceReport = { mapHash: map.hash, entrances: [entrance] };
  const straight = evaluateBridgeEntrances(map, report);
  expect(straight.tracks).toBe(3);
  expect(straight.failed).toBe(0);
  expect(straight.wheelTrack).toBe(COMPACT.track);
  expect(straight.wheelTracks).toBe(6);
  expect(straight.wheelFailed).toBe(1);
  expect(straight.wheelLargest).toBeGreaterThan(.5);
  expect(straight.wheelLargest).toBeLessThan(.65);
  expect(straight.results[0]!.wheelHeading).toEqual({ source: "deck", dx: 1, dz: 0 });

  const approached = evaluateBridgeEntrances(map, { ...report, entrances: [{ ...entrance,
    runout: [{ x: 64, y: 4, z: 64 }, { x: 62, y: 4, z: 64.5 }] }] });
  expect(approached.results[0]!.tracks).toEqual(straight.results[0]!.tracks);
  expect(approached.largest).toBe(straight.largest);
  expect(approached.failed).toBe(straight.failed);
  expect(approached.results[0]!.wheelHeading.source).toBe("approach");
  expect(approached.results[0]!.wheelHeading.dx).toBeCloseTo(2 / Math.hypot(2, .5), 12);
  expect(approached.results[0]!.wheelHeading.dz).toBeCloseTo(-.5 / Math.hypot(2, .5), 12);
  expect(approached.wheelLargest).toBeGreaterThan(straight.wheelLargest);
});
