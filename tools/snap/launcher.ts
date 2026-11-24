// A survivor with the rocket launcher at each moment of its hold: aimed, coming up, the keys of its reload and its kick
// (shared/anim/pose.ts). `bun run snap -- --launcher all` lines them up; `--launcher 4` stands near the fifth, turned by
// `--face`; with `--first` it is the viewer's own body, seen from its eye.

import { AnimState } from "../../shared/anim/pose.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../shared/sim/entities.ts";
import { ACT_COOL, ACT_EQUIP, ACT_NONE, ACT_RELOAD, HOLD_RIFLE } from "../../shared/sim/weapon.ts";
import type { ProvingView } from "../snap.ts";

/** Each moment: its name, its act and the ticks into it. */
export const LAUNCHER_MOMENTS: readonly (readonly [string, number, number])[] = [
  ["aimed", ACT_NONE, 0],
  ["lowered", ACT_EQUIP, 0],
  ["fetch", ACT_RELOAD, 38],
  ["to the muzzle", ACT_RELOAD, 56],
  ["load", ACT_RELOAD, 70],
  ["push", ACT_RELOAD, 87],
  ["shouldering", ACT_RELOAD, 108],
  ["kick", ACT_COOL, 2],
];

const TICK = 1000;
const EYE = 1.62;

/** Sets the scene and the camera. `which` is "all" or a moment's number; `face` turns the bodies, in radians; `pitch` is where they look. */
export function launcherScene(view: ProvingView, which: string, face: number, first: boolean, pitch = 0, item = "core:rocket_launcher"): string[] {
  const r = view.remote, cam = view.cam;
  r.count = 0;
  r.tick = TICK;
  const kind = view.reg.index.get("core:survivor")!;
  const held = view.reg.index.get(item)!;
  const st = new AnimState();
  const one = which === "all" ? -1 : Number(which);
  const shown = one < 0 ? LAUNCHER_MOMENTS : [LAUNCHER_MOMENTS[one]!];
  const x0 = 256, z0 = 228;
  shown.forEach(([, act, into], i) => {
    st.unpack(0);
    st.pitch = pitch;
    st.setAction(act, HOLD_RIFLE, TICK - into);
    const x = x0 + ((shown.length - 1) / 2 - i) * 1.5, y = view.hf.heightAt(x, z0);
    if (first && one >= 0) {
      const state = new AnimState();
      state.unpack(st.pack());
      const gear = new Uint16Array(GEAR_COUNT);
      gear[GEAR_HELD] = held;
      view.scene.own = { kind, x, y, z: z0, yaw: face, state, tick: TICK, firstPerson: true, colors: new Uint8Array(6), look: null, gear, id: 2048 };
      cam.x = x;
      cam.y = y + EYE;
      cam.z = z0;
      cam.yaw = face;
      cam.pitch = (pitch / 31) * (Math.PI / 2);
      cam.fovY = 1.2;
      return;
    }
    const n = r.count++;
    r.id[n] = 1024 * (n + 1);
    r.kind[n] = kind;
    r.x[n] = x;
    r.z[n] = z0;
    r.y[n] = y;
    r.yaw[n] = face;
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    r.gear[n * GEAR_COUNT + GEAR_HELD] = held;
    r.flags[n] = 1;
    r.anim[n] = st.pack();
  });
  if (!first || one < 0) {
    // From the south, level with the chest: near one body, or far enough for the line.
    const far = one < 0 ? 15 : 2.7;
    cam.x = x0;
    cam.z = z0 - far;
    cam.y = view.hf.heightAt(x0, z0) + (one < 0 ? 1 : 1.25);
    cam.yaw = 0;
    cam.pitch = 0;
    cam.fovY = one < 0 ? 0.17 : 0.75;
  }
  return shown.map(([name]) => name);
}
