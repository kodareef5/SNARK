// The emote menu (Z): the emotes a body can play, by what they are for, nine to a page on the digit keys, the arrows paging. A pair's emote
// goes to whoever the crosshair is on (or the survivor nearest ahead), which invites them; answering one is choosing
// it back at them. The server decides: a refusal says why under the crosshair.

import { EMOTES, EMOTE_NUMBER, type EmoteDef } from "../../../shared/anim/emotes.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_OK } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { S_BUTTON, S_LABEL, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_EMOTE_PANEL = 3700;
export const KEY_EMOTE_TITLE = 3701;
export const KEY_EMOTE_HINT = 3702;
export const KEY_EMOTE_STOP = 3703;
export const KEY_EMOTE_TAB = 3710;
export const KEY_EMOTE_BUTTON = 3730;

/** CMD_EMOTE's ops (server/emote.ts). */
const PLAY = 0, STOP = 1;

/** The pages, each the emotes with any of its tags. */
export const EMOTE_PAGES: readonly { name: string; tags: readonly string[] }[] = [
  { name: "Greet", tags: ["greeting", "call", "answer"] },
  { name: "Feel", tags: ["approval", "disapproval", "reaction"] },
  { name: "Dance", tags: ["dance"] },
  { name: "Fun", tags: ["fun", "showoff", "silly", "victory"] },
  { name: "Scary", tags: ["scary", "taunt"] },
  { name: "Rest", tags: ["rest", "idle", "work"] },
  { name: "Together", tags: ["pair"] },
];

const REASONS: Readonly<Record<number, string>> = {
  [RESULT_DENIED]: "Not now: stand still, hands free",
  [RESULT_FAR]: "Too far away",
  [RESULT_INVALID]: "That needs someone to do it with",
};

export class EmoteMenu implements Screen {
  readonly name = "emotes";
  readonly layer = "modal";
  readonly hotkey = "KeyZ";
  readonly bands = [{ from: KEY_EMOTE_PANEL, count: KEY_EMOTE_BUTTON + 9 - KEY_EMOTE_PANEL }];
  open = false;
  page = 0;
  /** Which nine of the page's emotes show. */
  sub = 0;
  /** The survivor a pair's emote goes to: the one the crosshair is on, set each frame by the app. -1 for none. */
  target = -1;
  targetName = "";
  /** Whether an emote can be played here: its clip is loaded. */
  has: (n: number) => boolean = () => true;
  notice = "";
  private noticeUntil = 0;
  private asked = 0;
  private now = 0;

  /** The emotes on the page showing, at most nine. */
  listed(): EmoteDef[] {
    return this.all().slice(this.sub * 9, this.sub * 9 + 9);
  }

  /** Every emote of the page's tab. */
  private all(): EmoteDef[] {
    const tags = EMOTE_PAGES[this.page]!.tags;
    const seen = new Set<string>();
    return EMOTES.filter((e) => {
      if (seen.has(e.id) || !this.has(EMOTE_NUMBER.get(e.id)!) || !e.tags.some((t) => tags.includes(t))) return false;
      // A pair's two sides are one choice: the side asked for first.
      if (e.pair && e.pair.with !== e.id) seen.add(e.pair.with);
      seen.add(e.id);
      return true;
    });
  }

  /** On through the tab's nines, then to the next tab (or back). */
  private turn(by: number): void {
    const pages = Math.max(1, Math.ceil(this.all().length / 9));
    const sub = this.sub + by;
    if (sub >= 0 && sub < pages) {
      this.sub = sub;
      return;
    }
    this.page = (this.page + by + EMOTE_PAGES.length) % EMOTE_PAGES.length;
    this.sub = by > 0 ? 0 : Math.max(0, Math.ceil(this.all().length / 9) - 1);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
  }

  /** Returns true if the menu used the key. */
  key(code: string, down: boolean, repeat: boolean, c: ScreenCtx): boolean {
    const session = c.session;
    if (!this.open) return false;
    const digit = /^Digit([1-9])$/.exec(code);
    if (digit) {
      if (down && !repeat && session) this.choose(Number(digit[1]) - 1, session);
      return true;
    }
    if (code === "Escape" || code === "KeyZ") {
      if (down && !repeat) this.open = false;
      return true;
    }
    if (code === "ArrowLeft" || code === "ArrowRight") {
      if (down && !repeat) this.turn(code === "ArrowRight" ? 1 : -1);
      return true;
    }
    return false;
  }

