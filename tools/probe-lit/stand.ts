// Bodies standing in a pose on a GPU, a check of tools/probe-lit.ts: bodies the frame has too few bones to pose, each on
// one bone in the pose its draw names (packet.ts DRAW_ONE_BONE). The scene fixture's tube, on medium, takes the surface
// program; survivors of the core pack standing, crouched, armed and in armour, one astride a saddled pteranodon, and a
// raptor take the lit flat program on medium and the flat one on low poly; on medium they cast with the depth program.
// Each is held to the rasterizer at points on one body with no edge near, and enough of those must be on one-bone draws.
// The frames carry no grade (post.ts): it holds poses, and the noon grade's gain of 1.8 steepens the twins' small
// differences of light on a body past its tolerance; the lit and finish checks hold the grade to the rasterizer.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_ONE_BONE, FRAME, type FramePacket } from "../../client/core/render/packet.ts";
import { SLOT_NAMES } from "../../shared/anim/human.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { STANCE_CROUCH } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { sceneSet, sceneWorld } from "../../tests/fixtures/sceneworld.ts";
import { TUBE } from "../../tests/fixtures/textured.ts";
import { spread } from "../probe-textured.ts";
import { provingView } from "../snap.ts";
import { PICK_ENTITY, Rasterizer } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const NEAR = 3;
const SMOOTH = 3;
const TOLERANCE = { pixelP95: 4, meanWorst: 4 };
const LEAST = { all: 200, standing: 150 };

interface Made {
  w: number;
  h: number;
  frame: number;
  color: Uint8ClampedArray;
  pickKind: Uint8Array;
  pickId: Float64Array;
  pickDraw: Int16Array;
  flags: Uint32Array;
}
const made = new Map<string, Made>();

/** The tubes of the scene fixture, two of them among four survivors, with their materials on medium. */
function tubes(): Shot {
  const [W, H] = [480, 270];
  const set = sceneSet(64);
  // Two tubes and four survivors want 116 bones; with 60 each takes one and the two poses they stand in 30.
  const w = sceneWorld({}, { ...tierOf("medium"), bones: 60 }, set);
  w.scene.viewHeight = H;
  w.scene.plainSky = true;
  w.cam.aspect = W / H;
  for (let k = 0; k < 6; k++) w.place(k < 4 ? "core:survivor" : TUBE, 30.6 + k * 0.6, 23.5, { colors: [8, 7, 14, 6], yaw: Math.PI / 2 + 0.4 * k });
  const raster = new Rasterizer(W, H, w.pack, w.hf, w.manifest);
  const shot = new Shot("stand-tubes", W, H, w.hf, set.files[0]!.bytes);
  shot.manifest = set.manifest;
  for (let f = 0; f < 40; f++) {
    const p = w.frame(100, false);
    p.frame.fill(0, FRAME.grade, FRAME.gamma + 1);
    raster.render(p);
    keep(shot, p, raster, f, 39);
  }
  return shot;
}

/** The core pack's bodies on `tier`, 3 to 6 m ahead of the camera. */
function bodies(tier: string): Shot {
  const [W, H] = [960, 540];
  const view = provingView(W, H);
  const { reg, hf, cam, remote: r, scene, raster } = view;
  const id = (name: string): number => reg.index.get(`core:${name}`)!;
  // Five survivors, a raptor and a pteranodon want 210 bones; with 170 each takes one and the five poses they stand in 154.
  scene.assets.tier = { ...tierOf(tier), bones: 170 };
  scene.plainSky = true;
  cam.yaw = 0;
  cam.pitch = -0.15;
  const worn = new Array<number>(SLOT_NAMES.length).fill(0);
  reg.defs.forEach((d, k) => d?.type === "item" && d.wear && d.id.startsWith("core:hide_") && (worn[SLOT_NAMES.indexOf(d.wear.slot)] = k));
  const st = new AnimState();
  r.count = 0;
  const put = (kind: number, x: number, z: number, yaw: number, stance = 0): number => {
    const n = r.count++;
    r.id[n] = 100 + n; r.kind[n] = kind; r.x[n] = cam.x + x; r.z[n] = cam.z + z; r.y[n] = hf.heightAt(r.x[n]!, r.z[n]!); r.yaw[n] = yaw; r.flags[n] = 1;
    st.stance = stance;
    r.anim[n] = st.pack();
    r.colors.set([8, 7, 14, 6, 9, 3], n * 6);
    return n;
  };
  for (let k = 0; k < 4; k++) {
    const n = put(id("survivor"), -1.5 + k, 3.2, Math.PI * (0.8 + 0.15 * k), k % 2 ? STANCE_CROUCH : 0);
    if (k >= 2) worn.forEach((item, slot) => (r.gear[n * GEAR_COUNT + GEAR_WORN + slot] = item));
    r.gear[n * GEAR_COUNT + GEAR_HELD] = [id("rifle"), id("hatchet"), id("spear")][k % 3]!;
  }
  put(id("raptor"), -2.8, 6, Math.PI * 0.6);
  const mount = put(id("pteranodon"), 2.8, 6, Math.PI * 1.2);
  r.gear[mount * GEAR_COUNT + GEAR_WORN] = id("saddle_pteranodon");
  const rider = put(id("survivor"), 2.8, 6, Math.PI * 1.2);
  r.seat[rider] = r.id[mount]! + 1;
  r.tick = 3000;
  const shot = new Shot(`stand-${tier}`, W, H, hf, corePackBytes());
  for (let f = 0; f < 20; f++) {
    r.tick += 0.5;
    const p = scene.build(cam, r);
    if (f < 19) p.drawCount = p.tileCount = 0;
    p.frame.fill(0, FRAME.grade, FRAME.gamma + 1);
    raster.render(p);
    keep(shot, p, raster, f, 19);
  }
  return shot;
}

