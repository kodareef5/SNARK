// The person stage (client/entry/person-stage.ts) worked in headless Chrome from a small parent page, as an admin page
// will work it: a look, gear, a wardrobe with a print, poses, hours and framings, each answered, and pictures saved.
// A page on another origin posts to a second stage, which must take none of it. Fails on any fault.
//
//   bun tools/people/stage-drive.ts [--dist var/people/dist] [--out artifacts/people/stage] [--build]
//
// The dist is a built client (bun tools/build-client.ts --quick --dist var/people/dist); --build makes the stage's page
// and script again in it alone.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { serveFile } from "../../server/files.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { personFrom, populationsOf, sexOf } from "../../shared/people/person.ts";
import { STAGE_FROM, STAGE_TO, stageMessage, type StageCommand } from "../../shared/people/stage.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { buildPersonStage } from "../build-entry.ts";
import { findChrome } from "../chrome.ts";
import { browse, type Page } from "../loadout/drive.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({ options: { dist: { type: "string", default: join(ROOT, "var/people/dist") }, out: { type: "string", default: join(ROOT, "artifacts/people/stage") }, build: { type: "boolean" } } });
const dist = resolve(values.dist!), out = resolve(values.out!);
if (!existsSync(join(dist, "assets/manifest.json"))) throw new Error(`${dist} is not a built client: bun tools/build-client.ts --quick --dist ${dist}`);
if (values.build || !existsSync(join(dist, "person-stage.js"))) {
  const t0 = performance.now();
  await buildPersonStage(dist);
  console.log(`the stage built in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
mkdirSync(out, { recursive: true });

/** The parent page: the stage in an iframe, a `send` that posts to it, and each answer kept, pictures as base64. */
const parentPage = (stage: string, foreign: string | null): string => `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">
<style>body{margin:0;background:#222}iframe{border:0;width:900px;height:1100px}</style>
<iframe id="stage" src="${stage}"></iframe>${foreign ? `<iframe id="foreign" src="${foreign}" style="width:300px;height:300px"></iframe>` : ""}
<script>
window.answers = [];
addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data || e.data.from !== ${JSON.stringify(STAGE_FROM)}) return;
  const a = e.data;
  if (a.kind !== "picture") return answers.push(a);
  const reader = new FileReader();
  reader.onload = () => answers.push({ ...a, png: String(reader.result).split(",")[1] });
  reader.readAsDataURL(a.png);
});
window.send = (m) => document.getElementById("stage").contentWindow.postMessage(m, location.origin);
</script>`;
/** A page on another origin that holds a stage and posts to it as its parent would. */
const foreignPage = (stage: string): string => `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">
<iframe id="stage" src="${stage}" style="width:280px;height:280px;border:0"></iframe>
<script>
setInterval(() => document.getElementById("stage").contentWindow.postMessage({ to: ${JSON.stringify(STAGE_TO)}, kind: "hour", hour: 3, id: 99 }, "*"), 500);
</script>`;

const html = (text: string): Response => new Response(text, { headers: { "content-type": "text/html; charset=utf-8" } });
const origins = { home: "", away: "" };
const home = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req): Response | Promise<Response> => (new URL(req.url).pathname === "/parent.html" ? html(parentPage("/person-stage.html", `${origins.away}foreign.html`)) : serveFile(dist, req)) });
const away = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req): Response => (new URL(req.url).pathname === "/foreign.html" ? html(foreignPage(`${origins.home}person-stage.html`)) : new Response("", { status: 404 })) });
origins.home = String(home.url);
origins.away = String(away.url);

const reg = compileContent(CORE_CONTENT).registry!;
const people = populationsOf(reg).list;
const city = people.find((p) => p.id === "core:people_city")!;
let seed = 11;
while (sexOf(seed, city) !== 1) seed++;
const woman = personFrom(seed, city).look;

const faults: string[] = [];
let next = 0;
/** Posts `c` and waits for the stage's answer to it, `kind` "applied" or "picture". */
async function ask(page: Page, c: StageCommand, tenths = 150): Promise<any> {
  const id = ++next;
  await page.run(`send(${JSON.stringify({ ...stageMessage({ ...c, id }), ...(c.kind === "look" ? { look: [...c.look] } : {}) })})`);
  if (!(await page.wait(`answers.some((a) => a.id === ${id})`, tenths))) {
    faults.push(`no answer to ${c.kind} (#${id})`);
    return null;
  }
  const answer = await page.run(`answers.find((a) => a.id === ${id})`);
  if (answer.kind === "applied" && answer.notes.length) faults.push(`${c.kind} was taken with notes: ${answer.notes.join("; ")}`);
  return answer;
}
async function picture(page: Page, name: string): Promise<void> {
  const a = await ask(page, { kind: "picture", width: 720, height: 900 }, 600);
  if (!a || a.kind !== "picture") return void faults.push(`no picture for ${name}`);
  const file = join(out, `${name}.png`);
  writeFileSync(file, Buffer.from(a.png, "base64"));
  console.log(`  ${name}: ${a.width} x ${a.height}, ${file}`);
}

