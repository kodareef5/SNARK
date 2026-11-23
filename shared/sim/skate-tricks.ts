// Every skate trick: the key and direction that start it, how the deck turns, and what it scores.
// The sim, the rider's poses, the HUD's trick feed and the trick list all read this one table.

export const FAM_OLLIE = 0, FAM_FLIP = 1, FAM_GRAB = 2, FAM_GRIND = 3, FAM_SLIDE = 4, FAM_MANUAL = 5, FAM_REVERT = 6,
  FAM_SPIN = 7, FAM_SPECIAL = 8;

/** The direction held as a trick starts: none, the four keys, then the diagonals. */
export const DIR_NONE = 0, DIR_UP = 1, DIR_DOWN = 2, DIR_LEFT = 3, DIR_RIGHT = 4,
  DIR_UP_LEFT = 5, DIR_UP_RIGHT = 6, DIR_DOWN_LEFT = 7, DIR_DOWN_RIGHT = 8;
export const DIR_ARROWS = ["", "↑", "↓", "←", "→", "↖", "↗", "↙", "↘"] as const;

export const GRADE_NONE = 0, GRADE_PERFECT = 1, GRADE_CLEAN = 2, GRADE_SLOPPY = 3;
export const GRADE_NAMES = ["", "Perfect", "Clean", "Sloppy"] as const;

/** Points for each half turn of spin. */
export const SPIN_POINTS = 100;

export interface SkateTrick {
  readonly id: number;
  readonly name: string;
  readonly family: number;
  /** Directions that pick it. The trick list shows the first. */
  readonly dirs: readonly number[];
  readonly points: number;
  /** Air tricks: ticks until the deck has come round. */
  readonly ticks: number;
  /** Turns of the deck about its long axis (kickflip +), its up axis (shove-it +) and its cross axis (impossible +). */
  readonly flip: number;
  readonly shove: number;
  readonly pitch: number;
  /** A grab's hand (1 front, -1 back) and where it holds the deck: along it (nose +1, tail -1) and across it (toe +1). */
  readonly hand: number;
  readonly along: number;
  readonly across: number;
  /** Degrees a special spins by itself. */
  readonly spin: number;
}

type Row = Partial<SkateTrick> & Pick<SkateTrick, "name" | "family" | "points">;
const row = (id: number, r: Row): SkateTrick => ({
  id, dirs: [], ticks: 0, flip: 0, shove: 0, pitch: 0, hand: 0, along: 0, across: 0, spin: 0, ...r,
});

export const T_NONE = 0, T_OLLIE = 1, T_KICKFLIP = 2, T_HEELFLIP = 3, T_IMPOSSIBLE = 4, T_POP_SHOVE = 5,
  T_VARIAL_KICKFLIP = 6, T_VARIAL_HEELFLIP = 7, T_360_SHOVE = 8, T_HARDFLIP = 9,
  T_MELON = 10, T_INDY = 11, T_NOSEGRAB = 12, T_TAILGRAB = 13, T_JAPAN = 14, T_STALEFISH = 15, T_MUTE = 16, T_CROSSBONE = 17,
  T_5050 = 18, T_NOSEGRIND = 19, T_50 = 20, T_CROOKED = 21, T_SMITH = 22,
  T_BOARDSLIDE = 23, T_NOSESLIDE = 24, T_TAILSLIDE = 25,
  T_MANUAL = 26, T_NOSE_MANUAL = 27, T_REVERT = 28, T_SPIN = 29, T_CHRIST_AIR = 30, T_MCTWIST = 31;

const LEFTS = [DIR_LEFT, DIR_UP_LEFT, DIR_DOWN_LEFT], RIGHTS = [DIR_RIGHT, DIR_UP_RIGHT, DIR_DOWN_RIGHT];
const UPS = [DIR_UP, DIR_UP_LEFT, DIR_UP_RIGHT], DOWNS = [DIR_DOWN, DIR_DOWN_LEFT, DIR_DOWN_RIGHT];

