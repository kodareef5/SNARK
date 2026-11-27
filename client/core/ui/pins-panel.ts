// The pins panel beside the corner chart while a pin is being placed: the kind and the sharing of the next one, its
// label, and the team's pins, newest first, each with its kind, label, author and age, a send for the creatures in range,
// and a remove where the reader may. Its patrol sends those creatures round the tribe's Go pins.

import { fitBytes } from "../../../shared/net/codec.ts";
import { ORDER_ALL, PIN_LABEL_BYTES, RESULT_FAR, RESULT_NOT_YOURS, RESULT_OK, RESULT_RATE } from "../../../shared/net/protocol.ts";
import { goPins, orderMove, orderPatrol } from "../courses.ts";
import { PIN_TINT, PIN_WORDS, mayUnpin, pinAge, unpin, type PinView } from "../pins.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_INPUT, K_PANEL, fitText, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_HUD_KEY, S_INPUT, S_KEY_SMALL, S_MARK_SELF, S_PANEL } from "./style.ts";

export const KEY_PIN_PANEL = 4600;
export const KEY_PIN_TITLE = 4601;
/** A button for each kind, by WAYPOINT_KINDS. */
export const KEY_PIN_KIND = 4602;
export const KEY_PIN_SHARE = 4610;
export const KEY_PIN_LABEL = 4611;
export const KEY_PIN_NOTE = 4612;
/** The pager: back, on, and the page it is at. */
export const KEY_PIN_PAGE = 4613;
/** Sends the tribe's creatures in range round its shared Go pins, in the order they were placed. */
export const KEY_PIN_PATROL = 4616;
/** Per row of the list: its line, its colour and its remove. */
export const KEY_PIN_ROW = 4620;
export const KEY_PIN_SWATCH = 4630;
export const KEY_PIN_REMOVE = 4640;
/** Per row: sends the tribe's creatures in range to its pin. */
export const KEY_PIN_SEND = 4650;
export const PIN_BAND = { from: KEY_PIN_PANEL, count: 60 };
/** Rows of the list a page shows. */
export const PIN_ROWS = 8;
export const PIN_PANEL_W = 236;
const ROW_H = 18;
const PAD = 6;

/** What the next pin will be, and the panel's own state. */
export class PinChoice {
  kind = 0;
  shared = true;
  label = "";
  page = 0;
  /** The label field has the keyboard. */
  typing = false;
  /** Why the last pin asked for was refused, or "". */
  note = "";
  /** The sequence number of the last pin command sent, whose answer is awaited. */
  asked = 0;
  /** The pin each row of the list shows, -1 for none. */
  readonly rows = new Int32Array(PIN_ROWS).fill(-1);
  /** The Go pins a patrol would walk, as the panel was last built. */
  readonly go: number[] = [];

  /** The label as typed, cut to what the server keeps. */
  edit(value: string): void {
    this.label = fitBytes(value, PIN_LABEL_BYTES);
  }

  /** A pin was asked for or removed by command `seq`; its answer is told in `note`. */
  sent(seq: number): void {
    if (seq !== 0) this.asked = seq;
    this.note = seq === 0 ? "not sent" : "";
  }

  /** The server's answer to a command. */
  result(seq: number, code: number): void {
    if (seq !== this.asked || this.asked === 0) return;
    this.asked = 0;
    this.note = code === RESULT_OK ? "" : code === RESULT_RATE ? "too many pins at once: wait a moment" : code === RESULT_FAR ? "nothing there to pin" : code === RESULT_NOT_YOURS ? "not yours to remove" : "refused";
  }

  reset(): void {
    this.typing = false;
    this.note = "";
    this.page = 0;
  }
}

/** Pins newest first, as the list shows them. */
function nth(pins: readonly PinView[], i: number): PinView | undefined {
  return pins[pins.length - 1 - i];
}

