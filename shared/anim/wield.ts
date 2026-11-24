// What a body holds changes how it is posed, and is not in its pose word: the server and every client know the item, and
// each gives it to the pose state after unpacking the word. Both must, or a shot is judged on another pose than is drawn.

import type { Registry } from "../content/registry.ts";
import type { AnimState } from "./pose.ts";

/** Sets what `st` poses from its held item, the content index `item` (0 for none): how the hold is posed, its kick and its reload. */
export function wield(st: AnimState, reg: Registry, item: number): void {
  const w = reg.weapon[item];
  st.wields = reg.holdPose[item] ?? 0;
  st.kick = reg.kickAngle[item] ?? 0;
  st.kickTicks = reg.kickTicks[item] ?? 0;
  st.coolTicks = w ? w.swingTicks : 0;
  st.reloadTicks = w ? w.reloadTicks : 0;
}

/** Copies what `from` poses from its held item to `to`. */
export function wieldAs(to: AnimState, from: AnimState): void {
  to.wields = from.wields;
  to.kick = from.kick;
  to.kickTicks = from.kickTicks;
  to.coolTicks = from.coolTicks;
  to.reloadTicks = from.reloadTicks;
}
