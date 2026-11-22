// What a frame leaves out because something drawn in it wholly hides it (client/core/render/hide.ts): a kind's plates, the
// picture's rule, and a street on flat ground drawn the same with it as without. The Miami slice's views and a flight
// through it are in hide.slow.test.ts.

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { Hiding, KindPlates } from "../../client/core/render/hide.ts";
import { CHUNK_SIZE, YAW_UNITS } from "../../shared/coords.ts";
import { SETUPS, censusWorld } from "../../tools/bench/census.ts";
import { miamiSlice } from "../fixtures/cityslice.ts";
import { building, cityWorld, slopes } from "../fixtures/cityworld.ts";
import { farPack } from "../fixtures/farworld.ts";
import { coreRegistry } from "../fixtures/world.ts";

test("a facade module's look is one plate across its whole bay, in the plane where its recessed panes meet its piers", () => {
  const slice = miamiSlice();
  const reg = coreRegistry();
  const plates = new KindPlates(censusWorld(slice.map, slice.centre, reg, farPack()).statics);
  for (const id of ["core:zruin_zlobby_limestone", "core:zruin_zwin_limestone", "core:zruin_zcurt_limestone"]) {
    const p = plates.of(reg.index.get(id)!);
    const across = [p[3]! - p[0]!, p[4]! - p[1]!, p[5]! - p[2]!].map((v) => Math.round(v * 100) / 100);
    expect(across, id).toEqual([8, 4, 0]);
  }
  // A plain kind's plate is its box.
  const wall = reg.index.get("core:zruin_wall4_limestone")!;
  expect(Array.from(plates.of(wall))).toEqual([-reg.halfX[wall]!, -reg.halfY[wall]!, -reg.halfZ[wall]!, reg.halfX[wall]!, reg.halfY[wall]!, reg.halfZ[wall]!]);
});

test("the picture hides a box wholly behind a face that covers it, and not one beside it, before it, just behind it, or at the near plane", () => {
  const cam = new Camera();
  cam.aspect = 16 / 9;
  cam.update();
  const h = new Hiding();
  h.begin(cam);
  // A wall 20 m wide and high, 0.2 m thick, 20 m ahead.
  h.box(0, 0, 20, 10, 10, 0.1, 1, 0);
  h.end();
  expect(h.on).toBe(true);
  expect(h.hides(-2, -2, 30, 2, 2, 32)).toBe(true);
  expect(h.hides(-9, -9, 21, 9, 9, 40)).toBe(true);
  // Beside it, reaching past its edge, before it, just behind its face, and from the camera's own place.
  expect(h.hides(12, -2, 30, 18, 2, 32)).toBe(false);
  expect(h.hides(-2, -2, 15, 2, 2, 19)).toBe(false);
  expect(h.hides(-2, -2, 19.9, 2, 2, 22)).toBe(false);
  expect(h.hides(-2, -2, 19.91, 2, 2, 22)).toBe(false);
  expect(h.hides(-2, -2, 0, 2, 2, 40)).toBe(false);
  // A wall seen from inside it puts nothing in the picture.
  h.begin(cam);
  h.box(0, 0, 0, 10, 10, 10, 1, 0);
  h.end();
  expect(h.on).toBe(false);
});

const HIGH = SETUPS.find((s) => s.name === "high")!;
const [W, H] = [160, 90];

test("on flat ground a street of buildings draws the same picture with what is hidden left out: the ground hides nothing level with it", () => {
  const street = (): ReturnType<typeof building> => {
    const out: ReturnType<typeof building> = [];
    for (let z = 296; z <= 456; z += 16) out.push(...building(360, z, 0, 10), ...building(392, z, 0, 10));
    out.push(...slopes(376, 340, 0, 16384).all);
    out.push(...building(380, 500, 0, 6, 2, YAW_UNITS / 12));
    return out;
  };
  const worlds = [true, false].map((hide) => {
    const w = cityWorld({ chunks: 16, statics: street(), tier: HIGH.tier, width: W, height: H });
    w.scene.hide = hide;
    for (let z = 256; z < 560; z += CHUNK_SIZE) for (let x = 320; x < 448; x += CHUNK_SIZE) w.rows(w.chunkOf(x, z));
    return w;
  });
  let hidden = 0;
  // Down in the street, from 150 m up over it, and at the foot of a building.
  for (const [x, y, z, lx, ly, lz] of [[376, 1.7, 300, 376, 6, 460], [376, 150, 230, 376, 0, 380], [376, 1.7, 330, 360, 3, 340]] as const) {
    for (const w of worlds) {
      [w.cam.x, w.cam.y, w.cam.z] = [x, y, z];
      [w.cam.yaw, w.cam.pitch] = [Math.atan2(lx - x, lz - z), Math.atan2(ly - y, Math.hypot(lx - x, lz - z))];
      for (let f = 0; f < 8; f++) w.frame(true);
    }
    let differ = 0;
    for (let i = 0; i < worlds[0]!.raster.color.length; i++) if (worlds[0]!.raster.color[i] !== worlds[1]!.raster.color[i]) differ++;
    expect(differ).toBe(0);
    hidden += worlds[0]!.scene.hiding.stats.hidden;
  }
  expect(hidden).toBeGreaterThan(0);
});
