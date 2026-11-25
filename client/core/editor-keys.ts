// The keys of build mode and of the template hammer, which the controls guide and the key rows need before the
// editor's own code has come (editor-load.ts). Each row acts only while its builder or hammer is there and in hand.

import { G_BUILD, type KeyContext, type KeyRow } from "./key-row.ts";
import { T_CANCEL, T_FOLLOW_ONE, T_LOWER, T_RAISE, T_RELOAD, T_SNAP } from "./touch.ts";

/** With a piece in hand and on foot, in play: when building's rows apply. */
const building = (c: KeyContext): boolean => (c.builder?.active ?? false) && c.session.driving < 0 && c.ui.wantsPointerLock;

// Before any screen has the key: Z takes the last piece back, where it else opens the emotes; and a finger's Cancel, which
// presses Escape, puts the piece away. The keyboard's Escape goes on to the menu.
export const BUILD_FIRST_KEYS: readonly KeyRow[] = [{
  name: "build cancel",
  keys: ["Escape", "KeyZ"],
  touch: { Escape: T_CANCEL },
  guide: [{ code: "KeyZ", group: G_BUILD, title: "Undo", detail: "Take back the piece you set down last, while it can still be picked up.", sheet: G_BUILD }],
  when: (c) => building(c) && !c.ui.opened("emotes"),
  press(c, code, down, repeat, source) {
    if (code === "KeyZ") {
      if (down && !repeat) c.undo();
      return true;
    }
    if (source !== 2) return undefined;
    if (down && !repeat && !c.builder!.cancel()) c.builder!.putAway(c.session, c.nowMs);
    return true;
  },
}];

// While a piece is being placed its keys are the builder's (Builder.key). The guide's Build tab is these words.
export const BUILD_KEYS: readonly KeyRow[] = [{
  name: "build",
  keys: ["KeyQ", "KeyR", "KeyT", "KeyX", "ArrowUp", "ArrowDown"],
  touch: { KeyR: T_RELOAD, KeyT: T_FOLLOW_ONE, KeyQ: T_SNAP, ArrowUp: T_RAISE, ArrowDown: T_LOWER },
  pad: { KeyX: 1, KeyT: 3, KeyQ: 14, ArrowUp: 12, ArrowDown: 13 },
  guide: [
    { code: "KeyQ", group: G_BUILD, title: "Next snap point / thruster flip", detail: "Tap to cycle snaps. Hold to toggle free placement. At the wheel of a thruster car (the Zephyr), on or just off the ground, flip: hold W for a front flip, S for a back flip, A or D for a barrel roll, or nothing for a kickflip; its nozzles catch it on its wheels. G flips too." },
    { code: "KeyQ", group: G_BUILD, title: "Next snap point", detail: "Tap to cycle snaps. Hold to toggle free placement.", sheet: G_BUILD },
    { code: "KeyR", group: G_BUILD, title: "Rotate", detail: "Rotate the active building preview. The mouse wheel turns it either way.", sheet: G_BUILD },
    { code: "KeyT", group: G_BUILD, title: "Next form / form wheel", detail: "Tap for the next form of the piece in hand: wall, doorframe, windowframe. Hold for a wheel of them, move the look or scroll to one, and let go.", sheet: G_BUILD },
    { code: "KeyX", group: G_BUILD, title: "Put away", detail: "Put the piece in hand away. The right mouse button does too.", sheet: G_BUILD },
    { code: "KeyE", group: G_BUILD, title: "Use / piece menu", detail: "Tap to use what you look at. Hold on a built piece to mend it, take it back or take it down.", sheet: G_BUILD },
    { code: "ArrowUp", group: G_BUILD, title: "Raise preview", sheet: G_BUILD },
    { code: "ArrowDown", group: G_BUILD, title: "Lower preview", sheet: G_BUILD },
    { code: "Mouse0", group: G_BUILD, title: "Place / drag a row", detail: "Click to set the piece down. Hold and sweep the look to lay floors, foundations or walls in a row of up to 32, set down when you let go. X or the right button gives the row up.", sheet: G_BUILD },
    { code: "Mouse1", group: G_BUILD, title: "Pick piece", detail: "Take in hand the piece that builds what you look at, if you carry one.", sheet: G_BUILD },
    { code: "Mouse2", group: G_BUILD, title: "Put away", sheet: G_BUILD },
  ],
  when: (c) => building(c),
  press(c, code, down, repeat) {
    if (code !== "KeyX") return c.builder!.key(code, down, repeat, c.nowMs, c.reg) || undefined;
    // A row being dragged is given up; with none, the piece is put away.
    if (down && !repeat && !c.builder!.cancel()) c.builder!.putAway(c.session, c.nowMs);
    return true;
  },
}];

/** With the hammer in hand and on foot, in play. */
const hammering = (c: KeyContext): boolean => (c.hammer?.active ?? false) && c.session.driving < 0 && c.ui.wantsPointerLock;

// The hammer's keys while it is in hand: the builder's own for turning, raising and putting away, T for the list of
// templates, F to fill and G to copy a box. The first button copies or sets down, and the middle one fills, which is
// the pad's d-pad right (App.mouseButton).
export const HAMMER_KEYS: readonly KeyRow[] = [{
  name: "hammer",
  keys: ["KeyQ", "KeyR", "KeyT", "KeyX", "KeyF", "KeyG", "Delete", "ArrowUp", "ArrowDown"],
  pad: { KeyX: 1, KeyT: 3, KeyQ: 14, ArrowUp: 12, ArrowDown: 13 },
  guide: [
    { code: "Mouse0", group: G_BUILD, title: "Hammer: copy / set down", detail: "With the template hammer: copy the base you look at, or set down the template in hand.", sheet: G_BUILD },
    { code: "KeyF", group: G_BUILD, title: "Hammer: fill the plan", detail: "Build every piece of the plan that you carry the piece for, foundations first.", sheet: G_BUILD },
    { code: "KeyG", group: G_BUILD, title: "Hammer: copy a box", detail: "Mark one corner, then the other: what of the base lies between is copied.", sheet: G_BUILD },
    { code: "Delete", group: G_BUILD, title: "Hammer: take a plan away", detail: "Press twice.", sheet: G_BUILD },
  ],
  when: (c) => hammering(c),
  press(c, code, down, repeat) {
    const h = c.hammer!;
    if (!down) return true;
    if (code === "ArrowUp" || code === "ArrowDown") h.lift(code === "ArrowUp" ? 1 : -1);
    else if (repeat) return true;
    else if (code === "KeyR") h.rotate(1);
    else if (code === "KeyQ") h.flip();
    else if (code === "KeyT") h.panel = true;
    else if (code === "KeyF") h.fill();
    else if (code === "KeyG") h.box();
    else if (code === "Delete") h.cancel();
    else if (code === "KeyX") {
      if (h.chosen >= 0) h.choose(-1);
      else if (h.corner >= 0) h.corner = -1;
      else return undefined;
    }
    return true;
  },
}];
