// What an admin places is what the world shows, in real Chrome against a development world. On the Wardrobe page a tee's
// draft gets a print no turn or mirror leaves alike: a red box at its upper left, a blue box at its lower right and a
// yellow R between. The person stage's picture of the draft is kept; the edition is published, the page loaded again and
// the edition reopened on the stage, pictured; then a survivor in a second page wears the edition, and a third page's
// survivor looks at its chest, pictured. In each picture the red box must be left of and above the blue one, as on the
// sheet, and the print on the middle of the chest. Fails on any fault. Pictures go to var/people/truth/.
//
//   bun tools/people/print-truth-drive.ts [--dist var/people/dist] [--out var/people/truth] [--port 8794] [--seconds 40]
//
// The dist is a built client (bun tools/build-client.ts --quick --dist var/people/dist); the admin pages, the stage and
// its content are built in it again here.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { brotliCompressSync } from "node:zlib";
import { startServer } from "../../server/main.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { Rules } from "../../server/settings/rules.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { buildAdmin } from "../build-admin.ts";
import { buildPersonStage, studioContent } from "../build-entry.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { browse, type Page } from "../loadout/drive.ts";
import { readPng } from "../pack/png-read.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({
  options: { dist: { type: "string", default: join(ROOT, "var/people/dist") }, out: { type: "string", default: join(ROOT, "var/people/truth") }, port: { type: "string", default: "8794" }, seconds: { type: "string", default: "40" } },
});
const dist = resolve(values.dist!), out = resolve(values.out!);
if (!existsSync(join(dist, "assets/manifest.json"))) throw new Error(`${dist} is not a built client: bun tools/build-client.ts --quick --dist ${dist}`);

