// A ridden flight on the block-out pteranodon (tests/fixtures/flyer), flown on a server and drawn by the game's renderer
// as a client draws what it is sent, tick by tick, so each body's gait is carried from frame to frame. A picture is
// taken at each moment of MOMENTS, the camera beside the flyer. `bun tools/snap.ts --flight` writes the sheet.

import type { Camera } from "../../client/core/render/camera.ts";
import type { RemoteSample } from "../../client/core/session.ts";
import { AnimState, CUE_LAND, CUE_ROLL, CUE_TAKEOFF } from "../../shared/anim/pose.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";
import { LOOK_BYTES } from "../../shared/anim/look.ts";
import { MODE_FLYER } from "../../shared/sim/character.ts";
import { flyCourse, mounted } from "../../tests/fixtures/flyer/course.ts";
import ASSET from "../../tests/fixtures/flyer/asset.ts";

/** One tick of the flyer and its rider as the server had them. */
interface Tick {
  tick: number;
  part: string;
  bodies: { id: number; kind: number; x: number; y: number; z: number; yaw: number; flags: number; anim: number; cue: number; seat: number; look: Uint8Array | null }[];
}

export interface Flight {
  ticks: Tick[];
  flyer: number;
}

/** Flies the course and keeps every tick of it. */
export function recordFlight(): Flight {
  const m = mounted();
  const { h, e } = m;
  const ents = h.world.ents;
  const rider = h.ent(m.ada);
  const ticks: Tick[] = [];
  let part = "standing";
  const step = h.server.tick.bind(h.server);
  h.server.tick = () => {
    step();
    ticks.push({
      tick: h.world.tick,
      part,
      bodies: [e, rider].map((i) => ({ id: i, kind: ents.kind[i]!, x: ents.x[i]!, y: ents.y[i]!, z: ents.z[i]!, yaw: ((ents.yaw[i]! >>> 6) * TAU) / 1024, flags: (ents.flags[i]! >>> 1) & 0xf, anim: ents.anim[i]!, cue: ents.cue[i]!, seat: ents.seat[i]!, look: ents.look[i] ?? null })),
    });
  };
  h.run(1000);
  flyCourse(m, (name) => (part = name));
  return { ticks, flyer: e };
}

/** A moment to picture: its words, which tick of the flight, and where the camera stands, in degrees round from behind, up, and metres off. */
export interface Moment {
  label: string;
  at: number;
  around: number;
  above: number;
  far: number;
}

const st = new AnimState();

