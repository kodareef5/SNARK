// What `bun run build` wrote, weighed against what a client may be sent. Raising a budget is a decision. A row pinned at
// today's number is one another change is bringing down; it fails until the pin comes down with it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { storedStep, type Manifest } from "../shared/pack/manifest.ts";
import { STEP0_SIZE, stepOf, topIn, type TextureFormat } from "../shared/pack/texture.ts";

const KB = 1024;
const MB = 1024 * KB;

/** The budgets, by row name. A negative budget pins the row at exactly that number. */
const BUDGETS: Record<string, number> = {
  "main.js, Brotli": 512 * KB,
  "manifest, Brotli": 256 * KB,
  "manifest": 1 * MB,
  "boot pack, Brotli": 1 * MB,
  "everything before the first frame, Brotli": 2 * MB,
  "mesh file": 32 * MB,
  "textures to 1,024, the largest compressed variant": 256 * MB,
  "textures to 2,048, the largest compressed variant": 640 * MB,
  "texture file, rgba": 354 * MB,
  "textures with a 2,048 step": 160,
  "sound file": 256 * MB,
  "sound, kbit/s": 260,
  "music": 48 * MB,
  "sound takes stored twice": 0,
  // Pinned: the liveries' and wrecks' copies are being shared at build (review A12, A11); lower each with them, to 0.
  "texture steps stored twice, astc": -176,
  "mesh parts stored twice": -401,
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
    ["main.js, Brotli", size("main.js.br")],
    ["manifest, Brotli", size("assets/manifest.json.br")],
    ["manifest", size("assets/manifest.json")],
    ["boot pack, Brotli", size(`${boot}.br`)],
    ["everything before the first frame, Brotli", ["index.html.br", "main.js.br", "assets-worker.js.br", "assets/manifest.json.br", `${boot}.br`, ...hud].reduce((s, n) => s + size(n), 0)],
    ["mesh file", fileOf("mesh")],
    ["textures to 1,024, the largest compressed variant", Math.max(textures("astc", 1024), textures("bc", 1024))],
    ["textures to 2,048, the largest compressed variant", Math.max(textures("astc", 2048), textures("bc", 2048))],
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
    const shown = (n: number): string => (Math.abs(n) >= MB ? `${(n / MB).toFixed(1)} MB` : Math.abs(n) >= 10 * KB ? `${(n / KB).toFixed(0)} KB` : n.toFixed(n % 1 === 0 ? 0 : 1));
    console.log(`  ${name.padEnd(52)} ${shown(value).padStart(10)}  ${pass ? "ok" : "MISS"} (${budget < 0 ? `pinned at ${shown(-budget)}` : `budget ${shown(budget)}`})`);
  }
  return ok;
}
