// What a player waits for before the first frame (tools/sizes.ts FIRST_FRAME_BUDGET), weighed part by part, and the
// page's script by the modules it was built from: the build writes it as first-frame.json beside the client, with the
// last build's beside it to set the change against, and this prints it.
//
//   bun tools/first-frame.ts [client folder]      the weighing of a built client (client/dist), as written or made now
//   bun tools/sizes.ts --first-frame [folder]     the same
//
// A module's share is its part of the minified script, as the script's source maps place each run of it, compressed by
// itself and scaled so that the modules add up to the script's own Brotli bytes. Compression shares what repeats across
// modules, so a module's figure is an estimate; the parts' figures are the files' own.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { checkoutBuild } from "../server/reports.ts";
import { FIRST_FRAME_BUDGET, firstFrame, mapLandmarks } from "./sizes.ts";
import { ART, SOURCE } from "./art/source.ts";

const ROOT = resolve(import.meta.dir, "..");
export const FIRST_FRAME_FILE = "first-frame.json";

export interface Weighed { name: string; bytes: number }
export interface ModuleWeight { file: string; bytes: number; raw: number }
export interface FirstFrameWeighing {
  version: 1;
  at: string;
  commit: string;
  clean: boolean | null;
  quick: boolean;
  budget: number;
  /** The core's first frame: what every map waits for. */
  total: number;
  room: number;
  parts: (Weighed & { files: string[] })[];
  /** Each map's: the core's and its landmarks' manifests and boot files. The map's own head is the server's, not weighed here. */
  maps: { map: string; total: number; room: number; landmarks: Weighed[] }[];
  /** The page's script by module and by folder, largest first, in estimated Brotli bytes and minified bytes. */
  modules: ModuleWeight[];
  folders: ModuleWeight[];
  previous: Omit<FirstFrameWeighing, "previous" | "modules" | "folders"> & { modules: ModuleWeight[] } | null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...B64].map((c, i) => [c, i]));

/** A source map's mappings, line by line: each segment's generated column and, where it has one, its source. */
export function segments(mappings: string): { col: number; src: number }[][] {
  const lines: { col: number; src: number }[][] = [];
  let src = 0;
  for (const line of mappings.split(";")) {
    const out: { col: number; src: number }[] = [];
    let col = 0;
    for (const seg of line.split(",")) {
      if (seg === "") continue;
      const fields: number[] = [];
      let value = 0, shift = 0;
      for (const c of seg) {
        const d = DIGIT.get(c) ?? 0;
        value += (d & 31) << shift;
        if (d & 32) shift += 5;
        else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = shift = 0;
        }
      }
      col += fields[0] ?? 0;
      if (fields.length >= 4) src += fields[1]!;
      out.push({ col, src: fields.length >= 4 ? src : -1 });
    }
    lines.push(out);
  }
  return lines;
}

/** The text of `js` by source, as its map `map` places each run of it; -1 the runs it places nowhere. */
export function textBySource(js: string, map: { mappings: string }): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const add = (src: number, text: string): void => void (text && (out.get(src) ?? out.set(src, []).get(src)!).push(text));
  const segs = segments(map.mappings), lines = js.split("\n");
  lines.forEach((line, n) => {
    const s = segs[n] ?? [];
    // A line's break goes with its last run.
    const end = n < lines.length - 1 ? "\n" : "";
    if (s.length === 0 || s[0]!.col > 0) add(-1, line.slice(0, s[0]?.col ?? line.length) + (s.length === 0 ? end : ""));
    for (let k = 0; k < s.length; k++) add(s[k]!.src, line.slice(s[k]!.col, s[k + 1]?.col ?? line.length) + (k === s.length - 1 ? end : ""));
  });
  return out;
}

