import { expect, test } from "bun:test";
import { parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";

test("authored vehicle heights and condition ranges survive the map codec without changing old placements", () => {
  const vehicles = [
    { kind: "core:compact", x: 20, z: 20, yaw: 0 },
    { kind: "core:helicopter_rescue", id: "hospital-roof", x: 40, y: 32.25, z: 40, yaw: 16384, condition: [.25, .8] as const, fuel: [0, .4] as const },
  ];
  const bytes = writeMap(flatMap(2, { vehicles }));
  const restored = parseMap(bytes);
  expect(restored.vehicles).toEqual(vehicles);
  expect(writeMap(restored)).toEqual(bytes);
});

test("vehicle placement rejects duplicate identities and invalid condition ranges before writing", () => {
  const v = { kind: "core:compact", id: "one", x: 20, z: 20, yaw: 0 };
  expect(() => writeMap(flatMap(1, { vehicles: [v, v] }))).toThrow("unique");
  for (const range of [[-.1, 1], [.5, .2], [0, 1.01], [0, NaN]] as const) {
    expect(() => writeMap(flatMap(1, { vehicles: [{ ...v, condition: range }] }))).toThrow("ordered fractions");
  }
  expect(() => writeMap(flatMap(1, { vehicles: [{ ...v, y: Infinity }] }))).toThrow("landing height");
});
