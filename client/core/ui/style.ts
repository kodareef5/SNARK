// How nodes look. Appearance is data, so the browser and the software
// rasterizer draw the same thing and neither holds a stylesheet of its own.

export interface Style {
  /** Background, 0xRRGGBBAA. Alpha 0 draws none. */
  readonly fill: number;
  /** Text colour, or the filled part of a bar, 0xRRGGBB. */
  readonly ink: number;
  /** Font size in canvas units. */
  readonly font: number;
  /** 0 left, 1 centre, 2 right. */
  readonly align: number;
  /** Dark outline behind the text, for text drawn over the world. */
  readonly shadow: boolean;
}

/** Advance of one character and height of one line, as multiples of the font size. */
export const CHAR_ADVANCE = 0.6;
export const LINE_HEIGHT = 1.35;

const style = (fill: number, ink: number, font = 13, align = 0, shadow = false): Style => ({ fill, ink, font, align, shadow });

export const S_TEXT = 0;
export const S_LABEL = 1;
export const S_BANNER = 2;
export const S_PANEL = 3;
export const S_INPUT = 4;
export const S_CONSOLE_TEXT = 5;
export const S_CROSS = 6;
export const S_FRAME = 7;
export const S_HEALTH = 8;
export const S_STAMINA = 9;
export const S_FOOD = 10;
export const S_WATER = 11;
export const S_OXYGEN = 12;
export const S_MARK_SELF = 13;
export const S_MARK_PLAYER = 14;
export const S_MARK_CREATURE = 15;
export const S_MARK_SPAWN = 16;
export const S_MARK_DEATH = 17;
export const S_BUTTON = 18;
export const S_TITLE = 19;

export const STYLES: readonly Style[] = [
  /* S_TEXT */ style(0, 0xeeeeee, 13, 0, true),
  /* S_LABEL */ style(0, 0xeeeeee, 12, 0, true),
  /* S_BANNER */ style(0x00000066, 0xffffff, 20, 1, false),
  /* S_PANEL */ style(0x10141ad9, 0xeeeeee, 13),
  /* S_INPUT */ style(0x000000cc, 0xffffff, 14),
  /* S_CONSOLE_TEXT */ style(0, 0xd8e0d8, 14),
  /* S_CROSS */ style(0xffffffcc, 0xffffff),
  /* S_FRAME */ style(0x00000088, 0xffffff),
  /* S_HEALTH */ style(0x00000066, 0xd84a4a),
  /* S_STAMINA */ style(0x00000066, 0xe8d24a),
  /* S_FOOD */ style(0x00000066, 0xd8904a),
  /* S_WATER */ style(0x00000066, 0x4a9ad8),
  /* S_OXYGEN */ style(0x00000066, 0xb8e0e8),
  /* S_MARK_SELF */ style(0xffffffff, 0),
  /* S_MARK_PLAYER */ style(0xe05050ff, 0),
  /* S_MARK_CREATURE */ style(0x40aaaaff, 0),
  /* S_MARK_SPAWN */ style(0x60b068ff, 0),
  /* S_MARK_DEATH */ style(0x111111ff, 0),
  /* S_BUTTON */ style(0x2a3440f0, 0xffffff, 14, 1),
  /* S_TITLE */ style(0, 0xffffff, 18, 0),
];