const brotliOf = (text: string): number => brotliCompressSync(Buffer.from(text), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length;

/** The page's script files (`scripts`, as index.html preloads them) by module, scaled to `brotli`, their Brotli bytes. */
export function scriptModules(dist: string, scripts: readonly string[], brotli: number): ModuleWeight[] {
  const raw = new Map<string, string[]>();
  for (const file of scripts) {
    const js = readFileSync(join(dist, file), "utf8"), mapFile = join(dist, `${file}.map`);
    const map = existsSync(mapFile) ? (JSON.parse(readFileSync(mapFile, "utf8")) as { mappings: string; sources: string[]; sourceRoot?: string }) : null;
    const pieces = map ? textBySource(js, map) : new Map([[-1, [js]]]);
    for (const [src, texts] of pieces) {
      const name = src < 0 || !map ? "(not placed by the source maps)" : relative(ROOT, resolve(dirname(mapFile), map.sourceRoot ?? "", map.sources[src]!));
      (raw.get(name) ?? raw.set(name, []).get(name)!).push(...texts);
    }
  }
  const weighed = [...raw].map(([file, texts]) => {
    const text = texts.join("");
    return { file, raw: Buffer.byteLength(text), alone: brotliOf(text) };
  });
  const sum = weighed.reduce((n, m) => n + m.alone, 0) || 1;
  return weighed.map((m) => ({ file: m.file, bytes: Math.round((m.alone / sum) * brotli), raw: m.raw })).sort((a, b) => b.bytes - a.bytes);
}

/** The modules summed by folder, largest first. */
export function byFolder(modules: readonly ModuleWeight[]): ModuleWeight[] {
  const out = new Map<string, ModuleWeight>();
  for (const m of modules) {
    const folder = m.file.startsWith("(") ? m.file : dirname(m.file);
    const f = out.get(folder) ?? out.set(folder, { file: folder, bytes: 0, raw: 0 }).get(folder)!;
    f.bytes += m.bytes;
    f.raw += m.raw;
  }
  return [...out.values()].sort((a, b) => b.bytes - a.bytes);
}

/** Weighs the built client in `dist`, with the last weighing written there as `previous`. */
export function weighFirstFrame(dist: string, quick: boolean): FirstFrameWeighing {
  const size = (name: string): number => statSync(join(dist, name)).size;
  const { script, fetched, first } = firstFrame(dist);
  const hud = first - ["index.html.br", ...script, "assets-worker.js.br", ...fetched].reduce((n, f) => n + size(f), 0);
  const named = (pattern: RegExp): string[] => fetched.filter((f) => pattern.test(f));
  const sum = (files: string[]): number => files.reduce((n, f) => n + size(f), 0);
  const scriptBytes = sum(script);
  const parts: (Weighed & { files: string[] })[] = [
    { name: "the page's script", bytes: scriptBytes, files: script },
    { name: "the boot pack", bytes: sum(named(/^assets\/core\./)), files: named(/^assets\/core\./) },
    { name: "the HUD's pictures and font", bytes: hud, files: [] },
    { name: "the content", bytes: sum(named(/\/content\./)), files: named(/\/content\./) },
    { name: "the manifest", bytes: sum(named(/manifest\.json/)), files: named(/manifest\.json/) },
    { name: "the sky's table", bytes: sum(named(/\/sky\./)), files: named(/\/sky\./) },
    { name: "the page itself and the asset worker", bytes: size("index.html.br") + size("assets-worker.js.br"), files: ["index.html.br", "assets-worker.js.br"] },
  ];
  const known = new Set(parts.flatMap((p) => p.files));
  const rest = fetched.filter((f) => !known.has(f));
  if (rest.length > 0) parts.push({ name: "the rest", bytes: sum(rest), files: rest });
  const maps = [...(ART ? mapLandmarks(SOURCE) : new Map<string, string[]>())].map(([map, names]) => {
    const landmarks = names.map((name) => {
      const manifest = join(dist, "assets/landmarks", `${name}.json`);
      if (!existsSync(manifest)) return { name, bytes: 0 };
      const m = JSON.parse(readFileSync(manifest, "utf8")) as { boot: number; files: { name: string }[] };
      return { name, bytes: statSync(`${manifest}.br`).size + statSync(join(dist, "assets/landmarks", `${m.files[m.boot]!.name}.br`)).size };
    });
    const total = first + landmarks.reduce((n, l) => n + l.bytes, 0);
    return { map, total, room: FIRST_FRAME_BUDGET - total, landmarks };
  });
  const modules = scriptModules(dist, script.map((f) => f.replace(/\.br$/, "")), scriptBytes);
  const own = checkoutBuild(ROOT);
  const last = existsSync(join(dist, FIRST_FRAME_FILE)) ? (JSON.parse(readFileSync(join(dist, FIRST_FRAME_FILE), "utf8")) as FirstFrameWeighing) : null;
  const previous = last ? { version: last.version, at: last.at, commit: last.commit, clean: last.clean, quick: last.quick, budget: last.budget, total: last.total, room: last.room, parts: last.parts, maps: last.maps, modules: last.modules.slice(0, 200) } : null;
  return { version: 1, at: new Date().toISOString(), commit: own.commit ?? "unknown", clean: own.clean ?? null, quick, budget: FIRST_FRAME_BUDGET, total: first, room: FIRST_FRAME_BUDGET - first, parts, maps, modules, folders: byFolder(modules), previous };
}

/** Writes first-frame.json beside the client. */
export function writeFirstFrame(dist: string, quick: boolean): FirstFrameWeighing {
  const w = weighFirstFrame(dist, quick);
  writeFileSync(join(dist, FIRST_FRAME_FILE), JSON.stringify(w) + "\n");
  return w;
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const change = (now: number, was: number | undefined): string => (was === undefined ? "" : now === was ? "  same" : `  ${now > was ? "+" : "-"}${kb(Math.abs(now - was))}`);

/** The weighing in lines, for a terminal: the parts, each map, and the script's largest modules and folders, beside the last build's. */
export function firstFrameLines(w: FirstFrameWeighing, most = 30): string[] {
  const p = w.previous, out: string[] = [];
  out.push(`First frame of the build at ${w.at.slice(0, 16).replace("T", " ")} (${w.commit.slice(0, 10)}${w.clean === false ? " with changes" : ""}${w.quick ? ", a quick build: its Brotli runs about a tenth over a real build's" : ""}): ${kb(w.total)} of ${kb(w.budget)}, ${kb(w.room)} left${change(w.total, p?.total)}${p ? ` against the build at ${p.at.slice(0, 16).replace("T", " ")}` : ""}`);
  for (const part of w.parts) out.push(`  ${part.name.padEnd(40)} ${kb(part.bytes).padStart(10)}  ${((part.bytes / w.budget) * 100).toFixed(1).padStart(5)}%${change(part.bytes, p?.parts.find((x) => x.name === part.name)?.bytes)}`);
  for (const m of w.maps) out.push(`  map ${m.map.padEnd(36)} ${kb(m.total).padStart(10)}  ${kb(m.room)} left${m.landmarks.length > 0 ? ` (landmarks ${m.landmarks.map((l) => `${l.name} ${kb(l.bytes)}`).join(", ")})` : ""}${change(m.total, p?.maps.find((x) => x.map === m.map)?.total)}`);
  out.push("", `The script's ${kb(w.parts[0]!.bytes)} by folder (estimated Brotli, minified):`);
  for (const f of w.folders.slice(0, 15)) out.push(`  ${f.file.padEnd(48)} ${kb(f.bytes).padStart(10)} ${kb(f.raw).padStart(10)}`);
  out.push("", `Its ${most} largest modules:`);
  const before = new Map((p?.modules ?? []).map((m) => [m.file, m.bytes]));
  for (const m of w.modules.slice(0, most)) out.push(`  ${m.file.padEnd(48)} ${kb(m.bytes).padStart(10)} ${kb(m.raw).padStart(10)}${p ? change(m.bytes, before.get(m.file) ?? 0) : ""}`);
  return out;
}

if (import.meta.main) {
  const dist = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(ROOT, "client/dist"));
  if (!existsSync(join(dist, "index.html"))) throw new Error(`no built client in ${dist}`);
  const w = existsSync(join(dist, FIRST_FRAME_FILE)) ? (JSON.parse(readFileSync(join(dist, FIRST_FRAME_FILE), "utf8")) as FirstFrameWeighing) : weighFirstFrame(dist, false);
  console.log(firstFrameLines(w).join("\n"));
}
