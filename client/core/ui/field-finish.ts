// The corner chart's edges: a pixel of silver above and to the left, and shadow below and to the right.
import { K_PANEL, type UiFrame } from "./nodes.ts";
import { S_ICE } from "./style.ts";

/** Dark backing and silver edges stay a pixel wide when the chart expands. */
export function chartEdge(f: UiFrame, base: number, x: number, y: number, side: number): void {
  const line = 1 / Math.max(1, f.unit);
  const top = f.add(base, K_PANEL, x, y - line, side, line, S_ICE);
  top.tint = 0xc6e1ed; top.alpha = .86;
  const left = f.add(base + 1, K_PANEL, x - line, y, line, side, S_ICE);
  left.tint = 0xa7cad8; left.alpha = .72;
  const right = f.add(base + 2, K_PANEL, x + side, y, line, side, S_ICE);
  right.tint = 0x132e41; right.alpha = .86;
  const bottom = f.add(base + 3, K_PANEL, x, y + side, side, line, S_ICE);
  bottom.tint = 0x132e41; bottom.alpha = .96;
}
