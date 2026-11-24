// The wheel of the forms of the piece in hand, round the crosshair while the form key is held (build.ts).

import { K_PANEL, lineHeight } from "../ui/nodes.ts";
import { S_PANEL, S_PROMPT } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

/** The box behind the form the wheel is on, then a form's name: KEY_FORM_NAME + its place on the wheel. */
export const KEY_FORM_ON = 5559;
export const KEY_FORM_NAME = 5560;
/** Units from the crosshair to a name's middle, and a name's width. */
const REACH = 84;
const WIDE = 112;

export interface FormsModel {
  formsOpen: boolean;
  formAt: number;
  formNames: string[];
}

export const FORMS: HudWidget<FormsModel> = {
  name: "forms",
  make: () => ({ formsOpen: false, formAt: 0, formNames: [] }),
  fill(m, c) {
    const a = c.frame;
    m.formsOpen = !!a && a.formsOpen;
    if (!a || !a.formsOpen) return;
    m.formAt = a.formAt;
    m.formNames.length = 0;
    for (const name of a.formNames) m.formNames.push(name);
  },
  build(f, m, at) {
    if (!m.formsOpen) return;
    const { W, H } = at;
    const n = m.formNames.length;
    const lh = lineHeight(S_PROMPT);
    // The first is straight up and the rest follow round to the right, as the look chooses them.
    for (let i = 0; i < n; i++) {
      const turn = (i / n) * 2 * Math.PI;
      const x = W / 2 + Math.sin(turn) * REACH - WIDE / 2;
      const y = H / 2 - Math.cos(turn) * REACH - lh / 2;
      if (i === m.formAt) f.add(KEY_FORM_ON, K_PANEL, x, y - 4, WIDE, lh + 8, S_PANEL);
      f.text(KEY_FORM_NAME + i, x, y, WIDE, S_PROMPT, m.formNames[i]!);
    }
  },
};
