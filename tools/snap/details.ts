// Small details seen as they play: a dodo does something on the proving ground, and frames at chosen moments after it
// are drawn as a client draws them, a row from 3 m and a row from 20 m, each at the size a phone at medium shows it.
// `bun run snap -- --details land --graphics medium` writes artifacts/details-land.png.

import { AnimState, CUE_DEAD, CUE_HELD, CUE_LAND, CUE_TORPOR, LAYER_FLINCH, bodySeed } from "../../shared/anim/pose.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";
import { ACT_SWING, HOLD_TOOL } from "../../shared/sim/weapon.ts";
import { GROUNDS } from "../../shared/pack/details.ts";
import { groundAt } from "../../client/core/details/ground.ts";
import type { ProvingView } from "../snap.ts";

export const DETAIL_SEQUENCES = ["land", "thrown", "struck", "down", "death", "up", "splash", "flock", "fight"] as const;
/** Seconds after the occasion each frame is drawn at. The first is just before it. */
export const MOMENTS = [-0.05, 0.1, 0.3, 0.6, 1, 1.6, 2.6, 4, 5.6, 6.6, 7.6];
/** Rows a phone at medium draws (390 CSS pixels at 1.5), and its view's height in radians. */
const PHONE_ROWS = 585;
const PHONE_FOV = (70 * Math.PI) / 180;

/** A dodo in the remote view: one more body of the scene. */
interface Bird {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  st: AnimState;
}

export interface Sequence {
  /** The frames drawn, each the rasterizer's colours, a row a distance, and what each shows. */
  frames: Uint8ClampedArray[][];
  labels: string[];
  /** Per frame of the near row: particles alive, drawn, and the blended fill in screens. */
  counts: string[];
  ground: string;
}

/**
 * Plays `which` in `view`, which the caller has filled and settled. The bird stands at (x, z) facing `yaw`; the camera
 * stands `near` metres off and then 20 m, at a phone's pixels a metre, frames `w` by `h`.
 */
