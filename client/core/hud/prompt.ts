// What the use key or a click would do, under the crosshair. The app works the words out (App.frame).

import { fitText } from "../ui/nodes.ts";
import { S_PROMPT } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

export const KEY_PROMPT = 33;

export interface PromptModel {
  prompt: string;
}

export const PROMPT: HudWidget<PromptModel> = {
  name: "prompt",
  make: () => ({ prompt: "" }),
  build(f, m, at) {
    const { W, H, touch } = at;
    if (!m.crosshair) return;
    // The helm panel already carries the exit control; repeating it over the centre overlaps portrait instruments.
    const exitInPanel = m.vehicle?.active && m.vehicle.boat && m.prompt === "E  exit vehicle";
    // A finger is offered the prompt as a button (ui/touch.ts), so here it loses its key.
    const prompt = touch && m.prompt.startsWith("E  ") ? m.prompt.slice(3) : m.prompt;
    if (prompt !== "" && !exitInPanel) f.text(KEY_PROMPT, W / 2 - 150, H / 2 + 14, 300, S_PROMPT, fitText(prompt, 300, S_PROMPT));
  },
};
