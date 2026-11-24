// Retake wiki photographs with the native game. bun tools/wiki/photos.ts [--only home,footer,vehicles] [--dist client/dist]
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { serveFile } from "../../server/files.ts";
import { mapRoutes } from "../../server/main.ts";
import { OPENING_SHOT } from "../../shared/title-scene.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { devtools } from "../map/trip.ts";
import { encodePhoto, readPhotoMap, WIKI_PHOTOS } from "./photo-files.ts";
import { photoReady, type PhotoStatus } from "./photo-recipe.ts";
import { CARD_SIZE, FOOTER_SHOT, PORTRAIT_SIZE, WIKI_SCENE_BRIEFS, photoName, photoPosition, photoSize } from "./photo-recipes.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SHELL = '<!doctype html><html><head><meta charset="utf-8"><style>html,body,canvas{margin:0;width:100%;height:100%;display:block;background:#000}</style></head><body><canvas></canvas><script type="module" src="/__wiki-photo.js"></script></body></html>';
const { values } = parseArgs({
  options: { dist: { type: "string", default: "client/dist" }, out: { type: "string", default: join(WIKI_PHOTOS, "retakes/scenes") }, only: { type: "string" }, map: { type: "string", default: "var/maps/miami.snmap" } },
});
const dist = resolve(values.dist!);
const out = resolve(values.out!);
const map = resolve(values.map!);
const selected = values.only?.split(",");
const photos = WIKI_SCENE_BRIEFS.filter((shot) => !selected || selected.includes(photoName(shot.route)));
if (!photos.length || (selected && photos.length !== selected.length)) throw Error("No camera recipe matches --only " + values.only);
const chrome = findChrome();
const cwebp = Bun.which("cwebp");
if (!chrome || !cwebp) throw Error("Wiki retakes need Chrome and cwebp");
if (!existsSync(join(dist, "entry-media.json"))) throw Error("Build the art and client before taking wiki photos");
const ground = photos.filter(({ route }) => route !== "" && route !== "footer");
const first = ground[0] ? photoPosition(ground[0].route) : null;
const head = first && await readPhotoMap(map, "miami");
const bundle = first && await Bun.build({ entrypoints: [join(ROOT, "tools/wiki/photo-stage.ts")], target: "browser", minify: true, format: "esm" });
if (bundle && !bundle.success) throw Error(bundle.logs.map(String).join("\n"));
const js = bundle ? await bundle.outputs[0]!.text() : "";
const work = mkdtempSync(join(tmpdir(), "snark-wiki-photos-"));
const profile = join(work, "chrome");
mkdirSync(out, { recursive: true });

let footer = false;
const routes = head && mapRoutes(map, head.id, head.hash);
const host = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/__wiki-photo.html") return new Response(SHELL, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (path === "/__wiki-photo.js") return new Response(js, { headers: { "content-type": "text/javascript" } });
    if (path === "/__wiki-photo-map.json") return Response.json({ head: "map/" + head?.name, first });
    if (path === "/cluster/title-scene.json") return Response.json(footer ? FOOTER_SHOT : OPENING_SHOT);
    return (routes && routes(path, req)) ?? serveFile(dist, req, path);
  },
});
const browser = Bun.spawn([
  chrome, "--headless=new", "--mute-audio", ...CHROME_FLAGS, "--enable-gpu", "--ignore-gpu-blocklist",
  "--no-first-run", "--disable-extensions", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
], { stdout: "ignore", stderr: Bun.file(join(work, "chrome.log")) });
let page: Awaited<ReturnType<typeof devtools>> | undefined;

async function viewport([width, height]: readonly [number, number]) {
  await page!.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
}

async function until<T>(expression: string, description: string, done: (value: T) => boolean, seconds = 65) {
  const end = Date.now() + seconds * 1000;
  let last: T;
  do {
    last = await page!.value<T>(expression);
    if (done(last)) return last;
    const error = await page!.value<string>("document.body?.dataset.error || ''");
    if (error) throw Error(error);
    await Bun.sleep(200);
  } while (Date.now() < end);
  throw Error(description + " did not settle: " + JSON.stringify(last));
}

async function shot(name: string, size: readonly [number, number], card: boolean) {
  const raw = join(work, name + ".png");
  await page!.shot(raw);
  const qualities = [88, 83, 76, 68, 59];
  encodePhoto(cwebp!, raw, join(out, name + ".webp"), size, 320 * 1024, qualities);
  if (card) encodePhoto(cwebp!, raw, join(out, name + ".card.webp"), CARD_SIZE, 64 * 1024, qualities);
}

try {
  page = await devtools(profile);
  for (const recipe of photos.filter(({ route }) => route === "" || route === "footer")) {
    const name = photoName(recipe.route);
    footer = name === "footer";
    for (const [label, size] of footer ? [[name, photoSize(recipe.route)]] as const : [[name, photoSize(recipe.route)], ["home.portrait", PORTRAIT_SIZE]] as const) {
      await viewport(size);
      await page.send("Page.navigate", { url: host.url + "flight.html?set=wynwood-shore&still=" + (footer ? "8" : "3") + "&wiki=" + label });
      await until<boolean>(`location.search.endsWith(${JSON.stringify(label)}) && document.body?.dataset.settled === 'true'`, label, Boolean);
      await shot(label, size, name === label && !footer);
    }
  }
  if (ground.length) {
    await viewport(photoSize(ground[0]!.route));
    await page.send("Page.navigate", { url: host.url + "__wiki-photo.html" });
    await until<boolean>("Boolean(window.snarkWikiPhoto)", "Miami stage", Boolean, 100);
    for (const recipe of ground) {
      const name = photoName(recipe.route);
      const setting = { recipe, position: photoPosition(recipe.route) };
      await page.value(`window.snarkWikiPhoto(${JSON.stringify(setting)})`);
      await until<PhotoStatus>("window.snarkWikiPhotoStatus()", name, (status) => photoReady(recipe, status), 110);
      await page.value("window.snarkWikiFreeze()");
      const status = await until<PhotoStatus>("window.snarkWikiPhotoStatus()", name + " presentation", (s) => s?.frozen === 2, 12);
      if (status.errors.length || (recipe.city && status.city === 0)) throw Error(name + " has missing geometry: " + JSON.stringify(status));
      await shot(name, photoSize(recipe.route), true);
    }
  }
} finally {
  page?.close();
  browser.kill();
  await browser.exited;
  host.stop(true);
  if (routes) routes.close();
  rmSync(work, { recursive: true, force: true });
}
