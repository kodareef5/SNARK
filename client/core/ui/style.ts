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
  /** Interface text uses the local face; console output and text entry retain monospace. */
  readonly sans?: boolean;
  /**
   * A sight's lens (D1077): the fill is drawn only outside a round hole as tall as the box and centred in it (LENS_ROUND),
   * or outside two merged side by side, each as tall as the box with its middle half the box's height in from its side
   * (LENS_TWIN, a box optics.ts TWIN_WIDE times as wide as tall).
   */
  readonly lens?: number;
}

export const LENS_ROUND = 1;
export const LENS_TWIN = 2;
/** Not a lens: the fill only on every third line (LENS_SCAN), or deepening from none in the middle to whole in the corners (LENS_VIGNETTE). */
export const LENS_SCAN = 3;
export const LENS_VIGNETTE = 4;

/** Advance of one character and height of one line, as multiples of the font size. */
export const CHAR_ADVANCE = 0.6;
export const LINE_HEIGHT = 1.35;

const style = (fill: number, ink: number, font = 13, align = 0, shadow = false): Style => ({ fill, ink, font, align, shadow, sans: true });
/** Words in the monospace face over the world, as a camera's feed prints them. */
const mono = (ink: number, font: number, align: number): Style => ({ fill: 0, ink, font, align, shadow: true, sans: false });

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
/** Over a creature: its name when it is wild, the viewer's tribe's or another tribe's; the lines under it; the taming bar; the backdrop. */
export const S_OVER_WILD = 41;
export const S_OVER_TRIBE = 42;
export const S_OVER_OTHER = 43;
export const S_OVER_TEXT = 44;
export const S_OVER_TAMING = 45;
export const S_OVER_PANEL = 46;
export const S_MENU = 47;
export const S_MENU_BUTTON = 48;
export const S_MENU_MAIN = 49;
export const S_MENU_NOTE = 50;
export const S_HUD_HIT = 51;
export const S_HUD_KEY = 52;
export const S_HUD_COUNT = 53;
export const S_ICE = 54;
export const S_MENU_FOCUS = 55;
export const S_MENU_HEADING = 56;
export const S_WARNING = 57;
export const S_KEY = 58;
export const S_KEY_SMALL = 59;
export const S_KEY_EDGE = 60;
export const S_KEY_FILL = 61;
export const S_KEY_ACTIVE = 62;
export const S_CONTROL_TITLE = 63;
/** The hour in the middle of the sundial. */
export const S_DIAL_HOUR = 64;
/** A note of the menu's screens that warns, in the warm accent. */
export const S_MENU_WARN = 65;
/** The offer to unmute: plain words over glass. */
export const S_UNMUTE = 66;
/** The compass's letters and degrees, pale ice over the world; N in the warm accent. */
export const S_COMPASS = 67;
export const S_COMPASS_NORTH = 68;
/** The black about a sight's round window, and about binoculars' two (Style.lens). */
export const S_LENS = 69;
export const S_LENS_TWIN = 70;
/** A visor's readouts, under its window. */
export const S_VISOR = 71;
/** The same, set to the left: the magnification ladder's words. */
export const S_VISOR_LEFT = 72;
/** A mark just made, in the spotted mark's ink. */
export const S_SPOT_WORD = 73;
/** The magnification ladder's zoom now, larger than its rungs. */
export const S_MAGNIFY = 74;
/** A skater's trick feed (hud/skate.ts): the line, its score, a good word and a bad one, a trick list's heading. */
export const S_SKATE_LINE = 75;
export const S_SKATE_SCORE = 76;
export const S_SKATE_GOOD = 77;
export const S_SKATE_BAD = 78;
export const S_SKATE_TRICK = 79;
/** The special meter's bar. */
export const S_SKATE_METER = 80;
/** A drone feed's readouts (hud/air-feed.ts): set left, right and in the middle, large, small, the REC mark, a warning. */
export const S_FEED = 81;
export const S_FEED_RIGHT = 82;
export const S_FEED_MID = 83;
export const S_FEED_BIG = 84;
export const S_FEED_SMALL = 85;
export const S_FEED_REC = 86;
export const S_FEED_WARN = 87;
/** A feed's tracking box's words (hud/tracks.ts): its name by how it stands to the viewer, and its line under. */
export const S_TRACK_TRIBE = 88;
export const S_TRACK_WILD = 89;
export const S_TRACK_OTHER = 90;
export const S_TRACK_NOTE = 91;
/** The black of a tier with no finishing pass under a feed (hud/air-feed.ts): in scanlines, and toward the corners. */
export const S_SCANLINES = 92;
export const S_VIGNETTE = 93;
/** A feed's small words set to the left. */
export const S_FEED_SMALL_LEFT = 94;