const chrome = findChrome();
if (!chrome) throw new Error("no Chrome to work the stage in");
const scratch = join(process.env.SNARK_CACHE || join(homedir(), ".cache/snark"), "t");
mkdirSync(scratch, { recursive: true });
const kept = mkdtempSync(join(scratch, "stage-"));
const t0 = performance.now();
try {
  await browse(chrome, `${home.url}parent.html`, kept, async (page) => {
    if (!(await page.wait(`window.answers && answers.some((a) => a.kind === "ready" || a.kind === "error")`, 1200))) throw new Error("the stage said nothing in two minutes");
    const first = await page.run(`answers.find((a) => a.kind === "ready" || a.kind === "error")`);
    if (first.kind === "error") throw new Error(`the stage could not draw: ${first.detail}`);
    console.log(`ready in ${((performance.now() - t0) / 1000).toFixed(1)} s, drawing ${first.meshes.join(", ")}`);
    await picture(page, "01-default-three-quarter");

    await ask(page, { kind: "look", look: woman });
    await ask(page, { kind: "print", key: "draft-tee", url: "/title/snark-emblem.webp", png: null });
    const wardrobe = await ask(page, { kind: "wardrobe", slots: [null, { item: "core:cloth_shirt", edition: 0, dye: [12, 40, 200], print: { key: "draft-tee", place: { u: 0.06, v: 0.12, w: 0.25, h: 0.2, scale: 1, turn: 0 } } }, null, null, null], hide: 0 });
    const prints = await page.run(`answers.find((a) => a.of === "print")`);
    if (!prints?.held?.prints?.[0]?.width) faults.push("the print's picture was not decoded");
    else console.log(`  print held: ${JSON.stringify(prints.held.prints)}; wardrobe held: ${JSON.stringify(wardrobe?.held)}`);
    await ask(page, { kind: "pose", pose: "walk", at: 0.25 });
    await ask(page, { kind: "framing", framing: "full" });
    await picture(page, "02-woman-walk-full");

    await ask(page, { kind: "gear", held: "core:pick", armor: [null, "core:cloth_shirt", null, "core:cloth_pants", "core:cloth_boots"] });
    await ask(page, { kind: "pose", pose: "tool", at: 0 });
    await ask(page, { kind: "framing", framing: "three-quarter" });
    await picture(page, "03-cloth-pick-three-quarter");

    await ask(page, { kind: "framing", framing: "portrait" });
    await ask(page, { kind: "hour", hour: 18.5 });
    await picture(page, "04-portrait-dusk");

    await ask(page, { kind: "gear", held: null, armor: [null, null, null, null, null] });
    await ask(page, { kind: "hour", hour: 11 });
    await ask(page, { kind: "pose", pose: "seated", at: 0.5 });
    await ask(page, { kind: "framing", framing: "back" });
    await picture(page, "05-seated-back");

    // Malformed, and from another origin: neither is answered, and each is counted as ignored.
    const ignored = (frame: string): string => `Number(${frame}.document.body.dataset.ignored ?? 0)`;
    const stage = `document.getElementById("stage").contentWindow`;
    const before = await page.run(ignored(stage));
    await page.run(`send({ to: ${JSON.stringify(STAGE_TO)}, kind: "look", look: [1, 2, 3], id: 500 })`);
    if (!(await page.wait(`${ignored(stage)} > ${before}`, 50))) faults.push("a malformed look was not ignored");
    if (await page.run(`answers.some((a) => a.id === 500)`)) faults.push("a malformed look was answered");
    // The other origin's stage is reached through its parent's frames, which a page may index across origins.
    const foreign = `frames[1].frames[0]`;
    if (!(await page.wait(`(() => { try { return ${ignored(foreign)} >= 2; } catch { return false; } })()`, 600))) faults.push("the other origin's messages were not ignored");
    else if (await page.run(`${foreign}.document.body.dataset.ready !== "1"`)) faults.push("the other origin's stage did not draw");
    else console.log(`  the other origin's stage ignored ${await page.run(ignored(foreign))} messages`);
    for (const e of page.errors) faults.push(`page error: ${e}`);
  });
} finally {
  home.stop(true);
  away.stop(true);
  rmSync(kept, { recursive: true, force: true });
}
console.log(faults.length === 0 ? `the stage did all that was asked of it in ${((performance.now() - t0) / 1000).toFixed(1)} s` : `${faults.length} things went wrong:\n${faults.map((f) => `  ${f}`).join("\n")}`);
process.exit(faults.length === 0 ? 0 : 1);
