// The people and populations admin pages worked in headless Chrome against a development world, as an admin works them.
// People: a person made with one part locked and others drawn again, dressed, saved, refused once over another page's
// save, and bound to a Cast role, which the people page and the Cast page then show. Populations: a built-in population
// copied; a shirt added to its outfits, which changes no face on the sheet of 24 (by the look bytes the page holds and by
// the pictures' heads); a save refused once and taken; and one person promoted and saved as a named person. Each act is
// judged by what the store then holds. Fails on any fault. --shots saves pictures under artifacts/people/pages/.
//
//   bun tools/people/pages-drive.ts [--only people|populations] [--dist var/people/dist] [--out artifacts/people/pages] [--port 8794] [--shots] [--build]
//
// The dist is a built client. --build (or a dist without the pages) makes the admin pages, the stage's page and script,
// and the stage's content again in it alone.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { brotliCompressSync } from "node:zlib";
import { startServer } from "../../server/main.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { Rules } from "../../server/settings/rules.ts";
import { PART_NAMES, type PersonDoc } from "../../shared/people/doc.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { partsChanged } from "../../client/core/admin/people.ts";
import { buildAdmin } from "../build-admin.ts";
import { buildPersonStage, studioContent } from "../build-entry.ts";
import { findChrome } from "../chrome.ts";
import { browse, type Page } from "../loadout/drive.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({
  options: {
    only: { type: "string" }, dist: { type: "string", default: join(ROOT, "var/people/dist") }, out: { type: "string", default: join(ROOT, "artifacts/people/pages") },
    port: { type: "string", default: "8794" }, shots: { type: "boolean" }, build: { type: "boolean" },
  },
});
const dist = resolve(values.dist!), out = resolve(values.out!);
const parts = values.only ? [values.only] : ["people", "populations"];
if (!parts.every((p) => p === "people" || p === "populations")) throw new Error("--only is people or populations");
if (!existsSync(join(dist, "assets/manifest.json"))) throw new Error(`${dist} is not a built client: bun tools/build-client.ts --quick --dist ${dist}`);