export const SKATE_TRICKS: readonly SkateTrick[] = [
  row(T_NONE, { name: "", family: -1, points: 0 }),
  row(T_OLLIE, { name: "Ollie", family: FAM_OLLIE, points: 0, ticks: 13 }),
  // Flips: R or the left mouse button in the air.
  row(T_KICKFLIP, { name: "Kickflip", family: FAM_FLIP, dirs: [DIR_LEFT, DIR_NONE], points: 100, ticks: 13, flip: 1 }),
  row(T_HEELFLIP, { name: "Heelflip", family: FAM_FLIP, dirs: [DIR_RIGHT], points: 100, ticks: 13, flip: -1 }),
  row(T_IMPOSSIBLE, { name: "Impossible", family: FAM_FLIP, dirs: [DIR_UP], points: 150, ticks: 14, pitch: 1 }),
  row(T_POP_SHOVE, { name: "Pop shove-it", family: FAM_FLIP, dirs: [DIR_DOWN], points: 100, ticks: 11, shove: .5 }),
  row(T_VARIAL_KICKFLIP, { name: "Varial kickflip", family: FAM_FLIP, dirs: [DIR_UP_LEFT], points: 150, ticks: 15, flip: 1, shove: .5 }),
  row(T_VARIAL_HEELFLIP, { name: "Varial heelflip", family: FAM_FLIP, dirs: [DIR_UP_RIGHT], points: 150, ticks: 15, flip: -1, shove: -.5 }),
  row(T_360_SHOVE, { name: "360 shove-it", family: FAM_FLIP, dirs: [DIR_DOWN_LEFT], points: 150, ticks: 15, shove: 1 }),
  row(T_HARDFLIP, { name: "Hardflip", family: FAM_FLIP, dirs: [DIR_DOWN_RIGHT], points: 150, ticks: 15, flip: 1, shove: -.5 }),
  // Grabs: C or the right mouse button, held, then let go before landing.
  row(T_MELON, { name: "Melon", family: FAM_GRAB, dirs: [DIR_LEFT, DIR_NONE], points: 150, hand: 1, across: -1 }),
  row(T_INDY, { name: "Indy", family: FAM_GRAB, dirs: [DIR_RIGHT], points: 150, hand: -1, across: 1 }),
  row(T_NOSEGRAB, { name: "Nosegrab", family: FAM_GRAB, dirs: [DIR_UP], points: 150, hand: 1, along: 1 }),
  row(T_TAILGRAB, { name: "Tailgrab", family: FAM_GRAB, dirs: [DIR_DOWN], points: 150, hand: -1, along: -1 }),
  row(T_JAPAN, { name: "Japan", family: FAM_GRAB, dirs: [DIR_UP_LEFT], points: 200, hand: 1, along: .3, across: 1 }),
  row(T_STALEFISH, { name: "Stalefish", family: FAM_GRAB, dirs: [DIR_DOWN_LEFT], points: 200, hand: -1, along: -.3, across: -1 }),
  row(T_MUTE, { name: "Mute", family: FAM_GRAB, dirs: [DIR_UP_RIGHT], points: 200, hand: 1, along: -.2, across: 1 }),
  row(T_CROSSBONE, { name: "Crossbone", family: FAM_GRAB, dirs: [DIR_DOWN_RIGHT], points: 200, hand: -1, along: .35, across: -1 }),
  // Grinds: Shift held, coming down along an edge.
  row(T_5050, { name: "50-50", family: FAM_GRIND, dirs: [DIR_NONE], points: 100 }),
  row(T_NOSEGRIND, { name: "Nosegrind", family: FAM_GRIND, dirs: [DIR_UP], points: 150, along: 1 }),
  row(T_50, { name: "5-0", family: FAM_GRIND, dirs: [DIR_DOWN], points: 150, along: -1 }),
  row(T_CROOKED, { name: "Crooked grind", family: FAM_GRIND, dirs: LEFTS, points: 150, along: 1, across: 1 }),
  row(T_SMITH, { name: "Smith grind", family: FAM_GRIND, dirs: RIGHTS, points: 200, along: -1, across: -1 }),
  // Slides: Shift held, coming across an edge.
  row(T_BOARDSLIDE, { name: "Boardslide", family: FAM_SLIDE, dirs: [DIR_NONE, DIR_LEFT, DIR_RIGHT], points: 100 }),
  row(T_NOSESLIDE, { name: "Noseslide", family: FAM_SLIDE, dirs: UPS, points: 150, along: 1 }),
  row(T_TAILSLIDE, { name: "Tailslide", family: FAM_SLIDE, dirs: DOWNS, points: 150, along: -1 }),
  // Manuals: X held on the ground; W at the start puts the weight on the nose.
  row(T_MANUAL, { name: "Manual", family: FAM_MANUAL, dirs: [DIR_NONE, ...DOWNS, DIR_LEFT, DIR_RIGHT], points: 50, along: -1 }),
  row(T_NOSE_MANUAL, { name: "Nose manual", family: FAM_MANUAL, dirs: UPS, points: 75, along: 1 }),
  row(T_REVERT, { name: "Revert", family: FAM_REVERT, points: 100, ticks: 8 }),
  row(T_SPIN, { name: "", family: FAM_SPIN, points: 0 }),
  // Specials: G in the air while the special meter is full.
  row(T_CHRIST_AIR, { name: "Christ air", family: FAM_SPECIAL, dirs: [DIR_NONE, ...UPS, ...DOWNS], points: 1000, ticks: 16, hand: 2 }),
  row(T_MCTWIST, { name: "540 McTwist", family: FAM_SPECIAL, dirs: [...LEFTS, ...RIGHTS], points: 1500, ticks: 24, hand: 1, across: 1, spin: 540 }),
];