/** Adds frame `f` of `shot`, read back and kept with the rasterizer's picture if it is the `last`. */
function keep(shot: Shot, p: FramePacket, raster: Rasterizer, f: number, last: number): void {
  shot.add(p, f === last);
  if (f === last) made.set(shot.key, { w: raster.width, h: raster.height, frame: f, color: raster.color.slice(), pickKind: raster.pickKind.slice(), pickId: raster.pickId.slice(), pickDraw: raster.pickDraw.slice(), flags: p.drawFlags.slice(0, p.drawCount) });
}

export const standCheck: LitCheck = {
  name: "bodies standing in a pose",

  shots(): Shot[] {
    return [tubes(), bodies("medium"), bodies("lowpoly")];
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = true;
    for (const key of made.keys()) {
      const one = judged(back, key);
      ok &&= one.ok;
      lines.push(`${key}: ${one.line}`);
    }
    return { ok, lines };
  },
};

/** The GPU's picture of shot `key` against the rasterizer's, at points on one draw of one body with no edge near. */
function judged(back: Readback, key: string): { ok: boolean; line: string } {
  const m = made.get(key)!;
  const { w: W, h: H, color, pickKind, pickId, pickDraw } = m;
  const gpu = back.pixels(key, m.frame);
  if (!gpu) return { ok: false, line: "NO PICTURE" };
  const one = (i: number): boolean => {
    if (pickKind[i] !== PICK_ENTITY) return false;
    for (let dy = -NEAR; dy <= NEAR; dy++) {
      for (let dx = -NEAR; dx <= NEAR; dx++) {
        const j = i + dy * W + dx;
        if (pickId[j] !== pickId[i] || pickDraw[j] !== pickDraw[i]) return false;
        for (let c = 0; c < 3; c++) if (Math.abs(color[j * 4 + c]! - color[(j + 1) * 4 + c]!) > SMOOTH || Math.abs(color[j * 4 + c]! - color[(j + W) * 4 + c]!) > SMOOTH) return false;
      }
    }
    return true;
  };
  const pixel: number[] = [];
  const mean: number[] = [];
  let standing = 0;
  for (let y = NEAR + 2; y < H - NEAR - 2; y++) {
    for (let x = NEAR + 2; x < W - NEAR - 2; x++) {
      const i = y * W + x;
      if (!one(i)) continue;
      if ((m.flags[pickDraw[i]!]! & DRAW_ONE_BONE) !== 0) standing++;
      let most = 0;
      let mostMean = 0;
      for (let c = 0; c < 3; c++) {
        most = Math.max(most, Math.abs(gpu[i * 4 + c]! - color[i * 4 + c]!));
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += gpu[(i + dy * W + dx) * 4 + c]! - color[(i + dy * W + dx) * 4 + c]!;
        mostMean = Math.max(mostMean, Math.abs(sum / 25));
      }
      pixel.push(most);
      mean.push(mostMean);
    }
  }
  const p = spread(pixel), mm = spread(mean);
  const ok = p.points >= LEAST.all && standing >= LEAST.standing && p.p95 <= TOLERANCE.pixelP95 && mm.worst <= TOLERANCE.meanWorst;
  return { ok, line: `${p.points} points, ${standing} on one bone; pixels 95 in 100 within ${p.p95}, worst ${p.worst}; 5 by 5 means worst ${mm.worst.toFixed(2)}  ${ok ? "ok" : "FAIL"}` };
}
