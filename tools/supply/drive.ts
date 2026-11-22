// The drop book's admin page driven as an admin drives it (bun tools/supply/page.ts --drive): the real page in headless
// Chrome against a development world that keeps its book in a file, each act made with the page's own controls and
// judged by what the server then holds. The page's logic has unit tests (client/core/drops) and its requests have integration tests; this is the
// wiring between them, which is DOM code and has no other proof: a tick that reads the wrong value or a button bound
// to the wrong act is found only by pressing it.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toPixel, toWorld } from "../../client/core/drops/place.ts";
import { num } from "../../client/core/drops/view.ts";
import type { Host } from "../../server/host.ts";
import type { SupplyBook } from "../../shared/supply/book.ts";
import { catalogOf } from "../../shared/supply/catalog.ts";
import { cellsOf, compileBook } from "../../shared/supply/compile.ts";
import { simulate } from "../../shared/supply/simulate.ts";
import { CHROME_FLAGS } from "../chrome.ts";

/** The page's map is this many pixels a side at its first zoom (client/drops/world.ts side). */
const MAP_SIDE = 860;

/**
 * Drives the page at `url`, served by `host`'s world, whose drop book is the file `bookFile`. Returns what went wrong,
 * a line each: none if all is well.
 */
export async function drive(chrome: string, url: string, host: Host, bookFile: string): Promise<string[]> {
  const faults: string[] = [];
  const store = host.supplyBook;
  const world = { sizeX: host.world.hf.sizeX, sizeZ: host.world.hf.sizeZ };
  const catalog = catalogOf(host.world.reg);
  const check = (what: string, got: unknown, want: unknown): void => {
    const [g, w] = [JSON.stringify(got), JSON.stringify(want)];
    console.log(`  ${g === w ? "ok  " : "FAIL"} ${what}${g === w ? "" : `: ${g}, not ${w}`}`);
    if (g !== w) faults.push(`${what}: ${g}, not ${w}`);
  };

  // A book to drive: two circuits with sites of their own and one they share, a site no circuit names (as a book read
  // from a file may have), in a world that doubles quality.
  const first = structuredClone(store.book) as SupplyBook;
  const at = (fx: number, fz: number): { x: number; z: number } => ({ x: Math.round(world.sizeX * fx), z: Math.round(world.sizeZ * fz) });
  first.sites = [{ key: "a/001", ...at(0.3, 0.3) }, { key: "a/002", ...at(0.4, 0.3) }, { key: "a/003", ...at(0.5, 0.4) }, { key: "b/001", ...at(0.6, 0.6) }, { key: "stray/001", ...at(0.7, 0.2) }];
  const circuit = (key: string, sites: string[]) => ({ key, name: key, on: true, sites, maxLive: 3, firstDelay: [120, 300] as [number, number], interval: [300, 600] as [number, number], tierWeights: { white: 1, blue: 1 } });
  first.circuits = [circuit("a", ["a/001", "a/002", "a/003"]), circuit("b", ["b/001", "a/003"])];
  const made = store.save(first, store.book.revision, "drive", "two circuits to drive the page with");
  if (!made.ok) return [`the book to drive could not be saved: ${JSON.stringify(made)}`];
  const said = host.setSetting("SupplyCrateLootQualityMultiplier", "2");
  if (said !== "") return [`the quality setting could not be set: ${said}`];

  const profile = mkdtempSync(join(tmpdir(), "snark-drops-"));
  const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--disable-extensions", "--window-size=1500,1300", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  try {
    let port = 0;
    const active = join(profile, "DevToolsActivePort");
    for (let k = 0; k < 100 && !port; k++, await Bun.sleep(100)) if (existsSync(active)) port = Number(readFileSync(active, "utf8").split("\n")[0]);
    if (!port) return ["Chrome did not say where it listens"];
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    type Answer = { id?: number; method?: string; params?: any; result?: any; error?: unknown };
    const waiting = new Map<number, (m: Answer) => void>();
    const errors: string[] = [];
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
      // A question the page asks (bring a revision back?) is answered yes.
      if (m.method === "Page.javascriptDialogOpening") void send("Page.handleJavaScriptDialog", { accept: true });
      if (m.id !== undefined) waiting.get(m.id)?.(m);
    };
    const run = async (expression: string): Promise<any> => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      // A control that is not there to press is a fault of the page or of this script, never to be passed over.
      if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text} in ${expression.slice(0, 120)}`);
      return r.result.value;
    };
    /** Waits until `expression` is true on the page, or says what it waited for. */
    const until = async (expression: string, what: string): Promise<boolean> => {
      for (let k = 0; k < 100; k++, await Bun.sleep(100)) if (await run(`!!(${expression})`)) return true;
      faults.push(`waited ten seconds for ${what}`);
      console.log(`  FAIL waited ten seconds for ${what}`);
      return false;
    };
    const q = (selector: string): string => `document.querySelector(${JSON.stringify(selector)})`;
    const click = (selector: string): Promise<unknown> => run(`${q(selector)}.click()`);
    const saidText = (): Promise<string> => run(`document.getElementById("said").textContent`);
    /** Presses Save and waits for the page to say the revision it was saved as. */
    const save = async (): Promise<void> => {
      const next = store.book.revision + 1;
      await click('[data-do="save"]');
      await until(`document.getElementById("said").textContent.startsWith("saved as revision ${next}")`, `"saved as revision ${next}" (the page says "${await saidText()}")`);
    };
    const tab = async (key: string, shown: string): Promise<boolean> => {
      await click(`[data-tab="${key}"]`);
      return until(q(shown), `the ${key} view`);
    };
    await Promise.all(["Page.enable", "Runtime.enable", "Log.enable"].map((m) => send(m)));
    await send("Page.navigate", { url: `${url}#circuits` });
    const on = `input[type=checkbox][data-path='["circuits",0,"on"]']`;
    if (!(await until(q(on), "the circuits view"))) return faults;

    // A circuit switched off by its tick, and saved: the book has it off, said outright.
    console.log("a circuit switched off");
    check("its tick is set to begin with", await run(`${q(on)}.checked`), true);
    await click(on);
    await save();
    check("the book in force has circuit a off", [store.book.circuits[0]!.key, store.book.circuits[0]!.on, "on" in store.book.circuits[0]!], ["a", false, true]);
    check("and the page shows it so after reading the book again", await run(`${q(on)}.checked`), false);

    // A circuit taken out: it goes with the sites it alone names. The one it shares stays, and so does the one no
    // circuit ever named, which was never its to take.
    console.log("a circuit taken out");
    await click(`button[data-do="del"][data-at='["circuits",0]']`);
    await save();
    check("the book in force has circuit b alone", store.book.circuits.map((c) => c.key), ["b"]);
    check("its own sites are gone, and no others", store.book.sites.map((s) => s.key).sort(), ["a/003", "b/001", "stray/001"]);

    // The site no circuit names is told of on the map, and taken out by its own button.
    console.log("a site no circuit names");
    if (await tab("map", "canvas#map")) {
      check("the map says there is one", await run(`${q("#main .warn")}?.textContent ?? ""`), "1 site no circuit names");
      await click('[data-do="unloose"]');
      await save();
      check("the book in force has it no more", store.book.sites.map((s) => s.key).sort(), ["a/003", "b/001"]);
    }

    // A site dragged on the map: where it is let go is where the saved book has it.
    console.log("a site dragged on the map");
    if (await tab("map", "canvas#map")) {
      await run(`${q("canvas#map")}.scrollIntoView({ block: "start" })`);
      // The map is drawn once the page has read what is live: until then a press on it finds nothing.
      await Bun.sleep(1500);
      const box = (await run(`(() => { const b = ${q("canvas#map")}.getBoundingClientRect(); return [b.left, b.top, b.width]; })()`)) as [number, number, number];
      const site = store.book.sites.find((s) => s.key === "b/001")!;
      const scale = box[2] / MAP_SIDE;
      const [px, py] = toPixel(world, site.x, site.z, MAP_SIDE);
      const [tx, ty] = [px + 60, py + 40];
      const mouse = (kind: string, x: number, y: number, buttons: number): Promise<unknown> => send("Input.dispatchMouseEvent", { type: kind, x: box[0] + x * scale, y: box[1] + y * scale, button: "left", buttons, clickCount: 1 });
      await mouse("mousePressed", px, py, 1);
      for (let k = 1; k <= 6; k++) await mouse("mouseMoved", px + k * 10, py + (k * 40) / 6, 1);
      await mouse("mouseReleased", tx, ty, 0);
      await until(`document.getElementById("said").textContent.startsWith("moved b/001")`, `"moved b/001" (the page says "${await saidText()}")`);
      await save();
      const moved = store.book.sites.find((s) => s.key === "b/001")!;
      const want = toWorld(world, tx, ty, MAP_SIDE);
      // To the metre a pixel is: the page reads the pointer in whole pixels of the screen.
      const metre = Math.ceil(Math.max(world.sizeX, world.sizeZ) / MAP_SIDE) + 1;
      check("the book in force has b/001 where it was let go", [Math.abs(moved.x - want[0]) <= metre, Math.abs(moved.z - want[1]) <= metre, moved.x !== site.x], [true, true, true]);
    }

    // The simulator rolls as this world's server does, at its quality multiplier, and the book alone where asked.
    console.log("the simulator at this world's quality");
    if (await tab("sim", "#simKey")) {
      await run(`(() => { ${q("#simKey")}.value = "red/arms"; ${q("#simN")}.value = "5000"; ${q("#simSeed")}.value = "11"; })()`);
      await click("#simGo");
      const mean = (): Promise<string> => run(`document.querySelector(".figures b").textContent`);
      const rolled = (quality: number): string => {
        const compiled = compileBook(store.book, catalog, { quality });
        return num(simulate(compiled, compiled.tables.get("red/arms")!, false, 5000, 11, true).mean);
      };
      check("its tick for the world's quality is shown and set", await run(`[${q("#simWorld")}.closest("label").hidden, ${q("#simWorld")}.checked]`), [false, true]);
      check("the mean is the server's at quality × 2", await mean(), rolled(2));
      await click("#simWorld");
      await click("#simGo");
      check("and the book's alone with the tick off", await mean(), rolled(1));
      check("which is not the same figure", rolled(1) !== rolled(2), true);
    }

    // ARK's ringed crate alone, pasted and put in the draft: plain drops keep the book's slots and the tier is still called.
    console.log("ARK's ringed crate pasted");
    if (await tab("ark", "#arkText")) {
      // The slots a plain drop has in the book now: those are kept, and what only a ringed drop had gives way to ARK's.
      const before = store.book.tables["blue/arms"]!.slots.filter((s) => (s.chance ?? 1) > 0).length;
      await run(`${q("#arkText")}.value = ${JSON.stringify('(SupplyCrateClassString="SupplyCrate_Level25_Double_C",MinItemSets=1,MaxItemSets=1,ItemSets=((MinNumItems=1,MaxNumItems=1,ItemEntries=((ItemClassStrings=("core:stone"),MinQuantity=77,MaxQuantity=77)))))')}`);
      await click('[data-do="arkread"]');
      if (await until(`${q('[data-do="arkput"]')} && !${q('[data-do="arkput"]')}.disabled`, "the paste to be read")) {
        await click('[data-do="arkput"]');
        // It is read against the draft once more as it is put there, which takes the server a moment.
        await until(`document.getElementById("said").textContent.startsWith("ARK's tables for blue are in the draft")`, `the tables to be in the draft (the page says "${await saidText()}")`);
        await save();
        const slots = store.book.tables["blue/arms"]!.slots;
        check("blue arms has the book's slots for a plain drop and ARK's for a ringed one", [slots.length, slots.at(-1)!.name, slots.slice(0, -1).every((s) => s.ringed === 0)], [before + 1, "ARK's ringed crate", true]);
        check("and a circuit still calls every class of blue", cellsOf(compileBook(store.book, catalog), store.book.circuits[0]!).filter((c) => c.table.key.startsWith("blue/")).length, store.book.classes.length);
      }
    }
    // A revision brought back, and then a draft saved, while the book's history cannot be written: the book is saved
    // and in force, and the page says what was not kept, by either button.
    console.log("a revision brought back while its history cannot be written");
    if (await tab("live", '[data-do="restore"][data-id="1"]')) {
      const history = `${bookFile}.history`;
      rmSync(history, { force: true });
      mkdirSync(history);
      const next = store.book.revision + 1;
      await click('[data-do="restore"][data-id="1"]');
      const warned = `document.getElementById("said").textContent.includes("but its history could not be written")`;
      await until(`document.getElementById("said").textContent.startsWith("revision 1 is revision ${next} now") && ${warned}`, `"revision 1 is revision ${next} now, but its history could not be written" (the page says "${await saidText()}")`);
      check("it is said as a warning", await run(`document.getElementById("said").className`), "warn");
      check("and the book in force is revision 1's again", [store.book.revision, store.book.circuits.map((c) => c.key)], [next, ["a", "b"]]);
      if (await tab("circuits", on)) {
        await click(on);
        await click('[data-do="save"]');
        await until(`document.getElementById("said").textContent.startsWith("saved as revision ${next + 1}") && ${warned}`, `"saved as revision ${next + 1}, but its history could not be written" (the page says "${await saidText()}")`);
        check("a draft saved then says the same", [store.book.revision, store.book.circuits[0]!.on], [next + 1, false]);
      }
      rmSync(history, { recursive: true, force: true });
    }
    check("the page raised no error", errors, []);
    ws.close();
  } finally {
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true });
  }
  return faults;
}