export const STYLES: readonly Style[] = [
  /* S_TEXT */ style(0, 0xeeeeee, 13, 0, true),
  /* S_LABEL */ style(0, 0xeeeeee, 12, 0, true),
  /* S_BANNER */ style(0x00000066, 0xffffff, 20, 1, false),
  /* S_PANEL */ style(0x0c2238df, 0xe3f4fc, 13),
  /* S_INPUT */ { ...style(0x000000cc, 0xffffff, 14), sans: false },
  /* S_CONSOLE_TEXT */ { ...style(0, 0xd8e0d8, 14), sans: false },
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
  /* S_BUTTON */ style(0x284357a8, 0xe3f4fc, 14, 1),
  /* S_TITLE */ style(0, 0xffffff, 18, 0),
  /* S_SLOT */ style(0x102c4288, 0xffffff, 11),
  /* S_SLOT_HELD */ style(0x549eb477, 0xecfaff, 11),
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
  /* S_CHAT_PANEL */ style(0x0c223899, 0xe3f4fc, 13),
  /* S_CHAT_TAG */ style(0x284357a8, 0xe3f4fc, 12, 1),
  /* S_OVER_WILD */ style(0, 0xf4f4f0, 14, 0, true),
  /* S_OVER_TRIBE */ style(0, 0x9ee8a2, 14, 0, true),
  /* S_OVER_OTHER */ style(0, 0xf2a860, 14, 0, true),
  /* S_OVER_TEXT */ style(0, 0xe8e8e4, 12, 0, true),
  /* S_OVER_TAMING */ style(0x00000066, 0x8cd66c),
  /* S_OVER_PANEL */ style(0x0c10168c, 0xeeeeee),
  /* S_MENU */ style(0x081a2e66, 0xc5e6f0),
  /* S_MENU_BUTTON */ style(0, 0xa5c4d3, 23),
  /* S_MENU_MAIN */ style(0, 0xecfaff, 23),
  /* S_MENU_NOTE */ style(0, 0xa9c9d8, 13),
  /* S_HUD_HIT */ style(0, 0xb5dbea, 15, 1),
  /* S_HUD_KEY */ style(0, 0xc0d7e2, 11, 0, true),
  /* S_HUD_COUNT */ style(0, 0xe8f8ff, 12, 2, true),
  /* S_ICE */ style(0xa6e3f4dd, 0xa6e3f4),
  /* S_MENU_FOCUS */ style(0x69b8df18, 0xe9f8ff, 15),
  /* S_MENU_HEADING */ style(0, 0xe3f4fc, 24),
  /* S_WARNING */ style(0, 0xf2a477, 13, 1, true),
  /* S_KEY */ style(0, 0xc9e7f3, 13, 1),
  /* S_KEY_SMALL */ style(0, 0xc9e7f3, 10, 1),
  /* S_KEY_EDGE */ style(0x77b8d45a, 0xb5dbea),
  /* S_KEY_FILL */ style(0x0b2134df, 0xb5dbea),
  /* S_KEY_ACTIVE */ style(0x326483bb, 0xe8f8ff),
  /* S_CONTROL_TITLE */ style(0, 0xe3f4fc, 18),
  /* S_DIAL_HOUR */ style(0, 0xecfaff, 40, 1),
  /* S_MENU_WARN */ style(0, 0xf2a477, 13),
  /* S_UNMUTE */ style(0, 0xecfaff, 20, 1, true),
  /* S_COMPASS */ style(0, 0xc9e7f3, 11, 1, true),
  /* S_COMPASS_NORTH */ style(0, 0xf2a477, 12, 1, true),
  /* S_LENS */ { ...style(0x000000ff, 0xffffff), lens: LENS_ROUND },
  /* S_LENS_TWIN */ { ...style(0x000000ff, 0xffffff), lens: LENS_TWIN },
  /* S_VISOR */ style(0, 0x7fe6d4, 13, 1, true),
  /* S_VISOR_LEFT */ style(0, 0x7fe6d4, 13, 0, true),
  /* S_SPOT_WORD */ style(0, 0xff6a3d, 13, 1, true),
  /* S_MAGNIFY */ style(0, 0xb4fff1, 20, 0, true),
  /* S_SKATE_LINE */ style(0, 0xf4f8fa, 18, 1, true),
  /* S_SKATE_SCORE */ style(0, 0xffd36a, 24, 1, true),
  /* S_SKATE_GOOD */ style(0, 0x9cf29a, 24, 1, true),
  /* S_SKATE_BAD */ style(0, 0xff6f5e, 24, 1, true),
  /* S_SKATE_TRICK */ style(0, 0xffd36a, 13, 0, true),
  /* S_SKATE_METER */ style(0x00000066, 0xffd36a),
  /* S_FEED */ mono(0xe9f3f7, 13, 0),
  /* S_FEED_RIGHT */ mono(0xe9f3f7, 13, 2),
  /* S_FEED_MID */ mono(0xe9f3f7, 13, 1),
  /* S_FEED_BIG */ mono(0xf4fbfd, 17, 1),
  /* S_FEED_SMALL */ mono(0xb9cdd4, 11, 1),
  /* S_FEED_REC */ mono(0xff4a3d, 13, 0),
  /* S_FEED_WARN */ mono(0xffb04a, 14, 1),
  /* S_TRACK_TRIBE */ mono(0x9ee8a2, 11, 0),
  /* S_TRACK_WILD */ mono(0xf4f4f0, 11, 0),
  /* S_TRACK_OTHER */ mono(0xf2a860, 11, 0),
  /* S_TRACK_NOTE */ mono(0xc4d3d8, 10, 0),
  /* S_SCANLINES */ { ...style(0x000000ff, 0xffffff), lens: LENS_SCAN },
  /* S_VIGNETTE */ { ...style(0x000000ff, 0xffffff), lens: LENS_VIGNETTE },
  /* S_FEED_SMALL_LEFT */ mono(0xb9cdd4, 11, 0),
];

/** Adds the styles of a screen the page fetches later, and returns the first one's index. */
export function addStyles(list: readonly Style[]): number {
  const at = STYLES.length;
  (STYLES as Style[]).push(...list);
  return at;
}
