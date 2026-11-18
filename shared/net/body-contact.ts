// A body must have stood idle and unchanged in the available sent views for 200 ms before becoming a movement obstacle.
// This uses the existing bounded view ring, including missing snapshots, and never predicts remote AI intent.
import { ACT_NONE } from "../sim/weapon.ts";
import { AnimState } from "../anim/pose.ts";
import { MODE_WALK } from "../sim/character.ts";
import type { SentView, ViewRing } from "./view.ts";
const STILL_TICKS = 6, SEARCH_TICKS = 12, pose = new AnimState();
export function stoodInViews(view: SentView, row: number, history: ViewRing<SentView>): boolean {
  const id = view.id[row]!;
  for (let age = 1; age <= SEARCH_TICKS && age < view.tick; age++) {
    const before = history.find(view.tick - age); if (!before) continue;
    let low = 0, high = before.count;
    while (low < high) { const mid = (low + high) >>> 1; if (before.id[mid]! < id) low = mid + 1; else high = mid; }
    if (low === before.count || before.id[low] !== id || before.gen[low] !== view.gen[row] || before.kind[low] !== view.kind[row] ||
      before.rev[low] !== view.rev[row] || before.qx[low] !== view.qx[row] || before.qy[low] !== view.qy[row] || before.qz[low] !== view.qz[row]) return false;
    pose.unpack(before.anim[low]!, before.cue[low]!);
    if (!pose.grounded || pose.mode !== MODE_WALK || pose.speed !== 0 || (pose.action & 7) !== ACT_NONE || pose.out || pose.dead || pose.held) return false;
    if (age >= STILL_TICKS) return true;
  }
  return false;
}
