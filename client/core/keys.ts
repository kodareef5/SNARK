// What each key does, as rows. App.key walks KEY_ROWS from the first, so the list's order is the precedence: the first
// row that answers has the key. A feature keeps its rows in its own file and takes its place in the list at the foot of
// this one. The controls guide reads its words from the rows (ui/controls-guide.ts).

import { makeHandle } from "../../shared/ids.ts";
import { CMD_OPEN, CMD_ORDER, CMD_SELECT, CMD_TAKE, CMD_THROW, CMD_VEHICLE, ORDER_ALL, ORDER_ATTACK, ORDER_FOLLOW, ORDER_STAY, ORDER_YOURS, VEHICLE_DOOR, VEHICLE_PACK, VEHICLE_INSPECT, VEHICLE_LIGHTS } from "../../shared/net/protocol.ts";
import { isSkateboard, isWheelVehicle } from "../../shared/sim/vehicle.ts";
import { BUILD_KEYS } from "./build.ts";
import { GLASS_KEYS } from "./glass.ts";
import { ANY_KEY, G_WORLD, type KeyRow } from "./key-row.ts";
import { SIGHT_KEYS } from "./optics.ts";
import { ORBIT_KEYS } from "./orbit.ts";
import { CHART_KEYS } from "./tactical.ts";
import { T_FOLLOW, T_FOLLOW_ONE, T_MIC, T_SIC, T_STAY, T_STAY_ONE, T_USE, T_VIEW } from "./touch.ts";
import { PLACEMENT_KEYS } from "./vehicle-placement.ts";
import { VISOR_KEYS } from "./visor.ts";

// F8 takes a note in bug report mode, from any screen (notes/notes.ts).
const NOTE: KeyRow = { name: "note", keys: ["F8"], when: (c) => c.notes !== null, press: (c, _code, down, repeat) => c.notes!.key(down, repeat) };

const INTERFACE: KeyRow = {
  name: "interface",
  keys: ANY_KEY,
  press(c, code, down, repeat) {
    if (!c.ui.key(code, down, repeat, c.session)) return undefined;
    // A screen that captures the keyboard releases the body's keys and a push-to-talk microphone.
    if (c.ui.captureKeyboard) c.blur();
    return true;
  },
};

const INSPECT_ZOOM: KeyRow = {
  name: "inspect zoom",
  keys: ["Minus", "Equal"],
  when: (c) => c.ui.inspect,
  press(c, code, down, repeat) {
    if (down && !repeat) c.zoomMini(code === "Equal" ? 1 : -1);
    return true;
  },
};

/** A screen that has the keyboard: the page types into it, and no row after this one sees the key. */
const TYPING: KeyRow = { name: "typing", keys: ANY_KEY, when: (c) => c.ui.captureKeyboard, press: () => false };

// Returning true keeps the browser from opening its menu.
const ALT: KeyRow = { name: "alt", keys: ["AltLeft", "AltRight"], press: (c, _code, down) => ((c.alt = down), true) };
const SHIFT: KeyRow = { name: "shift", keys: ["ShiftLeft", "ShiftRight"], press: (c, _code, down) => ((c.shift = down), undefined) };

// The use key on an egg takes it up with a command of its own, and the body does not get the press.
const TAKE: KeyRow = {
  name: "take",
  keys: ["KeyE"],
  when: (c, _code, down, repeat) => c.eggKept || (down && !repeat && c.eggAimed >= 0),
  press(c, _code, down) {
    if (!c.eggKept) c.session.command(CMD_TAKE, (w) => w.u32(c.eggAimed >>> 0));
    c.eggKept = down;
    return true;
  },
};

// The use key at an obelisk's terminal opens the list of servers to travel to.
const TERMINAL: KeyRow = {
  name: "terminal",
  keys: ["KeyE"],
  when: (c, _code, down, repeat) => down && !repeat && c.terminalAimed >= 0,
  press: (c) => (c.ui.travel.openAt(c.terminalAimed), true),
};

// Holding the use key on a structure opens its menu, so there the body gets the press only on release, as a short pulse.
const USE: KeyRow = {
  name: "use",
  keys: ["KeyE"],
  touch: { KeyE: T_USE },
  pad: { KeyE: 3 },
  guide: [{ code: "KeyE", group: G_WORLD, title: "Use / ride", detail: "Tap to interact, or to get in or out of a seat or saddle. Hold on a structure to open its actions." }],
  press(c, _code, down, repeat) {
    if (down && !repeat) {
      c.seatNotice.pressed(c.seatPress());
      c.useDownAt = c.nowMs;
      c.useKept = c.aimed >= 0;
    } else if (!down) {
      if (c.useKept && c.useDownAt >= 0) c.usePulse = 4;
      c.useDownAt = -1;
    }
    if (!c.useKept) return undefined;
    if (!down) c.useKept = false;
    return true;
  },
};

