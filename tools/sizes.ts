// What `bun run build` wrote, weighed. Two kinds of row. What every player waits for before the first frame has a
// budget, with room in it, and raising it is a decision. What is streamed when wanted (pages, meshes, textures, sounds,
// clips, music) grows with the catalogue and is shown, not held: an asset is held to its own budget by the art check.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { SURFACE_PREFIX } from "../content/surfaces.ts";
import { parseManifest, readPages, storedStep, type Manifest } from "../shared/pack/manifest.ts";
import type { ManifestSound } from "../shared/pack/sound.ts";
import { STEP0_SIZE, stepOf, topIn, type TextureFormat } from "../shared/pack/texture.ts";

const KB = 1024;
const MB = 1024 * KB;

/**
 * The rows that fail a build. The first is 0.4 s at 20 Mbit/s and holds no art past the survivor's: it was 647 KB with
 * 660 meshes and is 658 with ten times as many, a mesh adding 4 bytes of its name and page, so its room, about a third
 * of it, is for the script and the content as the game is built. The rest are waste the build can always avoid.
 */
export const FIRST_FRAME_BUDGET = 1024 * KB;
const BUDGETS: Record<string, number> = {
  "everything before the first frame, Brotli": FIRST_FRAME_BUDGET,
  "title script, style, font, catalogue and poster": 512 * KB,
  "game loading poster": 224 * KB,
  "sound, kbit/s": 42,
  "sound takes stored twice": 0,
  "texture steps stored twice, astc": 0,
};

/** Copies past the first of each hash. */
const twice = (hashes: string[]): number => {
  const named = hashes.filter((h) => h !== "");
  return named.length - new Set(named).size;
};

