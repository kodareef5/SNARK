// The Storage tab of the settings (client/core/ui/storage.ts) and what it tells the asset port (assets/keeping.ts):
// the words for every state, which fit their boxes in every window the interface is laid out for, phones either way up
// among them; the buttons, finger-sized by touch and reached by the keyboard and the pad; and what a press asks of the port.
import { expect, test } from "bun:test";
import { CONFIRM_MS, type KeepState } from "../../client/core/assets/keeping.ts";
import { KEEP_OFF, KEEP_ON, KEEP_PAUSED, type KeepReport } from "../../client/core/assets/bulk.ts";
import type { AssetPort } from "../../client/core/assets/port.ts";
import { StorageInfo } from "../../client/core/assets/storage.ts";
import { Residency } from "../../client/core/assets/residency.ts";
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { HudModel } from "../../client/core/hud.ts";
import { DOWNLOAD_ROW, SETTING_ROWS } from "../../client/core/settings.ts";
import { KEY_MENU_BACK } from "../../client/core/ui/menu.ts";
import { K_BAR, K_BUTTON, K_PANEL, canvasHeight, textWidth, wrapText } from "../../client/core/ui/nodes.ts";
import { STORAGE_TAB } from "../../client/core/ui/settings.ts";
import { glass } from "../../client/core/ui/skin.ts";
import { COPIED, KEY_STORAGE_DELETE, KEY_STORAGE_PRIMARY, StoragePage, bytesText, downloadLine, leftText, storageButtons } from "../../client/core/ui/storage.ts";
import { S_HUD_COUNT, S_HUD_HIT, S_HUD_KEY, S_ICE, S_MENU_NOTE, S_OXYGEN } from "../../client/core/ui/style.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { stressSet } from "../../tools/pack/stress.ts";

const MB = 1024 * 1024, GB = 1024 * MB;

/** A port as the worker reports it, which keeps what it is told. */
class Port implements AssetPort {
  readonly cache: AssetPort["cache"] & { keep: KeepReport; totals: NonNullable<AssetPort["cache"]["totals"]> } = {
    used: 0, limit: 0, mode: "disk", filling: 0, off: "", writing: 0,
    totals: { memoryParts: 0, memoryBytes: 0, diskParts: 0, diskReadBytes: 0, netParts: 0, netBytes: 0, timeouts: 0, fillAsked: 0, fillDone: 0, fillBytes: 0, fillFailed: 0, fillTimeouts: 0 },
    keep: { mode: KEEP_OFF, parts: 0, bytes: 0, missing: 0, missingBytes: 0, capped: false },
  };
  readonly protocol = "h2";
  /** What the browser was asked: whether it keeps the files, to keep them, and its room. */
  readonly asked = { persisted: 0, persist: 0, estimate: 0 };
  readonly storage = new StorageInfo({
    persisted: async () => (this.asked.persisted++, false),
    persist: async () => (this.asked.persist++, true),
    estimate: async () => (this.asked.estimate++, { quota: 9.8 * GB }),
  });
  named = 0;
  readonly told: string[] = [];
  request(): void {}
  cancel(): void {}
  take(): number { return 0; }
  fill(parts: readonly { file: number; part: { length: number } }[]): void {
    this.named += parts.length;
    for (const p of parts) this.cache.keep.bytes += p.part.length;
    this.cache.keep.missingBytes = this.cache.keep.bytes - this.cache.used;
  }
  keep(mode: number, reset = false): void {
    this.told.push(`keep ${mode}${reset ? " reset" : ""}`);
    this.cache.keep.mode = mode;
    if (reset) this.cache.keep.bytes = this.cache.keep.missingBytes = 0;
  }
  clear(): void { this.told.push("clear"); }
  limit(bytes: number): void { this.told.push(`limit ${bytesText(bytes)}`); }
  /** The worker's next report: it has heard of every part named. */
  report(): void { this.cache.totals.fillAsked = this.named; }
}

/** The page as the app makes it. */
const made = (): StoragePage => new StoragePage({ textWidth, wrapText, glass });

/** A step as the app takes it each frame. */
function step(page: StoragePage, ui: Ui, port: AssetPort | null, r: Residency, now: number): void {
  page.step(ui, forTouch(tierOf(ui.settings.tier), ui.settings.touchFirst), port, r, null, now);
}

