// The level's line under the hotbar (client/core/hud/level.ts) and the character screen's title and bar. The line is
// filled from a session that never met a server, told what a server would say; whole clients on the harness show that
// what the server sends reaches it.

import { expect, test } from "bun:test";
import { GAIN_LEAST, GAIN_MS, KEY_LEVEL, LEVEL, gainText, levelTable } from "../../client/core/hud/level.ts";
import { HudFill } from "../../client/core/hud/widget.ts";
import { KEY_ZONE_LOOK, KEY_ZONE_MOVE } from "../../client/core/touch.ts";
import { CharacterScreen, KEY_CHAR_STAT, KEY_CHAR_TITLE, KEY_CHAR_XP } from "../../client/core/ui/character.ts";
import { K_BAR, K_TEXT, UiFrame, lineHeight, textWidth, type UiNode } from "../../client/core/ui/nodes.ts";
import { S_OXYGEN, S_STAMINA } from "../../client/core/ui/style.ts";
import { CMD_SPEND, RESULT_OK, SESSION_ALIVE, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { STAT_NAMES } from "../../shared/sim/genome.ts";
import { covered, meets } from "../fixtures/boxes.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { PHONES, WINDOWS, camp, direct, id, resize, screen, send, shown, until, type Direct } from "../kit/kit.ts";

const reg = coreRegistry();
const table = levelTable(reg)!;
const LAST = table.length;
const WORDS = KEY_LEVEL, BAR = KEY_LEVEL + 1, LIT = KEY_LEVEL + 2, GAIN = KEY_LEVEL + 3;

/** A survivor's interface, and what a server says of its experience at a time: the level's line is filled and the frame built. */
function told(): { d: Direct; say(now: number, xp: number, level: number, points?: number): UiFrame; at(now: number): UiFrame } {
  const d = direct(1280, 720), c = new HudFill();
  c.session = d.session;
  const at = (now: number): UiFrame => {
    c.nowMs = now;
    LEVEL.fill!(d.hud, c);
    return d.build();
  };
  const say = (now: number, xp: number, level: number, points = 0): UiFrame => {
    const p = d.session.progress;
    p.xp = xp; p.level = level; p.statPoints = points; p.version++;
    return at(now);
  };
  return { d, say, at };
}

/** The level's nodes fit the frame and their words fit them; none meets a node of anything else. */
function clear(f: UiFrame, where: string): void {
  const all = f.nodes.slice(0, f.count), mine = all.filter((n) => n.key >= KEY_LEVEL && n.key <= GAIN);
  const own = (n: UiNode): boolean => mine.includes(n);
  expect(mine.map((n) => n.key), where).toEqual([WORDS, BAR, LIT, GAIN]);
  for (const n of mine) {
    const who = `${where} key=${n.key}`;
    expect(n.x >= 0 && n.y >= 0 && n.x + n.w <= f.width && n.y + n.h <= f.height, who).toBe(true);
    expect(n.w, who).toBeGreaterThan(0);
    if (n.kind === K_TEXT) {
      expect(textWidth(n.text, n.style), who).toBeLessThanOrEqual(n.w + 0.01);
      expect(n.h, who).toBeGreaterThanOrEqual(lineHeight(n.style));
      expect(n.y + n.h, who).toBeLessThan(f.height - f.bottom);
    }
    for (const q of all) {
      // A finger's two zones lie under the whole HUD, and the lit bar lies on the bar.
      if (q === n || q.key === KEY_ZONE_MOVE || q.key === KEY_ZONE_LOOK || (own(q) && n.key + q.key === BAR + LIT)) continue;
      expect(meets(covered(n), covered(q)), `${who} and ${q.key}`).toBe(false);
    }
  }
  // Wide enough to read as a bar.
  expect(f.find(BAR)!.w, where).toBeGreaterThanOrEqual(100);
}

test("the bar is half full halfway to the next level, and full at the last", () => {
  const { say } = told();
  const from = table[22]!, to = table[23]!;
  let f = say(0, (from + to) / 2, 23);
  expect([f.find(WORDS)!.text, f.find(BAR)!.kind, f.find(BAR)!.style]).toEqual(["Lv 23", K_BAR, S_OXYGEN]);
  expect(f.find(BAR)!.value).toBeCloseTo(0.5, 6);
  f = say(100, from, 23);
  expect(f.find(BAR)!.value).toBe(0);
  f = say(200, table[LAST - 1]!, LAST);
  expect([f.find(WORDS)!.text, f.find(BAR)!.value]).toEqual([`Lv ${LAST}`, 1]);
});

test("no line shows before the server has said the level, or without a living body", () => {
  const { d, say, at } = told();
  expect(at(0).find(BAR)).toBeNull();
  expect(say(100, 30, 3).find(BAR)).not.toBeNull();
  d.session.sessionState = SESSION_DEAD;
  const f = at(200);
  expect([f.find(WORDS), f.find(BAR), f.find(GAIN)]).toEqual([null, null, null]);
});

test("a gain shows by the bar, a second adds to it, and the line clears", () => {
  const { say, at } = told();
  say(0, 100, 5);
  let f = say(1000, 112.5, 5);
  expect([f.find(GAIN)!.text, f.find(GAIN)!.alpha]).toEqual(["+12.5 xp", 1]);
  // The second comes while the first shows, and the two seconds start again.
  f = say(2500, 120, 5);
  expect(f.find(GAIN)!.text).toBe("+20 xp");
  expect(at(2500 + GAIN_MS - 1000).find(GAIN)!.text).toBe("+20 xp");
  // It fades at its end, then is gone, and the next gain starts from nothing.
  const fading = at(2500 + GAIN_MS - 100).find(GAIN)!.alpha;
  expect(fading > 0 && fading < 1).toBe(true);
  expect(at(2500 + GAIN_MS).find(GAIN)).toBeNull();
  expect(say(9000, 123, 5).find(GAIN)!.text).toBe("+3 xp");
});

test("a gain too small to count neither starts the line nor adds to it", () => {
  const { say } = told();
  say(0, 100, 5);
  expect(say(1000, 100 + GAIN_LEAST / 2, 5).find(GAIN)).toBeNull();
  expect(say(2000, 110, 5).find(GAIN)!.text).toBe("+9.8 xp");
  // It moves the bar all the same.
  const before = say(2100, 110, 5).find(BAR)!.value, f = say(2200, 110 + GAIN_LEAST / 2, 5);
  expect([f.find(GAIN)!.text, f.find(BAR)!.value > before]).toEqual(["+9.8 xp", true]);
});

test("a whole gain prints plain, a fraction to one decimal, thousands with commas", () => {
  expect([gainText(12), gainText(12.5), gainText(0.1 + 0.2), gainText(1250), gainText(1250.25)]).toEqual(["+12 xp", "+12.5 xp", "+0.3 xp", "+1,250 xp", "+1,250.3 xp"]);
  // Less than a twentieth shows nothing.
  expect(gainText(0.04)).toBe("");
});

test("the first experience after joining or rising again is not a gain", () => {
  const { d, say, at } = told();
  // Joined with experience already earned.
  expect(say(0, 2410, 22).find(GAIN)).toBeNull();
  expect(say(500, 2420, 22).find(GAIN)!.text).toBe("+10 xp");
  // Dead, then risen with other experience: no gain, and the old one is not carried over.
  d.session.sessionState = SESSION_DEAD;
  at(600);
  d.session.sessionState = SESSION_ALIVE;
  const f = say(700, 2600, 23);
  expect([f.find(WORDS)!.text, f.find(GAIN), f.find(LIT)]).toEqual(["Lv 23", null, null]);
  // Experience lost is not a gain either.
  expect(say(800, 2550, 23).find(GAIN)).toBeNull();
});

test("a new level lights the bar for a moment", () => {
  const { say, at } = told();
  expect(say(0, 18, 2).find(LIT)).toBeNull();
  let f = say(1000, 25, 3);
  expect([f.find(WORDS)!.text, f.find(LIT)!.style, f.find(LIT)!.alpha, f.find(LIT)!.value]).toEqual(["Lv 3", S_STAMINA, 1, f.find(BAR)!.value]);
  f = at(2000);
  expect(f.find(LIT)!.alpha > 0 && f.find(LIT)!.alpha < 1).toBe(true);
  expect(at(4000).find(LIT)).toBeNull();
});

test("the call to spend shows while a stat point is unspent, by key and by touch", () => {
  const { d, say } = told();
  expect(say(0, 2800, 24, 2).find(WORDS)!.text).toBe("Level 24 · P to spend");
  expect(say(100, 2800, 24, 1).find(WORDS)!.text).toBe("Level 24 · P to spend");
  expect(say(200, 2800, 24, 0).find(WORDS)!.text).toBe("Lv 24");
  // A finger has no P: it has the bar's Character button.
  const phone = direct(844, 390, [47, 0, 47, 21], { finger: true });
  Object.assign(phone.hud.levelBar, d.hud.levelBar, { points: 1, spendTouch: "Level 24 · Character to spend" });
  expect(phone.build().find(WORDS)!.text).toBe("Level 24 · Character to spend");
});

test("a fill makes the line's words again only when the server says more", () => {
  const { d, say, at } = told();
  say(0, 100, 5, 1);
  // The words are made from the level: a fill that does not read it makes none.
  let reads = 0;
  Object.defineProperty(d.session.progress, "level", { get: () => (reads++, 5) });
  for (let now = 16; now < 1000; now += 16) at(now);
  expect([reads, d.hud.levelBar.label, d.hud.levelBar.spend]).toEqual([0, "Lv 5", "Level 5 · P to spend"]);
});

test("experience given on a server reaches the bar, the gain and the call to spend", () => {
  const { h, ada } = camp({ screen: true });
  const view = screen(h, ada), levels = levelTable(ada.registry)!;
  expect([shown(view, WORDS), shown(view, GAIN)]).toEqual(["Lv 1", null]);
  // Half of the way to the second level, then past the third.
  const half = levels[1]! / 2;
  h.say(ada, `addxp ${half}`);
  expect([shown(view, WORDS), shown(view, GAIN)]).toEqual(["Lv 1", gainText(half)]);
  // The drip that comes with time may have added a little.
  expect(view.app.ui.frame.find(BAR)!.value).toBeCloseTo(ada.progress.xp / levels[1]!, 6);
  expect(view.app.ui.frame.find(BAR)!.value).toBeCloseTo(0.5, 1);
  h.say(ada, `addxp ${levels[2]! - half}`);
  expect([ada.progress.level, ada.progress.statPoints]).toEqual([3, 2]);
  expect([shown(view, WORDS), shown(view, GAIN), view.app.ui.frame.find(LIT) !== null]).toEqual(["Level 3 · P to spend", gainText(levels[2]!), true]);
  h.run(GAIN_MS + 500);
  expect([shown(view, GAIN), view.app.ui.frame.find(LIT)]).toEqual([null, null]);
  const health = STAT_NAMES.indexOf("health");
  expect([send(h, ada, CMD_SPEND, (w) => w.u8(health)), send(h, ada, CMD_SPEND, (w) => w.u8(health))]).toEqual([RESULT_OK, RESULT_OK]);
  h.run(200);
  // A point spent is not experience earned.
  expect([shown(view, WORDS), shown(view, GAIN)]).toEqual(["Lv 3", null]);
});

test("a server's cap on experience short of a level leaves no level to show ahead", () => {
  const ramp = "(ExperiencePointsForLevel[0]=10,ExperiencePointsForLevel[1]=30,ExperiencePointsForLevel[2]=60)";
  const { h, ada } = camp({ screen: true, rules: { LevelExperienceRampOverrides: ramp, OverrideMaxExperiencePointsPlayer: 45, GenericXPMultiplier: 0 } });
  const view = screen(h, ada);
  // Level 4 takes 60, which the cap of 45 never lets her have.
  expect(levelTable(ada.registry)).toEqual([0, 10, 30]);
  h.say(ada, "addxp 1000");
  expect([ada.progress.xp, ada.progress.level]).toEqual([45, 3]);
  expect(view.app.ui.frame.find(BAR)!.value).toBe(1);
  view.app.ui.screen<CharacterScreen>("character").open = true;
  h.run(100);
  expect([shown(view, KEY_CHAR_TITLE), view.app.ui.frame.find(KEY_CHAR_XP)!.value]).toEqual(["Level 3 · 45 xp", 1]);
});

test("the level's line fits and overlaps nothing at four window shapes", () => {
  const { h, ada } = camp({ screen: true, gear: ["pistol"] });
  const view = screen(h, ada);
  view.app.ui.settings.vitalLabels = true;
  takeInHand(h, ada, id("pistol"));
  expect(until(h, () => ada.own.rounds > 0, 10)).toBe(true);
  for (const [name, width, height] of WINDOWS) {
    // A level each time, once the last gain has gone: the call to spend, the gain and the lit bar show by the ammunition line.
    h.run(GAIN_MS + 100);
    h.say(ada, "addxp 1250.5", 100);
    resize(h, view, width, height);
    expect(shown(view, GAIN), name).toBe("+1,250.5 xp");
    expect(shown(view, WORDS), name).toBe(`Level ${ada.progress.level} · P to spend`);
    clear(view.app.ui.frame, name);
  }
});

test("by touch the level's line overlaps nothing on any phone or tablet", () => {
  for (const [name, width, height, insets] of PHONES) {
    for (const muted of [false, true]) {
      const d = direct(width, height, insets, { finger: true });
      d.ui.settings.muted = muted;
      d.ui.settings.vitalLabels = true;
      d.hud.prompt = "E  ride raptor";
      d.hud.ammo = "pistol round  6 / 54";
      // The longest it gets: the last level with a point to spend, a large gain, the bar lit.
      Object.assign(d.hud.levelBar, { shown: true, points: 1, fraction: 0.5, spendTouch: `Level ${LAST} · Character to spend`, gainText: "+1,250.5 xp", gainAlpha: 1, flash: 1 });
      clear(d.build(), `${name}${muted ? ", muted" : ""}`);
    }
  }
});

/** The character screen of a survivor with this experience, at a desktop's window. */
function sheet(xp: number, level: number, points = 0): UiFrame {
  const f = new UiFrame();
  f.begin(16 / 9);
  const progress = { xp, level, statPoints: points, engramPoints: 0, engrams: [], jobs: [], version: 1 };
  new CharacterScreen().draw(f, { progress, ownKind: reg.index.get("core:survivor")! } as never, reg);
  return f;
}

test("the character screen's title and bar say how far the next level is", () => {
  const from = table[22]!, to = table[23]!;
  const f = sheet(from + (to - from) / 4 + 0.25, 23);
  expect(f.find(KEY_CHAR_TITLE)!.text).toBe(`Level 23 · ${Math.floor(from + (to - from) / 4).toLocaleString("en-US")} / ${to.toLocaleString("en-US")} xp`);
  expect(f.find(KEY_CHAR_TITLE)!.text).toMatch(/^Level 23 · \d,\d{3} \/ \d,\d{3} xp$/);
  const bar = f.find(KEY_CHAR_XP)!, title = f.find(KEY_CHAR_TITLE)!;
  expect(bar.kind).toBe(K_BAR);
  expect(bar.value).toBeCloseTo(0.25, 2);
  // Under the title, as wide as it.
  expect([bar.x, bar.w, bar.y >= title.y + title.h]).toEqual([title.x, title.w, true]);
});

test("at the last level the character screen's title drops the next threshold", () => {
  const most = table[LAST - 1]!, f = sheet(most, LAST);
  expect(f.find(KEY_CHAR_TITLE)!.text).toBe(`Level ${LAST} · ${Math.floor(most).toLocaleString("en-US")} xp`);
  expect(f.find(KEY_CHAR_XP)!.value).toBe(1);
});

test("a stat's row says what a point adds to it", () => {
  const f = sheet(30, 3, 2);
  const row = (name: string): string | undefined => f.find(KEY_CHAR_STAT + STAT_NAMES.indexOf(name as never) * 2)?.text;
  expect([row("health"), row("oxygen"), row("speed"), row("torpidity")]).toEqual(["health  +10% a point", "oxygen  +20% a point", "speed  +1.5% a point", undefined]);
});
