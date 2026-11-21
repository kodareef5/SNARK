// Everything here is drawn from CombatModel (client/core/feedback.ts). Damage numbers are the renderer's
// (render/damage-numbers.ts), drawn in the world's own frame.

import type { CombatModel } from "../feedback.ts";
import { K_PANEL, fitText, type UiFrame } from "./nodes.ts";
import { S_BLOOD, S_HIT, S_HIT_KILL, S_NOTICE } from "./style.ts";

/** Four strokes about the crosshair. */
export const KEY_HIT_MARK = 2000;
/** Two bands along each edge of the screen. */
export const KEY_BLOOD = 2010;
/** One mark per direction harm came from. */
export const KEY_HURT = 2020;
export const KEY_NOTICE = 2040;

/** Distance from the crosshair of the hit marks and of the harm marks, in canvas units. */
const MARK_REACH = 9;
const HURT_REACH = 96;
const HURT_SIZE = 14;
const BAND = 18;

export function buildCombat(f: UiFrame, m: CombatModel): void {
  const W = f.width;
  const H = f.height;
  const cx = W / 2;
  const cy = H / 2;

  // The red edges go first, so everything else is over them. Each side has two overlapping bands, so the edge deepens outward.
  if (m.blood > 0.01) {
    let k = KEY_BLOOD;
    for (let band = 2; band >= 1; band--) {
      const t = BAND * band;
      const a = m.blood * 0.3;
      f.add(k++, K_PANEL, 0, 0, W, t, S_BLOOD).alpha = a;
      f.add(k++, K_PANEL, 0, H - t, W, t, S_BLOOD).alpha = a;
      f.add(k++, K_PANEL, 0, t, t, H - t * 2, S_BLOOD).alpha = a;
      f.add(k++, K_PANEL, W - t, t, t, H - t * 2, S_BLOOD).alpha = a;
    }
  }

  for (let i = 0; i < m.hurtCount; i++) {
    const h = m.hurts[i]!;
    // The angle is to the left of straight ahead, and straight ahead is up the screen.
    const x = cx - Math.sin(h.angle) * HURT_REACH;
    const y = cy - Math.cos(h.angle) * HURT_REACH;
    f.add(KEY_HURT + i, K_PANEL, x - HURT_SIZE / 2, y - HURT_SIZE / 2, HURT_SIZE, HURT_SIZE, S_BLOOD).alpha = h.alpha;
  }

  if (m.mark > 0) {
    const big = m.markKill || m.markHead;
    const reach = MARK_REACH + (big ? 3 : 0);
    const size = big ? 5 : 4;
    const style = m.markKill ? S_HIT_KILL : S_HIT;
    for (let i = 0; i < 4; i++) {
      const x = cx + (i & 1 ? reach : -reach) - size / 2;
      const y = cy + (i & 2 ? reach : -reach) - size / 2;
      f.add(KEY_HIT_MARK + i, K_PANEL, x, y, size, size, style).alpha = m.mark;
    }
  }

  if (m.noticeAlpha > 0 && m.notice !== "") {
    const w = Math.min(W - 24, 620);
    f.text(KEY_NOTICE, cx - w / 2, cy + 70, w, S_NOTICE, fitText(m.notice, w, S_NOTICE)).alpha = m.noticeAlpha;
  }
}