function world(): { ui: Ui; page: StoragePage; port: Port; r: Residency } {
  const set = stressSet({ rocks: 4, detail: 4, plate: 64 });
  const port = new Port(), r = new Residency(set.manifest, parsePack(set.files[0]!.bytes), port);
  r.cap = 6;
  const ui = new Ui(), page = made();
  ui.storage = page;
  return { ui, page, port, r };
}

test("the page's own copies of the interface's numbers are the interface's", () => {
  expect(COPIED).toEqual({ K_PANEL, K_BAR, K_BUTTON, S_OXYGEN, S_MENU_NOTE, S_HUD_HIT, S_HUD_KEY, S_HUD_COUNT, S_ICE, STORAGE_TAB });
});

function openStorage(ui: Ui): void {
  ui.openMenu();
  ui.options = true;
  ui.settings.tab = STORAGE_TAB;
}

test("bytes, rates and time left read as a player would say them", () => {
  expect([0.4 * MB, 3.5 * MB, 812 * MB, 999 * MB, 1000 * MB, 1.1 * GB, 24 * GB].map(bytesText)).toEqual(["410 KB", "3.5 MB", "812 MB", "999 MB", "1.0 GB", "1.1 GB", "24 GB"]);
  expect([20, 290, 5300, 9000].map(leftText)).toEqual(["less than a minute left", "about 5 min left", "about 88 min left", "about 3 h left"]);
});

test("opening the tab names everything the chosen tier keeps, and counts it once every page has come and the port has heard", () => {
  const { ui, page, port, r } = world();
  step(page, ui, port, r, 0);
  // Shut, and not asked for: nothing is named, and the disk's limit follows the tier.
  expect([port.named, port.told]).toEqual([0, ["limit 2.0 GB"]]);
  openStorage(ui);
  ui.settings.tier = "high";
  step(page, ui, port, r, 16);
  expect(port.named).toBeGreaterThan(0);
  expect(port.told).toEqual(["limit 2.0 GB", "keep 0 reset"]);
  // While pages are coming and the port has not heard of everything, the bytes are being counted.
  const v = page.keeping.view;
  for (let f = 2; f < 400 && r.pagesLeft > 0; f++) {
    r.begin(f * 16);
    r.end([], [], [], [], f * 16);
    step(page, ui, port, r,f * 16);
    expect(v.missing).toBeNull();
  }
  step(page, ui, port, r, 9000);
  expect(v.missing).toBeNull();
  port.report();
  step(page, ui, port, r, 9016);
  expect([v.state, v.total, v.missing, v.tier, v.limit]).toEqual(["idle", port.cache.keep.bytes, port.cache.keep.bytes, "high", 8 * GB]);
  expect(port.asked.estimate).toBeGreaterThan(0);
  // The tier changed: what was named is forgotten and the new tier's named, and its limit taken once the settings are left.
  ui.settings.tier = "lowpoly";
  step(page, ui, port, r, 9032);
  expect(port.told.slice(-1)).toEqual(["keep 0 reset"]);
  ui.options = false;
  step(page, ui, port, r, 9048);
  expect(port.told.slice(-1)).toEqual(["limit 256 MB"]);
});

test("Download all, Pause and Resume tell the port, and a remembered Download all goes on by itself on a later visit", () => {
  const { ui, page, port, r } = world();
  openStorage(ui);
  step(page, ui, port, r, 0);
  port.report();
  step(page, ui, port, r, 16);
  expect(page.keeping.view.state).toBe("idle");
  for (const [want, mode] of [["downloading", KEEP_ON], ["paused", KEEP_PAUSED], ["downloading", KEEP_ON]] as const) {
    ui.pointer(0, KEY_STORAGE_PRIMARY, 0, 0, 0, null);
    step(page, ui, port, r, 32);
    // The button steps as the settings' Download all row does.
    expect([page.keeping.view.state, port.cache.keep.mode, SETTING_ROWS[DOWNLOAD_ROW]!.value(ui.settings)]).toEqual([want, mode, want === "paused" ? "paused" : "on"]);
  }
  // The rate is what the download wrote over the last seconds, and the time left the bytes missing at that rate.
  for (let t = 1; t <= 12; t++) {
    port.cache.totals.fillBytes += 2 * MB;
    step(page, ui, port, r, 32 + t * 1000);
  }
  expect(page.keeping.view.rate).toBeCloseTo(2 * MB, -3);
  expect(page.keeping.view.left).toBeCloseTo(port.cache.keep.missingBytes / (2 * MB), 0);
  // A later visit: the setting is restored, and with the tab never opened the set is named and fetched.
  const later = world();
  later.ui.settings.restoreInterface(ui.settings.interfacePreferences());
  step(later.page, later.ui, later.port, later.r, 0);
  expect([later.port.named > 0, later.port.told]).toEqual([true, ["keep 1 reset", "limit 2.0 GB"]]);
  // The browser was asked to keep the files on the player's press, once; the later visit, unasked, asks it nothing.
  expect([port.asked.persist, later.port.asked.persist]).toEqual([1, 0]);
});

