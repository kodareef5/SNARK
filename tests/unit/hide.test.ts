// What a frame leaves out because something drawn in it wholly hides it (client/core/render/hide.ts), held to the
// software rasterizer: the Miami slice's views and a flight through it draw the same picture with it as without, no
// shadow left out falls where a pixel in view looks its cascade up, and less is drawn.

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { Hiding, KindPlates } from "../../client/core/render/hide.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import type { Scene } from "../../client/core/render/scene.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { SETUPS, SLICE_VIEWS, censusWorld, placeOf } from "../../tools/bench/census.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { miamiSlice } from "../fixtures/cityslice.ts";
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

/** Each a scene of the Miami slice on high, the first hiding and the second not, with a rasterizer fed every frame. */
function pair(world: ReturnType<typeof censusWorld>): { scene: Scene; raster: Rasterizer }[] {
  return [true, false].map((hide) => {
    const scene = world.scene(HIGH, H);
    scene.hide = hide;
    return { scene, raster: new Rasterizer(W, H, world.pack, world.hf) };
  });
}

/** A frame of each at `cam`, rasterized where `look`, else only taken in. */
function frame(both: { scene: Scene; raster: Rasterizer }[], cam: Camera, look: boolean): FramePacket[] {
  return both.map(({ scene, raster }) => {
    scene.now += 1000 / 60;
    const p = scene.build(cam, null);
    const [draws, tiles] = [p.drawCount, p.tileCount];
    if (!look) p.drawCount = p.tileCount = 0;
    raster.render(p);
    [p.drawCount, p.tileCount] = [draws, tiles];
    return p;
  });
}

