// Appearance is data, so the browser and the software rasterizer draw the same thing and neither holds its own stylesheet.

export interface Style {
  /** Background, 0xRRGGBBAA. Alpha 0 draws none. */
  readonly fill: number;
  /** Text colour, or the filled part of a bar, 0xRRGGBB. */
  readonly ink: number;
  /** In canvas units. */
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
export const S_SLOT = 20;
export const S_SLOT_HELD = 21;
export const S_SLOT_TEXT = 22;
export const S_SWATCH = 23;
export const S_PROMPT = 24;
/** A stroke of the hit mark, and of the kill mark. */
export const S_HIT = 25;
export const S_HIT_KILL = 26;
/** A damage number for a body hit, a head hit and a kill. */
export const S_DAMAGE = 27;
export const S_DAMAGE_HEAD = 28;
export const S_DAMAGE_KILL = 29;
/** The red screen edges, and the mark for the direction harm came from. */
export const S_BLOOD = 30;
/** The line under the crosshair that says what was killed or who killed you. */
export const S_NOTICE = 31;
/** The torpor bar, a buff's mark, and the dark panel shown while unconscious. */
export const S_TORPOR = 32;
export const S_BUFF = 33;
export const S_DARK = 34;
/** Chat lines on the global, local and tribe channels and from the server, then the open box's backdrop and the channel tag. */
export const S_CHAT = 35;
export const S_CHAT_LOCAL = 36;
export const S_CHAT_TRIBE = 37;
export const S_CHAT_NOTICE = 38;
export const S_CHAT_PANEL = 39;
export const S_CHAT_TAG = 40;

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
  /* S_SLOT */ style(0x00000088, 0xffffff, 11),
  /* S_SLOT_HELD */ style(0xe8d24acc, 0x000000, 11),
  /* S_SLOT_TEXT */ style(0, 0xffffff, 11, 2, true),
  /* S_SWATCH */ style(0x808080ff, 0xffffff, 11, 0, true),
  /* S_PROMPT */ style(0, 0xffffff, 13, 1, true),
  /* S_HIT */ style(0xffffffff, 0xffffff),
  /* S_HIT_KILL */ style(0xe03030ff, 0xffffff),
  /* S_DAMAGE */ style(0, 0xffffff, 16, 1, true),
  /* S_DAMAGE_HEAD */ style(0, 0xffc83c, 20, 1, true),
  /* S_DAMAGE_KILL */ style(0, 0xff5040, 20, 1, true),
  /* S_BLOOD */ style(0xb01010ff, 0xffffff),
  /* S_NOTICE */ style(0, 0xffffff, 14, 1, true),
  /* S_TORPOR */ style(0x00000066, 0xa070d8),
  /* S_BUFF */ style(0x808080ff, 0xffffff, 11, 1, true),
  /* S_DARK */ style(0x000000ff, 0xffffff),
  /* S_CHAT */ style(0, 0xf2f2f2, 13, 0, true),
  /* S_CHAT_LOCAL */ style(0, 0xf0dc96, 13, 0, true),
  /* S_CHAT_TRIBE */ style(0, 0x96e89a, 13, 0, true),
  /* S_CHAT_NOTICE */ style(0, 0xa8c8ec, 13, 0, true),
  /* S_CHAT_PANEL */ style(0x10141a99, 0xeeeeee, 13),
  /* S_CHAT_TAG */ style(0x2a3440f0, 0xffffff, 12, 1),
];