test("Delete asks first: a second press within four seconds deletes and stops the download, a later one asks again", () => {
  const { ui, page, port, r } = world();
  openStorage(ui);
  port.cache.used = 812 * MB;
  ui.settings.keepAll = true;
  step(page, ui, port, r, 0);
  ui.pointer(0, KEY_STORAGE_DELETE, 0, 0, 0, null);
  step(page, ui, port, r, 100);
  expect([page.keeping.view.state, downloadLine(page.keeping.view)]).toEqual(["confirm", ["Delete 812 MB? They download again as you play."]]);
  // Keep takes it back; left alone it times out.
  ui.pointer(0, KEY_STORAGE_PRIMARY, 0, 0, 0, null);
  step(page, ui, port, r, 200);
  expect([page.keeping.view.state, port.told.includes("clear")]).toEqual(["downloading", false]);
  ui.pointer(0, KEY_STORAGE_DELETE, 0, 0, 0, null);
  step(page, ui, port, r, 300 + CONFIRM_MS);
  expect(page.keeping.view.state).toBe("downloading");
  ui.pointer(0, KEY_STORAGE_DELETE, 0, 0, 0, null);
  step(page, ui, port, r, 5000);
  expect([page.keeping.view.state, port.told.includes("clear")]).toEqual(["confirm", false]);
  ui.pointer(0, KEY_STORAGE_DELETE, 0, 0, 0, null);
  step(page, ui, port, r, 5100);
  expect([port.told.filter((t) => t === "clear").length, ui.settings.keepAll, port.cache.keep.mode]).toEqual([1, false, KEEP_OFF]);
});

test("each state of the port and the browser is told in its own words", () => {
  const { ui, page, port, r } = world();
  openStorage(ui);
  const state = (): KeepState => {
    port.report();
    step(page, ui, port, r, 0);
    return page.keeping.view.state;
  };
  expect(state()).toBe("idle");
  port.cache.used = port.cache.keep.bytes;
  port.cache.keep.missingBytes = 0;
  expect(state()).toBe("done");
  port.cache.off = "full";
  expect(state()).toBe("full");
  port.cache.off = "none";
  expect(state()).toBe("none");
  port.cache.off = "";
  port.cache.keep.missingBytes = 1;
  port.cache.keep.bytes = 3 * GB;
  expect(state()).toBe("over");
  ui.settings.keepAll = true;
  expect(state()).toBe("downloading");
  port.cache.keep.capped = true;
  expect(state()).toBe("over");
  step(page, ui, null, r, 0);
  expect(page.keeping.view.state).toBe("built");
  // Resume after the device filled tells the port again, so it tries its disk again.
  port.cache.off = "full";
  step(page, ui, port, r, 0);
  const told = port.told.length;
  ui.pointer(0, KEY_STORAGE_PRIMARY, 0, 0, 0, null);
  step(page, ui, port, r, 16);
  expect(port.told.slice(told)).toEqual(["keep 1"]);
});

