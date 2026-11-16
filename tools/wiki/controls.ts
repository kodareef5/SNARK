// The wiki's controls page from the game's own tables: the help each key and gamepad button has in each of the controls
// screen's groups (client/core/ui/controls-guide.ts), named as that screen names them. A binding added there is here.

import { CONTROL_GROUPS, keyBinding, padBinding, type Binding } from "../../client/core/ui/controls-guide.ts";
import { padLabel } from "../../client/core/ui/controller.ts";
import { KEY_ROWS } from "../../client/core/ui/keyboard.ts";

export interface Control {
  /** The keys or buttons, as the controls screen labels them. */
  keys: string[];
  title: string;
  detail: string;
}

export interface ControlGroup {
  name: string;
  keys: Control[];
  pad: Control[];
}

const MOUSE: readonly (readonly [string, string])[] = [["Mouse0", "Left mouse button"], ["Mouse2", "Right mouse button"], ["MouseMove", "Mouse"]];
/** The buttons of a standard gamepad that the controls screen draws. */
const PAD_BUTTONS = 16;

/** Each group's bindings: those the controls screen lights in that group, keys that do the same thing as one. */
export function controlGroups(): ControlGroup[] {
  const keys = [...KEY_ROWS.flat().filter(([code]) => code !== "").map(([code, label]) => [code, label] as const), ...MOUSE];
  const rows = (found: [string, Binding | undefined][], group: number): Control[] => {
    const out: Control[] = [];
    for (const [label, b] of found) {
      if (b?.group !== group) continue;
      const same = out.find((c) => c.title === b.title && c.detail === b.detail);
      if (same) same.keys.push(label);
      else out.push({ keys: [label], title: b.title, detail: b.detail });
    }
    return out;
  };
  return CONTROL_GROUPS.map((name, g) => ({
    name,
    keys: rows(keys.map(([code, label]) => [label, keyBinding(code, g)]), g),
    pad: rows(Array.from({ length: PAD_BUTTONS }, (_, i) => [[...new Set([padLabel(i, 0), padLabel(i, 1)])].join(" / "), padBinding(i, g)]), g),
  }));
}
