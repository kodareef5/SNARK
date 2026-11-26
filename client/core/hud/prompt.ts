// What the use key or a click would do, under the crosshair. The prompts work the words out (prompts.ts).

import { fitText, lineHeight } from "../ui/nodes.ts";
import { usePrompt } from "../ui/use-prompt.ts";
import { S_PROMPT } from "../ui/style.ts";
import { band, type HudWidget } from "./widget.ts";

export const KEY_PROMPT = 33;
/** The prompt's second line, under the first: how a city piece stands, under its building's name. */
export const KEY_PROMPT_UNDER = 39;

export interface PromptModel {
  prompt: string;
}

export const PROMPT: HudWidget<PromptModel> = {
  name: "prompt",
  bands: [band(KEY_PROMPT, 1), band(KEY_PROMPT_UNDER, 1)],
  make: () => ({ prompt: "" }),
  fill(m, c) {
    if (c.frame) m.prompt = c.frame.prompt;
  },
  build(f, m, at) {
    const { W, H, touch } = at;
    if (!m.crosshair) return;
    // The helm panel already carries the exit control; repeating it over the centre overlaps portrait instruments.
    const exitInPanel = m.vehicle?.active && (m.vehicle.boat || m.vehicle.board && !touch) && m.prompt === "E  exit vehicle";
    if (!m.prompt || exitInPanel) return;
    const [first, under] = m.prompt.split("\n");
    const showFirst = first && (!touch || !at.controls || !usePrompt(first));
    if (showFirst) f.text(KEY_PROMPT, W / 2 - 150, H / 2 + 14, 300, S_PROMPT, fitText(first, 300, S_PROMPT));
    if (under && (!touch || !at.controls || !usePrompt(under))) f.text(KEY_PROMPT_UNDER, W / 2 - 150, H / 2 + 14 + (showFirst ? lineHeight(S_PROMPT) : 0), 300, S_PROMPT, fitText(under, 300, S_PROMPT));
  },
};
