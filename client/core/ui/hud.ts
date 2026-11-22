// The HUD's build: a walk over its widgets (../hud/widgets.ts), each drawing its own part at the places the layout gives
// (../hud/layout.ts). A widget's keys are in its own file; those that were here are still exported from here.

import type { HudModel } from "../hud.ts";
import { layoutHud } from "../hud/layout.ts";
import { HUD_WIDGETS } from "../hud/widgets.ts";
import type { Settings } from "../settings.ts";
import type { UiFrame } from "./nodes.ts";
import type { TouchPlan } from "./touch.ts";

export { KEY_ACTION } from "../hud/action.ts";
export { KEY_BUFF } from "../hud/buffs.ts";
export { KEY_CONE, KEY_CROSS } from "../hud/crosshair.ts";
export { KEY_DOT } from "../hud/dots.ts";
export { KEY_AMMO, KEY_HOTBAR } from "../hud/hotbar.ts";
export { KEY_JET_FUEL } from "../hud/jet.ts";
export { HOTBAR_CELL, chatBand, hotbarCell, hotbarLeft, hotbarTop, stripRoom } from "../hud/layout.ts";
export { KEY_GLINT, KEY_SPOT } from "../hud/marks.ts";
export { IMAGE_MAP, IMAGE_MINIMAP, KEY_CLOCK, KEY_MARKER, KEY_MINIMAP, KEY_MINIMAP_FRAME, KEY_MINIMAP_IN, KEY_MINIMAP_OUT, KEY_MINIMAP_TOGGLE, KEY_SELF_ARROW, MARKER_STYLE, MARKER_TINT, MINIMAP_SIZE } from "../hud/minimap.ts";
export { KEY_PROMPT } from "../hud/prompt.ts";
export { KEY_READOUT } from "../hud/readout.ts";
export { KEY_GLASS, KEY_MAGNIFY, KEY_MIL, KEY_SIGHT, KEY_SIGHT_SHADE, KEY_TINT, KEY_VISOR } from "../hud/sight.ts";
export { KEY_BANNER, KEY_OUT, KEY_STATUS } from "../hud/state.ts";
export { KEY_VEHICLE } from "../hud/vehicle.ts";
export { KEY_VITAL, VITAL_PITCH } from "../hud/vitals.ts";
export { KEY_TALKER, KEY_VOICE } from "../hud/voice.ts";

const SHOWN: Pick<Settings, "minimap" | "diagnostics" | "vitalLabels" | "compass"> = { minimap: true, diagnostics: false, vitalLabels: false, compass: true };

/**
 * The HUD, inside the canvas's insets. With `touch` (ui/touch.ts touchPlan) it makes room for a finger's controls: the
 * vitals stand in a row at the top, the stack in the top left starts under the bar, the minimap is the plan's size and
 * the prompt loses its key.
 */
export function buildHud(f: UiFrame, m: HudModel, options: Pick<Settings, "minimap" | "diagnostics" | "vitalLabels" | "compass"> = SHOWN, controls = true, inspect = false, touch: TouchPlan | null = null): void {
  const at = layoutHud(f, m, options, controls, inspect, touch);
  for (let i = 0; i < HUD_WIDGETS.length; i++) HUD_WIDGETS[i]!.build?.(f, m, at);
}
