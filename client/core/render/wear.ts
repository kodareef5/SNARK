// How a road vehicle wears its hurt and decay layer (surface.ts `wounded`). Each car takes one of WEAR_STORIES stories
// for good, from its colour regions (`wearOf`), which it is saved with and every client is sent. A story is where the
// car was struck: on a grid over the body's box at rest, how many stages later than its layer says a mark shows there.
// The layer holds every mark any story shows, so a story costs nothing on the card: the draw carries its number.

/** Stories a road vehicle takes one of. 0 is none: the layer as it is. */
export const WEAR_STORIES = 5;
/** A body's layer level and its story as one number, as characters.ts keys and draws them: the level, plus the story times this, which is more than LAYER_LEVELS. */
export const WEAR_KEY = 128;
/** Stages a mark is held back where a story never shows it: past the last decay stage of the first hurt mark. */
const NEVER = 9;
/** A decay mark is held back no more than this, so a wreck rusts all over, and soonest where it was struck. */
const DECAY_MOST = 2;
/** A layer texel of this alpha or more is a hurt mark, and under it a decay mark (tools/pack/image.ts `layerPicture`). */
const HURT_ALPHA = 0.5;
/**
 * The grid's first point and its step on each axis of the box, -1 to 1 across the mesh's bounds: x right, middle and
 * left (+X is the driver's side), y below and above the waist, z rear, middle and nose.
 */
const FROM = [-0.8, -0.35, -0.7] as const;
const STEP = [0.8, 0.8, 0.7] as const;
const SIDE = [3, 2, 3] as const;
/** Between two points, a value holds for the outer 0.3 of the step on either side and runs straight across the middle 0.4. */
const HOLD = 0.3;
/** Numbers a story has: z, then y, then x. */
const CELLS = SIDE[0] * SIDE[1] * SIDE[2];

const N = NEVER;
/** Each story by the rear, middle and nose of the box: below the waist right, middle and left, then above it the same. */
const STORIES: readonly (readonly [rear: readonly number[], middle: readonly number[], nose: readonly number[]])[] = [
  // Struck at the nose on the driver's side: the windscreen and the driver's glass go first, the rear glass not at all.
  [[N, 3, 2, N, N, 3], [3, 1, 0, N, 2, 0], [1, 0, 0, 2, 0, 0]],
  // Struck at the rear on the passenger's side: the rear glass and the passenger's go, the windscreen never.
  [[0, 0, 1, 0, 0, 2], [0, 2, 3, 0, 3, N], [2, 3, N, N, N, N]],
  // Scraped down the passenger's side: its glass goes, and nothing on the driver's.
  [[0, 2, N, 1, N, N], [0, 2, N, 0, 3, N], [0, 2, N, 1, 3, N]],
  // Head on: the nose, the lamps and the windscreen, the side glass late, the rear never.
  [[N, 3, N, N, N, N], [2, 1, 2, 2, 2, 2], [0, 0, 0, 0, 0, 0]],
  // Rolled: the roof and the glass round it, the windscreen a stage behind, the body late.
  [[3, 2, 3, 1, 0, 1], [2, 3, 2, 0, 0, 0], [3, 2, 3, 1, 1, 1]],
];

/** Every story's stages, CELLS each, the first story's first. */
export const WEAR: readonly number[] = STORIES.flatMap((s) => s.flatMap((z) => [...z]));

/** The story a car with these colour regions (six from `at`) takes, 1 to WEAR_STORIES. */
export function wearOf(colors: ArrayLike<number>, at = 0): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < 6; k++) h = Math.imul(h ^ colors[at + k]!, 0x01000193);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return 1 + ((h >>> 0) % WEAR_STORIES);
}

/** Where on axis `a` a box coordinate lies on the grid: the cell's first point, and how far toward the next. */
function cell(a: number, b: number): [number, number] {
  const g = Math.min(Math.max((b - FROM[a]!) / STEP[a]!, 0), SIDE[a]! - 1);
  const i = Math.min(Math.floor(g), SIDE[a]! - 2);
  return [i, Math.min(Math.max((g - i - HOLD) / (1 - 2 * HOLD), 0), 1)];
}

/** Stages story `story` holds the layer back at box coordinate x, y, z. 0 for story 0. */
export function wearLate(story: number, x: number, y: number, z: number): number {
  if (story === 0) return 0;
  const [ix, tx] = cell(0, x), [iy, ty] = cell(1, y), [iz, tz] = cell(2, z);
  const at = (story - 1) * CELLS + (iz * SIDE[1] + iy) * SIDE[0] + ix;
  const row = (k: number): number => WEAR[k]! + (WEAR[k + 1]! - WEAR[k]!) * tx;
  const plane = (k: number): number => row(k) + (row(k + SIDE[0]) - row(k)) * ty;
  return plane(at) + (plane(at + SIDE[0] * SIDE[1]) - plane(at)) * tz;
}

/** A layer texel of alpha `alpha` held back `late` stages: its alpha as `wounded` reads it. */
export function wearAlpha(alpha: number, late: number, stages: number): number {
  return alpha - (alpha >= HURT_ALPHA ? late : Math.min(late, DECAY_MOST)) / stages;
}

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** `wearLate` and `wearAlpha` as GLSL: `vBox` the box coordinate, `uWear` the story. */
export const WEAR_GLSL = `in vec3 vBox;
uniform float uWear;
const float WEAR[${WEAR.length}] = float[${WEAR.length}](${WEAR.map(f).join(", ")});
float wearLate() {
  int s = int(uWear + 0.5);
  if (s == 0) return 0.0;
  vec3 g = clamp((vBox - vec3(${FROM.map(f).join(", ")})) / vec3(${STEP.map(f).join(", ")}), vec3(0.0), vec3(${SIDE.map((n) => f(n - 1)).join(", ")}));
  ivec3 i = min(ivec3(g), ivec3(${SIDE.map((n) => n - 2).join(", ")}));
  vec3 t = clamp((g - vec3(i) - ${f(HOLD)}) / ${f(1 - 2 * HOLD)}, 0.0, 1.0);
  int at = (s - 1) * ${CELLS} + (i.z * ${SIDE[1]} + i.y) * ${SIDE[0]} + i.x;
  float near = mix(mix(WEAR[at], WEAR[at + 1], t.x), mix(WEAR[at + ${SIDE[0]}], WEAR[at + ${SIDE[0] + 1}], t.x), t.y);
  at += ${SIDE[0] * SIDE[1]};
  float far = mix(mix(WEAR[at], WEAR[at + 1], t.x), mix(WEAR[at + ${SIDE[0]}], WEAR[at + ${SIDE[0] + 1}], t.x), t.y);
  return mix(near, far, t.z);
}
float wearAlpha(float alpha, float late, float stages) {
  return alpha - (alpha >= ${f(HURT_ALPHA)} ? late : min(late, ${f(DECAY_MOST)})) / stages;
}
`;
