// A tab of the debug bar's drawer: its name in the bar, and how it lays itself out and answers a press.

import type { DebugBar } from "./debug.ts";
import type { Draw } from "./draw.ts";

/** Actions of the bar itself. A tab's own start at TAB_ACT. */
export const ACT_TAB = 1, ACT_SAVE = 2, ACT_CLOSE = 3, ACT_PICTURES = 4, ACT_DRAWER = 5, ACT_OPEN = 6;
export const TAB_ACT = 100;

/** Where a press or the pointer fell in a node: its action and argument, and how far across and down it, 0 to 1. */
export interface Press {
  act: number;
  arg: number;
  fx: number;
  fy: number;
}

export interface Tab {
  readonly name: string;
  /** Whether it shows for this session; without one it always does. */
  shown?(d: DebugBar): boolean;
  /** What stands beside its name in the bar, "" for nothing, and whether that is bad news. */
  badge?(d: DebugBar): string;
  /** Lays it out in the box. Called a few times a second while it shows, and after a press. */
  lay(d: DebugBar, draw: Draw, x: number, y: number, w: number, h: number, nowMs: number): void;
  /** A press on one of its nodes. */
  press?(d: DebugBar, p: Press): void;
  /** The pointer moved over one of its nodes; true where that changes what it shows. */
  hover?(d: DebugBar, p: Press): boolean;
  /** The wheel turned while it shows; true where it took it. */
  wheel?(d: DebugBar, dy: number): boolean;
}