/** Windows the interface is laid out for: the canvas's width and height in units, and the screen's edges in units. */
function windows(): { name: string; w: number; h: number; insets: number[]; touch: boolean }[] {
  const out: { name: string; w: number; h: number; insets: number[]; touch: boolean }[] = [];
  for (const aspect of [9 / 16, 4 / 3, 16 / 9, 21 / 9, 32 / 9]) out.push({ name: `aspect ${aspect.toFixed(2)}`, w: Math.max(405, Math.round(720 * aspect)), h: 720, insets: [0, 0, 0, 0], touch: false });
  for (const [w, h] of [[1056, 488], [834, 469], [710, 400], [1280, 576]] as const) out.push({ name: `short ${w}x${h}`, w, h, insets: [0, 0, 0, 0], touch: true });
  // The touch windows of tests/integration/touch.test.ts, in CSS pixels with their screens' edges.
  for (const [name, w, h, edges] of [["phone on its side", 844, 390, [47, 0, 47, 21]], ["small phone on its side", 667, 375, [0, 0, 0, 0]], ["smallest phone on its side", 568, 320, [0, 0, 0, 0]], ["phone upright", 390, 844, [0, 47, 0, 34]], ["small phone upright", 375, 667, [0, 20, 0, 0]], ["tall narrow phone upright", 360, 800, [0, 32, 0, 24]], ["smallest phone upright", 320, 568, [0, 20, 0, 0]], ["tablet", 1024, 768, [0, 24, 0, 20]], ["tablet upright", 768, 1024, [0, 24, 0, 20]]] as const) {
    const units = canvasHeight(w, h), unit = h / units;
    out.push({ name, w: Math.max(405, Math.round(units * w / h)), h: units, insets: edges.map((e) => e / unit), touch: true });
  }
  return out;
}

const STATES: KeepState[] = ["built", "none", "confirm", "full", "done", "over", "downloading", "paused", "idle"];

