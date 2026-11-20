// How far things fade, and how trees, rocks and bushes pass from the near store to the far one. Both drop fragments by a
// 4 by 4 ordered pattern on the pixel. The hand-over is a band of distance, the tier's (assets/tiers.ts `nodes`): a node
// whose foot is short of it is drawn by the near store at its own levels, one past it by the far store at its last, and
// one in it by both, each keeping the pixels the other drops, so its coverage passes from one to the other evenly. The
// band ends short of where a chunk can change hands, so a chunk is drawn alike just before it does and just after.

/** The 4 by 4 ordered pattern the fades drop fragments by, row after row from the bottom left of the screen. */
export const FADE_ORDER: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** A draw's hand-over (packet.ts `drawHand`): a near node's draw fades out over the band, a far node's fades in. */
export const HAND_NEAR = 1;
export const HAND_FAR = -1;

/**
 * Whether the near store's draw of a node whose foot is `at` metres off keeps window pixel (x, y), counted from the
 * bottom left, across the band from `from` to `to`; the far store's keeps every pixel it drops. HAND_GLSL's twin.
 */
export function nearKeeps(at: number, from: number, to: number, x: number, y: number): boolean {
  return (to - at) * 16 > (FADE_ORDER[(y & 3) * 4 + (x & 3)]! + 0.5) * (to - from);
}

/**
 * The hand-over in GLSL, for a program that reads the frame block: `vAt` is how far the instance's foot is, and `uHand`
 * the draw's HAND_ value. handDrops() says whether to discard the fragment.
 */
export const HAND_GLSL = `uniform float uHand;
flat in float vAt;
const float FADE_ORDER[16] = float[16](${FADE_ORDER.map((v) => v.toFixed(1)).join(", ")});
bool handDrops() {
  ivec2 q = ivec2(gl_FragCoord.xy) & 3;
  return uHand != 0.0 && ((fHandTo - vAt) * 16.0 > (FADE_ORDER[q.y * 4 + q.x] + 0.5) * (fHandTo - fHandFrom)) != (uHand > 0.0);
}
`;

/**
 * The same in a vertex text, after the frame block: an instance whose draw keeps none of it, its foot `at` metres off,
 * which the vertex puts out of view so that none of it is rasterized.
 */
export const HAND_VERTEX = `uniform float uHand;
bool handGone(float at) {
  return (uHand > 0.0 && at >= fHandTo) || (uHand < 0.0 && at <= fHandFrom);
}
`;

/**
 * A near node's own levels pass one to the next by the same pattern, over a short time rather than a band of distance:
 * where a cell of trees changes level, it is drawn at both for a moment (Tier.nodes.levels ms), the new level keeping
 * a share `t` of the pattern's pixels and the old the rest, `t` going from 0 to 1. A draw's swap (packet.ts `drawSwap`)
 * is `t` for the new level, `-t` for the old, and 0 for neither. Whether it keeps window pixel (x, y); SWAP_GLSL's twin.
 */
export function swapKeeps(swap: number, x: number, y: number): boolean {
  if (swap === 0) return true;
  const o = FADE_ORDER[(y & 3) * 4 + (x & 3)]! + 0.5;
  return swap > 0 ? o < swap * 16 : o >= -swap * 16;
}

/** The swap in GLSL, after HAND_GLSL, whose pattern it shares: swapDrops() says whether to discard the fragment. */
export const SWAP_GLSL = `uniform float uSwap;
bool swapDrops() {
  if (uSwap == 0.0) return false;
  ivec2 q = ivec2(gl_FragCoord.xy) & 3;
  float o = FADE_ORDER[q.y * 4 + q.x] + 0.5;
  return uSwap > 0.0 ? o >= uSwap * 16.0 : o < -uSwap * 16.0;
}
`;