// At the wheel of a patrol vehicle K cycles its lights. Elsewhere it is the orbit camera (orbit.ts).
const PATROL_LIGHTS: KeyRow = {
  name: "patrol lights",
  keys: ["KeyK"],
  when: (c) => c.session.driving >= 0,
  press(c, _code, down, repeat) {
    const def = c.reg.vehicle[c.session.bodyKind];
    if (!def || !isWheelVehicle(def) || !def.emergencyLights) return undefined;
    const r = c.remote, i = r.id.subarray(0, r.count).indexOf(c.session.driving);
    if (down && !repeat && i >= 0) c.session.command(CMD_VEHICLE, (w) => { w.u8(VEHICLE_LIGHTS); w.u32(makeHandle(c.session.driving, r.gen[i]!)); });
    return true;
  },
};

// Q on foot throws what is in hand along the look (server/loose.ts). Building and placing a car take Q first. The key
// is not kept: nothing else on foot is bound to it. In a car's seat, Q swings its door open or shut, and a door held
// open on a car going fast strikes whoever it passes (server/urban.ts).
const DOOR_OR_THROW: KeyRow = {
  name: "door or throw",
  keys: ["KeyQ"],
  when: (c, _code, down, repeat) => down && !repeat && c.ui.wantsPointerLock,
  press(c) {
    const s = c.session, r = c.remote, ids = r.id.subarray(0, r.count);
    const host = s.driving >= 0 ? s.driving : s.own.seatSlot && s.own.seat > 0 ? s.own.seat - 1 : -1;
    const at = host >= 0 ? ids.indexOf(host) : -1;
    const def = at >= 0 ? c.reg.vehicle[r.kind[at]!] : undefined;
    // A vehicle whose controls take Q for themselves (a helicopter's, a thruster's) keeps it.
    if (def && isWheelVehicle(def) && !c.controls.binds("KeyQ")) {
      s.command(CMD_VEHICLE, (w) => { w.u8(VEHICLE_DOOR); w.u32(makeHandle(host, r.gen[at]!)); });
      return true;
    }
    if (s.driving < 0) s.command(CMD_THROW, () => {});
    return undefined;
  },
};

// F opens the occupied boat, the hull being aimed at, or a tribe creature's inventory.
const OPEN: KeyRow = {
  name: "open",
  keys: ["KeyF"],
  pad: { KeyF: 2 },
  guide: [{ code: "KeyF", group: G_WORLD, title: "Creature inventory", detail: "Opens the owned creature you are riding or looking at." }],
  press(c, _code, down, repeat) {
    if (!down || repeat) return true;
    const s = c.session, r = c.remote, ids = r.id.subarray(0, r.count);
    let which = s.driving;
    if (which < 0 && s.own.seatSlot && s.own.seat > 0) {
      const at = ids.indexOf(s.own.seat - 1);
      if (at >= 0 && r.gen[at] === s.own.seatGen && c.reg.vehicle[r.kind[at]!]?.movement === "boat") which = r.id[at]!;
    }
    if (which < 0) which = c.aimedBoat >= 0 ? c.aimedBoat : c.lookedAt;
    if (which >= 0) {
      const at = ids.indexOf(which);
      const vehicle = at >= 0 ? c.reg.vehicle[r.kind[at]!] : undefined;
      if (vehicle) {
        const action = s.driving < 0 && isSkateboard(vehicle) ? VEHICLE_PACK : VEHICLE_INSPECT;
        s.command(CMD_VEHICLE, w => { w.u8(action); w.u32(makeHandle(which, r.gen[at]!)); });
      } else s.command(CMD_OPEN, (w) => w.u32(which >>> 0));
    }
    return true;
  },
};

/** A whistle to the creature looked at (`one`) or to every tribe creature that hears. */
function whistle(name: string, code: string, touch: number, title: string, one: boolean, order: number): KeyRow {
  return {
    name,
    keys: [code],
    touch: { [code]: touch },
    guide: [{ code, group: G_WORLD, title, detail: one ? "Whistle to the creature you are looking at." : "" }],
    press(c, _code, down, repeat) {
      const which = one ? c.lookedAt : ORDER_ALL;
      if (down && !repeat && which >= 0) c.session.command(CMD_ORDER, (w) => (w.u32(which >>> 0), w.u8(order)));
      return true;
    },
  };
}