test("every state's words fit their boxes in every window, inside the screen's edges, with nothing overlapping and edges shared exactly", () => {
  const ui = new Ui(), hud = new HudModel(), page = made(), v = page.keeping.view;
  ui.storage = page;
  openStorage(ui);
  let checked = 0;
  /** Where each window's buttons stand, by window and variant: the same in every state that has them. */
  const stands = new Map<string, number>();
  for (const win of windows()) for (const state of STATES) for (const variant of [0, 1, 2]) {
    // The longest words each state can have: the longest tier name, big numbers, and each of the browser's answers.
    Object.assign(v, { state, tier: variant === 1 ? "lowpoly" : "high", saved: variant === 2 ? 23.9 * GB : 812 * MB, limit: tierOf(variant === 1 ? "lowpoly" : "ultra").diskBytes, total: variant === 0 ? null : 2.6 * GB, missing: variant === 0 ? null : variant === 1 ? 0 : 1.9 * GB, rate: variant === 0 ? 0 : 999 * 1024, left: variant === 2 ? 5300 : null, room: variant === 1 ? null : 9.8 * GB, kept: [false, null, true][variant]!, card: 1000 * MB, cardOf: 4 * GB });
    page.touch = win.touch;
    ui.inputDevice = win.touch ? 2 : 0;
    ui.canvasHeight = win.h;
    [ui.frame.left, ui.frame.top, ui.frame.right, ui.frame.bottom] = win.insets as [number, number, number, number];
    ui.build(win.w / win.h, hud, null);
    const f = ui.frame, nodes = f.nodes.slice(0, f.count), where = `${win.name} ${state} ${variant}`;
    expect([f.width, f.height], where).toEqual([win.w, win.h]);
    const mine = nodes.filter((n) => (n.key >= 8000 && n.key < 8200) || n.key === 98100 || n.key === 98101);
    expect(mine.length, where).toBeGreaterThan(10);
    const keys = new Set<number>();
    for (const n of nodes) {
      expect(keys.has(n.key), `${where} key ${n.key}`).toBe(false);
      keys.add(n.key);
      // The backdrop under the menu covers the whole canvas; the rest stays clear of the screen's edges.
      if (n.key !== 5400) expect(n.x >= f.left - 0.01 && n.y >= f.top - 0.01 && n.x + n.w <= f.width - f.right + 0.01 && n.y + n.h <= f.height - f.bottom + 0.01, `${where} key ${n.key} at ${n.x},${n.y} ${n.w}x${n.h}`).toBe(true);
      if (n.text) expect(textWidth(n.text, n.style), `${where}: ${n.text}`).toBeLessThanOrEqual(n.w + 0.01);
      expect(n.text.includes("…") && n.text !== "counting…", `${where}: cut "${n.text}"`).toBe(false);
    }
    // Inside the settings panel, in one of its columns, each thing on the column's left edge or its right.
    const panel = f.find(2300)!, inner = panel.w - 48, x0 = panel.x + 24, side = f.find(8092) !== null, cw = side ? (inner - 32) / 2 : inner;
    const columns = side ? [[x0, x0 + cw], [x0 + cw + 32, x0 + inner]] : [[x0, x0 + inner]];
    for (const n of mine) {
      expect(n.y + n.h <= panel.y + panel.h - 8, `${where}: ${n.key} "${n.text}" past the panel's foot`).toBe(true);
      if (n.key === 8092 || n.key >= 90000) continue;
      const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
      const column = columns.find(([l, r]) => n.x >= l! - 0.01 && n.x + n.w <= r! + 0.01);
      expect(column !== undefined && (near(n.x, column[0]!) || near(n.x + n.w, column[1]!)), `${where}: ${n.key} "${n.text}" at ${n.x}..${n.x + n.w}, columns ${JSON.stringify(columns)}`).toBe(true);
    }
    const controls = nodes.filter((n) => n.interactive);
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!, b = controls[j]!;
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${where}: overlap ${a.key}/${b.key}`).toBe(false);
    }
    for (const key of [KEY_STORAGE_PRIMARY, KEY_STORAGE_DELETE]) {
      const b = f.find(key);
      if (b?.interactive) expect(b.h, `${where} button ${key}`).toBe(win.touch ? 44 : 36);
      // A second press of Delete lands where the first did, whatever the state became between them.
      const at = `${win.name} ${variant} ${key}`;
      if (b && !stands.has(at)) stands.set(at, b.y);
      if (b) expect(b.y, `${where}: button ${key} moved`).toBe(stands.get(at)!);
    }
    const [left, right] = storageButtons(v, false);
    expect([f.find(KEY_STORAGE_PRIMARY)?.text ?? null, f.find(KEY_STORAGE_DELETE)?.text ?? null], where).toEqual([left?.text ?? null, right?.text ?? null]);
    checked++;
  }
  expect(checked).toBe(windows().length * STATES.length * 3);
});

test("the keyboard and the pad reach every button of the tab, and Enter presses the one with the focus", () => {
  const ui = new Ui(), hud = new HudModel(), page = made();
  ui.storage = page;
  openStorage(ui);
  Object.assign(page.keeping.view, { state: "downloading", saved: 812 * MB, total: 2 * GB, missing: 1.2 * GB });
  ui.build(16 / 9, hud, null);
  const reached = new Set<number>();
  for (let k = 0; k < 20; k++) {
    reached.add(ui.navigate(1));
    ui.build(16 / 9, hud, null);
  }
  expect([reached.has(KEY_MENU_BACK), reached.has(KEY_STORAGE_PRIMARY), reached.has(KEY_STORAGE_DELETE)]).toEqual([true, true, true]);
  // From the tabs, Tab steps on to the buttons; Enter on Pause pauses.
  for (let k = 0; k < 20 && ui.menuFocus !== KEY_STORAGE_PRIMARY; k++) ui.key("Tab", true, false, null);
  ui.settings.keepAll = true;
  ui.key("Enter", true, false, null);
  expect(ui.settings.keepPaused).toBe(true);
  // The focused button shows its line bright.
  ui.build(16 / 9, hud, null);
  expect(ui.frame.find(90000 + KEY_STORAGE_PRIMARY)!.alpha).toBe(1);
  expect(ui.frame.find(90000 + KEY_STORAGE_DELETE)!.alpha).toBeLessThan(1);
  // Arrow keys change no setting here.
  expect(ui.adjustFocused(1)).toBe(false);
});

test("a browser that saves nothing greys Download all, and a page that has everything built in shows no buttons", () => {
  const ui = new Ui(), hud = new HudModel(), page = made();
  ui.storage = page;
  openStorage(ui);
  Object.assign(page.keeping.view, { state: "none", saved: 0 });
  ui.build(16 / 9, hud, null);
  const b = ui.frame.find(KEY_STORAGE_PRIMARY)!;
  expect([b.text, b.interactive, b.alpha < 1, ui.frame.find(KEY_STORAGE_DELETE)]).toEqual(["Download all", false, true, null]);
  page.keeping.view.state = "built";
  ui.build(16 / 9, hud, null);
  expect([ui.frame.find(KEY_STORAGE_PRIMARY), ui.frame.find(KEY_STORAGE_DELETE)]).toEqual([null, null]);
});
