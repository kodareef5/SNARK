// The HUD's widgets, in the order they are filled and drawn: what is earlier lies under what is later, and a widget may
// read what an earlier one filled. A new widget is a file beside this one and a line here.

import { ACTION } from "./action.ts";
import { FEED } from "./air-feed.ts";
import { BUFFS } from "./buffs.ts";
import { COMPASS } from "./compass.ts";
import { CROSSHAIR } from "./crosshair.ts";
import { DOTS } from "./dots.ts";
import { FALLEN } from "./fallen.ts";
import { FORMS } from "./forms.ts";
import { HOTBAR } from "./hotbar.ts";
import { JET } from "./jet.ts";
import { LEVEL } from "./level.ts";
import { MARKS } from "./marks.ts";
import { MINIMAP, MINIMAP_TOGGLE } from "./minimap.ts";
import { PROMPT } from "./prompt.ts";
import { READOUT } from "./readout.ts";
import { RESTART } from "./restart.ts";
import { HOLO_TINT, SIGHT } from "./sight.ts";
import { SKATE } from "./skate.ts";
import { STATE, WORDS } from "./state.ts";
import { TRACKS } from "./tracks.ts";
import { VEHICLE } from "./vehicle.ts";
import { VITALS } from "./vitals.ts";
import { VOICE } from "./voice.ts";
import { band, type HudWidget } from "./widget.ts";
import type { FighterModel } from "./fighter.ts";
import { askJet, JET_CODE, KEY_FIGHTER, KEY_LOCK_WARNING } from "../jet-load.ts";

/**
 * The jet's glass (fighter.ts), which comes with the jet's code: until then its fields stand and nothing is drawn. Armed
 * or warned, a survivor's page fetches the code.
 */
const FIGHTER: HudWidget<FighterModel> = {
  name: "fighter",
  bands: [band(KEY_FIGHTER, KEY_LOCK_WARNING - KEY_FIGHTER + 1)],
  make: () => ({ lockU: -1, lockV: -1, lockName: "", warned: 0 }),
  fill(m, c) {
    const code = JET_CODE.code;
    if (code) code.fighter.fill(m, c);
    else if (c.session.arms.now || c.session.arms.warned) void askJet().catch(() => {});
  },
  build(f, m, at) {
    JET_CODE.code?.fighter.build(f, m, at);
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HUD_WIDGETS: readonly HudWidget<any>[] = [
  STATE,
  FALLEN,
  HOLO_TINT,
  DOTS,
  SIGHT,
  MARKS,
  TRACKS,
  FEED,
  READOUT,
  VOICE,
  MINIMAP,
  COMPASS,
  MINIMAP_TOGGLE,
  JET,
  VEHICLE,
  FIGHTER,
  SKATE,
  VITALS,
  BUFFS,
  HOTBAR,
  LEVEL,
  CROSSHAIR,
  PROMPT,
  FORMS,
  ACTION,
  RESTART,
  WORDS,
];