/** Prints each row, and its budget where it has one; false if any is over. */
export function weigh(dist: string): boolean {
  // The manifest as a tool sees it, every page and the sounds' rows read into it.
  const m = parseManifest(readFileSync(join(dist, "assets/manifest.json"), "utf8"));
  readPages(m, (f) => new Uint8Array(readFileSync(join(dist, "assets", m.files[f]!.name))), (stored) => new Uint8Array(inflateRawSync(stored)));
  if (m.soundRows) m.sounds = JSON.parse(readFileSync(join(dist, "assets", m.soundRows), "utf8")) as ManifestSound[];
  const size = (name: string): number => statSync(join(dist, name)).size;
  const titleBytes = (files: string[]): number => files.filter(n => existsSync(join(dist, n))).reduce((total, n) => total + size(n), 0);
  const fileOf = (role: string, format?: TextureFormat): number => m.files.filter((f) => f.role === role && (!format || f.format === format)).reduce((s, f) => s + f.bytes, 0);
  const boot = `assets/${m.files[m.boot]!.name}`;
  const { script, fetched, first } = firstFrame(dist);
  const textures = (format: TextureFormat, widest: number, only?: readonly number[]): number => texturesOf(m, format, widest, only);
  // The world's finishes, which the ground and every piece without art of its own wear, are asked for once the world is
  // drawn: base colour and normal at a tier's side, the packed map at half of it (client/core/assets/tiers.ts `finishes`).
  const world = (m.materials ?? []).filter((x) => x.id.startsWith(SURFACE_PREFIX));
  const finishes = (format: TextureFormat, side: number): number => textures(format, side, world.flatMap((x) => [x.base, x.normal])) + textures(format, side / 2, world.map((x) => x.mro));
  const sounds = m.sounds ?? [];
  const seconds = sounds.reduce((s, x) => s + x.takes.reduce((a, t) => a + t.samples, 0) / x.rate, 0);
  const music = join(dist, "assets/music");
  const rows: [string, number][] = [
    ["title script, style, font, catalogue and poster", titleBytes(["entry.js.br", "entry.css.br", "title/barlow.ttf", "title/maps.json", "title/red-tide.webp", "title/snark-emblem.webp"])],
    ["game loading poster", titleBytes(["title/miami-splash.webp", "title/snark-emblem.webp"])],
    ["the page's script, Brotli", script.reduce((s, n) => s + size(n), 0)],
    ["the content, Brotli", fetched.filter((n) => n.includes("/content.")).reduce((s, n) => s + size(n), 0)],
    ["manifest, Brotli", size("assets/manifest.json.br")],
    ["manifest", size("assets/manifest.json")],
    ["boot pack, Brotli", size(`${boot}.br`)],
    ["everything before the first frame, Brotli", first],
    ["the world's finishes on medium (512), astc", finishes("astc", 512)],
    ["the world's finishes on medium (512), bc", finishes("bc", 512)],
    ["the world's finishes on high (1,024), astc", finishes("astc", 1024)],
    ["the world's finishes on high (1,024), bc", finishes("bc", 1024)],
    ["the world's finishes on ultra (2,048), astc", finishes("astc", 2048)],
    ["the world's finishes on ultra (2,048), bc", finishes("bc", 2048)],
    ["page file", fileOf("page")],
    ["mesh file", fileOf("mesh")],
    ["clip file", fileOf("clip")],
    ["textures to 1,024, astc", textures("astc", 1024)],
    ["textures to 2,048, astc", textures("astc", 2048)],
    ["textures to 1,024, bc", textures("bc", 1024)],
    ["textures to 2,048, bc", textures("bc", 2048)],
    ["texture file, rgba", fileOf("tex", "rgba")],
    ["textures with a 2,048 step", (m.textures ?? []).filter((t) => t.top >= STEP0_SIZE << 5).length],
    ["sound file", fileOf("sound")],
    ["sound, kbit/s", (sounds.reduce((s, x) => s + x.takes.reduce((a, t) => a + t.bytes, 0), 0) * 8) / Math.max(1, seconds) / 1000],
    ["music", (existsSync(music) ? readdirSync(music, { recursive: true }) : []).reduce((s: number, n) => s + (statSync(join(music, String(n))).isFile() ? statSync(join(music, String(n))).size : 0), 0)],
    ["sound takes stored twice", twice(sounds.flatMap((x) => x.takes.map((t) => t.hash)))],
    ["texture steps stored twice, astc", twice((m.textures ?? []).flatMap((t) => t.in.astc?.hash ?? []))],
    ["mesh parts stored twice", twice(m.meshes.flatMap((x) => x.levels.flatMap((l) => l.parts.map((p) => p.hash))))],
  ];
  let ok = true;
  for (const [name, value] of rows) {
    const budget = BUDGETS[name];
    const pass = budget === undefined || value <= budget;
    ok &&= pass;
    const shown = (n: number): string => (Math.abs(n) >= 10 * MB ? `${(n / MB).toFixed(1)} MB` : Math.abs(n) >= 10 * KB ? `${(n / KB).toFixed(0)} KB` : n.toFixed(n % 1 === 0 ? 0 : 1));
    console.log(`  ${name.padEnd(52)} ${shown(value).padStart(10)}  ${budget === undefined ? "" : `${pass ? "ok" : "MISS"} (budget ${shown(budget)})`}`);
  }
  return ok;
}

/** The page's script and its Brotli bytes before the first frame, as the page asks for them: its script's modules, and the files the first frame needs, which the server's map is not among. */
export function firstFrame(dist: string): { script: string[]; fetched: string[]; first: number } {
  const size = (name: string): number => statSync(join(dist, name)).size;
  const page = readFileSync(join(dist, "index.html"), "utf8");
  const script = [...page.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((x) => `${x[1]}.br`);
  const fetched = (JSON.parse(/for \(const href of (\[[^\]]*\])\)/.exec(page)![1]!) as string[]).filter((n) => existsSync(join(dist, n))).map((n) => `${n}.br`);
  const hud = readdirSync(join(dist, "assets")).filter((n) => /^hud\.\w+\.(?:webp|png)$|^hud-font\.\w+\.ttf\.br$/.test(n)).map((n) => `assets/${n}`);
  return { script, fetched, first: ["index.html.br", ...script, "assets-worker.js.br", ...fetched, ...hud].reduce((s, n) => s + size(n), 0) };
}

/**
 * Each landmark's files (assets/landmarks), shown as the core's are, and what a client on a map that places it waits for
 * before its first frame, its manifest and boot file with the core's, held to the core's budget. `maps` names the
 * landmarks each map places, and a client on that map waits for all of theirs, so each map is held to it as well.
 */