export function playDetails(view: ProvingView, which: string, w: number, h: number, settle: (v: ProvingView) => void, zoom = 1, moments: readonly number[] = MOMENTS, rows = 2): Sequence {
  const { reg, hf, remote: r, scene, cam, raster } = view;
  const kind = reg.index.get("core:dodo")!;
  const survivor = reg.index.get("core:survivor")!;
  // A grassy spot beyond the plaza, or for a splash the water's edge.
  let [x0, z0] = [256, 362];
  if (which === "splash") [x0, z0] = findWater(view);
  const ground = GROUNDS[groundAt(hf, x0, hf.heightAt(x0, z0), z0)] ?? "?";
  const birds: Bird[] = [];
  const flock = which === "flock" || which === "fight";
  const count = which === "flock" ? 40 : which === "fight" ? 100 : 1;
  for (let k = 0; k < count; k++) {
    const a = k * 2.399;
    const rr = flock ? 1.2 + Math.sqrt(k) * (which === "fight" ? 1.3 : 1.1) : 0;
    const [x, z] = [x0 + Math.cos(a) * rr, z0 + 6 + Math.sin(a) * rr];
    birds.push({ id: 2000 + k * 7, x, y: hf.heightAt(x, z), z, yaw: a * 1.7, st: new AnimState() });
  }
  const sea = hf.seaLevel;
  // Each bird its own dyes from the species' sets, the first its default, so a feather shows whose it was.
  const def = reg.defs[kind]!;
  const sets = def.type === "species" ? (def.regions ?? []) : [];
  const dyes = (id: number, q: number): number => {
    const list = sets[q]?.colors ?? [];
    return list.length === 0 ? 0 : list[id === birds[0]!.id ? 0 : (id * 7 + q * 3) % list.length]![0]!;
  };
  const fill = (tick: number, t: number): void => {
    r.count = 0;
    r.tick = tick;
    const start = (s: number): number => Math.floor(tick - s * TICK_RATE) & 255;
    for (const b of birds) {
      const st = b.st;
      st.unpack(0, 0);
      let y = hf.heightAt(b.x, b.z);
      const fall = (from: number, ofT: number): void => {
        // In the air for the second before it lands, from `from` metres up.
        if (ofT < 0) {
          st.grounded = false;
          y += from * Math.min(1, -ofT) ** 0.5;
        }
      };
      if (which === "land" || which === "flock") {
        fall(1.6, t);
        if (t >= 0) [st.cue, st.cueStart] = [CUE_LAND, start(t)];
      } else if (which === "thrown") {
        // Held until the throw, then thrown, then lands 0.7 s later.
        if (t < 0) [st.held, y] = [true, y + 1];
        else if (t < 0.7) [st.grounded, st.speed, y] = [false, 6, y + 1 + 0.8 * t - 4.9 * t * t * 1.6];
        else [st.cue, st.cueStart] = [CUE_LAND, start(t - 0.7)];
      } else if (which === "struck") {
        if (t >= 0) [st.layer, st.layerStart] = [LAYER_FLINCH, start(t)];
      } else if (which === "down" || which === "fight") {
        if (t >= 0) [st.out, st.cue, st.cueStart] = [true, CUE_TORPOR, start(t)];
      } else if (which === "up") {
        st.out = t < 0;
        if (t >= 0) [st.cue, st.cueStart] = [CUE_TORPOR, start(t)];
      } else if (which === "splash") {
        if (t < 0) [st.grounded, y] = [false, sea + 1.6 * Math.min(1, -t * 2)];
        else [st.mode, y] = [MODE_SWIM, sea - 0.25];
      }
      put(b.id, kind, b.x, y, b.z, b.yaw, st, which === "death" && t >= 0 ? CUE_DEAD : 0);
    }
    if (which === "struck") {
      // A survivor a step off swings at it, just before the flinch.
      const st = new AnimState();
      st.setAction(ACT_SWING, HOLD_TOOL, start(Math.max(0, t) + 0.15));
      const b = birds[0]!;
      put(1900, survivor, b.x - 1.3, hf.heightAt(b.x - 1.3, b.z), b.z, Math.PI / 2, st, 0);
    }
  };
  const put = (id: number, k: number, x: number, y: number, z: number, yaw: number, st: AnimState, dead: number): void => {
    const n = r.count++;
    [r.id[n], r.kind[n], r.x[n], r.y[n], r.z[n], r.yaw[n], r.flags[n]] = [id, k, x, y, z, yaw, st.grounded ? 1 : 0];
    for (let q = 0; q < 6; q++) r.colors[n * 6 + q] = k === kind ? dyes(id, q) : 0;
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    [r.span[n], r.grown[n], r.seat[n], r.hasLook[n]] = [0, 0, 0, 0];
    r.anim[n] = st.pack();
    r.cue[n] = (st.packCue() | dead) >>> 0;
    if (st.held) r.cue[n] = (r.cue[n]! | CUE_HELD) >>> 0;
  };
  // Remote ids are sorted, as a view is.
  birds.sort((a, b) => a.id - b.id);

  const b0 = birds[0]!;
  // From a survivor's eye, looking at the ground the bird stands on.
  const views = [
    { metres: flock ? 16 : 3, height: flock ? 4 : 1.6 },
    { metres: flock ? 34 : 20, height: flock ? 6 : 1.7 },
  ];
  const frames: Uint8ClampedArray[][] = views.map(() => []);
  const counts: string[] = [];
  const labels = moments.map((m) => `${m < 0 ? "before" : `${m.toFixed(1)} s`}`);
  views.slice(0, rows).forEach((v, row) => {
    // A phone's pixels a metre at that distance, in a frame `h` rows high.
    cam.fovY = 2 * Math.atan((h / (PHONE_ROWS * zoom)) * Math.tan(PHONE_FOV / 2));
    cam.aspect = w / h;
    const look = which === "struck" ? -0.9 : 0.5;
    const [ax, az] = flock ? [x0, z0 + 6] : [b0.x, b0.z];
    cam.x = ax - Math.sin(look) * v.metres;
    cam.z = az - Math.cos(look) * v.metres;
    cam.y = hf.heightAt(b0.x, b0.z) + v.height;
    cam.yaw = look;
    cam.pitch = -Math.atan2(v.height - 0.2, v.metres);
    // A fresh run for each row, from a second before the occasion, sixty frames a second.
    const t0 = 1000;
    let tick = t0 - TICK_RATE * 1.2;
    fill(tick, -1.2);
    settle(view);
    let next = 0;
    if (which === "death") r.died = new Map();
    while (next < moments.length) {
      tick += 0.5;
      scene.now += 1000 / 60;
      const t = (tick - t0) / TICK_RATE;
      fill(tick, t);
      if (which === "death") {
        // The bodies' entities go and their corpses come under new ids, as the server sends them.
        if (t >= 0) {
          r.died = new Map(birds.map((b) => [b.id, t0] as const));
          for (let n = 0; n < r.count; n++) r.id[n] = r.id[n]! + 1;
        }
      }
      const p = scene.build(cam, r);
      if (t >= moments[next]! || p.assetUploads.length + p.texUploads.length > 0) raster.render(p);
      if (t < moments[next]!) continue;
      frames[row]!.push(raster.color.slice());
      if (row === 0) counts.push(`${scene.details.pool.count} alive, ${p.detailCount} drawn, fill ${p.detailFill.toFixed(3)}`);
      next++;
    }
  });
  void bodySeed;
  return { frames, labels, counts, ground };
}

/** A point on the proving ground a metre from the water's edge, out in the water. */
function findWater(view: ProvingView): [number, number] {
  const hf = view.hf;
  for (let z = 256; z < 300; z += 1) for (let x = 140; x < 200; x += 1) if (hf.heightAt(x, z) < hf.seaLevel - 0.6 && hf.heightAt(x + 3, z) > hf.seaLevel) return [x, z - 6];
  return [172, 250];
}
