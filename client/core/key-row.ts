// A row of the key table (keys.ts): which key, when it applies, what it does, and what the controls guide says of it.
// This file imports nothing that runs, so a feature's file can take its row's type and the guide's tabs from here.

import type { App } from "./app.ts";

/** What a row reads and acts on: the app. */
export type KeyContext = App;

/** The controls guide's tabs (ui/controls-guide.ts CONTROL_GROUPS). */
export const G_MOVE = 0, G_COMBAT = 1, G_WORLD = 2, G_BUILD = 3, G_FLIGHT = 4, G_MENUS = 5;

/**
 * What the controls guide says of `code`. `group` is the tab that lights the key. With `sheet` (G_BUILD, G_FLIGHT or
 * G_MENUS) the words stand only on that tab, in place of the key's own.
 */
export interface GuideWords {
  code: string;
  group: number;
  title: string;
  detail?: string;
  sheet?: number;
}

export interface KeyRow {
  /** Says which row this is, to a reader and to a test. */
  name: string;
  /** The codes it takes, or ANY_KEY. */
  keys: readonly string[] | typeof ANY_KEY;
  /** Whether it applies now. Without one it always does. */
  when?(c: KeyContext, code: string, down: boolean, repeat: boolean): boolean;
  /**
   * What it does. True or false is App.key's answer (true: the page should not also act on the key) and ends the walk.
   * Undefined leaves the key to the rows after it.
   */
  press(c: KeyContext, code: string, down: boolean, repeat: boolean, source: number): boolean | undefined;
  /** The touch button (touch.ts T_) and the pad's button that stand for a code. */
  touch?: Readonly<Record<string, number>>;
  pad?: Readonly<Record<string, number>>;
  guide?: readonly GuideWords[];
}

export const ANY_KEY = "*";

/** Walks `rows` in order with one key event, and returns the first answer; false where no row answers. */
export function pressKey(rows: readonly KeyRow[], c: KeyContext, code: string, down: boolean, repeat: boolean, source: number): boolean {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.keys !== ANY_KEY && !row.keys.includes(code)) continue;
    if (row.when && !row.when(c, code, down, repeat)) continue;
    const answer = row.press(c, code, down, repeat, source);
    if (answer !== undefined) return answer;
  }
  return false;
}