export function weighLandmarks(dist: string, maps: ReadonlyMap<string, readonly string[]> = new Map()): boolean {
  const dir = join(dist, "assets/landmarks"), core = firstFrame(dist).first;
  const budget = BUDGETS["everything before the first frame, Brotli"]!;
  const owns = new Map<string, number>();
  const shown = (n: number): string => (Math.abs(n) >= 10 * MB ? `${(n / MB).toFixed(1)} MB` : Math.abs(n) >= 10 * KB ? `${(n / KB).toFixed(0)} KB` : n.toFixed(0));
  let ok = true;
  for (const file of existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort() : []) {
    // As a tool sees it, every page read into it.
    const name = file.slice(0, -5), m = parseManifest(readFileSync(join(dir, file), "utf8"));
    readPages(m, (f) => new Uint8Array(readFileSync(join(dir, m.files[f]!.name))), (stored) => new Uint8Array(inflateRawSync(stored)));
    const own = statSync(join(dir, `${file}.br`)).size + statSync(join(dir, `${m.files[m.boot]!.name}.br`)).size;
    owns.set(name, own);
    const fileOf = (role: string, format?: TextureFormat): number => m.files.filter((f) => f.role === role && (!format || f.format === format)).reduce((s, f) => s + f.bytes, 0);
    const rows: [string, number, number | undefined][] = [
      [`landmark ${name}: its manifest and boot file, Brotli`, own, undefined],
      [`landmark ${name}: everything before the first frame, Brotli`, core + own, budget],
      [`landmark ${name}: page file`, fileOf("page"), undefined],
      [`landmark ${name}: mesh file`, fileOf("mesh"), undefined],
      [`landmark ${name}: textures to 1,024, astc`, texturesOf(m, "astc", 1024), undefined],
      [`landmark ${name}: texture file, rgba`, fileOf("tex", "rgba"), undefined],
      [`landmark ${name}: mesh parts stored twice`, twice(m.meshes.flatMap((x) => x.levels.flatMap((l) => l.parts.map((p) => p.hash)))), undefined],
    ];
    for (const [row, value, most] of rows) {
      const pass = most === undefined || value <= most;
      ok &&= pass;
      console.log(`  ${row.padEnd(52)} ${shown(value).padStart(10)}  ${most === undefined ? "" : `${pass ? "ok" : "MISS"} (budget ${shown(most)})`}`);
    }
  }
  for (const [map, names] of maps) {
    if (names.length === 0) continue;
    const value = names.reduce((sum, name) => sum + (owns.get(name) ?? NaN), core);
    const pass = value <= budget;
    ok &&= pass;
    console.log(`  ${`map ${map}: everything before the first frame, Brotli`.padEnd(52)} ${shown(value).padStart(10)}  ${pass ? "ok" : "MISS"} (budget ${shown(budget)})`);
  }
  return ok;
}

/** The landmarks each city places (its city.json's world.landmarks, tools/maps/README.md), by map. */
export function mapLandmarks(source: string): Map<string, string[]> {
  const maps = join(source, "maps"), out = new Map<string, string[]>();
  for (const map of existsSync(maps) ? readdirSync(maps).sort() : []) {
    const city = join(maps, map, "city.json");
    if (existsSync(city)) out.set(map, ((JSON.parse(readFileSync(city, "utf8")) as { world?: { landmarks?: { name: string }[] } }).world?.landmarks ?? []).map((l) => l.name));
  }
  return out;
}

/** Bytes of every step of a manifest's textures in `format` up to `widest` pixels across. */
function texturesOf(m: Manifest, format: TextureFormat, widest: number, only?: readonly number[]): number {
  let bytes = 0;
  for (const [k, t] of (m.textures ?? []).entries()) {
    const v = only && !only.includes(k) ? undefined : t.in[format];
    if (v) for (let s = 0; s <= stepOf(Math.min(widest, topIn(format, t.top))); s++) bytes += storedStep(v, format, t.role, s);
  }
  return bytes;
}

