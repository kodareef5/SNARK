// The debug bar's look: its styles, added to the interface's table when the bar is first fetched, and its colours.

import { addStyles, type Style } from "../ui/style.ts";

const style = (fill: number, ink: number, font = 12, align = 0, mono = false): Style => ({ fill, ink, font, align, shadow: false, sans: !mono });

/** Inks: the main one, a quieter one, the faintest, the accent, and good, warning and bad. */
export const INK = 0xdbe8ef, INK_DIM = 0x8ea6b5, INK_FAINT = 0x5f7889, ACCENT = 0x8fd3ee, GOOD = 0x86d39a, WARN = 0xf0c060, BAD = 0xf06a5f;
/** Fills, 0xRRGGBB: the bar, the drawer, a well a chart or list sits in, a rule, a chosen tab or button. */
export const FILL_BAR = 0x070f16, FILL_DRAWER = 0x0a141d, FILL_WELL = 0x0e1b26, FILL_RULE = 0x1e3344, FILL_ON = 0x1b3b53;

const FIRST = addStyles([
  style(0x070f16f2, INK),
  style(0x0a141df0, INK),
  style(0, INK),
  style(0, INK_DIM),
  style(0, INK_FAINT, 11),
  style(0, ACCENT, 13),
  style(0, GOOD),
  style(0, WARN),
  style(0, BAD),
  style(0, INK, 12, 2),
  style(0, INK_DIM, 12, 2),
  style(0x00000000, INK_DIM, 12, 1),
  style(0x1b3b53ff, 0xf2f9fc, 12, 1),
  style(0x132535ff, INK, 12, 1),
  style(0, INK, 12, 0, true),
  style(0, INK_DIM, 12, 0, true),
  style(0, WARN, 12, 0, true),
  style(0, BAD, 12, 0, true),
  style(0, INK_FAINT, 12, 0, true),
  style(0xf06a5fff, 0x10161c, 11, 1),
  style(0x0e1b26ff, INK),
]);

/** The bar's and the drawer's backgrounds. */
export const D_BAR = FIRST, D_DRAWER = FIRST + 1;
/** Words: plain, quieter, faint and small, a heading, good, warning, bad. */
export const D_TEXT = FIRST + 2, D_DIM = FIRST + 3, D_FAINT = FIRST + 4, D_HEAD = FIRST + 5, D_GOOD = FIRST + 6, D_WARN = FIRST + 7, D_BAD = FIRST + 8;
/** Numbers set to the right, plain and quieter. */
export const D_NUM = FIRST + 9, D_NUM_DIM = FIRST + 10;
/** A tab, a chosen tab, a button. */
export const D_TAB = FIRST + 11, D_TAB_ON = FIRST + 12, D_BUTTON = FIRST + 13;
/** Lines in an even face: plain, quieter, a warning, an error, faint. */
export const D_MONO = FIRST + 14, D_MONO_DIM = FIRST + 15, D_MONO_WARN = FIRST + 16, D_MONO_BAD = FIRST + 17, D_MONO_FAINT = FIRST + 18;
/** A count of errors on a tab. */
export const D_BADGE = FIRST + 19;
/** The well a chart or a list sits in. */
export const D_WELL = FIRST + 20;

/** Colours for the parts of a chart, in turn, 0xRRGGBB. */
export const PALETTE = [0x5aa9e6, 0x4fd1c5, 0x7bd389, 0xf2d23a, 0xf2a477, 0xe06a6a, 0xb48ae6, 0xe68ab4, 0xa0a8b0, 0x8fb8c8, 0x6fc3a8, 0xd6b36a];

/** A colour that stays the same for a name: a slot of the flame chart, a category of the network. */
export function colourOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return PALETTE[(h >>> 0) % PALETTE.length]!;
}

/** 0xRRGGBB to the painter's 0xRRGGBBAA. */
export const opaque = (rgb: number, alpha = 255): number => ((rgb << 8) | alpha) >>> 0;
