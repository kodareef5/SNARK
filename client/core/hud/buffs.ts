// Buffs, in a column above the bottom row.

import { TICK_RATE } from "../../../shared/coords.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import type { ClientSession } from "../session.ts";
import { K_PANEL, lineHeight } from "../ui/nodes.ts";
import { S_BUFF } from "../ui/style.ts";
import { HOTBAR_CELL } from "./layout.ts";
import type { HudWidget } from "./widget.ts";

/** One mark per buff. */
export const KEY_BUFF = 180;

export interface BuffsModel {
  /** tint is 0xRRGGBB. seconds is -1 for no end. */
  buffs: { label: string; tint: number; seconds: number }[];
}

export function fillBuffs(m: BuffsModel, session: ClientSession | null, reg: Registry, palette: Uint8Array, rivalry = false): void {
  m.buffs.length = 0;
  if (!session) return;
  if (rivalry && session.driving >= 0) m.buffs.push({ label: "Rivalry · large predator nearby", tint: 0x824a34, seconds: -1 });
  for (const b of session.buffs) {
    const def = reg.defs[b.buff];
    if (def?.type !== "buff") continue;
    const c = def.color * 4;
    m.buffs.push({ label: def.label, tint: (palette[c]! << 16) | (palette[c + 1]! << 8) | palette[c + 2]!, seconds: b.until === 0 ? -1 : Math.max(0, Math.ceil((b.until - session.serverTick) / TICK_RATE)) });
  }
}

export const BUFFS: HudWidget<BuffsModel> = {
  name: "buffs",
  make: () => ({ buffs: [] }),
  fill(m, c) {
    const a = c.frame;
    if (a) fillBuffs(m, a.alive ? c.session : null, a.reg, a.palette, a.rivalry);
  },
  build(f, m, at) {
    const { touch, left, right, foot, panel, dashY, dashH } = at;
    const barW = 150;
    const labelW = 62;
    // Buffs stay in a column above the bottom row. A buff with negative seconds shows no time.
    const buffW = barW + labelW;
    const buffH = lineHeight(S_BUFF) + 2;
    let by = foot - HOTBAR_CELL - 64 - buffH;
    const buffTop = panel ? Math.max(200, dashY + dashH + 4) : 200;
    for (let i = 0; i < m.buffs.length && i < 16 && by > buffTop; i++) {
      const b = m.buffs[i]!;
      const n = f.add(KEY_BUFF + i, K_PANEL, touch ? left : Math.max(left, right - buffW - 58), by, buffW, buffH, S_BUFF);
      n.tint = b.tint;
      n.text = b.seconds < 0 ? b.label : `${b.label}  ${b.seconds}s`;
      by -= buffH + 2;
    }
  },
};
