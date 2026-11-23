// The HUD's widgets, in the order they are filled and drawn: what is earlier lies under what is later, and a widget may
// read what an earlier one filled. A new widget is a file beside this one and a line here.

import { ACTION } from "./action.ts";
import { BUFFS } from "./buffs.ts";
import { COMPASS } from "./compass.ts";
import { CROSSHAIR } from "./crosshair.ts";
import { DOTS } from "./dots.ts";
import { FALLEN } from "./fallen.ts";
import { HOTBAR } from "./hotbar.ts";
import { JET } from "./jet.ts";
import { MARKS } from "./marks.ts";
import { MINIMAP, MINIMAP_TOGGLE } from "./minimap.ts";
import { PROMPT } from "./prompt.ts";
import { READOUT } from "./readout.ts";
import { HOLO_TINT, SIGHT } from "./sight.ts";
import { STATE, WORDS } from "./state.ts";
import { VEHICLE } from "./vehicle.ts";
import { VITALS } from "./vitals.ts";
import { VOICE } from "./voice.ts";
import type { HudWidget } from "./widget.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HUD_WIDGETS: readonly HudWidget<any>[] = [
  STATE,
  FALLEN,
  HOLO_TINT,
  DOTS,
  SIGHT,
  MARKS,
  READOUT,
  VOICE,
  MINIMAP,
  COMPASS,
  MINIMAP_TOGGLE,
  JET,
  VEHICLE,
  VITALS,
  BUFFS,
  HOTBAR,
  CROSSHAIR,
  PROMPT,
  ACTION,
  WORDS,
];
