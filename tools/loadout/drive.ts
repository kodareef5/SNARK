// The loadouts' admin page worked in headless Chrome as an admin works it, each act judged by what the server then holds.
// A press holds the mouse down a moment, as a hand does: the page draws itself between a field's change and a click.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { joinServer } from "../../agent/join.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { builtinLoadouts } from "../../content/loadouts.ts";
// The page is driven on a development server, whose open pages act under this name.
import { DEVELOPMENT as PAGE } from "../../server/admin/gate.ts";
import { OP_ADMIN } from "../../server/console.ts";
import type { Host } from "../../server/host.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { decodeAct } from "../../shared/acts.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { isTame, type Entry, type ItemEntry, type LoadoutBook } from "../../shared/loadout/book.ts";
import { KEY_BYTES } from "../../shared/net/protocol.ts";
import { ARMOR_SLOTS, HOTBAR_SLOTS, QUALITY_NAMES } from "../../shared/sim/items.ts";
import { CHROME_FLAGS } from "../chrome.ts";

/** A survivor the tool stands in the world. */
export interface Survivor {
  name: string;
  pid: number;
  /** Closes its connection, and waits until the world has it as away. */
  leave(): Promise<void>;
}

/** Stands a survivor called `name` in `host`'s world: the game's own client session over the server's socket, ticked from here. */
export async function enter(host: Host, socket: string, name: string): Promise<Survivor> {
  const session = await joinServer(socket, name, crypto.getRandomValues(new Uint8Array(KEY_BYTES)), compileContent(CORE_CONTENT).registry!);
  const beat = setInterval(() => session.update(performance.now(), 0, 0, 0, 0, 0), 33);
  const here = () => host.game.clients.find((c) => !!c?.active && !c.closed && c.name === name && c.pid !== 0 && c.ent >= 0);
  for (let k = 0; k < 300 && !here(); k++) await Bun.sleep(50);
  const pid = here()?.pid ?? 0;
  if (pid === 0) {
    clearInterval(beat);
    session.close();
    throw new Error(`${name} did not come to stand in the world: its session is ${session.state}`);
  }
  // What a new survivor is handed, it is handed as its body is made: a few ticks more and it is all there.
  await Bun.sleep(200);
  return {
    name,
    pid,
    leave: async () => {
      clearInterval(beat);
      session.close();
      for (let k = 0; k < 200 && host.online(pid); k++) await Bun.sleep(50);
    },
  };
}

/** The page in Chrome, as the drive works it. */
interface Page {
  send(method: string, params?: object): Promise<any>;
  /** The value of `expression` on the page. */
  run(expression: string): Promise<any>;
  /** Whether `expression` came true on the page within `tenths` tenths of a second. */
  wait(expression: string, tenths?: number): Promise<boolean>;
  /** Presses the mouse on the middle of what `selector` finds, holds it a moment and lets it go. */
  press(selector: string): Promise<void>;
  /** Takes the field `selector` finds in hand with the mouse, and types `text` in place of what it holds. */
  type(selector: string, text: string): Promise<void>;
  /** Leaves the field in hand with the Tab key. */
  tab(): Promise<void>;
  /** Chooses the option with `value` in the select `selector` finds. */
  choose(selector: string, value: string): Promise<void>;
  /** A picture of the whole page into `file`. */
  shot(file: string): Promise<void>;
  /** Holds each request of the page whose address has `part` in it until `go` is called. */
  hold(part: string): Promise<{ held: () => number; go: () => Promise<void> }>;
  /** What the page asked in a dialog, each answered yes, and the errors it raised. */
  dialogs: string[];
  errors: string[];
}

const q = (selector: string): string => `document.querySelector(${JSON.stringify(selector)})`;
/** How long a press holds the mouse down, ms: longer than the page waits to draw itself after a change. */
const HELD_MS = 60;