{
  await buildAdmin(dist);
  await buildPersonStage(dist);
  const bytes = new TextEncoder().encode(JSON.stringify(studioContent(CORE_CONTENT)));
  const file = `assets/studio-content.${new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16)}.json`;
  writeFileSync(join(dist, file), bytes);
  writeFileSync(join(dist, `${file}.br`), brotliCompressSync(bytes));
  const media = JSON.parse(readFileSync(join(dist, "entry-media.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(dist, "entry-media.json"), JSON.stringify({ ...media, studioContent: file }));
}
mkdirSync(out, { recursive: true });

const scratch = join(process.env.SNARK_CACHE || join(homedir(), ".cache/snark"), "t");
mkdirSync(scratch, { recursive: true });
mkdirSync(join(ROOT, "var/people"), { recursive: true });
const kept = mkdtempSync(join(ROOT, "var/people/truth-world-"));
const config = new Rules();
const refused = config.set(rowOf("NoDinos", true)!, "True", "command line");
if (refused !== "") throw new Error(refused);

// The wearer stands facing +z; the watcher 1.8 m in front of it, looking back at its chest.
const orders = new Map<string, { run: string[]; look: [number, number]; at?: [number, number, number] }>();
const server = startServer({
  port: Number(values.port), clientDir: dist, dev: true, config, dbPath: join(kept, "world.db"), noBackups: true,
  routes: (_req, url) => (url.pathname === "/__look" ? (orders.has(url.searchParams.get("view") ?? "") ? Response.json(orders.get(url.searchParams.get("view")!)) : new Response("no such view", { status: 404 })) : null),
});
const base = `http://127.0.0.1:${server.port}`;
const { host } = server, { world, game } = host;

const faults: string[] = [];
const check = (what: string, ok: boolean, detail = ""): void => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
  if (!ok) faults.push(`${what} ${detail}`);
};

/** Where the red and blue boxes are in a picture, as shares of its width and height, and how many pixels each covers. */
function boxes(file: string): { red: [number, number, number]; blue: [number, number, number] } {
  const img = readPng(file), c = img.channels;
  const sum = { red: [0, 0, 0], blue: [0, 0, 0] };
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * c, r = img.data[i]!, g = img.data[i + 1]!, b = img.data[i + 2]!;
    const k = r > 140 && g < 70 && b < 70 && r > 2.2 * Math.max(g, b) ? "red" : b > 120 && r < 60 && g < 90 && b > 1.8 * Math.max(r, g) ? "blue" : null;
    if (!k) continue;
    sum[k][0]! += x;
    sum[k][1]! += y;
    sum[k][2]!++;
  }
  const of = (s: number[]): [number, number, number] => [s[0]! / Math.max(1, s[2]!) / img.width, s[1]! / Math.max(1, s[2]!) / img.height, s[2]!];
  return { red: of(sum.red), blue: of(sum.blue) };
}

/** Judges one picture: both boxes seen, red left of and above blue, the print about the middle across. */
function judge(name: string, file: string, middle: number): void {
  const { red, blue } = boxes(file);
  const at = (p: number[]): string => `(${p[0]!.toFixed(3)}, ${p[1]!.toFixed(3)}, ${p[2]} px)`;
  console.log(`  ${name}: red ${at(red)}, blue ${at(blue)}`);
  check(`${name}: both boxes are seen`, red[2] > 30 && blue[2] > 30);
  check(`${name}: red is left of blue, as on the sheet (not mirrored)`, red[0] < blue[0]);
  check(`${name}: red is above blue (not upside down)`, red[1] < blue[1]);
  check(`${name}: the print is about the middle across`, Math.abs((red[0] + blue[0]) / 2 - middle) < 0.12, `${((red[0] + blue[0]) / 2).toFixed(3)}`);
}

const q = (selector: string): string => `document.querySelector(${JSON.stringify(selector)})`;

try {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome");
  let edition = 0;
  await browse(chrome, `${base}/admin/wardrobe/`, scratch, async (page: Page) => {
    const { run, press, type, choose } = page;
    const until = async (expression: string, what: string, tenths = 300): Promise<void> => {
      if (!(await page.wait(expression, tenths))) throw new Error(`waited for ${what}`);
    };
    const slide = async (selector: string, value: string): Promise<void> => {
      await run(`(() => { const e = ${q(selector)}; e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
      await run("new Promise((r) => setTimeout(r, 20))");
    };
    const taken = async (): Promise<void> => {
      await Bun.sleep(500);
      await until(`document.body.dataset.stageTaken === document.body.dataset.stageSent`, "the stage to take what it was sent");
    };
    /** The stage's picture of what it now draws, saved as `name`. */
    const picture = async (name: string): Promise<string> => {
      const before = Number((await run(`document.body.dataset.pictures ?? "0"`)) as string);
      await press("#stage-picture");
      await until(`Number(document.body.dataset.pictures ?? 0) > ${before}`, "the stage's picture", 600);
      const b64 = (await run(`(async () => { const b = new Uint8Array(await (await fetch(document.body.dataset.picture)).arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); })()`)) as string;
      const file = join(out, `${name}.png`);
      writeFileSync(file, Buffer.from(b64, "base64"));
      console.log(`  picture ${file}`);
      return file;
    };
    const ready = async (): Promise<void> => {
      await until(`document.body.dataset.loaded === "1"`, "the store's state");
      await until(`document.body.dataset.stage === "ready"`, "the stage", 1200);
      await choose("#framing", "full");
      await taken();
    };

    console.log("a draft with an asymmetric print");
    await ready();
    await press('[data-start="core:tee"]');
    await until(`!${q("#editor")}.hidden`, "the draft's editor");
    await type("#name", "Truth tee");
    await page.tab();
    await press('[data-colour="10"]');
    await press("#has-print");
    await until(`!${q("#print")}.hidden`, "the print's sheet");
    const place = JSON.stringify(await run(`[...document.querySelectorAll("[data-pf]")].map((e) => Number(e.value))`));
    check("a new print starts on the tee's chest", place === JSON.stringify([0.06, 0.12, 0.25, 0.2, 1, 0]), place);
    await press("#clear");
    for (const [colour, x, y] of [["#e00000", 0.3, 0.36], ["#0028ff", 0.7, 0.64]] as const) {
      await choose("#shape-kind", "box");
      await press('[data-add="shape"]');
      await slide('[data-lf="colour"]', colour);
      await slide('[data-lf="w"]', "0.32");
      await slide('[data-lf="h"]', "0.24");
      await slide('[data-lf="x"]', String(x));
      await slide('[data-lf="y"]', String(y));
    }
    await press('[data-add="text"]');
    await type('[data-lf="text"]', "R");
    await page.tab();
    await slide('[data-lf="colour"]', "#ffd400");
    await slide('[data-lf="size"]', "0.42");
    await taken();
    await Bun.sleep(1500);
    await page.shot(join(out, "page-draft.png"));
    judge("the stage, the draft", await picture("stage-draft"), 0.5);

    console.log("published, loaded again and reopened");
    await press("#publish");
    await until(`${q("#msg")}.textContent.startsWith("Published edition")`, "the publish");
    edition = host.people.view().editions.at(-1)!.id;
    check("the store holds the edition's print on the tee's chest", JSON.stringify(host.people.view().byId.get(edition)?.print?.place) === JSON.stringify({ u: 0.06, v: 0.12, w: 0.25, h: 0.2, scale: 1, turn: 0 }));
    await page.send("Page.reload");
    await Bun.sleep(500);
    await ready();
    await press(`[data-show="${edition}"]`);
    await taken();
    await Bun.sleep(1500);
    await page.shot(join(out, "page-reopened.png"));
    judge("the stage, the edition reopened", await picture("stage-reopened"), 0.5);
  });

  console.log("a second player wears it, a third looks");
  const browsers: { browser: ReturnType<typeof Bun.spawn>; profile: string }[] = [];
  let hold: ReturnType<typeof setInterval> | null = null;
  try {
    /** A Chrome of its own for each page, so neither is a tab behind the other, whose frames would stop. */
    const open = async (name: string, view: string): Promise<string> => {
      const profile = mkdtempSync(join(scratch, "chrome-")), port = 9800 + Math.floor(Math.random() * 150);
      const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--window-size=1200,900", "--force-device-scale-factor=1", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
      browsers.push({ browser, profile });
      let target: { webSocketDebuggerUrl: string } | undefined;
      for (let k = 0; k < 100 && !target; k++) {
        await Bun.sleep(200);
        try {
          target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page");
        } catch { /* not up yet */ }
      }
      if (!target) throw new Error(`Chrome for ${name} did not open a page`);
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((r) => (ws.onopen = r));
      ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url: `${base}/?quick&tier=high&name=${name}&look=${view}` } }));
      await Bun.sleep(200);
      ws.close();
      for (let k = 0; k < 720 && !game.clients.some((c) => c?.active && !c.closed && c.ent >= 0 && c.name === name); k++) await Bun.sleep(250);
      if (!game.clients.some((c) => c?.active && c.name === name)) throw new Error(`${name} never joined; in the world: ${game.clients.filter((c) => c?.active).map((c) => c!.name).join(", ")}`);
      return target.webSocketDebuggerUrl;
    };
    // Orders are read once a page starts, so both are set before either opens.
    orders.set("wear", { run: ["enablecheats", "settime 12"], look: [0, 0] });
    orders.set("watch", { run: ["enablecheats", "settime 12"], look: [Math.PI, Math.atan2(1.3 - 1.62, 1.8)] });
    await open("wearer", "wear");
    const who = game.clients.find((c) => c?.active && c.name === "wearer")!;
    const [x, z] = [world.ents.x[who.ent]!, world.ents.z[who.ent]!], y = world.ents.y[who.ent]!;
    const wearerAt: [number, number, number] = [x, y, z], watcherAt: [number, number, number] = [x, y, z + 1.8];
    const rec = host.records.byPid.get(who.pid)!, items = host.items, inv = items.inv(rec), tee = world.reg.index.get("core:tee")!;
    check("the wearer puts the tee on", items.mintAt(rec, inv.wardrobe, tee, 1) === 1);
    check("in the published edition", items.restyle(rec, inv.wardrobe, edition, 0));
    host.refreshBody(rec);
    const socket = await open("watcher", "watch");
    hold = setInterval(() => {
      for (const c of game.clients) {
        if (!c?.active || c.closed || c.ent < 0) continue;
        const at = c.name === "wearer" ? wearerAt : c.name === "watcher" ? watcherAt : null;
        if (!at) continue;
        if (c.name === "watcher") world.ents.mode[c.ent] = MODE_GHOST;
        world.ents.setPosition(c.ent, at[0], at[1], at[2]);
        world.history.discontinuity(c.ent);
        world.ents.vx[c.ent] = world.ents.vy[c.ent] = world.ents.vz[c.ent] = 0;
        if (c.name === "wearer") world.ents.yaw[c.ent] = 0;
      }
    }, 50);
    await Bun.sleep(Number(values.seconds) * 1000);
    const ws = new WebSocket(socket);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const waiting = new Map<number, (v: any) => void>();
    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && waiting.has(d.id)) waiting.get(d.id)!(d.result);
    };
    const send = (method: string, params: object = {}): Promise<any> => new Promise((r) => (waiting.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
    await send("Runtime.evaluate", { expression: 'document.getElementById("ui") && (document.getElementById("ui").style.visibility = "hidden")' });
    await Bun.sleep(300);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const file = join(out, "game-watcher.png");
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(`  picture ${file}`);
    ws.close();
    judge("the game, a second player's tee", file, 0.5);
  } finally {
    if (hold) clearInterval(hold);
    for (const { browser, profile } of browsers) {
      browser.kill();
      await browser.exited;
      rmSync(profile, { recursive: true, force: true });
    }
  }
} catch (e) {
  faults.push(String(e instanceof Error ? e.stack : e));
  console.log(`  FAIL ${String(e)}`);
} finally {
  server.stop();
}
console.log(faults.length === 0 ? "every check passed" : `${faults.length} faults:\n  ${faults.join("\n  ")}`);
process.exit(faults.length === 0 ? 0 : 1);