/** The stage's content as this checkout has it, so it knows the garments and armour the server offers. */
function stageContent(): void {
  const bytes = new TextEncoder().encode(JSON.stringify(studioContent(CORE_CONTENT)));
  const file = `assets/studio-content.${new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16)}.json`;
  writeFileSync(join(dist, file), bytes);
  writeFileSync(join(dist, `${file}.br`), brotliCompressSync(bytes));
  const media = JSON.parse(readFileSync(join(dist, "entry-media.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(dist, "entry-media.json"), JSON.stringify({ ...media, studioContent: file }));
}

if (values.build || !existsSync(join(dist, "admin/people.html")) || !existsSync(join(dist, "admin/populations.html"))) {
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
const kept = mkdtempSync(join(ROOT, "var/people/pages-world-"));
const config = new Rules();
const refusedRule = config.set(rowOf("NoDinos", true)!, "True", "command line");
if (refusedRule !== "") throw new Error(refusedRule);
const server = startServer({ port: Number(values.port), clientDir: dist, dev: true, config, dbPath: join(kept, "world.db"), noBackups: true });
const base = `http://127.0.0.1:${server.port}`;
const people = server.host.people;

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
const unhex = (h: string): Uint8Array => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const latest = (kind: "person" | "population", id: number) => people.view().records[kind].get(id)?.at(-1);
const outside = (body: object): Promise<Response> => fetch(`${base}/admin/people/save`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });

const t0 = performance.now();
try {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome to work the pages in");
  await browse(chrome, `${base}/admin/${parts[0]}/`, scratch, async (page: Page) => {
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
      const size = (await page.send("Page.getLayoutMetrics")).cssContentSize as { width: number; height: number };
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: Math.ceil(size.height), deviceScaleFactor: 1, mobile: false });
      await run("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      await page.shot(file);
      await page.send("Emulation.clearDeviceMetricsOverride");
      console.log(`  picture ${file}`);
    };
    const goto = async (path: string, loaded = `document.body?.dataset.loaded === "1"`): Promise<boolean> => {
      await run("window.before = true");
      await page.send("Page.navigate", { url: `${base}${path}` });
      return until(`!window.before && ${loaded}`, `${path} to load`);
    };
    const stageReady = (): Promise<boolean> => until(`document.body.dataset.stage === "ready" || document.body.dataset.stage === "error"`, "the stage to say it is ready", 1200);
    /** Waits until the stage has answered all the page sent it, after the page's own wait to send. */
    const stageTook = async (what: string): Promise<void> => {
      await Bun.sleep(500);
      if (!(await until(`document.body.dataset.stageTaken === document.body.dataset.stageSent`, `the stage to take ${what}`, 300))) return;
      check(`the stage took ${what} with no notes`, await run(`document.body.dataset.stageNotes ?? "0"`), "0");
    };
    const previewed = async (): Promise<Uint8Array> => {
      await stageTook("the look");
      return unhex(await run(`document.body.dataset.previewed ?? ""`));
    };
    /** What a part is now, without the seed of its own a locked part shows. */
    const partText = async (part: string): Promise<string> => (await text(`tr[data-part="${part}"] td.now`)).split(" seed ")[0]!;

    if (parts.includes("people")) {
      console.log("the people page");
      if (parts[0] !== "people" && !(await goto("/admin/people/"))) return;
      if (!(await until(`document.body.dataset.loaded === "1"`, "the store's state"))) return;
      if (!(await stageReady())) return;
      check("the stage said ready", await run(`document.body.dataset.stage`), "ready");
      await until(`Number(document.body.dataset.castRead ?? 0) > 0`, "the world's Cast");
      check("nobody is named yet", await run(`document.querySelectorAll("#people .named").length`), 0);
      await snap("people-empty");

      console.log("a person drawn, a part locked, parts drawn again alone");
      await press("#new-person");
      if (!(await until(`!${q("#editor")}.hidden`, "the editor"))) return;
      check("an unnamed person cannot be saved", [await run(`${q("#save")}.disabled`), await text("#faults")], [true, "Give the person a name of 1 to 40 letters."]);
      await type("#name", "Rosa Diaz");
      check("a named person can be saved", [await run(`${q("#save")}.disabled`), await text("#faults")], [false, ""]);
      const first = await previewed();
      await press('[data-lock="face"]');
      const face = await partText("face");
      await press('[data-reroll="hair"]');
      const hair = await previewed();
      check("drawing the hair again changed nothing but the hair", partsChanged(first, hair).every((p) => p === "hair"), true);
      await press("#draw-again");
      const again = await previewed();
      const moved = partsChanged(hair, again);
      // Hair is drawn by the sex's own weights, so a locked hair keeps only while the sex does.
      check("a new seed kept the locked face and hair, and moved the rest", [moved.includes("face"), moved.includes("hair") && !moved.includes("sex"), moved.includes("body"), await partText("face")], [false, false, true, face]);
      // A hand control fixes the bytes; going back gives the seed form again.
      await press('[data-hand-pick="skin"][data-value="7"]');
      check("a skin tone set by hand fixes the look", [(await text("#look-mode")).startsWith("Fixed by hand"), (await previewed())[23]], [true, 7]);
      await press("#back-to-drawn");
      check("and back to the seed, the look is as it was", [...(await previewed())], [...again]);
      console.log("dressed in its own wardrobe");
      await press('input[name="dress"][value="wardrobe"]');
      await choose('[data-slot-garment="0"]', "core:plain_tee");
      await press('[data-well="0:0"]');
      await press('[data-colour="34"]');
      await stageTook("the wardrobe");
      check("the wardrobe's top is the dyed tee", await run(`${q('[data-slot-garment="0"]')}.value`), "core:plain_tee");
      await snap("people-draft");

      console.log("saved, and refused once over another page's save");
      await press("#save");
      await said("Saved person 1, revision 1.");
      const saved = latest("person", 1)?.body as PersonDoc | undefined;
      const look = saved?.look as { seed?: number; locks?: Record<string, number> } | undefined;
      check("the store has the person as drafted", saved && { name: saved.name, seedForm: look?.seed !== undefined, locked: Object.keys(look?.locks ?? {}).sort(), top: saved.wardrobe?.[0] }, { name: "Rosa Diaz", seedForm: true, locked: ["face", "hair"], top: { garment: "core:plain_tee", edition: 0, dye: [34, 0, 0] } });
      const theirs = await outside({ kind: "person", id: 1, rev: 1, doc: { ...saved, notes: "from another page" } });
      check("the other page's save was taken", theirs.status, 200);
      await type("#notes", "Sells mangoes by the bay");
      await press("#save");
      await said("Not saved: The person 1 was saved in another page.");
      check("the page kept the draft", await run(`${q("#notes")}.value`), "Sells mangoes by the bay");
      await snap("people-conflict");
      await press("#save");
      await said("Saved person 1, revision 3.");
      check("the store took the page's notes over the other's", (latest("person", 1)?.body as PersonDoc | undefined)?.notes, "Sells mangoes by the bay");

      console.log("bound to a Cast role");
      const key = "cast:cart_queue/vendor";
      if (!(await run(`[...${q("#role")}.options].some((o) => o.value === ${JSON.stringify(key)})`))) fault(`the role list offers no ${key}`);
      await choose("#role", key);
      const reads = Number(await run(`document.body.dataset.castRead`));
      await press("#bind");
      await said("Rosa Diaz plays the Food cart vendor when the role is free.");
      await until(`Number(document.body.dataset.castRead) > ${reads}`, "Cast read again");
      check("Cast holds the role for the person", server.host.cast.cast.casting.roles[key], 1);
      check("the page lists the role it plays", [await run(`[...document.querySelectorAll("#cast [data-plays]")].map((e) => e.dataset.plays)`), await run(`[...${q("#role")}.options].find((o) => o.value === ${JSON.stringify(key)}).textContent.endsWith("(this person)")`)], [[key], true]);
      await snap("people-bound");
      if (await goto("/admin/worlds/local/cast/", `${q(`[data-role="${key}"]`)}`)) {
        check("the Cast page shows the person in the role", await run(`(() => { const s = ${q(`[data-role="${key}"]`)}; return [s.value, s.selectedOptions[0].textContent]; })()`), ["1", "Rosa Diaz (1)"]);
        await snap("cast-page");
      }
      // Let go through the people page, and bound again for the world after.
      if (await goto("/admin/people/?id=1")) {
        await until(`Number(document.body.dataset.castRead ?? 0) > 0 && ${q(`[data-letgo="${key}"]`)}`, "the role it plays");
        await press(`[data-letgo="${key}"]`);
        await said("Let go of the Food cart vendor");
        check("Cast let the role go", server.host.cast.cast.casting.roles[key], undefined);
        await choose("#role", key);
        await press("#bind");
        await said("Rosa Diaz plays the Food cart vendor");
        check("and holds it again", server.host.cast.cast.casting.roles[key], 1);
      }
    }

    if (parts.includes("populations")) {
      console.log("the populations page");
      if (parts[0] !== "populations" && !(await goto("/admin/populations/"))) return;
      if (!(await until(`document.body.dataset.loaded === "1"`, "the store's state"))) return;
      if (!(await stageReady())) return;
      const gen = async (): Promise<number> => Number(await run(`document.body.dataset.sheetGen ?? 0`));
      /** Waits for the sheet drawn after generation `after`, past the page's wait to draw it. */
      const drawn = async (what: string, after: number, tenths = 1200): Promise<boolean> => {
        await Bun.sleep(500);
        return until(`Number(document.body.dataset.sheetGen ?? 0) > ${after} && document.body.dataset.sheetDrawn === document.body.dataset.sheetGen && document.querySelectorAll(".card img").length === 24`, what, tenths);
      };
      if (!(await drawn("the city crowd's sheet", 0))) return;
      check("a built-in population is read only", [await run(`${q("#label")}.disabled`), await run(`!${q("#read-only")}.hidden`)], [true, true]);
      await snap("populations-built-in");

      console.log("copied, and a shirt added: no face changes");
      let g = await gen();
      await press('[data-copy="core:people_city"]');
      await said("Copied core:people_city as population 1.");
      check("the store has the copy", (latest("population", 1)?.body as { label?: string } | undefined)?.label, "City crowd copy");
      if (!(await drawn("the copy's sheet", g))) return;
      g = await gen();
      await choose("#framing", "portrait");
      if (!(await drawn("the copy's sheet, as portraits", g))) return;
      const cards = (): Promise<{ seed: number; look: string; wear: string }[]> => run(`[...document.querySelectorAll(".card")].map((c) => ({ seed: Number(c.dataset.seed), look: c.dataset.look, wear: c.dataset.wear }))`);
      const before = await cards();
      await run(`(async () => { window.beforePictures = await Promise.all([...document.querySelectorAll(".card img")].map((i) => fetch(i.src).then((r) => r.blob()))); })()`);
      g = await gen();
      await press("#add-outfit");
      await until(`${q('[data-add-piece="0"]')}`, "the new outfit");
      await choose('[data-add-piece="0"]', "core:cloth_shirt");
      await press('[data-piece-off="0"][data-piece="core:plain_tee"]');
      check("the outfit wears the shirt alone", await run(`[...document.querySelectorAll('[data-outfit="0"] [data-piece]')].map((b) => b.dataset.piece)`), ["core:cloth_shirt"]);
      if (!(await drawn("the sheet with the shirt", g))) return;
      const after = await cards();
      const changed = before.map((b, k) => partsChanged(unhex(b.look), unhex(after[k]!.look)));
      check("the sheet kept its 24 seeds", after.map((c) => c.seed), before.map((c) => c.seed));
      check("no part of any look changed", changed.flat(), []);
      check("every look's face, body, skin and hair bytes are the same", after.every((c, k) => c.look === before[k]!.look), true);
      check("everyone wears the shirt now", after.every((c) => c.wear === "core:cloth_shirt"), true);
      check("the page marks clothes changed and no look changed", [await run(`document.querySelectorAll(".chip.moved").length`), await run(`document.querySelectorAll(".chip.rewear").length`)], [0, 24]);
      // The heads in the pictures: the top half of each portrait, against its picture before the shirt.
      const diffs = (await run(`(async () => {
        const read = async (b) => { const i = await createImageBitmap(b); const c = new OffscreenCanvas(i.width, i.height), g = c.getContext("2d"); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height); };
        const now = await Promise.all([...document.querySelectorAll(".card img")].map((i) => fetch(i.src).then((r) => r.blob())));
        const out = [];
        for (let k = 0; k < now.length; k++) {
          const a = await read(window.beforePictures[k]), b = await read(now[k]);
          let head = 0, all = 0;
          const rows = Math.floor(a.height * 0.5);
          for (let i = 0; i < a.data.length; i += 4) {
            const d = (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3;
            all += d;
            if (i / 4 < rows * a.width) head += d;
          }
          out.push([head / (rows * a.width), all / (a.width * a.height)]);
        }
        return out;
      })()`)) as [number, number][];
      const head = Math.max(...diffs.map((d) => d[0])), whole = Math.max(...diffs.map((d) => d[1]));
      console.log(`  heads differ by at most ${head.toFixed(2)} of 255 a pixel on average; whole pictures by up to ${whole.toFixed(2)}`);
      check("no head in the pictures changed", head < 1.5, true);
      check("the shirt shows in the pictures", whole > head, true);
      await snap("populations-shirt-portraits");
      g = await gen();
      await choose("#framing", "full");
      if (!(await drawn("the sheet at full length", g))) return;
      await snap("populations-shirt");

      console.log("saved, refused once, saved again");
      await press("#save");
      await said("Saved population 1, revision 2.");
      check("the store has the shirt", (latest("population", 1)?.body as { outfits?: unknown } | undefined)?.outfits, [{ wear: ["core:cloth_shirt"], weight: 1 }]);
      const theirs = await outside({ kind: "population", id: 1, rev: 2, doc: { ...(latest("population", 1)!.body as object), label: "Their crowd" } });
      check("the other page's save was taken", theirs.status, 200);
      await run(`(() => { const e = ${q('[data-share="women"]')}; e.value = "0.7"; e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
      await press("#save");
      await said("Not saved: The population 1 was saved in another page.");
      check("the edit is kept", await run(`${q('[data-share="women"]')}.value`), "0.7");
      g = await gen();
      await press("#save");
      await said("Saved population 1, revision 4.");
      check("the store has the page's edit", (latest("population", 1)?.body as { women?: number } | undefined)?.women, 0.7);
      if (!(await drawn("the saved sheet", g))) return;

      console.log("one promoted to a named person");
      const pick = (await cards())[5]!;
      await press('[data-promote="5"]');
      if (!(await until(`location.pathname === "/admin/people/" && document.body.dataset.loaded === "1"`, "the people page"))) return;
      await said("Promoted from a population's sheet");
      await stageReady();
      check("the promoted look is the sheet's person", Buffer.from(await previewed()).toString("hex"), pick.look);
      check("every part is locked", await run(`[...document.querySelectorAll("[data-lock]")].filter((c) => c.checked).length`), PART_NAMES.length);
      await type("#name", "Sheet person");
      const id = people.view().records.person.size + 1;
      await press("#save");
      await said(`Saved person ${id}, revision 1.`);
      const promoted = latest("person", id)?.body as PersonDoc | undefined;
      check("the store has it drawn in population 1 at revision 4", promoted && "seed" in promoted.look ? [promoted.look.seed, promoted.look.population, promoted.look.revision, Object.keys(promoted.look.locks).length] : null, [pick.seed, 1, 4, PART_NAMES.length]);
      await snap("people-promoted");
    }

    // A save another page came before is refused with 409, which a browser logs.
    const expected = (e: string): boolean => e.includes("409") && e.endsWith("/admin/people/save");
    check("the pages raised no error but the refused saves", page.errors.filter((e) => !expected(e)), []);
  });
} catch (err) {
  fault(err instanceof Error ? err.message : String(err));
} finally {
  server.stop();
  rmSync(kept, { recursive: true, force: true });
}
console.log(faults.length === 0 ? `the ${parts.join(" and ")} pages did all that was asked of them in ${((performance.now() - t0) / 1000).toFixed(1)} s` : `${faults.length} things went wrong:\n${faults.map((f) => `  ${f}`).join("\n")}`);
process.exit(faults.length === 0 ? 0 : 1);