/** Opens `url` in headless Chrome, its profile kept under `scratch`, and gives the page to `work`. */
async function browse<T>(chrome: string, url: string, scratch: string, work: (page: Page) => Promise<T>): Promise<T> {
  const profile = mkdtempSync(join(scratch, "chrome-"));
  const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--disable-extensions", "--hide-scrollbars", "--window-size=1500,1300", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  try {
    let port = 0;
    const active = join(profile, "DevToolsActivePort");
    for (let k = 0; k < 100 && !port; k++, await Bun.sleep(100)) if (existsSync(active)) port = Number(readFileSync(active, "utf8").split("\n")[0]);
    if (!port) throw new Error("Chrome did not say where it listens");
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    type Answer = { id?: number; method?: string; params?: any; result?: any; error?: unknown };
    const waiting = new Map<number, (m: Answer) => void>();
    const dialogs: string[] = [];
    const errors: string[] = [];
    const paused: string[] = [];
    let id = 0;
    const send = (method: string, params: object = {}): Promise<any> =>
      new Promise((ok, fail) => {
        const n = ++id;
        const timer = setTimeout(() => fail(new Error(`${method} took too long`)), 30000);
        waiting.set(n, (m) => (clearTimeout(timer), m.error ? fail(new Error(JSON.stringify(m.error))) : ok(m.result)));
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as Answer;
      if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      // A browser asks every site for an icon, which a world's admin pages do not have: that is no fault of the page.
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !String(m.params.entry.url ?? "").endsWith("/favicon.ico")) errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ""}`.trim());
      // A question the page asks (clear what they hold?) is kept, and answered yes.
      if (m.method === "Page.javascriptDialogOpening") {
        dialogs.push(String(m.params.message));
        void send("Page.handleJavaScriptDialog", { accept: true });
      }
      if (m.method === "Fetch.requestPaused") paused.push(String(m.params.requestId));
      if (m.id !== undefined) waiting.get(m.id)?.(m);
    };
    const run = async (expression: string): Promise<any> => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      // A control that is not there to press is a fault of the page or of this script, never to be passed over.
      if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text} in ${expression.slice(0, 160)}`);
      return r.result.value;
    };
    const wait = async (expression: string, tenths = 100): Promise<boolean> => {
      for (let k = 0; k < tenths; k++, await Bun.sleep(100)) if (await run(`!!(${expression})`)) return true;
      return false;
    };
    const mouse = (type: string, x: number, y: number, buttons: number): Promise<unknown> => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
    const press = async (selector: string): Promise<void> => {
      const [x, y] = (await run(`(() => { const e = ${q(selector)}; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`)) as [number, number];
      await mouse("mouseMoved", x, y, 0);
      await mouse("mousePressed", x, y, 1);
      await Bun.sleep(HELD_MS);
      await mouse("mouseReleased", x, y, 0);
      // What the press set going on the page's own thread has run before the next act.
      await run("new Promise((r) => setTimeout(r, 20))");
    };
    const key = async (name: string, code: number): Promise<void> => {
      for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code });
      await run("new Promise((r) => setTimeout(r, 20))");
    };
    const page: Page = {
      send,
      run,
      wait,
      press,
      dialogs,
      errors,
      type: async (selector, text) => {
        await press(selector);
        // The page may have drawn itself anew under the press: the field in hand must still be the one pressed.
        if (!(await run(`document.activeElement === ${q(selector)}`))) throw new Error(`${selector} was pressed and is not the field in hand`);
        await run("document.activeElement.select()");
        await send("Input.insertText", { text });
      },
      tab: () => key("Tab", 9),
      choose: async (selector, value) => {
        const had = await run(`(() => { const e = ${q(selector)}; if (![...e.options].some((o) => o.value === ${JSON.stringify(value)})) return false; e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
        if (!had) throw new Error(`${selector} offers no ${value}`);
        await run("new Promise((r) => setTimeout(r, 20))");
      },
      hold: async (part) => {
        await send("Fetch.enable", { patterns: [{ urlPattern: `*${part}*` }] });
        return {
          held: () => paused.length,
          go: async () => {
            for (const requestId of paused.splice(0)) await send("Fetch.continueRequest", { requestId });
            await send("Fetch.disable");
          },
        };
      },
      shot: async (file) => {
        const size = (await send("Page.getLayoutMetrics")).cssContentSize as { width: number; height: number };
        const made = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 } });
        writeFileSync(file, Buffer.from(made.data as string, "base64"));
      },
    };
    await Promise.all(["Page.enable", "Runtime.enable", "Log.enable"].map((m) => send(m)));
    // A page nobody looks at still has the keyboard: a field pressed is the field in hand.
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await send("Page.navigate", { url });
    try {
      return await work(page);
    } finally {
      ws.close();
    }
  } finally {
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true });
  }
}

/** An id without its pack: round_rifle for core:round_rifle. */
const short = (id: string): string => id.slice(id.indexOf(":") + 1);

/** One thing held, as a line: where, how many, of what quality, and for a weapon what is loaded and fitted. */
function line(place: string, count: number, item: string, quality: number, loaded: string, fitted: string): string {
  return `${place} ${count} ${short(item)}${quality > 0 ? ` ${QUALITY_NAMES[quality]}` : ""}${loaded === "" ? "" : `, ${loaded} loaded`}${fitted === "" ? "" : `, ${short(fitted)} fitted`}`;
}

/** What survivor `pid` wears and carries on the server, a line to each slot in use, read from its slots alone. */
function held(host: Host, pid: number): string[] {
  const rec = host.records.byPid.get(pid);
  if (!rec) return [`no survivor ${pid}`];
  const ids = host.world.reg.ids;
  const inv = host.items.inv(rec);
  const out: string[] = [];
  for (let s = 0; s < inv.cap; s++) {
    if (inv.item[s] === 0 || inv.count[s] === 0) continue;
    const place = s < inv.bag ? "bag" : inv.armor >= 0 && s >= inv.armor && s < inv.armor + ARMOR_SLOTS ? "wear" : inv.hotbar >= 0 && s >= inv.hotbar && s < inv.hotbar + HOTBAR_SLOTS ? "hotbar" : `slot ${s}`;
    out.push(line(place, inv.count[s]!, ids[inv.item[s]!]!, inv.quality[s]!, inv.loaded[s]! > 0 ? `${inv.loaded[s]} ${short(ids[inv.ammo[s]!]!)}` : "", inv.attach[s] === 0 ? "" : ids[inv.attach[s]!]!));
  }
  return out.sort();
}

/** What `entries` handed to a survivor who held nothing leave it holding, as `held` reads it: a loaded weapon has a full clip. */
function handed(reg: Registry, entries: readonly Entry[]): string[] {
  const items = entries.filter((e): e is ItemEntry => !isTame(e));
  return items.map((e) => line(e.place, e.count, e.item, e.quality ?? 0, e.ammo === undefined ? "" : `${reg.weapon[reg.index.get(e.item)!]?.clip ?? 0} ${short(e.ammo)}`, e.attach ?? "")).sort();
}

/** `lines` by kind alone: how many of each thing, wherever it lies and in however many stacks. */
function kinds(lines: readonly string[]): string[] {
  const sums = new Map<string, number>();
  for (const l of lines) {
    const [, count, kind] = /^\S+ (\d+) (.*)$/.exec(l) ?? ["", "0", l];
    sums.set(kind!, (sums.get(kind!) ?? 0) + Number(count));
  }
  return [...sums].map(([kind, n]) => `${n} ${kind}`).sort();
}

/** The draft's table as the page shows it, read back as the entries its fields say. */
const ROWS = `[...document.querySelectorAll("#loadout tbody tr[data-entry]")].map((tr) => {
  const v = (f) => tr.querySelector('[data-field="' + f + '"]')?.value ?? "";
  const e = { item: v("item"), count: Number(v("count")), place: v("place") };
  if (v("quality") !== "" && v("quality") !== "0") e.quality = Number(v("quality"));
  if (v("ammo") !== "") e.ammo = v("ammo");
  if (v("attach") !== "") e.attach = v("attach");
  return e;
})`;

const SAVE_FIRST = "Save first: a survivor is handed the loadout as it is in force, not the draft.";

/** Drives the page at `url`. Returns what went wrong, a line each, and the lines the admin journal must hold once the world stops. */
export async function drive(chrome: string, url: string, host: Host, socket: string, bookFile: string, scratch: string): Promise<{ faults: string[]; journal: string[] }> {
  const faults: string[] = [];
  const journal: string[] = [];
  const store = host.loadoutBook;
  const reg = host.world.reg;
  const here: Survivor[] = [];
  const fault = (what: string): void => {
    console.log(`  FAIL ${what}`);
    faults.push(what);
  };
  const check = (what: string, got: unknown, want: unknown): void => {
    const [g, w] = [JSON.stringify(got), JSON.stringify(want)];
    console.log(`  ${g === w ? "ok  " : "FAIL"} ${what}${g === w ? "" : `: ${g}, not ${w}`}`);
    if (g !== w) faults.push(`${what}: ${g}, not ${w}`);
  };
  const of = (id: string) => store.book.loadouts.find((l) => l.id === id);
  const index = (name: string): number => reg.index.get(`core:${name}`)!;
  const onDisk = (): unknown => (existsSync(bookFile) ? JSON.parse(readFileSync(bookFile, "utf8")) : null);
  const join = async (name: string): Promise<Survivor> => {
    const s = await enter(host, socket, name);
    here.push(s);
    return s;
  };

  try {
    await browse(chrome, url, scratch, async (page) => {
      const { run, press, type, choose } = page;
      const text = (selector: string): Promise<string> => run(`${q(selector)}?.textContent ?? ""`);
      const disabled = (selector: string): Promise<boolean> => run(`${q(selector)}.disabled`);
      const until = async (expression: string, what: string, tenths = 100): Promise<boolean> => {
        if (await page.wait(expression, tenths)) return true;
        fault(`waited ${tenths / 10} seconds for ${what}`);
        return false;
      };
      /** Waits for the page to say what begins with `words`. */
      const said = async (words: string): Promise<boolean> => (await page.wait(`${q("#msg")}.textContent.startsWith(${JSON.stringify(words)})`)) || (fault(`waited ten seconds for the page to say "${words}": it says "${await text("#msg")}"`), false);
      const shown = (): Promise<string[]> => run(`[...document.querySelectorAll("#list [data-pick]")].map((b) => b.dataset.pick)`);
      /** Whether Apply cannot be pressed, and what the page says of it. */
      const hand = async (): Promise<[boolean, string]> => [await disabled("#apply"), await text("#hand-note")];
      /** Presses Save, with `note` typed first, and waits for the page to say the revision it was saved as. */
      const save = async (note: string): Promise<void> => {
        const next = store.book.revision + 1;
        if (!(await until(q('[data-do="save"]'), "a Save button"))) return;
        if (note !== "") await type("#note", note);
        await press('[data-do="save"]');
        await said(`Saved as revision ${next}.`);
        journal.push(`${PAGE}\tloadouts saved${note === "" ? "" : ` (${note})`}: revision ${next}`);
      };
      /** Waits for the survivor picker to offer `who`: the page asks who is here every ten seconds. */
      const offered = (who: Survivor, words: string): Promise<boolean> => until(`${q(`#survivor option[value="${who.pid}"]`)}?.textContent === ${JSON.stringify(words)}`, `the picker to offer ${words}`, 150);
      /** Presses Apply, and waits for the console's reply that begins with `reply`. */
      const apply = async (loadout: string, who: Survivor, clear: boolean, reply: string): Promise<void> => {
        await press("#apply");
        if (await said(reply)) journal.push(`${PAGE}\tloadout ${loadout} #${who.pid}${clear ? " -clear" : ""}`);
      };

      // The page reads the book in force: the built-in one, of a world nobody has joined.
      console.log("the built-in book");
      if (!(await until(`document.querySelectorAll("#list [data-pick]").length > 0 && ${q("#assign-admin")}.value !== ""`, "the list of loadouts"))) return;
      check("the five built-in loadouts are listed", await shown(), ["naked", "stone", "hunter", "rifleman", "scout"]);
      check("new players and new admins both get naked", await run(`[${q("#assign-player")}.value, ${q("#assign-admin")}.value]`), ["naked", "naked"]);
      check("the page says it is the built-in book of a world with a save", await text("#world"), "revision 0, the built-in loadouts");
      check("with nobody in the world nothing is handed out, and the page says why", await hand(), [true, "No survivor has joined this world yet."]);

      // An entry added to stone and the loadout made to come again after each death, saved with a note.
      console.log("stone edited and saved");
      await press('[data-pick="stone"]');
      const n = of("stone")!.entries.length;
      const row = `tr[data-entry="${n}"]`;
      await press('[data-do="item"]');
      if (!(await until(q(`${row} [data-field="item"]`), "the new entry's row"))) return;
      // The item is written by its name, as the picker's list shows it, and the page finds its id.
      await type(`${row} [data-field="item"]`, "Stone");
      await choose(`${row} [data-field="place"]`, "hotbar");
      check("the name typed in the picker became the item's id", await run(`${q(`${row} [data-field="item"]`)}.value`), "core:stone");
      await type(`${row} [data-field="count"]`, "25");
      // The tick is pressed with the count still in the field: the count is taken as the mouse goes down.
      await press('[data-head="respawn"]');
      check("the tick took, pressed straight from a field just typed in", await run(`${q('[data-head="respawn"]')}.checked`), true);
      check("the bar says what is not saved", [await text("#bar b"), await text("#bar .lines")], ["Not saved", `stone: handed out again after each death, ${n + 1} entries, not ${n}`]);
      await save("stone tools come with stone");
      const added = { item: "core:stone", count: 25, place: "hotbar" };
      check("the book in force has the entry, the flag and the next revision", [store.book.revision, of("stone")!.respawn, of("stone")!.entries.length, of("stone")!.entries[n]], [1, true, n + 1, added]);
      check("the book's file holds the same book", onDisk(), store.book);
      check("the page shows revision 1, not the built-in book", [await text("#world"), await text("#bar b")], ["revision 1", ""]);

      // What the page says goes as a field changes: a button pressed straight from that field must not move from under the press.
      console.log("a button pressed straight from a changed field");
      const rows = `document.querySelectorAll("#loadout tbody tr[data-entry]").length`;
      const count = `${q(`${row} [data-field="count"]`)}.value`;
      check("the page is saying that it saved", await text("#msg"), "Saved as revision 1.");
      await type(`${row} [data-field="count"]`, "26");
      await press('[data-do="tame"]');
      check("the press added an entry, and the count typed is in the draft", [await run(rows), await run(count), await text("#bar .lines"), await text("#msg")], [n + 2, "26", `stone: ${n + 2} entries, not ${n + 1}`, ""]);
      await press('[data-do="discard"]');
      check("Discard shows the book in force again", [await run(rows), await run(count), await text("#bar b")], [n + 1, "25", ""]);
      check("and the book in force was not touched", [store.book.revision, of("stone")!.entries.length], [1, n + 1]);

      // Stone given to new admins: on a development world everyone has cheats, so a new survivor takes it.
      console.log("stone given to new admins");
      await choose("#assign-admin", "stone");
      check("the bar says who gets what", await text("#bar .lines"), "New admins get stone, not naked");
      await save("");
      check("the book in force gives admins stone", [store.book.revision, store.book.assign], [2, { player: "naked", admin: "stone" }]);
      const nell = await join("Nell");
      check("a survivor who joins now wears and carries stone", held(host, nell.pid), handed(reg, of("stone")!.entries));

      // A loadout handed to a survivor who holds things already: they stay, and the loadout is added.
      console.log("hunter applied to a survivor who holds things");
      if (host.items.mint(host.records.byPid.get(nell.pid)!, index("wood"), 30) !== 30) fault("30 wood could not be given to Nell");
      const before = held(host, nell.pid);
      if (!(await offered(nell, "Nell (online)"))) return;
      await choose("#survivor", String(nell.pid));
      await press('[data-pick="hunter"]');
      check("Apply can be pressed", await hand(), [false, ""]);
      await apply("hunter", nell, false, "hunter for Nell: gave bow");
      const after = held(host, nell.pid);
      check("what she held is where it was", before.filter((l) => !after.includes(l)), []);
      check("and the hunter's things are added to it", kinds(after), kinds([...before, ...handed(reg, of("hunter")!.entries)]));
      check("nothing was asked, as nothing is cleared", page.dialogs, []);

      console.log("naked applied with a clear");
      await press("#clear");
      await press('[data-pick="naked"]');
      await apply("naked", nell, true, "naked for Nell, cleared first: nothing given");
      check("the page asked before it cleared", page.dialogs.splice(0), ["Clear everything Nell holds, then hand out naked?"]);
      check("she holds nothing", held(host, nell.pid), []);
      await press("#clear");
      check("the tick to clear is off again", await run(`${q("#clear")}.checked`), false);

      // New admins get naked again, so that the next to join hold nothing but what the page hands them.
      await choose("#assign-admin", "naked");
      await save("admins start with nothing again");
      check("the book in force gives admins naked again", store.book.assign, { player: "naked", admin: "naked" });

      // Two survivors whose names differ by a capital: Ada has left, ada is here. Nothing meant for Ada reaches ada.
      console.log("a survivor who is away, and another of nearly her name");
      const away = await join("Ada");
      await away.leave();
      const ada = await join("ada");
      check("they are two survivors, one away and one here", [away.pid !== ada.pid, host.online(away.pid), host.online(ada.pid)], [true, false, true]);
      if (!(await offered(away, "Ada (away)")) || !(await offered(ada, "ada (online)"))) return;
      await press('[data-pick="hunter"]');
      await choose("#survivor", String(away.pid));
      check("with Ada picked Apply is disabled, and the page says she is away", await hand(), [true, "Ada is away. A loadout is handed to a survivor who is in the world; a fill reads one who is away too."]);
      check("she may still be read for a fill", await disabled('[data-do="capture"]'), false);
      await press("#apply");
      await Bun.sleep(400);
      check("a press on Apply hands nothing to either", [held(host, away.pid), held(host, ada.pid)], [[], []]);
      await choose("#survivor", String(ada.pid));
      await press('[data-pick="stone"]');
      check("with ada picked Apply can be pressed", await hand(), [false, ""]);
      await apply("stone", ada, false, "stone for ada: gave hatchet");
      check("ada alone has stone", [held(host, ada.pid), held(host, away.pid), held(host, nell.pid)], [handed(reg, of("stone")!.entries), [], []]);

      // A kit on Nell: two pieces worn, a pistol with two rounds and a scope in the fourth hotbar slot, a stack and a fine tool in the bag.
      console.log("a new loadout filled from a survivor");
      const rec = host.records.byPid.get(nell.pid)!;
      const inv = host.items.inv(rec);
      const weapon = inv.hotbar + 3;
      const made = [
        host.items.mintAt(rec, inv.armor + reg.wearSlot[index("flak_hat")]!, index("flak_hat"), 1),
        host.items.mintAt(rec, inv.armor + reg.wearSlot[index("hide_boots")]!, index("hide_boots"), 1),
        host.items.mintAt(rec, weapon, index("pistol"), 1),
        host.items.mintLoaded(rec, weapon, index("round_pistol"), 2),
        Number(host.items.mintFitted(rec, weapon, index("scope"))),
        host.items.mint(rec, index("wood"), 40),
        host.items.mint(rec, index("hatchet"), 1, 3),
      ];
      if (made.join() !== "1,1,1,2,1,40,1") return fault(`the kit could not be given to Nell: ${made.join()}`);
      const kit: Entry[] = [
        { item: "core:flak_hat", count: 1, place: "wear" },
        { item: "core:hide_boots", count: 1, place: "wear" },
        { item: "core:pistol", count: 1, place: "hotbar", ammo: "core:round_pistol", attach: "core:scope" },
        { item: "core:wood", count: 40, place: "bag" },
        { item: "core:hatchet", count: 1, place: "bag", quality: 3 },
      ];
      const worn = held(host, nell.pid);
      await press('[data-do="new"]');
      check("New made a loadout, and it is the one shown", [await shown(), await run(`${q('[data-head="id"]')}.value`)], [["naked", "stone", "hunter", "rifleman", "scout", "new"], "new"]);
      await choose("#survivor", String(nell.pid));
      const was = JSON.stringify(store.book);
      await press('[data-do="capture"]');
      await said("Filled new from Nell: 5 entries. Not saved yet.");
      check("the draft's table shows what she wears and carries", await run(ROWS), kit);
      check("the bar says it is not saved", [await text("#bar b"), await text("#bar .lines")], ["Not saved", "new: new, with 5 entries"]);
      check("the book in force is as it was", JSON.stringify(store.book) === was, true);
      check("the draft cannot be handed out", await hand(), [true, SAVE_FIRST]);
      check("nothing was asked, as the loadout was empty", page.dialogs, []);
      await save("what Nell carries");
      check("the saved book's new loadout has those entries", of("new")?.entries, kit);
      check("and so has the book's file", onDisk(), store.book);
      await press("#clear");
      await apply("new", nell, true, "new for Nell, cleared first: gave");
      check("the page asked before it cleared", page.dialogs.splice(0), ["Clear everything Nell holds, then hand out new?"]);
      const fresh = handed(reg, kit);
      check("she holds the kit again, the pistol new with a full clip", [held(host, nell.pid), fresh.join() !== worn.join()], [fresh, true]);
      await press("#clear");

      // The server's answer to a fill is held back while another loadout is picked: it fills the one it was asked for.
      console.log("a fill answered after another loadout is picked");
      await press('[data-do="new"]');
      const answer = await page.hold("loadouts/capture.json");
      await press('[data-do="capture"]');
      for (let k = 0; k < 50 && answer.held() === 0; k++) await Bun.sleep(100);
      check("the page asked the server what Nell carries", answer.held(), 1);
      await press('[data-pick="hunter"]');
      await answer.go();
      await said("Filled new-2 from Nell: 5 entries. Not saved yet.");
      check("hunter, the loadout shown, is as the book has it", [await run(`${q('[data-head="id"]')}.value`), await run(ROWS)], ["hunter", of("hunter")!.entries]);
      await press('[data-pick="new-2"]');
      check("and the loadout the fill was asked for has what she carries", [await run(ROWS), await text("#bar .lines")], [kit, "new-2: new, with 5 entries"]);
      // Filled once more, the entries it has are to be replaced, and the page asks first.
      await press('[data-do="capture"]');
      await said("Filled new-2 from Nell: 5 entries. Not saved yet.");
      check("a fill over entries is asked about first", page.dialogs.splice(0), ["Put what Nell wears and carries in place of the 5 entries of new-2?"]);
      await press('[data-do="discard"]');
      check("Discard takes the unsaved loadout away", [await shown(), await text("#bar b")], [["naked", "stone", "hunter", "rifleman", "scout", "new"], ""]);
      await press('[data-pick="new"]');

      // Apply pressed straight from a changed field: the change is made as the mouse goes down, so nothing may be handed out.
      console.log("a draft that is not saved");
      const wood = 'tr[data-entry="3"] [data-field="count"]';
      await type(wood, "41");
      await press("#apply");
      await Bun.sleep(400);
      check("Apply pressed straight from the changed field hands out nothing, and the page says to save first", [held(host, nell.pid), await text("#msg")], [fresh, SAVE_FIRST]);
      check("Apply is disabled from then on", await hand(), [true, SAVE_FIRST]);
      await press('[data-do="discard"]');
      check("with the draft discarded Apply can be pressed again", await hand(), [false, ""]);
      await type(wood, "41");
      await press("#apply");
      await Bun.sleep(400);
      check("and pressed straight from the field once more it hands out nothing", [held(host, nell.pid), await text("#msg")], [fresh, SAVE_FIRST]);
      check("the bar says the entries are not saved", [await text("#bar b"), await text("#bar .lines")], ["Not saved", "new: its entries"]);
      await press('[data-pick="hunter"]');
      check("a loadout the draft leaves as it is can be handed out", await hand(), [false, ""]);
      await press('[data-pick="new"]');
      check("and the changed one still cannot", await hand(), [true, SAVE_FIRST]);

      // Another editor saves while the page has its draft: the page's save is refused, and it offers both ways on.
      console.log("a save that another editor's came before");
      const editor = (label: string): number => {
        const theirs = structuredClone(store.book) as LoadoutBook;
        theirs.loadouts.find((l) => l.id === "hunter")!.label = label;
        const r = store.save(theirs, store.book.revision, "drive", "another editor");
        if (!r.ok) fault(`the other editor's save was refused: ${JSON.stringify(r)}`);
        return store.book.revision;
      };
      let theirs = editor("Hunter of another editor");
      await type("#note", "mine");
      await press('[data-do="save"]');
      await said("Not saved: the book changed. Another editor saved first.");
      check("the bar says which revision came first", (await text("#bar .warn")).startsWith(`The book changed: another editor saved revision ${theirs} since this page read it.`), true);
      check("and offers to read theirs or to save over it", [await text('[data-do="theirs"]'), await text('[data-do="over"]')], ["Read theirs, and lose these changes", `Save over revision ${theirs}`]);
      check("the book in force is the other editor's", [store.book.revision, of("hunter")!.label, (of("new")!.entries[3] as ItemEntry).count], [theirs, "Hunter of another editor", 40]);
      await press('[data-do="theirs"]');
      await said("Read again.");
      await press('[data-pick="hunter"]');
      const label = `${q('[data-head="label"]')}.value`;
      check("Read theirs shows the other editor's book, and no draft", [await text("#world"), await run(label), await text("#bar b"), await run(`!!${q('[data-do="over"]')}`)], [`revision ${theirs}`, "Hunter of another editor", "", false]);
      await press('[data-pick="new"]');
      check("and the count this page had changed is theirs again", await run(`${q(wood)}.value`), "40");

      // The other way on: the page's draft is saved over the revision that came first.
      await type(wood, "42");
      await page.tab();
      theirs = editor("Hunter of another editor, again");
      await press('[data-do="save"]');
      await said("Not saved: the book changed.");
      await press('[data-do="over"]');
      await said(`Saved as revision ${theirs + 1}.`);
      journal.push(`${PAGE}\tloadouts saved: revision ${theirs + 1}`);
      check("Save over puts the page's draft in force", [store.book.revision, of("hunter")!.label, (of("new")!.entries[3] as ItemEntry).count], [theirs + 1, "Hunter of another editor", 42]);
      check("and in the book's file", onDisk(), store.book);

      // A loadout a role is given stays: the page says why. One no role is given goes.
      console.log("a loadout taken out");
      await press('[data-pick="naked"]');
      await press('[data-do="remove"]');
      check("naked is not taken out, and the page says why", [await text("#msg"), await shown(), await text("#bar b")], ["New players get this loadout. Choose another for them first.", ["naked", "stone", "hunter", "rifleman", "scout", "new"], ""]);
      await press('[data-pick="new"]');
      await press('[data-do="remove"]');
      check("new is taken out of the draft", [await shown(), await text("#bar .lines")], [["naked", "stone", "hunter", "rifleman", "scout"], "new: removed"]);
      await save("the filled loadout is done with");
      check("and out of the book in force", store.book.loadouts.map((l) => l.id), ["naked", "stone", "hunter", "rifleman", "scout"]);

      // The built-in book comes back as the next revision, once the page has asked.
      console.log("the built-in loadouts put back");
      const back = store.book.revision + 1;
      await press('[data-do="reset"]');
      await said(`The built-in loadouts are back, as revision ${back}.`);
      journal.push(`${PAGE}\tloadouts reset to the built-ins: revision ${back}`);
      check("the page asked first", page.dialogs.splice(0), ["Put the built-in loadouts back, as the next revision? Every loadout made here goes."]);
      check("the book in force is the built-in one at the next revision", store.book, { ...builtinLoadouts(), revision: back });
      check("and so is the book's file", onDisk(), store.book);
      check("the page shows it", [await text("#world"), await run(`${q('[data-pick="stone"] span')}.textContent`)], [`revision ${back}`, "stone · 8 entries"]);

      // The two saves that lost to another editor's were refused with 409, which a browser logs: nothing else was.
      const refused = (e: string): boolean => e.includes("409") && e.endsWith("/admin/loadouts/book");
      check("the page raised no error but the two refused saves", [page.errors.filter((e) => !refused(e)), page.errors.filter(refused).length], [[], 2]);
    });
  } catch (err) {
    fault(err instanceof Error ? err.message : String(err));
  }
  for (const s of here) await s.leave();
  return { faults, journal };
}