  pointer(kind: number, key: number, _x: number, _y: number, _button: number, c: ScreenCtx): boolean {
    return kind === 0 && c.session !== null && this.click(key, c.session);
  }

  click(key: number, session: ClientSession): boolean {
    if (!this.open) return false;
    if (key === KEY_EMOTE_STOP) {
      session.emote(STOP, 0);
      this.open = false;
      return true;
    }
    const tab = key - KEY_EMOTE_TAB;
    if (tab >= 0 && tab < EMOTE_PAGES.length) {
      this.sub = this.page === tab ? (this.sub + 1) % Math.max(1, Math.ceil(this.all().length / 9)) : 0;
      this.page = tab;
      return true;
    }
    const n = key - KEY_EMOTE_BUTTON;
    if (n < 0 || n >= 9) return false;
    this.choose(n, session);
    return true;
  }

  private choose(i: number, session: ClientSession): void {
    const e = this.listed()[i];
    if (!e) return;
    if (e.pair && this.target < 0) {
      this.say("Look at someone to do that with", this.now);
      return;
    }
    this.asked = session.emote(PLAY, EMOTE_NUMBER.get(e.id)!, e.pair ? this.target : -1);
    if (e.pair) this.say(`Asked ${this.targetName || "them"}`, this.now);
    this.open = false;
  }

  /** The server's answer to what this menu sent. */
  result(seq: number, code: number): void {
    if (seq !== this.asked || seq === 0) return;
    this.asked = 0;
    if (code !== RESULT_OK && code !== RESULT_BUSY) this.say(REASONS[code] ?? "Not now", this.now);
  }

  private say(text: string, nowMs: number): void {
    this.notice = text;
    this.noticeUntil = nowMs + 2500;
  }

  tick(nowMs: number): void {
    this.now = nowMs;
    if (this.notice !== "" && nowMs >= this.noticeUntil) this.notice = "";
  }

  build(f: UiFrame): void {
    if (!this.open) return;
    const titleH = lineHeight(S_TITLE), labelH = lineHeight(S_LABEL);
    const pad = 12, rowH = 28, tabH = 26;
    const w = Math.min(f.width - 16, 460);
    const list = this.listed();
    const tabW = Math.floor((w - pad * 2 - (EMOTE_PAGES.length - 1) * 4) / EMOTE_PAGES.length);
    const cols = 3, cellW = Math.floor((w - pad * 2 - (cols - 1) * 6) / cols);
    const rows = Math.max(1, Math.ceil(list.length / cols));
    const h = pad * 2 + titleH + labelH + 6 + tabH + 8 + rows * (rowH + 6) + rowH;
    const x = Math.round((f.width - w) / 2);
    const y = Math.round(Math.max(8, f.height / 2 - h / 2));
    f.add(KEY_EMOTE_PANEL, K_PANEL, x, y, w, h, S_PANEL);
    f.text(KEY_EMOTE_TITLE, x + pad, y + pad, w - pad * 2, S_TITLE, "Emotes");
    const page = EMOTE_PAGES[this.page]!;
    const hint = page.tags.includes("pair") ? (this.target >= 0 ? `with ${this.targetName || "them"}: they answer with it back` : "look at someone first") : `1-9 to play, arrows for more${this.all().length > 9 ? `  (${this.sub + 1} of ${Math.ceil(this.all().length / 9)})` : ""}`;
    f.text(KEY_EMOTE_HINT, x + pad, y + pad + titleH, w - pad * 2, S_LABEL, hint);
    const top = y + pad + titleH + labelH + 6;
    EMOTE_PAGES.forEach((p, i) => {
      const b = f.add(KEY_EMOTE_TAB + i, K_BUTTON, x + pad + i * (tabW + 4), top, tabW, tabH, S_BUTTON);
      b.text = i === this.page ? `[${p.name}]` : p.name;
      b.interactive = true;
    });
    list.forEach((e, i) => {
      const b = f.add(KEY_EMOTE_BUTTON + i, K_BUTTON, x + pad + (i % cols) * (cellW + 6), top + tabH + 8 + Math.floor(i / cols) * (rowH + 6), cellW, rowH, S_BUTTON);
      b.text = `${i + 1} ${e.name}`;
      b.interactive = true;
    });
    const stop = f.add(KEY_EMOTE_STOP, K_BUTTON, x + pad, y + h - pad - rowH + 6, w - pad * 2, rowH - 6, S_BUTTON);
    stop.text = "Stop";
    stop.interactive = true;
  }
}
