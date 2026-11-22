import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { LAMPS_OFF, lampsOn } from "../../client/core/render/surface.ts";
import { MATERIAL_NIGHT, parsePack } from "../../shared/pack/pack.ts";

const ROOT = join(import.meta.dir, "../..");

test("a working lamp's lens glows only by night: its material says so, and the lamps are on as the true sun goes under", () => {
  const pack = parsePack(new Uint8Array(readFileSync(join(ROOT, "assets/source/core/props/street/street.snpk"))));
  const lens = pack.header.materials!.find((m) => m.id === "core:street/street_glow")!;
  expect(lens.emissive).toBeGreaterThan(0);
  expect(lens.flags & MATERIAL_NIGHT).toBe(MATERIAL_NIGHT);
  // Every other material of the set gives out no light.
  expect(pack.header.materials!.filter((m) => m.emissive > 0 || (m.flags & MATERIAL_NIGHT) !== 0).map((m) => m.id)).toEqual([lens.id]);

  // The frame carries the moon's direction, the true sun's turned round.
  const at = (sunUp: number): number => {
    const frame = new Float32Array(FRAME_FLOATS);
    frame[FRAME.moon + 1] = -sunUp;
    return lampsOn(frame);
  };
  expect(at(0.5)).toBe(0);
  expect(at(LAMPS_OFF)).toBeCloseTo(0, 6);
  expect(at(LAMPS_OFF / 2)).toBeCloseTo(0.5, 5);
  expect(at(0)).toBe(1);
  expect(at(-0.4)).toBe(1);
});