/**
 * The wiki's budgets (tools/wiki.ts), Brotli where the server has it: what a visitor waits for before a page can be read (its
 * text, style, font and script, and the pictures at its top; the rest load as they come into view), and the size of any one
 * picture and card. None is a total over the catalogue: a map, creature or landmark added adds a page and a card, not weight
 * to one. The first has room for a map's ground and an entry's first view at the most the build makes them.
 */
const WIKI_BUDGETS: Record<string, number> = {
  "wiki: the heaviest page before it can be read": 400 * KB,
  "wiki: its largest picture": 320 * KB,
  "wiki: its largest card's picture": 64 * KB,
  // Fetched only when "View in 3D" is pressed (D894): the studio's page and script, and what it draws with before the
  // subject's own meshes come: the manifest, the boot pack, the content, the sky and the font.
  "wiki: what the studio fetches before it draws": 1200 * KB,
};

/** Prints the wiki's rows against their budgets; false if any is over. */
export function weighWiki(dist: string): boolean {
  const sent = (address: string): number => {
    const file = join(dist, address.split(/[?#]/)[0]!);
    return existsSync(`${file}.br`) ? statSync(`${file}.br`).size : statSync(file).size;
  };
  const shared = new Map<string, number>();
  // A page's stylesheet with its font, and its script with the modules it imports before it runs.
  const fixed = (html: string): number => {
    let bytes = 0;
    for (const m of html.matchAll(/<link rel="stylesheet" href="([^"]+)"|<script type="module" src="([^"]+)"/g)) {
      const address = (m[1] ?? m[2])!;
      if (!shared.has(address)) {
        let n = sent(address);
        const text = readFileSync(join(dist, address), "utf8");
        for (const f of text.matchAll(/url\("(\/[^"]+)"\)/g)) n += sent(f[1]!);
        for (const f of text.matchAll(/\bimport\s*(?:\{[^}]*\}\s*from\s*)?"\.\/([^"]+\.js)"/g)) n += sent(address.replace(/[^/]+$/, f[1]!));
        shared.set(address, n);
      }
      bytes += shared.get(address)!;
    }
    return bytes;
  };
  const eager = (html: string): number =>
    [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"[^>]*>/g)].filter((m) => !m[0].includes('loading="lazy"')).reduce((n, m) => n + sent(m[1]!), 0);
  const pages = [...new Bun.Glob("wiki/**/index.html").scanSync({ cwd: dist })].map((p): [string, number] => {
    const html = readFileSync(join(dist, p), "utf8");
    return [p, sent(p) + fixed(html) + eager(html)];
  });
  const media = [...new Bun.Glob("wiki/media/*.png").scanSync({ cwd: dist })].map((f): [string, number] => [f, sent(f)]);
  const most = (list: [string, number][]): [string, number] => list.reduce((a, b) => (b[1] > a[1] ? b : a), ["", 0]);
  const media3d = existsSync(join(dist, "entry-media.json")) ? (JSON.parse(readFileSync(join(dist, "entry-media.json"), "utf8")) as Record<string, string | null>) : {};
  const studio = ["studio.html", "studio.js", "assets/manifest.json", "title/barlow.ttf", media3d.boot, media3d.content, media3d.sky]
    .filter((f): f is string => !!f && existsSync(join(dist, f)))
    .reduce((n, f) => n + sent(f), 0);
  const rows: [string, [string, number]][] = [
    ["wiki: the heaviest page before it can be read", most(pages)],
    ["wiki: what the studio fetches before it draws", ["studio.html", studio]],
    ["wiki: its largest picture", most(media)],
    ["wiki: its largest card's picture", most(media.filter(([f]) => f.endsWith(".card.png")))],
  ];
  let ok = true;
  for (const [name, [what, value]] of rows) {
    const pass = value <= WIKI_BUDGETS[name]!;
    ok &&= pass;
    console.log(`  ${name.padEnd(52)} ${`${(value / KB).toFixed(0)} KB`.padStart(10)}  ${pass ? "ok" : "MISS"} (budget ${(WIKI_BUDGETS[name]! / KB).toFixed(0)} KB)  ${what.replace(/^wiki\/|index\.html$/g, "")}`);
  }
  return ok;
}
