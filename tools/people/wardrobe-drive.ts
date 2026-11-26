// The wardrobe admin page (client/admin/wardrobe.ts) worked in headless Chrome against a development world, as an admin
// works it: a draft with text, a shape and an uploaded picture, seen on the person stage; published; a publish another
// admin made first, answered 409 with the draft kept; a store too busy, answered 503 and tried again; a reload; a retire
// and its undoing; and a big picture brought under the print cap. Each act is judged by what the store then holds.
// Fails on any fault. --shots saves a picture of the page at each step under artifacts/people/wardrobe/.
//
//   bun tools/people/wardrobe-drive.ts [--dist var/people/dist] [--out artifacts/people/wardrobe] [--port 8793] [--shots] [--build]
//
// The dist is a built client. --build (or a dist without the page) makes the admin pages, the stage's page and script,
// and the stage's content again in it alone.

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { brotliCompressSync } from "node:zlib";
import { startServer } from "../../server/main.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { Rules } from "../../server/settings/rules.ts";
import { printPath } from "../../shared/people/doc.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { buildAdmin } from "../build-admin.ts";
import { buildPersonStage, studioContent } from "../build-entry.ts";
import { findChrome } from "../chrome.ts";
import { browse, type Page } from "../loadout/drive.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({
  options: { dist: { type: "string", default: join(ROOT, "var/people/dist") }, out: { type: "string", default: join(ROOT, "artifacts/people/wardrobe") }, port: { type: "string", default: "8793" }, shots: { type: "boolean" }, build: { type: "boolean" } },
});
const dist = resolve(values.dist!), out = resolve(values.out!);
if (!existsSync(join(dist, "assets/manifest.json"))) throw new Error(`${dist} is not a built client: bun tools/build-client.ts --quick --dist ${dist}`);