/** Builds the panel with its top left at (x, y). Returns its height. */
export function buildPins(f: UiFrame, session: ClientSession, p: PinChoice, x: number, y: number): number {
  const w = PIN_PANEL_W, inner = w - PAD * 2, pins = session.pins;
  const pages = Math.max(1, Math.ceil(pins.length / PIN_ROWS));
  p.page = Math.min(p.page, pages - 1);
  const shown = Math.min(PIN_ROWS, pins.length - p.page * PIN_ROWS);
  const h = PAD + 18 + 26 + 26 + (p.note ? ROW_H : 0) + Math.max(1, shown) * ROW_H + (pages > 1 ? 22 : 0) + PAD;
  f.add(KEY_PIN_PANEL, K_PANEL, x, y, w, h, S_PANEL).alpha = .9;
  let top = y + PAD;
  f.text(KEY_PIN_TITLE, x + PAD, top, inner - 64, S_HUD_KEY, pins.length === 0 ? "PINS" : `PINS  ${pins.length}`);
  goPins(pins, p.go);
  const patrol = f.add(KEY_PIN_PATROL, K_BUTTON, x + w - PAD - 60, top - 2, 60, 18, S_BUTTON);
  patrol.text = p.go.length > 0 ? `Patrol ${p.go.length}` : "Patrol";
  patrol.label = "Send your creatures in range round the tribe's Go pins, in order";
  patrol.interactive = p.go.length > 0;
  patrol.alpha = patrol.interactive ? 1 : .4;
  top += 18;
  const each = Math.floor(inner / PIN_WORDS.length);
  for (let k = 0; k < PIN_WORDS.length; k++) {
    const b = f.add(KEY_PIN_KIND + k, K_BUTTON, x + PAD + k * each, top, each - 2, 22, S_BUTTON);
    b.text = fitText(PIN_WORDS[k]!, each - 6, S_BUTTON);
    b.label = `Pin kind: ${PIN_WORDS[k]}`;
    b.tint = k === p.kind ? PIN_TINT[k]! : -1;
    b.alpha = k === p.kind ? 1 : .6;
    b.interactive = true;
  }
  top += 26;
  const share = f.add(KEY_PIN_SHARE, K_BUTTON, x + PAD, top, 70, 22, S_BUTTON);
  share.text = p.shared ? "Tribe" : "Only me";
  share.label = p.shared ? "Shared with the tribe" : "Seen by you alone";
  share.interactive = true;
  const label = f.add(KEY_PIN_LABEL, K_INPUT, x + PAD + 74, top, inner - 74, 22, S_INPUT);
  label.text = p.label;
  label.label = "The pin's label";
  label.interactive = true;
  top += 26;
  if (p.note) {
    f.text(KEY_PIN_NOTE, x + PAD, top, inner, S_KEY_SMALL, fitText(p.note, inner, S_KEY_SMALL));
    top += ROW_H;
  }
  p.rows.fill(-1);
  const now = session.serverTick, rank = session.tribe.rank;
  if (shown <= 0) f.text(KEY_PIN_ROW, x + PAD, top, inner, S_KEY_SMALL, "No pins yet: choose a place on the map");
  for (let i = 0; i < shown; i++) {
    const pin = nth(pins, p.page * PIN_ROWS + i)!;
    p.rows[i] = pin.id;
    const ry = top + i * ROW_H;
    f.add(KEY_PIN_SWATCH + i, K_PANEL, x + PAD, ry + 5, 7, 7, S_MARK_SELF).tint = PIN_TINT[pin.kind] ?? -1;
    const who = pin.mine ? "you" : pin.author;
    const words = (PIN_WORDS[pin.kind] ?? "?") + (pin.label ? "  " + pin.label : "") + (who ? "  " + who : "") + "  " + pinAge(now, pin.at);
    const removable = mayUnpin(pin, rank), room = inner - 12 - 22 - (removable ? 22 : 0);
    const text = f.text(KEY_PIN_ROW + i, x + PAD + 12, ry, room, S_KEY_SMALL, fitText(words, room, S_KEY_SMALL));
    text.label = pin.shared ? "Shared with the tribe" : "Seen by you alone";
    const send = f.add(KEY_PIN_SEND + i, K_BUTTON, x + w - PAD - 18 - (removable ? 22 : 0), ry, 18, 16, S_BUTTON);
    send.text = "→";
    send.label = "Send your creatures in range here";
    send.interactive = true;
    if (removable) {
      const b = f.add(KEY_PIN_REMOVE + i, K_BUTTON, x + w - PAD - 18, ry, 18, 16, S_BUTTON);
      b.text = "×";
      b.label = "Remove this pin";
      b.interactive = true;
    }
  }
  top += Math.max(1, shown) * ROW_H;
  if (pages > 1) {
    for (let i = 0; i < 2; i++) {
      const b = f.add(KEY_PIN_PAGE + i, K_BUTTON, x + PAD + i * 26, top, 22, 18, S_BUTTON);
      b.text = i === 0 ? "‹" : "›";
      b.label = i === 0 ? "Newer pins" : "Older pins";
      b.interactive = i === 0 ? p.page > 0 : p.page < pages - 1;
      b.alpha = b.interactive ? 1 : .4;
    }
    f.text(KEY_PIN_PAGE + 2, x + PAD + 56, top + 2, 60, S_KEY_SMALL, `${p.page + 1} of ${pages}`);
  }
  return h;
}

/** A press on the panel's node `key`. True if it was one of the panel's. */
export function pressPins(key: number, session: ClientSession, p: PinChoice): boolean {
  if (key < KEY_PIN_PANEL || key >= KEY_PIN_PANEL + PIN_BAND.count) return false;
  p.typing = key === KEY_PIN_LABEL;
  if (key >= KEY_PIN_KIND && key < KEY_PIN_KIND + PIN_WORDS.length) p.kind = key - KEY_PIN_KIND;
  else if (key === KEY_PIN_SHARE) p.shared = !p.shared;
  else if (key === KEY_PIN_PAGE) p.page = Math.max(0, p.page - 1);
  else if (key === KEY_PIN_PAGE + 1) p.page++;
  else if (key >= KEY_PIN_REMOVE && key < KEY_PIN_REMOVE + PIN_ROWS) {
    const id = p.rows[key - KEY_PIN_REMOVE]!;
    if (id >= 0) p.sent(unpin(session, id));
  } else if (key >= KEY_PIN_SEND && key < KEY_PIN_SEND + PIN_ROWS) {
    const id = p.rows[key - KEY_PIN_SEND]!;
    if (id >= 0) p.sent(orderMove(session, ORDER_ALL, id));
  } else if (key === KEY_PIN_PATROL) p.sent(orderPatrol(session, ORDER_ALL, goPins(session.pins, p.go), false));
  return true;
}
