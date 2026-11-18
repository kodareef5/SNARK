import type { Clip, ClipSet } from "../../shared/anim/clip.ts";
import type { PackRig } from "../../shared/pack/pack.ts";

/** A posed head that lowers on KO, then briefly dips during recovery before standing. */
export function breathingRig(enabled = true): { rig: PackRig; clips: ClipSet } {
  const rig: PackRig = { id: "core:dodo", skeleton: "dodo", names: ["body", "head"], parent: [-1, 0], rest: [0, 1, 0, 0, 1.5, 1],
    sockets: [{ name: "breath_l", bone: 1, x: -.2, y: 0, z: 0 }, { name: "breath_r", bone: 1, x: .2, y: 0, z: 0 }],
    ...(enabled ? { breath: ["breath_l", "breath_r"] as [string, string] } : {}) };
  const make = (name: string, frames: number, loop: boolean, height: (t: number) => number): Clip => {
    const root = new Float32Array(frames * 3), rot = new Float32Array(frames * 8);
    for (let i = 0; i < frames; i++) { root[i * 3 + 1] = height(i / Math.max(1, frames - 1)); rot[i * 8 + 3] = rot[i * 8 + 7] = 1; }
    return { id: `core:dodo/${name}`, frames, bones: 2, loop, rot, root };
  };
  const clips = [make("idle", 2, true, () => 0), make("torpor_idle", 2, true, () => -1),
    make("torpor_in", 31, false, t => -t), make("torpor_out", 91, false, t => t < .5 ? -1 - .4 * t : -1.2 + (t - .5) * 2.4)];
  return { rig, clips: { clips, index: new Map(clips.map((c, i) => [c.id, i])), hash: 0 } };
}