const picks: number[][] = [];
for (const t of SKATE_TRICKS) {
  if (t.family < 0) continue;
  const byDir = picks[t.family] ??= [];
  for (const d of t.dirs) byDir[d] ??= t.id;
}

/** The trick of `family` that `dir` picks, or the family's own with no direction. */
export function trickFor(family: number, dir: number): number {
  const byDir = picks[family];
  return byDir?.[dir] ?? byDir?.[DIR_NONE] ?? T_NONE;
}

/** The direction of the movement keys or stick, from the signed bytes the input sends. */
export function skateDirection(x: number, z: number): number {
  const right = x >= 64, left = x <= -64, up = z >= 64, down = z <= -64;
  if (up) return left ? DIR_UP_LEFT : right ? DIR_UP_RIGHT : DIR_UP;
  if (down) return left ? DIR_DOWN_LEFT : right ? DIR_DOWN_RIGHT : DIR_DOWN;
  return left ? DIR_LEFT : right ? DIR_RIGHT : DIR_NONE;
}

export const trickOf = (id: number): SkateTrick => SKATE_TRICKS[id] ?? SKATE_TRICKS[T_NONE]!;

/** One entry of a line: the trick, its spin in half turns and how it landed, in 16 bits. */
export const lineEntry = (id: number, halves: number, grade: number): number => (id & 127) | (Math.min(7, halves) << 7) | ((grade & 3) << 10);
export const entryTrick = (e: number): number => e & 127;
export const entryHalves = (e: number): number => (e >>> 7) & 7;
export const entryGrade = (e: number): number => (e >>> 10) & 3;
/** Entries that count as the same trick for repeats and the multiplier. */
export const entryKey = (e: number): number => e & 1023;

/** "360 Kickflip", "540", "Boardslide". */
export function trickName(id: number, halves = 0): string {
  const t = trickOf(id), degrees = halves * 180;
  if (t.family === FAM_SPIN) return `${degrees}`;
  if (!halves || t.spin) return t.name;
  return `${degrees} ${t.name}`;
}

/** A trick done again in the same line pays less each time. */
export const REPEAT_SHARE = [100, 75, 50, 25, 10] as const;

/** What a trick in the air or on an edge is worth before the multiplier, with its spin and the times it was done before. */
export function trickPoints(id: number, halves: number, repeats: number): number {
  const base = trickOf(id).points + halves * SPIN_POINTS;
  return Math.floor(base * REPEAT_SHARE[Math.min(repeats, REPEAT_SHARE.length - 1)]! / 100);
}