// Period, as in ARK, sends every tribe creature that hears at the body looked at. ARK's equals, the attack-my-target
// whistle, zooms the minimap here, so it is the right bracket beside it.
const ATTACK_THIS: KeyRow = {
  name: "attack this target",
  keys: ["Period"],
  touch: { Period: T_SIC },
  guide: [{ code: "Period", group: G_WORLD, title: "Attack this target", detail: "Orders tribe creatures that can hear you." }],
  press(c, _code, down, repeat) {
    const at = c.target;
    if (down && !repeat && at >= 0) c.session.command(CMD_ORDER, (w) => (w.u32(ORDER_ALL), w.u8(ORDER_ATTACK), w.u32(at >>> 0)));
    return true;
  },
};
const ATTACK_MINE: KeyRow = {
  name: "attack my target",
  keys: ["BracketRight"],
  guide: [{ code: "BracketRight", group: G_WORLD, title: "Attack my target" }],
  press(c, _code, down, repeat) {
    if (down && !repeat) c.session.command(CMD_ORDER, (w) => (w.u32(ORDER_ALL), w.u8(ORDER_YOURS)));
    return true;
  },
};

const VOICE: KeyRow = {
  name: "voice",
  keys: ["KeyB"],
  touch: { KeyB: T_MIC },
  guide: [{ code: "KeyB", group: G_WORLD, title: "Voice", detail: "Hold to talk, or use the toggle preference in Audio." }],
  press(c, _code, down, repeat) {
    if (repeat) return true;
    if (!c.ui.settings.toggleTalk) c.talk(down);
    else if (down) c.talk(!c.talking);
    return true;
  },
};

const DIGITS = ["Digit0", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"];
// Keys 1 to 9 then 0 are slots 0 to 9. The key of the held slot puts it away (255).
const HOTBAR: KeyRow = {
  name: "hotbar",
  keys: DIGITS,
  guide: DIGITS.map((code, i) => ({ code, group: G_WORLD, title: `Hotbar ${i}`, detail: "Select this slot; press again to put it away." })),
  press(c, code, down, repeat) {
    const slot = (DIGITS.indexOf(code) + 9) % 10;
    if (down && !repeat) c.session.command(CMD_SELECT, (w) => w.u8(c.session.held === slot ? 255 : slot));
    return true;
  },
};

// On foot the choice is kept (Settings.thirdPerson). In a helicopter or a boat V picks the cockpit or the chase view, for that ride only.
const VIEW: KeyRow = {
  name: "view",
  keys: ["KeyV"],
  touch: { KeyV: T_VIEW },
  guide: [{ code: "KeyV", group: G_WORLD, title: "View", detail: "Switch third / first person when the server allows it. You start in third." }],
  press(c, _code, down, repeat) {
    if (down && !repeat && c.session.thirdPerson) {
      c.view.thirdPerson = !c.view.thirdPerson;
      if (c.wasOnFoot) { c.ui.settings.thirdPerson = c.view.thirdPerson; c.ui.settings.changed(); }
    }
    return true;
  },
};

// Arms round a creature do not lie down with it.
const ARMS_FULL: KeyRow = { name: "arms full", keys: ["KeyX"], when: (c, _code, down) => down && c.holding >= 0, press: () => true };

/** The buttons of the body or vehicle driven, the stances and the keys that move it (controls.ts). */
const BODY: KeyRow = { name: "body", keys: ANY_KEY, press: (c, code, down, _repeat, source) => c.controls.key(code, down, source) };

/**
 * Every key the app takes, in the order of precedence. A feature adds its rows here, before whatever it must win the
 * key from and after whatever must win it from the feature.
 */
export const KEY_ROWS: readonly KeyRow[] = [
  NOTE,
  ...PLACEMENT_KEYS,
  INTERFACE,
  INSPECT_ZOOM,
  TYPING,
  ...SIGHT_KEYS,
  ...GLASS_KEYS,
  ...VISOR_KEYS,
  ...BUILD_KEYS,
  ...CHART_KEYS,
  ALT,
  SHIFT,
  TAKE,
  TERMINAL,
  USE,
  PATROL_LIGHTS,
  DOOR_OR_THROW,
  ...ORBIT_KEYS,
  OPEN,
  whistle("follow: one", "KeyT", T_FOLLOW_ONE, "Follow: one", true, ORDER_FOLLOW),
  whistle("stay: one", "KeyY", T_STAY_ONE, "Stay: one", true, ORDER_STAY),
  whistle("follow: all", "KeyJ", T_FOLLOW, "Follow: all", false, ORDER_FOLLOW),
  whistle("stay: all", "KeyU", T_STAY, "Stay: all", false, ORDER_STAY),
  ATTACK_THIS,
  ATTACK_MINE,
  VOICE,
  HOTBAR,
  VIEW,
  ARMS_FULL,
  BODY,
];