/** What is wrong with the admin journal of the stopped world at `dbPath`: it holds `want`, which the page's acts wrote, in order. */
export function journalFaults(dbPath: string, reg: Registry, want: readonly string[]): string[] {
  const kept = new WorldStore(dbPath, reg);
  const lines = kept
    .journal()
    .filter((j) => j.op === OP_ADMIN)
    .map((j) => decodeAct(j.data))
    .filter((a) => a.kind === "command")
    .map((a) => `${a.name}\t${a.what}`);
  kept.close();
  const [g, w] = [JSON.stringify(lines), JSON.stringify(want)];
  console.log(`  ${g === w ? "ok  " : "FAIL"} the admin journal has each save and each loadout handed out${g === w ? "" : `: ${g}, not ${w}`}`);
  return g === w ? [] : [`the admin journal: ${g}, not ${w}`];
}

/** Pictures the page into `out`: a loadout as it comes, one handed out, a survivor who is away, and a draft. Returns what went wrong. */
export async function shots(chrome: string, url: string, host: Host, socket: string, out: string, scratch: string): Promise<string[]> {
  const faults: string[] = [];
  const here: Survivor[] = [];
  try {
    const away = await enter(host, socket, "Ada");
    await away.leave();
    const bea = await enter(host, socket, "Bea");
    here.push(bea);
    await browse(chrome, `${url}#rifleman`, scratch, async (page) => {
      const picture = async (name: string): Promise<void> => {
        await page.shot(join(out, `${name}.png`));
        console.log(`  ${join(out, `${name}.png`)}`);
      };
      const offered = `${q(`#survivor option[value="${away.pid}"]`)} && ${q(`#survivor option[value="${bea.pid}"]`)}`;
      if (!(await page.wait(`${q('[data-head="id"]')}?.value === "rifleman" && ${offered}`, 150))) return void faults.push("the page did not show rifleman and the two survivors");
      await picture("rifleman");
      await page.choose("#survivor", String(bea.pid));
      await page.press("#apply");
      if (!(await page.wait(`${q("#msg")}.textContent.startsWith("rifleman for Bea")`))) faults.push("rifleman was not handed to Bea");
      await picture("survivor");
      await page.choose("#survivor", String(away.pid));
      await picture("away");
      await page.press('[data-pick="hunter"]');
      await page.type('tr[data-entry="1"] [data-field="count"]', "60");
      await page.tab();
      await picture("draft");
    });
  } catch (err) {
    faults.push(err instanceof Error ? err.message : String(err));
  }
  for (const s of here) await s.leave();
  for (const f of faults) console.log(`  FAIL ${f}`);
  return faults;
}
