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
  find("on the ground", "taking off", () => true, 60, 12, 7);
  find("taking off, 3", "taking off", (s, i) => s.cue === CUE_TAKEOFF && since(i) === 3, 70, 8, 7);
  find("taking off, 10", "taking off", (s, i) => s.cue === CUE_TAKEOFF && since(i) === 10, 70, 6, 8);
  find("taking off, 20", "taking off", (s, i) => s.cue === CUE_TAKEOFF && since(i) === 20, 70, 4, 8);
  out.push({ label: "hovering", at: last("taking off"), around: 50, above: 0, far: 8 });
  find("flying off", "flying off", (s) => s.speed >= 3, 80, -4, 8);
  /** The tick of `part` banked the most. */
  const banked = (part: string): number => {
    let most = -1;
    f.ticks.forEach((t, i) => {
      if (t.part === part && (most < 0 || Math.abs(of(i).bank) > Math.abs(of(most).bank))) most = i;
    });
    return most;
  };
  const left = banked("turning left");
  if (left >= 0) out.push({ label: `turning left, bank ${of(left).bank}`, at: left, around: 15, above: -8, far: 8 });
  find("climbing", "climbing", (s) => s.pitch >= 9, 90, -4, 8);
  find("sprinting", "sprinting", (s) => s.speed >= 8, 70, -4, 9);
  const right = banked("turning hard");
  if (right >= 0) out.push({ label: `turning hard right, bank ${of(right).bank}`, at: right, around: -15, above: -10, far: 9 });
  find("diving", "diving", (s) => s.pitch <= -18 && s.speed >= 3, -95, 10, 8);
  find("braking", "braking", (s) => s.speed <= 1, 60, 0, 8);
  find("rolling, 7", "rolling", (s, i) => s.cue === CUE_ROLL && since(i) === 7, 20, -4, 8);
  find("rolling, 15", "rolling", (s, i) => s.cue === CUE_ROLL && since(i) === 15, 20, -4, 8);
  find("gliding", "gliding", (s) => s.pitch <= -5, 70, -2, 8);
  find("skimming in, landing 4", "skimming in", (s, i) => s.mode !== MODE_FLYER && s.cue === CUE_LAND && since(i) === 4, 70, 10, 7);
  find("setting down", "setting down", (s) => s.speed >= 4, 60, -4, 8);
  find("landing, 8", "setting down", (s, i) => s.mode !== MODE_FLYER && s.cue === CUE_LAND && since(i) === 8, 60, 10, 7);
  find("landing, 18", "setting down", (s, i) => s.mode !== MODE_FLYER && s.cue === CUE_LAND && since(i) === 18, 60, 10, 7);
  find("landing, 30", "setting down", (s, i) => s.mode !== MODE_FLYER && s.cue === CUE_LAND && since(i) === 30, 60, 10, 7);
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

/** The camera beside the flyer at moment `m`, looking at its middle, and no nearer the ground below it than 1.5 m. */
export function frame(f: Flight, m: Moment, cam: Camera, ground: (x: number, z: number) => number): void {
  const b = f.ticks[m.at]!.bodies[0]!;
  const a = b.yaw + Math.PI + (m.around * Math.PI) / 180;
  const e = (m.above * Math.PI) / 180;
  const [cx, cy, cz] = [b.x, b.y + 0.9, b.z];
  cam.x = cx + m.far * Math.sin(a) * Math.cos(e);
  cam.z = cz + m.far * Math.cos(a) * Math.cos(e);
  cam.y = Math.max(cy + m.far * Math.sin(e), ground(cam.x, cam.z) + 1.5);
  cam.yaw = Math.atan2(cx - cam.x, cz - cam.z);
  cam.pitch = Math.atan2(cy - cam.y, Math.hypot(cx - cam.x, cz - cam.z));
  cam.fovY = 0.75;
}
