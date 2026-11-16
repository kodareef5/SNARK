// A creature in its saddle, for pictures, drawn as every client draws it from the gear on the wire (D491): rows through
// what it plays, each wearing the saddle, and a row with a rider seated in the seat's whole frame and one bare beside.
// `bun run snap -- --saddles worn --graphics all` draws the sample raptor with its code-made saddle (tests/fixtures/saddles.ts),
// `--saddles saddled` with its code-made saddled model, and `--saddles own --species core:pteranodon` a species' own art.
// `--close MOMENT` draws one near, in one of the moments below ("ridden, biting" unless named), and `--levels` that at each
// of its levels side by side.

import type { Camera } from "../../client/core/render/camera.ts";
import type { RemoteSample } from "../../client/core/session.ts";
import type { Assets } from "../../client/core/assets/assets.ts";
import { AnimState, CUE_TORPOR, bodySeed } from "../../shared/anim/pose.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { STANCE_CROUCH } from "../../shared/sim/character.ts";
import { ACT_SWING, HOLD_HANDS } from "../../shared/sim/weapon.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";

interface View {
  readonly reg: Registry;
  readonly hf: Heightfield;
  readonly cam: Camera;
  readonly remote: RemoteSample;
}

type Label = { text: string; at: [number, number, number] };
type Moment = [label: string, set: (s: AnimState, tick: number) => void, ridden?: boolean];

/** What it plays, a moment of each, three to a row; the last row ridden but its last, which is bare. */
const ROWS: readonly (readonly Moment[])[] = [
  [["idle", () => {}], ["walk", (s) => (s.speed = 4)], ["run", (s) => (s.speed = 12)]],
  [["bite", (s, tick) => s.setAction(ACT_SWING, HOLD_HANDS, tick - 9)], ["in the air", (s) => (s.grounded = false)], ["going down", (s, tick) => ((s.out = true), (s.cue = CUE_TORPOR), (s.cueStart = (tick - 18) & 255))]],
  [["ridden", () => {}, true], ["ridden, running", (s) => (s.speed = 12), true], ["ridden, biting", (s, tick) => s.setAction(ACT_SWING, HOLD_HANDS, tick - 9), true]],
];

/** The smallest id past `from` whose body clock runs `seed` ticks ahead, so each body is where its moment puts it. */
function idWithSeed(seed: number, from: number): number {
  for (let id = from; ; id++) if (bodySeed(id) === seed) return id;
}

/**
 * `species` wearing `saddle` in rows through what it plays, the last row ridden but for one bare body at its end, seen
 * from its side and a little above; or with `close` naming one of those moments, that one filling the view. Its regions
 * are in `colors`. Returns the words to write under each.
 */