/** The stage's content as this checkout has it, so it knows the garments the server offers. */
function stageContent(): void {
  const bytes = new TextEncoder().encode(JSON.stringify(studioContent(CORE_CONTENT)));
  const file = `assets/studio-content.${new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16)}.json`;
  writeFileSync(join(dist, file), bytes);
  writeFileSync(join(dist, `${file}.br`), brotliCompressSync(bytes));
  const media = JSON.parse(readFileSync(join(dist, "entry-media.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(dist, "entry-media.json"), JSON.stringify({ ...media, studioContent: file }));
}

if (values.build || !existsSync(join(dist, "admin/wardrobe.html"))) {
  const t0 = performance.now();
  await buildAdmin(dist);
  await buildPersonStage(dist);
  stageContent();
  console.log(`the admin pages, the stage and its content built in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith(".png")) rmSync(join(out, f));

// One GPU job at a time on this machine: another tool's headless Chrome is waited for.
for (let k = 0; ; k++) {
  const others = Bun.spawnSync(["pgrep", "-f", "[c]hrome.*headless"]).stdout.toString().trim();
  if (others === "") break;
  if (k % 30 === 0) console.log("waiting for another headless Chrome to finish");
  if (k > 1800) throw new Error("another headless Chrome ran for half an hour");
  await Bun.sleep(1000);
}

const scratch = join(process.env.SNARK_CACHE || join(homedir(), ".cache/snark"), "t");
mkdirSync(scratch, { recursive: true });
mkdirSync(join(ROOT, "var/people"), { recursive: true });
const kept = mkdtempSync(join(ROOT, "var/people/wardrobe-world-"));
const config = new Rules();
const refusedRule = config.set(rowOf("NoDinos", true)!, "True", "command line");
if (refusedRule !== "") throw new Error(refusedRule);
const dbPath = join(kept, "world.db");
const server = startServer({ port: Number(values.port), clientDir: dist, dev: true, config, dbPath, noBackups: true });
const base = `http://127.0.0.1:${server.port}`;
const people = server.host.people;
console.log(`the wardrobe page: ${base}/admin/wardrobe/`);

const faults: string[] = [];
const fault = (what: string): void => {
  console.log(`  FAIL ${what}`);
  faults.push(what);
};
const check = (what: string, got: unknown, want: unknown): void => {
  const [g, w] = [JSON.stringify(got), JSON.stringify(want)];
  console.log(`  ${g === w ? "ok  " : "FAIL"} ${what}${g === w ? "" : `: ${g}, not ${w}`}`);
  if (g !== w) faults.push(`${what}: ${g}, not ${w}`);
};
const q = (selector: string): string => `document.querySelector(${JSON.stringify(selector)})`;
const picture = join(ROOT, "client/entry/media/snark-emblem.webp");

const t0 = performance.now();
try {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome to work the page in");
  await browse(chrome, `${base}/admin/wardrobe/`, scratch, async (page: Page) => {
    const { run, press, type, choose } = page;
    const text = (selector: string): Promise<string> => run(`${q(selector)}?.textContent ?? ""`);
    const until = async (expression: string, what: string, tenths = 100): Promise<boolean> => {
      if (await page.wait(expression, tenths)) return true;
      fault(`waited ${tenths / 10} s for ${what}`);
      return false;
    };
    const said = async (words: string, tenths = 150): Promise<boolean> =>
      (await page.wait(`${q("#msg")}.textContent.startsWith(${JSON.stringify(words)})`, tenths)) || (fault(`waited for the page to say "${words}": it says "${await text("#msg")}"`), false);
    let shot = 0;
    const snap = async (name: string): Promise<void> => {
      if (!values.shots) return;
      const file = join(out, `${String(++shot).padStart(2, "0")}-${name}.png`);
      // The page is laid out at its whole height, so the fixed rail is drawn where it is on screen.
      const size = (await page.send("Page.getLayoutMetrics")).cssContentSize as { width: number; height: number };
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: Math.ceil(size.height), deviceScaleFactor: 1, mobile: false });
      await run("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      await page.shot(file);
      await page.send("Emulation.clearDeviceMetricsOverride");
      console.log(`  picture ${file}`);
    };
    /** Waits until the stage has answered every message the page sent it, after the page's own wait to send. */
    const stageTook = async (what: string): Promise<void> => {
      await Bun.sleep(400);
      if (!(await until(`document.body.dataset.stageTaken === document.body.dataset.stageSent`, `the stage to take ${what}`, 200))) return;
      check(`the stage took ${what} with no notes`, await run(`document.body.dataset.stageNotes ?? "0"`), "0");
    };
    const fileInto = async (selector: string, path: string): Promise<void> => {
      const doc = await page.send("DOM.getDocument", { depth: 1 });
      const { nodeId } = await page.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
      await page.send("DOM.setFileInputFiles", { nodeId, files: [path] });
    };
    /** Sets a slider or number field to `value` as a hand would, with its input and then its change. */
    const slide = async (selector: string, value: string): Promise<void> => {
      await run(`(() => { const e = ${q(selector)}; e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
      await run("new Promise((r) => setTimeout(r, 20))");
    };
    /** Gives the picture field a file of noise, `side` pixels a side, which a PNG cannot pack. */
    const noise = (side: number, name: string): Promise<void> =>
      run(`(async () => {
        const c = new OffscreenCanvas(${side}, ${side}), g = c.getContext("2d"), img = g.createImageData(${side}, ${side});
        let s = 7;
        for (let i = 0; i < img.data.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; img.data[i] = i % 4 === 3 ? 255 : s >>> 24; }
        g.putImageData(img, 0, 0);
        const t = new DataTransfer();
        t.items.add(new File([await c.convertToBlob({ type: "image/png" })], ${JSON.stringify(name)}, { type: "image/png" }));
        const input = document.getElementById("picture-file");
        input.files = t.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);
    const layerNames = (): Promise<string[]> => run(`[...document.querySelectorAll("#layers [data-pick-layer]")].map((b) => b.textContent)`);
    const listed = (): Promise<string[]> => run(`[...document.querySelectorAll("#editions .edition")].map((e) => e.dataset.edition + " " + e.querySelector("b").textContent + (e.classList.contains("retired") ? " (retired)" : ""))`);

    console.log("the page and the person");
    if (!(await until(`document.body.dataset.loaded === "1"`, "the store's state"))) return;
    if (!(await until(`document.body.dataset.stage === "ready" || document.body.dataset.stage === "error"`, "the stage to say it is ready", 1200))) return;
    check("the stage said ready", await run(`document.body.dataset.stage`), "ready");
    check("no edition is published yet", await listed(), []);
    check("both garments can be started from", await run(`[...document.querySelectorAll("[data-start]")].map((b) => b.dataset.start)`), ["core:tee", "core:jeans"]);
    await stageTook("the default person");
    await snap("empty");

    console.log("a draft with text, a picture and a shape");
    await press('[data-start="core:tee"]');
    if (!(await until(`!${q("#editor")}.hidden`, "the draft's editor"))) return;
    check("an unnamed draft cannot be published", [await run(`${q("#publish")}.disabled`), await text("#faults")], [true, "Give the edition a name of 1 to 40 letters."]);
    await type("#name", "Drive tee");
    for (const colour of [34, 58, 11]) await press(`[data-colour="${colour}"]`);
    await press("#has-print");
    if (!(await until(`!${q("#print")}.hidden`, "the print's sheet"))) return;
    await press('[data-add="text"]');
    await type('[data-lf="text"]', "MIAMI 26");
    await page.tab();
    await fileInto("#picture-file", picture);
    if (!(await until(`${q("#layers")}.textContent.includes("Picture: snark-emblem.webp")`, "the picture's layer"))) return;
    // The picture is put below the text, and a star is added on top.
    await press('[data-layer-down]');
    await choose("#shape-kind", "star");
    await press('[data-add="shape"]');
    check("the layers, topmost first", await layerNames(), ["Shape: star", "Text “MIAMI 26”", "Picture: snark-emblem.webp"]);
    // The star is dragged up and to the right on the sheet.
    const [x, y, w] = (await run(`(() => { const b = ${q("#sheet")}.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.width]; })()`)) as [number, number, number];
    const mouse = (kind: string, mx: number, my: number, buttons: number) => page.send("Input.dispatchMouseEvent", { type: kind, x: mx, y: my, button: kind === "mouseMoved" ? "none" : "left", buttons, clickCount: kind === "mouseMoved" ? 0 : 1 });
    await mouse("mouseMoved", x, y, 0);
    await mouse("mousePressed", x, y, 1);
    for (let k = 1; k <= 5; k++) await mouse("mouseMoved", x + (k * w * 0.3) / 5, y - (k * w * 0.32) / 5, 1);
    await mouse("mouseReleased", x + w * 0.3, y - w * 0.32, 0);
    await run("new Promise((r) => setTimeout(r, 50))");
    const star = (await run(`[${q('[data-lf="x"]')}.value, ${q('[data-lf="y"]')}.value].map(Number)`)) as [number, number];
    check("the star was dragged to the upper right", [star[0] > 0.75 && star[0] < 0.85, star[1] > 0.13 && star[1] < 0.23], [true, true]);
    await slide('[data-lf="w"]', "0.22");
    await slide('[data-pf="scale"]', "1.2");
    check("the draft can be published", [await run(`${q("#publish")}.disabled`), await text("#faults")], [false, ""]);
    await stageTook("the draft, its print and its wardrobe");
    check("the page says the stage holds the garment but cannot draw it yet", await text("#stage-note"), "The person holds the garment and its print, but draws neither until the garment's cut is made.");
    await snap("draft");
    await press("#stage-picture");
    if (await until(`document.body.dataset.pictures === "1"`, "the stage's picture", 300)) {
      // What the button gave the browser to save, read back from the address it made.
      const sent = (await run(`fetch(document.body.dataset.picture).then((r) => r.arrayBuffer()).then((b) => { let s = ""; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s); })`)) as string;
      const bytes = Buffer.from(sent, "base64");
      if (values.shots) writeFileSync(join(out, "stage-picture.png"), bytes);
      check("the picture button saved a PNG of the person", [bytes[1] === 0x50 && bytes.length > 10000, bytes.length > 24 ? bytes.readUInt32BE(16) : 0], [true, 720]);
    }

    console.log("published");
    await press("#publish");
    await said("Published edition 1.");
    let view = people.view();
    const first = view.editions[0];
    check("the store has the edition as drafted", first && { name: first.name, garment: first.garment, colours: first.colours, side: [first.print?.width, first.print?.height], scale: first.print?.place.scale }, { name: "Drive tee", garment: "core:tee", colours: [34, 58, 11], side: [512, 512], scale: 1.2 });
    if (first?.print) {
      const r = await fetch(`${base}${printPath(first.print.hash)}`);
      check("its print is served", [r.status, r.headers.get("content-type")], [200, "image/png"]);
    }
    check("the draft is put away", await run(`${q("#editor")}.hidden`), true);
    await stageTook("the published edition");
    check("the new edition is picked and shown on the person", [await listed(), await run(`${q(".edition.picked")}?.dataset.edition`), await text("#showing")], [["1 Drive tee"], "1", "Wearing edition 1"]);
    await snap("published");

    console.log("a publish another admin made first");
    await press('[data-copy="1"]');
    if (!(await until(`${q("#name")}.value === "Drive tee copy"`, "a copy of edition 1"))) return;
    await until(`${q("#layers")}.textContent.includes("edition 1's print")`, "edition 1's print as the copy's picture");
    await type("#name", "Drive tee two");
    await press('[data-colour="0"]');
    const outside = await fetch(`${base}/admin/people/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ revision: people.view().revision, garment: "core:jeans", colours: [0, 0, 0], name: "Outside trousers" }),
    });
    check("the other admin's publish was taken", outside.status, 200);
    await press("#publish");
    await said(`Not saved: Another admin published edition 2 "Outside trousers" since this page read it.`);
    check("the page lists the other admin's edition", await listed(), ["2 Outside trousers", "1 Drive tee"]);
    check("and keeps the draft", [await run(`${q("#editor")}.hidden`), await run(`${q("#name")}.value`), await layerNames(), await run(`${q("#publish")}.disabled`)], [false, "Drive tee two", ["Picture: edition 1's print"], false]);
    check("the store did not take the stale publish", people.view().editions.length, 2);
    await stageTook("the kept draft");
    check("the person wears the draft", await text("#showing"), "Wearing the draft");
    await snap("conflict");
    await press("#publish");
    await said("Published edition 3.");
    view = people.view();
    check("published over the newer revision", view.editions.map((e) => `${e.id} ${e.name} ${e.colours.join(",")}`), ["1 Drive tee 34,58,11", "2 Outside trousers 0,0,0", "3 Drive tee two 0,58,11"]);
    check("the copy kept edition 1's print size and place", [view.byId.get(3)?.print?.width, view.byId.get(3)?.print?.place.scale], [512, 1.2]);

    console.log("a store too busy for a while");
    await press('[data-start="core:jeans"]');
    await type("#name", "Busy trousers");
    const lock = new Database(`${dbPath}.people.sqlite`);
    lock.exec("BEGIN IMMEDIATE");
    let held = true;
    try {
      await press("#publish");
      if (await page.wait(`${q("#msg")}.textContent.startsWith("The store is busy.")`, 50)) console.log("  ok   the page said the store is busy and tried again");
      else fault(`the page did not say the store is busy: it says "${await text("#msg")}"`);
      await Bun.sleep(900);
      lock.exec("ROLLBACK");
      held = false;
    } finally {
      if (held) lock.exec("ROLLBACK");
      lock.close();
    }
    await said("Published edition 4.");
    check("the busy publish went in once", people.view().editions.map((e) => e.name), ["Drive tee", "Outside trousers", "Drive tee two", "Busy trousers"]);
    await snap("busy-then-published");

    console.log("the page read again");
    await run("window.before = true");
    await page.send("Page.reload");
    if (!(await until(`!window.before && document.body?.dataset.loaded === "1"`, "the store's state after the reload"))) return;
    check("every edition is listed, newest first", await listed(), ["4 Busy trousers", "3 Drive tee two", "2 Outside trousers", "1 Drive tee"]);
    check("each print's picture is shown", await run(`[...document.querySelectorAll("#editions .edition")].map((e) => !!e.querySelector("img"))`), [false, true, false, true]);
    await until(`document.body.dataset.stage === "ready"`, "the stage after the reload", 1200);
    await press('[data-show="3"]');
    await stageTook("edition 3 by its published print");
    await snap("reloaded");

    console.log("retired and brought back");
    await press('[data-retire="1"]');
    await said("Retired edition 1.");
    check("the store has edition 1 retired, and still serves it", [[...people.view().retired], people.view().editions.length], [[1], 4]);
    check("the page marks it", (await listed()).at(-1), "1 Drive tee (retired)");
    check("its button brings it back", await text('[data-retire="1"]'), "Bring back");
    await snap("retired");
    await press('[data-retire="1"]');
    await said("Edition 1 is back on the pick list.");
    check("the store has no edition retired", [...people.view().retired], []);
    check("the page shows it so", (await listed()).at(-1), "1 Drive tee");

    console.log("a big picture brought under the cap");
    await press('[data-start="core:tee"]');
    await type("#name", "Noise tee");
    await press("#has-print");
    // A big picture is shrunk as it is read; it is taken off again.
    await noise(2048, "big-noise.png");
    await said("big-noise.png was 2048 × 2048; it is held at 1024 × 1024.");
    await press("[data-layer-del]");
    // Noise drawn pixel for pixel over the whole sheet: its PNG is over the cap.
    await noise(512, "noise.png");
    await said("Added noise.png.");
    await slide('[data-lf="w"]', "1");
    await press("#publish");
    await said("Published edition 5.", 300);
    const fitted = people.view().byId.get(5)?.print;
    check("the print was saved smaller, still square", !!fitted && fitted.width < 512 && fitted.width === fitted.height, true);
    const note = await text("#fit-note");
    check("and the page said so", /^The print was \d+ KB at 512 × 512, over the 640 KB a print may be, so it was saved at \d+ × \d+ \(\d+ KB\)\.$/.test(note), true);
    console.log(`  ${note}`);
    await stageTook("the fitted edition");
    await snap("fitted");

    // The publish another admin came before was refused with 409, and the busy store's with 503, which a browser logs.
    const expected = (e: string): boolean => (e.includes("409") || e.includes("503")) && e.endsWith("/admin/people/publish");
    check("the page raised no error but the refused publishes", page.errors.filter((e) => !expected(e)), []);
  });
} catch (err) {
  fault(err instanceof Error ? err.message : String(err));
} finally {
  server.stop();
  rmSync(kept, { recursive: true, force: true });
}
console.log(faults.length === 0 ? `the wardrobe page did all that was asked of it in ${((performance.now() - t0) / 1000).toFixed(1)} s` : `${faults.length} things went wrong:\n${faults.map((f) => `  ${f}`).join("\n")}`);
process.exit(faults.length === 0 ? 0 : 1);
