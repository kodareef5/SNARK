import { expect, test } from "bun:test";
import { FRAME } from "../../client/core/render/packet.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { PICK_ENTITY } from "../../tools/snap/raster.ts";
import { Stage, squareMesh } from "../fixtures/stage.ts";

test("LED alpha masks emit in darkness while opaque zero-mask trim remains solid", () => {
  const mesh = squareMesh("test:car-light", 1, ["base"]);
  mesh.materials![0]!.emissive = 1.5;
  const stage = new Stage(parsePack(buildPack([mesh], defaultPalette())), 64, 64);
  [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw] = [0, .5, 1.2, Math.PI];
  const middle = 32 * 64 + 32;
  const draw = (mask: number): number[] => {
    stage.begin();
    const p = stage.packet;
    p.frame.fill(0, FRAME.sunColor, FRAME.sunColor + 3);
    p.frame.fill(0, FRAME.skyAbove, FRAME.skyAbove + 3);
    p.frame.fill(0, FRAME.skyBelow, FRAME.skyBelow + 3);
    p.frame[FRAME.skyScale] = 0;
    p.frame[FRAME.exposure] = 1;
    p.fogStart = 1000; p.fogEnd = 2000;
    stage.texture(0, "base", [Uint8Array.from([200, 160, 90, mask])]);
    stage.add("test:car-light", 0, { x: 0, y: 0, z: 0 });
    const pixels = stage.render();
    expect(stage.raster.pickKind[middle]).toBe(PICK_ENTITY);
    return [...pixels.subarray(middle * 4, middle * 4 + 3)];
  };
  const trim = draw(0), lamp = draw(255);
  expect(Math.max(...trim)).toBeLessThan(3);
  expect(lamp[0]!).toBeGreaterThan(120);
  expect(lamp[0]!).toBeGreaterThan(lamp[2]!);
});