export function saddlesScene(view: View, species: string, saddle: string, tick: number, close: string, colors: readonly number[] = []): Label[] {
  const { reg, hf, cam } = view;
  const r = view.remote;
  r.count = 0;
  r.tick = tick;
  const kind = reg.index.get(species)!;
  const def = reg.defs[kind]!;
  const length = def.type === "species" ? def.radius * 5 : 3;
  const st = new AnimState();
  const labels: Label[] = [];
  const put = (k: number, x: number, z: number, worn: number, set: (s: AnimState, tick: number) => void): number => {
    const n = r.count++;
    r.id[n] = idWithSeed(0, (n + 1) * 1024);
    [r.kind[n], r.x[n], r.z[n], r.y[n], r.yaw[n], r.flags[n]] = [k, x, z, hf.heightAt(x, z), Math.PI / 2, 1];
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    r.gear[n * GEAR_COUNT + GEAR_WORN] = worn;
    for (let q = 0; q < 6; q++) r.colors[n * 6 + q] = k === kind ? (colors[q] ?? 0) : 0;
    r.span[n] = r.grown[n] = r.seat[n] = r.hasLook[n] = 0;
    st.unpack(0);
    set(st, tick);
    if (!st.grounded) r.flags[n] = 0;
    r.anim[n] = st.pack();
    r.cue[n] = st.packCue();
    return n;
  };
  const ride = (mount: number): void => {
    const rider = put(reg.index.get("core:survivor")!, r.x[mount]!, r.z[mount]!, 0, (s) => (s.stance = STANCE_CROUCH));
    r.seat[rider] = r.id[mount]! + 1;
  };
  const [x0, z0] = [256, 236];
  const worn = reg.index.get(saddle) ?? 0;
  if (close !== "") {
    const moment = ROWS.flat().find(([text]) => text === close);
    if (!moment) throw new Error(`--close takes ${ROWS.flat().map(([text]) => `"${text}"`).join(", ")}, not "${close}"`);
    const n = put(kind, x0, z0, worn, moment[1]);
    if (moment[2]) ride(n);
    // Looking at the middle of its length from before its shoulder and a little above, near enough to fill the view.
    cam.fovY = 0.35;
    const far = (length * 0.62) / Math.tan(cam.fovY / 2);
    const [yaw, pitch] = [0.42, -0.2];
    const [tx, ty, tz] = [x0 - length * 0.12, hf.heightAt(x0, z0) + 0.85, z0];
    [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [tx - far * Math.sin(yaw) * Math.cos(pitch), ty - far * Math.sin(pitch), tz - far * Math.cos(yaw) * Math.cos(pitch), yaw, pitch];
    return labels;
  }
  const gap = length * 1.45;
  ROWS.forEach((row, j) => {
    row.forEach(([text, set, ridden], i) => {
      // The camera looks along +Z, so -X is to its right: a row reads from left to right.
      const x = x0 - (i - 1) * gap;
      const z = z0 + j * gap * 1.1;
      const n = put(kind, x, z, worn, set);
      if (ridden) ride(n);
      labels.push({ text, at: [x + text.length * 0.07, r.y[n]!, z - gap * 0.28] });
    });
  });
  // One bare beside the ridden ones, to compare.
  const bare = put(kind, x0 - 2 * gap, z0 + 2 * gap * 1.1, 0, () => {});
  labels.push({ text: "bare", at: [r.x[bare]! + 0.28, r.y[bare]!, r.z[bare]! - gap * 0.28] });
  // Far enough back for the four across and a body's length, from above the middle row's front, looking down at it.
  cam.fovY = 0.42;
  const across = Math.atan(Math.tan(cam.fovY / 2) * cam.aspect);
  const far = (1.25 * (gap * 1.5 + length * 0.6)) / Math.tan(across);
  const down = 0.6;
  [cam.x, cam.z, cam.y, cam.yaw, cam.pitch] = [x0 - gap * 0.5 + length * 0.2, z0 + gap * 0.9 - far * Math.cos(down), hf.heightAt(x0, z0) + 0.5 + far * Math.sin(down), 0, -down];
  return labels;
}

/**
 * Makes the body nearest the camera be drawn at `level` of its mesh (`mesh`, by the pack's index) by how coarse the
 * tier lets a body be, as the governor's bodies step does (Tier.bodyError), so a picture shows that level near.
 */
export function atLevel(assets: Assets, view: View, mesh: number, level: number, height: number): void {
  const errors = assets.table.error[mesh]!;
  const r = view.remote;
  const cam = view.cam;
  const d = Math.hypot(r.x[0]! - cam.x, r.y[0]! - cam.y, r.z[0]! - cam.z);
  // Halfway between this level's error and the next's, or past the last's.
  const want = level + 1 < errors.length ? (errors[level]! + errors[level + 1]!) / 2 : errors[level]! * 2 + 0.01;
  const scale = height / (2 * Math.tan(cam.fovY / 2));
  assets.tier = { ...assets.tier, bodyError: (want * scale) / (assets.tier.threshold * d) };
}