/** Per pixel of `r`, the camera-relative point drawn there (x, y, z), or NaN where nothing is: from its depth and `p`'s ranges. */
function points(r: Rasterizer, p: FramePacket): Float64Array {
  const out = new Float64Array(W * H * 3).fill(NaN);
  const m = p.viewProj;
  const [a, b, c, d, e, f, g, h, k] = [m[0]!, m[4]!, m[8]!, m[1]!, m[5]!, m[9]!, m[3]!, m[7]!, m[11]!];
  const inv = [e * k - f * h, c * h - b * k, b * f - c * e, f * g - d * k, a * k - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  const det = a * inv[0]! + b * inv[3]! + c * inv[6]!;
  for (let at = 0; at < W * H; at++) {
    const z = r.depth[at]!;
    if (z === Infinity) continue;
    // Stored as the shell's depth ranges put it: the near range's to 0, the far range's from 0 (raster.ts stored).
    const far = p.split > 0 && z >= 0;
    const ndc = p.split > 0 ? (far ? 2 * z - 1 : 2 * z + 1) : z;
    const v = far ? p.farViewProj : p.viewProj;
    const depthA = -(v[2]! * v[3]! + v[6]! * v[7]! + v[10]! * v[11]!);
    const w = v[14]! / (ndc + depthA);
    const nx = (((at % W) + 0.5) / W) * 2 - 1, ny = 1 - ((Math.floor(at / W) + 0.5) / H) * 2;
    for (let i = 0; i < 3; i++) out[at * 3 + i] = (w * (inv[i * 3]! * nx + inv[i * 3 + 1]! * ny + inv[i * 3 + 2]!)) / det;
  }
  return out;
}

/**
 * Whether a caster or a tile's casting that `with` left out of `without`'s frame touches a texel of any cascade within
 * `reach` texels of where a point drawn in `without`'s picture looks that cascade up. `size` is the cascades' side.
 */
function shadeSeen(r: Rasterizer, without: FramePacket, with_: FramePacket, size: number, reach: number): { left: number; seen: boolean } {
  const key = (p: FramePacket, e: number): string => [p.casterMesh[e], p.casterLod[e], p.casterBuffer[e], p.casterFirst[e], p.casterInstances[e], p.casterFlags[e], p.casterFirstIndex[e], p.casterIndexCount[e], p.casterCascades[e]].join();
  const kept = new Map<string, number>();
  for (let e = 0; e < with_.casterCount; e++) kept.set(key(with_, e), (kept.get(key(with_, e)) ?? 0) + 1);
  // `without`'s frame cut to what `with` left out, and put back after.
  const count = without.casterCount, cascades = without.casterCascades.slice(), passes = without.tilePass.slice();
  let left = 0;
  for (let e = 0; e < count; e++) {
    const n = kept.get(key(without, e)) ?? 0;
    if (n > 0) {
      kept.set(key(without, e), n - 1);
      without.casterCascades[e] = 0;
    } else left++;
  }
  for (let t = 0; t < without.tileCount; t++) {
    const gone = (passes[t]! & ~with_.tilePass[t]!) & ~3;
    without.tilePass[t] = gone;
    if (gone !== 0) left++;
  }
  const at = points(r, without);
  let seen = false;
  for (let k = 0; k < without.cascadeCount && left > 0 && !seen; k++) {
    const map = r.cascade(without, k, size);
    const m = without.cascades.subarray(k * 16, k * 16 + 16);
    for (let i = 0; i < W * H && !seen; i++) {
      if (Number.isNaN(at[i * 3]!)) continue;
      const [x, y, z] = [at[i * 3]!, at[i * 3 + 1]!, at[i * 3 + 2]!];
      const u = Math.floor(((m[0]! * x + m[4]! * y + m[8]! * z + m[12]! + 1) / 2) * size), v = Math.floor(((m[1]! * x + m[5]! * y + m[9]! * z + m[13]! + 1) / 2) * size);
      for (let j = Math.max(0, v - reach); j <= Math.min(size - 1, v + reach) && !seen; j++) for (let q = Math.max(0, u - reach); q <= Math.min(size - 1, u + reach); q++) if (map[j * size + q]! < 1) seen = true;
    }
  }
  without.casterCascades.set(cascades);
  without.tilePass.set(passes);
  return { left, seen };
}

test("the Miami slice's views and a flight through it on high draw the same picture with what is hidden left out, its shadows unseen, and draw less", () => {
  const slice = miamiSlice();
  const world = censusWorld(slice.map, slice.centre, coreRegistry(), farPack());
  const cam = new Camera();
  cam.aspect = W / H;
  let draws = [0, 0], triangles = [0, 0], frames = 0, casters = 0;
  const look = (both: { scene: Scene; raster: Rasterizer }[], shadows: boolean): void => {
    const [on, off] = frame(both, cam, true);
    let differ = 0;
    for (let i = 0; i < both[0]!.raster.color.length; i++) if (both[0]!.raster.color[i] !== both[1]!.raster.color[i]) differ++;
    expect(differ).toBe(0);
    draws = [draws[0]! + on!.drawCount, draws[1]! + off!.drawCount];
    triangles = [triangles[0]! + on!.triangles, triangles[1]! + off!.triangles];
    frames++;
    if (!shadows) return;
    const { left, seen } = shadeSeen(both[1]!.raster, off!, on!, HIGH.tier.shadows.size, 4);
    expect(seen).toBe(false);
    casters += left;
  };
  // Each view settled, its shadows looked at.
  for (const v of SLICE_VIEWS) {
    [cam.x, cam.y, cam.z] = placeOf(slice.centre, world.hf, v);
    [cam.yaw, cam.pitch] = [v.yaw, v.pitch];
    world.hold(cam.x, cam.z);
    const both = pair(world);
    for (let f = 0; f < 8; f++) frame(both, cam, false);
    look(both, true);
  }
  // From the street up over the roofs, turning, the near store following the camera a chunk at a time as a client's does.
  const [street] = SLICE_VIEWS;
  [cam.x, cam.y, cam.z] = placeOf(slice.centre, world.hf, street!);
  [cam.yaw, cam.pitch] = [street!.yaw, street!.pitch];
  let chunk = -1;
  const hold = (): void => {
    const at = Math.floor(cam.x / CHUNK_SIZE) * 1000 + Math.floor(cam.z / CHUNK_SIZE);
    if (at !== chunk) world.hold(cam.x, cam.z);
    chunk = at;
  };
  hold();
  const both = pair(world);
  for (let f = 0; f < 8; f++) frame(both, cam, false);
  for (let f = 0; f < 16; f++) {
    cam.x += Math.sin(cam.yaw) * 5;
    cam.z += Math.cos(cam.yaw) * 5;
    cam.y += f < 8 ? 0.3 : 8;
    cam.yaw += 0.08;
    cam.pitch -= 0.02;
    hold();
    look(both, false);
  }
  // Less drawn: about a fifth of the draws and a sixth of the triangles over the views and the flight; and some casters left out.
  expect([frames, draws[0]! < draws[1]! * 0.9, triangles[0]! < triangles[1]! * 0.9, casters > 0]).toEqual([19, true, true, true]);
});
