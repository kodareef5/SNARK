// The numbers the resource monitor's files take from the code the first frame waits for, as copies, since they import
// none of it (ui/monitor-kit.ts says why): kinds of node (ui/nodes.ts), styles (ui/style.ts) and the heights of their
// lines. tests/unit/monitor.test.ts holds each to its original.

export const K_PANEL = 0, K_TEXT = 1, K_BAR = 2, K_BUTTON = 5, K_HOLD = 9;
export const S_TEXT = 0, S_LABEL = 1, S_DARK = 34, S_MENU = 47, S_MENU_NOTE = 50, S_HUD_HIT = 51, S_HUD_COUNT = 53, S_ICE = 54, S_MENU_HEADING = 56, S_WARNING = 57, S_KEY = 58, S_MENU_WARN = 65, S_UNMUTE = 66, S_OXYGEN = 12;
/** A line of S_MENU_NOTE and of S_TEXT, of S_LABEL and S_HUD_COUNT, and of S_MENU_HEADING: lineHeight() of each. */
export const LINE = 18, SMALL_LINE = 17, HEADING_LINE = 33;
