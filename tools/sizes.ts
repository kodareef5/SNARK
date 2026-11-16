// What `bun run build` wrote, weighed against what a client may be sent. Raising a budget is a decision. A row pinned at
// today's number is one another change is bringing down; it fails until the pin comes down with it.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { storedStep, type Manifest } from "../shared/pack/manifest.ts";
import { STEP0_SIZE, stepOf, topIn, type TextureFormat } from "../shared/pack/texture.ts";

const KB = 1024;
const MB = 1024 * KB;

/** The budgets, by row name: today's size and about 3%. A negative budget pins the row at exactly that number. */
const BUDGETS: Record<string, number> = {
  "the page's script, Brotli": 324 * KB,
  "manifest, Brotli": 127 * KB,
  "manifest": 583 * KB,
  "boot pack, Brotli": 481 * KB,
  "everything before the first frame, Brotli": 1058 * KB,
  "mesh file": 20.2 * MB,
  "clip file": 122 * KB,
  "textures to 1,024, astc": 129 * MB,
  "textures to 2,048, astc": 348 * MB,
  "textures to 1,024, bc": 237 * MB,
  "textures to 2,048, bc": 590 * MB,
  "texture file, rgba": 346 * MB,
  "textures with a 2,048 step": 143,
  "sound file": 4 * MB,
  "sound, kbit/s": 42,
  "music": 41 * MB,
  "sound takes stored twice": 0,
  "texture steps stored twice, astc": 0,
  // Pinned: grey boxes shared by many kinds, and the boat's and helicopter's liveries, until a stored part can serve
  // every level that holds it; lower it with that, to 0.
  "mesh parts stored twice": -394,
};

/** Copies past the first of each hash. */
const twice = (hashes: string[]): number => {
  const named = hashes.filter((h) => h !== "");
  return named.length - new Set(named).size;
};

/** Prints each row against its budget; false if any is over, or a pinned row is not at its pin. */
export function weigh(dist: string): boolean {
  const m = JSON.parse(readFileSync(join(dist, "assets/manifest.json"), "utf8")) as Manifest;
  const size = (name: string): number => statSync(join(dist, name)).size;
  const fileOf = (role: string, format?: TextureFormat): number => m.files.filter((f) => f.role === role && (!format || f.format === format)).reduce((s, f) => s + f.bytes, 0);
  const boot = `assets/${m.files[m.boot]!.name}`;
  // As the page asks for them: its script's modules, and the files the first frame needs, which the server's map is not among.
  const page = readFileSync(join(dist, "index.html"), "utf8");
  const script = [...page.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((x) => `${x[1]}.br`);
  const fetched = (JSON.parse(/for \(const href of (\[[^\]]*\])\)/.exec(page)![1]!) as string[]).filter((n) => existsSync(join(dist, n))).map((n) => `${n}.br`);
  const hud = readdirSync(join(dist, "assets")).filter((n) => /^hud\.\w+\.png$|^hud-font\.\w+\.ttf\.br$/.test(n)).map((n) => `assets/${n}`);
  const textures = (format: TextureFormat, widest: number): number => {
    let bytes = 0;
    for (const t of m.textures ?? []) {
      const v = t.in[format];
      if (v) for (let s = 0; s <= stepOf(Math.min(widest, topIn(format, t.top))); s++) bytes += storedStep(v, format, t.role, s);
    }
    return bytes;
  };
  const sounds = m.sounds ?? [];
  const seconds = sounds.reduce((s, x) => s + x.takes.reduce((a, t) => a + t.samples, 0) / x.rate, 0);
  const music = join(dist, "assets/music");
  const rows: [string, number][] = [
    ["the page's script, Brotli", script.reduce((s, n) => s + size(n), 0)],
    ["manifest, Brotli", size("assets/manifest.json.br")],
    ["manifest", size("assets/manifest.json")],
    ["boot pack, Brotli", size(`${boot}.br`)],
    ["everything before the first frame, Brotli", ["index.html.br", ...script, "assets-worker.js.br", ...fetched, ...hud].reduce((s, n) => s + size(n), 0)],
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
    ["music", readdirSync(music, { recursive: true }).reduce((s: number, n) => s + (statSync(join(music, String(n))).isFile() ? statSync(join(music, String(n))).size : 0), 0)],
    ["sound takes stored twice", twice(sounds.flatMap((x) => x.takes.map((t) => t.hash)))],
    ["texture steps stored twice, astc", twice((m.textures ?? []).flatMap((t) => t.in.astc?.hash ?? []))],
    ["mesh parts stored twice", twice(m.meshes.flatMap((x) => x.levels.flatMap((l) => l.parts.map((p) => p.hash))))],
  ];
  let ok = true;
  for (const [name, value] of rows) {
    const budget = BUDGETS[name]!;
    const pass = budget < 0 ? value === -budget : value <= budget;
    ok &&= pass;
    const shown = (n: number): string => (Math.abs(n) >= 10 * MB ? `${(n / MB).toFixed(1)} MB` : Math.abs(n) >= 10 * KB ? `${(n / KB).toFixed(0)} KB` : n.toFixed(n % 1 === 0 ? 0 : 1));
    console.log(`  ${name.padEnd(52)} ${shown(value).padStart(10)}  ${pass ? "ok" : "MISS"} (${budget < 0 ? `pinned at ${shown(-budget)}` : `budget ${shown(budget)}`})`);
  }
  return ok;
}

/** The field guide's budgets (tools/pages.ts): what a visitor's browser fetches for a page before it scrolls, Brotli where the server has it. */
const GUIDE_BUDGETS: Record<string, number> = {
  "guide: the front page, every picture": 300 * KB,
  "guide: its heaviest page": 300 * KB,
  "guide: a list page with every card's picture": 300 * KB,
};

/** Prints the guide's rows against their budgets; false if any is over. */
export function weighGuide(dist: string): boolean {
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
  const pictures = (html: string, lazy: boolean): number =>
    [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"[^>]*>/g)].filter((m) => lazy || !m[0].includes('loading="lazy"')).reduce((n, m) => n + sent(m[1]!), 0);
  const pages = [...new Bun.Glob("guide/**/index.html").scanSync({ cwd: dist })];
  const weigh = (path: string, lazy: boolean): number => {
    const html = readFileSync(join(dist, path), "utf8");
    return sent(path) + fixed(html) + pictures(html, lazy);
  };
  const lists = pages.filter((p) => /^guide\/(creatures|items|vehicles|characters)\/(page\/\d+\/|group\/\w+\/)?index\.html$/.test(p));
  const rows: [string, number][] = [
    ["guide: the front page, every picture", weigh("guide/index.html", true)],
    ["guide: its heaviest page", Math.max(...pages.map((p) => weigh(p, false)))],
    ["guide: a list page with every card's picture", Math.max(...lists.map((p) => weigh(p, true)))],
  ];
  let ok = true;
  for (const [name, value] of rows) {
    const pass = value <= GUIDE_BUDGETS[name]!;
    ok &&= pass;
    console.log(`  ${name.padEnd(52)} ${`${(value / KB).toFixed(0)} KB`.padStart(10)}  ${pass ? "ok" : "MISS"} (budget ${(GUIDE_BUDGETS[name]! / KB).toFixed(0)} KB)`);
  }
  return ok;
}