/** The moments of a recorded flight worth a picture: the take-off, a turn, a climb, a dive, a roll, a glide and two landings. */
export function moments(f: Flight): Moment[] {
  const out: Moment[] = [];
  const of = (i: number): AnimState => {
    const b = f.ticks[i]!.bodies[0]!;
    st.unpack(b.anim, b.cue);
    return st;
  };
  const since = (i: number): number => ((f.ticks[i]!.tick & 255) - of(i).cueStart) & 255;
  /** The first tick of `part` where `test` holds, pictured from (around, above, far). */
  const find = (label: string, part: string, test: (s: AnimState, i: number) => boolean, around: number, above: number, far: number): void => {
    const i = f.ticks.findIndex((t, k) => t.part === part && test(of(k), k));
    if (i >= 0) out.push({ label, at: i, around, above, far });
  };
  const last = (part: string): number => f.ticks.findLastIndex((t) => t.part === part);
  find("on the ground", "taking off", () => true, 60, 8, 9);
  find("taking off, 4", "taking off", (s, i) => s.cue === CUE_TAKEOFF && since(i) === 4, 60, 8, 9);
  find("taking off, 10", "taking off", (s, i) => s.cue === CUE_TAKEOFF && since(i) === 10, 60, 8, 9);
  find("taking off, 22", "taking off", (s, i) => s.cue === CUE_TAKEOFF && since(i) === 22, 60, 8, 9);
  out.push({ label: "hovering", at: last("taking off"), around: 50, above: 5, far: 10 });
  find("flying off", "flying off", (s) => s.speed >= 3, 70, 10, 11);
  /** The tick of `part` banked the most. */
  const banked = (part: string): number => {
    let most = -1;
    f.ticks.forEach((t, i) => {
      if (t.part === part && (most < 0 || Math.abs(of(i).bank) > Math.abs(of(most).bank))) most = i;
    });
    return most;
  };
  const left = banked("turning left");
  if (left >= 0) out.push({ label: `turning left, bank ${of(left).bank}`, at: left, around: 0, above: 6, far: 9 });
  find("climbing", "climbing", (s) => s.pitch >= 9, 90, 0, 9);
  find("sprinting", "sprinting", (s) => s.speed >= 8, 80, 10, 10);
  const right = banked("turning hard");
  if (right >= 0) out.push({ label: `turning hard right, bank ${of(right).bank}`, at: right, around: 0, above: 6, far: 10 });
  find("diving", "diving", (s) => s.pitch <= -18 && s.speed >= 3, 90, 5, 9);
  find("braking", "braking", (s) => s.speed <= 1, 60, 5, 10);
  find("rolling, 7", "rolling", (s, i) => s.cue === CUE_ROLL && since(i) === 7, 10, 6, 11);
  find("rolling, 15", "rolling", (s, i) => s.cue === CUE_ROLL && since(i) === 15, 10, 6, 11);
  find("gliding", "gliding", (s) => s.pitch <= -5, 70, 12, 9);
  find("landing, 4", "skimming in", (s, i) => s.mode !== MODE_FLYER && s.cue === CUE_LAND && since(i) === 4, 70, 10, 9);
  find("setting down", "setting down", (s) => s.speed >= 4, 60, 0, 11);
  find("landing, 10", "setting down", (s, i) => s.mode !== MODE_FLYER && s.cue === CUE_LAND && since(i) === 10, 60, 8, 9);
  find("landing, 26", "setting down", (s, i) => s.mode !== MODE_FLYER && s.cue === CUE_LAND && since(i) === 26, 60, 8, 9);
  return out;
}

/** Puts tick `i` of the flight in `r`, the flyer in the colours its block-out is reviewed in. */
export function stage(f: Flight, i: number, r: RemoteSample): void {
  const t = f.ticks[i]!;
  r.count = 0;
  r.tick = t.tick;
  for (const b of t.bodies) {
    const n = r.count++;
    [r.id[n], r.gen[n], r.kind[n], r.x[n], r.y[n], r.z[n], r.yaw[n], r.flags[n], r.anim[n], r.cue[n]] = [b.id, 0, b.kind, b.x, b.y, b.z, b.yaw, b.flags, b.anim, b.cue];
    for (let q = 0; q < 6; q++) r.colors[n * 6 + q] = n === 0 ? ASSET.regions[q]!.sample : 0;
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    [r.span[n], r.grown[n], r.seat[n], r.seatSlot[n], r.seatGen[n]] = [0, 0, b.seat, 0, 0];
    r.hasLook[n] = b.look ? 1 : 0;
    if (b.look) r.look.set(b.look, n * LOOK_BYTES);
  }
}

/** The camera beside the flyer at moment `m`, looking at its middle. */
export function frame(f: Flight, m: Moment, cam: Camera): void {
  const b = f.ticks[m.at]!.bodies[0]!;
  const a = b.yaw + Math.PI + (m.around * Math.PI) / 180;
  const e = (m.above * Math.PI) / 180;
  const [cx, cy, cz] = [b.x, b.y + 0.9, b.z];
  cam.x = cx + m.far * Math.sin(a) * Math.cos(e);
  cam.y = cy + m.far * Math.sin(e);
  cam.z = cz + m.far * Math.cos(a) * Math.cos(e);
  cam.yaw = Math.atan2(cx - cam.x, cz - cam.z);
  cam.pitch = Math.atan2(cy - cam.y, Math.hypot(cx - cam.x, cz - cam.z));
  cam.fovY = 0.75;
}
