// The default media every cluster's screens start with (assets/source/core/screens/README.md): clips and still images,
// one folder each. source.json, its recipe and rights, and clip.json, what the encode made, are tracked; the clip.mp4 or
// image.png / image.jpg and its poster.jpg are art, one release archive to an item (core-screens-<name>). channels.json
// lists the default channels, each for one type of screen. ffmpeg runs here alone: the game never encodes or decodes.
//
//   bun run screens add <file or folder>... --list sheet.csv [--jobs N]   encode new items, their words from the sheet
//   bun run screens make [name...] [--jobs N]                             encode items again from their recipes
//   bun run screens check                                                 check every recipe, item and channel
//
// The same original and the same ffmpeg give the same bytes: one thread, fixed flags, no dates in the files. An original
// is kept in the machine's cache by its SHA-256, never in the repository.

import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  CLIP_MAX_BYTES, CLIP_MAX_HIGH, CLIP_MAX_KBPS, CLIP_MAX_SECONDS, CLIP_MAX_WIDE, COLOUR_PARTS, COLOUR_RATE, IMAGE_MAX_LONG, SCREENS, STILL_MAX, STILL_MIN,
  clipId, isClipId, isScreenType, offeredOn, type Clip, type ScreenType,
} from "../../shared/video/clip.ts";
import { probeImage } from "../../shared/video/image.ts";

export const ROOT = resolve(import.meta.dir, "../..");
export const SCREENS_DIR = join(ROOT, "assets/source/core/screens");
export const SOURCES_FILE = join(SCREENS_DIR, "SOURCES.md");
export const CHANNELS_FILE = join(SCREENS_DIR, "channels.json");
const PREFIX = "assets/source/core/screens/";
export const INVENTORY = join(ROOT, "distribution/source-files.txt");

/** The encode's long and short sides: 360p already outresolves the ball's pucks (screen-video.md, video-1). */
const LONG = 640, SHORT = 360;
/** The bit rate a clip gets unless its recipe says, and the largest a poster may be. */
const KBPS = 600;
const POSTER_BYTES = 40 * 1024;
/** The largest a default image may be, well under the upload cap, since every client may fetch it. */
export const IMAGE_PACK_BYTES = 400 * 1024;
/** The types a default image is offered on where its sheet says none: every type but the ball, as an upload's are. */
export const IMAGE_TYPES_DEFAULT: readonly ScreenType[] = SCREENS.filter((s) => s !== "orb");

/** Where a clip's original came from: a file fetched from `url` (its rights on `page`), or one supplied `by` someone. */
export interface From {
  readonly url?: string;
  readonly page?: string;
  readonly by?: string;
  /** The original's SHA-256: it is held to it, and kept in the cache by it. */
  readonly sha256: string;
}

/**
 * An item's recipe, source.json: where it is from and why we may ship it, and how it is cut and encoded. Times are
 * seconds into the original. An image is fitted to IMAGE_MAX_LONG, never upscaled, as a JPEG unless it says PNG.
 */
export interface Recipe {
  readonly kind?: "clip" | "image";
  readonly title: string;
  readonly year?: number;
  readonly from: From;
  /** One line, shown with the clip: who made it and why we may show it. */
  readonly rights: string;
  /** The licence as its source words it, quoted in SOURCES.md. */
  readonly licence: string;
  /** What was done to it, for SOURCES.md. */
  readonly changes?: string;
  readonly start?: number;
  readonly length?: number;
  /** An ffmpeg crop that takes off black bars, before the scale. */
  readonly crop?: string;
  /** Grain taken down a little: old film's grain costs bits and shows nothing at puck size. */
  readonly denoise?: boolean;
  /** Keep its sound. Without it the clip is silent. */
  readonly audio?: boolean;
  readonly kbps?: number;
  /** Seconds into the cut clip, or the brightest sample of its colour track; a tenth of the way in by default. */
  readonly poster?: number | "brightest";
  /** It flashes, so no default channel may hold it. */
  readonly flashes?: boolean;
  /** The types of screen it is offered on; every type where it says none. */
  readonly types?: readonly ScreenType[];
  /** An image's file: PNG for flat art, JPEG otherwise. */
  readonly format?: "png" | "jpeg";
}

/** A default channel: a name, the items' folder names in order, whether it shuffles, its type, and an image's seconds. */
export interface DefaultChannel {
  readonly name: string;
  readonly shuffle: boolean;
  readonly items: readonly string[];
  readonly type?: ScreenType;
  readonly still?: number;
}

export const isImageRecipe = (r: Recipe): boolean => r.kind === "image";
/** The files an item's folder holds as art. */
export const artFiles = (r: Recipe): [string, string] => [isImageRecipe(r) ? (r.format === "png" ? "image.png" : "image.jpg") : "clip.mp4", "poster.jpg"];

/** An item folder's name: lower case words joined by hyphens, which names its release archive core-screens-<name>. */
export const isItemName = (name: string): boolean => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && name.length <= 48;
/** A folder name made from a title. */
export const nameOf = (title: string): string =>
  title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "") || "clip";

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const writeJson = (file: string, value: unknown): void => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** Every item folder's name, in order. */
export const itemNames = (dir = SCREENS_DIR): string[] =>
  readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "source.json"))).map((d) => d.name).sort();
export const readRecipe = (name: string, dir = SCREENS_DIR): Recipe => readJson<Recipe>(join(dir, name, "source.json"));
/** What an item's encode made, or null where it has not been encoded. */
export const readItem = (name: string, dir = SCREENS_DIR): Clip | null => (existsSync(join(dir, name, "clip.json")) ? readJson<Clip>(join(dir, name, "clip.json")) : null);
export const readChannels = (dir = SCREENS_DIR): DefaultChannel[] => (existsSync(join(dir, "channels.json")) ? readJson<DefaultChannel[]>(join(dir, "channels.json")) : []);

const sameTypes = (a: readonly ScreenType[] | undefined, b: readonly ScreenType[] | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---- Checks: what the tests and `screens check` hold every default item to.

/** Everything wrong with the default items in `dir`, one sentence each; none where all is well. */
export function problems(dir = SCREENS_DIR, inventory: readonly string[] = existsSync(INVENTORY) ? readFileSync(INVENTORY, "utf8").split("\n") : []): string[] {
  const out: string[] = [];
  const listed = new Set(inventory);
  const names = itemNames(dir), ids = new Map<string, string>();
  for (const name of names) {
    const say = (s: string): number => out.push(`${name}: ${s}`);
    if (!isItemName(name)) say("a folder's name is lower case words joined by hyphens, 48 letters at most.");
    const r = readRecipe(name, dir), image = isImageRecipe(r);
    if (r.kind !== undefined && r.kind !== "clip" && r.kind !== "image") say('source.json\'s kind is "clip" or "image".');
    if (r.types !== undefined && (!Array.isArray(r.types) || r.types.length === 0 || !r.types.every(isScreenType) || new Set(r.types).size !== r.types.length)) {
      say(`source.json's types are one or more of ${SCREENS.join(", ")}, each once.`);
    }
    if (r.format !== undefined && (!image || (r.format !== "png" && r.format !== "jpeg"))) say('only an image has a format, "png" or "jpeg".');
    if (!r.title?.trim()) say("source.json has no title.");
    if (!r.rights || r.rights.trim().length < 12) say("source.json needs a rights line: who made it and why we may show it.");
    if (!r.licence || r.licence.trim().length < 12) say("source.json needs the licence as its source words it.");
    if (!/^[0-9a-f]{64}$/.test(r.from?.sha256 ?? "")) say("source.json needs the original's SHA-256.");
    if (!r.from?.url && !r.from?.by) say("source.json says neither the url it came from nor who supplied it.");
    if (r.from?.url && !r.from.page) say("source.json names a url but no page stating its rights.");
    const c = readItem(name, dir);
    if (!c) {
      say("it has not been encoded: bun run screens make " + name);
      continue;
    }
    if (!isClipId(c.id)) say("clip.json has no id.");
    if (ids.has(c.id)) say(`it is the same file as ${ids.get(c.id)}.`);
    ids.set(c.id, name);
    const [file, poster] = artFiles(r);
    if (c.file !== file || c.poster !== poster) say(`clip.json names files other than ${file} and ${poster}.`);
    if (c.title !== r.title || c.rights !== r.rights || !sameTypes(c.types, r.types) || (c.kind === "image") !== image) say("clip.json's title, rights, kind or types are not the recipe's: bun run screens make " + name);
    const samples = Buffer.from(c.colours, "base64").length / (3 * COLOUR_PARTS);
    if (image) {
      if (Math.max(c.width, c.height) > IMAGE_MAX_LONG) say(`it is ${c.width}×${c.height}, over ${IMAGE_MAX_LONG} on its long side.`);
      if (c.seconds !== 0 || c.audio || c.bytes > IMAGE_PACK_BYTES) say(`an image has no length or sound and is ${IMAGE_PACK_BYTES / 1024} KB at most.`);
      if (samples !== 1) say("an image's colour track is one sample.");
    } else {
      if (Math.max(c.width, c.height) > CLIP_MAX_WIDE || Math.min(c.width, c.height) > CLIP_MAX_HIGH) say(`it is ${c.width}×${c.height}, over the caps.`);
      if (!(c.seconds > 0) || c.seconds > CLIP_MAX_SECONDS || c.bytes > CLIP_MAX_BYTES || (c.bytes * 8) / c.seconds / 1000 > CLIP_MAX_KBPS) say("its length, size or bit rate is over the caps.");
      if (!Number.isInteger(samples) || Math.abs(samples - c.seconds * COLOUR_RATE) > 1) say("its colour track is not COLOUR_RATE samples a second.");
    }
    for (const f of [file, poster]) if (inventory.length && !listed.has(`${PREFIX}${name}/${f}`)) say(`distribution/source-files.txt does not list ${f}.`);
  }
  const seen = new Set<string>();
  for (const ch of readChannels(dir)) {
    if (!ch.name || ch.name === "scenes" || ch.name.startsWith("scene:") || ch.name.length > 40 || seen.has(ch.name)) out.push(`channels.json: "${ch.name}" is not a name a channel may have, or is there twice.`);
    seen.add(ch.name);
    if (ch.type !== undefined && !isScreenType(ch.type)) out.push(`channels.json: ${ch.name} is for ${SCREENS.join(", ")} screens.`);
    if (ch.still !== undefined && !(typeof ch.still === "number" && ch.still >= STILL_MIN && ch.still <= STILL_MAX)) out.push(`channels.json: ${ch.name} holds an image ${STILL_MIN} to ${STILL_MAX} seconds.`);
    const type = ch.type ?? "orb";
    for (const item of ch.items) {
      if (!names.includes(item)) out.push(`channels.json: ${ch.name} lists ${item}, which is no item.`);
      else if (readRecipe(item, dir).flashes) out.push(`channels.json: ${ch.name} lists ${item}, which flashes.`);
      else if (!offeredOn(readRecipe(item, dir), type)) out.push(`channels.json: ${ch.name} lists ${item}, which is not offered on ${type} screens.`);
    }
  }
  return out;
}

// ---- The sheet `screens add` reads: one row to a file.

/** Rows of a CSV sheet as objects by its first row's headings, lower-cased. Quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.some((f) => f.trim() !== ""));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const yes = (v: string | undefined): boolean => /^(y|yes|true|1)$/i.test(v ?? "");
const num = (v: string | undefined): number | undefined => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);

const VIDEO_FILES = /\.(mp4|m4v|mov|mkv|webm|ogv|ogg|avi)$/i;
const IMAGE_FILES = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const list = (v: string | undefined): string[] => (v ?? "").split(/[;|]/).map((c) => c.trim()).filter(Boolean);

/**
 * A sheet's row as a recipe for an original whose SHA-256 is `sha256`, and the default channels it joins. The row's
 * headings: file, title, rights, licence (needed); name, kind (clip or image, else from the file's ending), types,
 * format (png or jpeg, for an image), year, url, page, by, changes, start, length, crop, poster, kbps, audio, denoise,
 * flashes, channels. Lists are split by ; or |. An image with no types is offered on every type but the ball.
 */
export function recipeOf(row: Record<string, string>, sha256: string): { name: string; recipe: Recipe; channels: string[] } {
  const missing = ["title", "rights", "licence"].filter((k) => !row[k]);
  if (!row.url && !row.by) missing.push("url or by");
  if (missing.length) throw new Error(`${row.file || "a row"}: the sheet needs ${missing.join(", ")}.`);
  const kind = row.kind ? row.kind.toLowerCase() : IMAGE_FILES.test(row.file ?? "") ? "image" : "clip";
  if (kind !== "clip" && kind !== "image") throw new Error(`${row.file}: its kind is clip or image.`);
  const types = list(row.types);
  if (!types.every(isScreenType) || new Set(types).size !== types.length) throw new Error(`${row.file}: its types are some of ${SCREENS.join(", ")}.`);
  const format = row.format ? row.format.toLowerCase().replace(/^jpg$/, "jpeg") : "";
  if (format && (kind !== "image" || (format !== "png" && format !== "jpeg"))) throw new Error(`${row.file}: only an image has a format, png or jpeg.`);
  const poster = row.poster === "brightest" ? "brightest" : num(row.poster);
  const recipe: Recipe = {
    ...(kind === "image" ? { kind: "image" as const } : {}),
    title: row.title!,
    ...(num(row.year) ? { year: num(row.year) } : {}),
    from: { ...(row.url ? { url: row.url } : {}), ...(row.page ? { page: row.page } : {}), ...(row.by ? { by: row.by } : {}), sha256 },
    rights: row.rights!,
    licence: row.licence!,
    ...(row.changes ? { changes: row.changes } : {}),
    ...(num(row.start) !== undefined ? { start: num(row.start) } : {}),
    ...(num(row.length) !== undefined ? { length: num(row.length) } : {}),
    ...(row.crop ? { crop: row.crop } : {}),
    ...(num(row.kbps) !== undefined ? { kbps: num(row.kbps) } : {}),
    ...(poster !== undefined ? { poster } : {}),
    ...(row.audio ? { audio: yes(row.audio) } : {}),
    ...(yes(row.denoise) ? { denoise: true } : {}),
    ...(yes(row.flashes) ? { flashes: true } : {}),
    ...(types.length ? { types: SCREENS.filter((s) => types.includes(s)) } : kind === "image" ? { types: IMAGE_TYPES_DEFAULT } : {}),
    ...(format === "png" ? { format: "png" as const } : {}),
  };
  const channels = list(row.channels);
  if (recipe.flashes && channels.length) throw new Error(`${row.file}: it flashes, so it may not be in a default channel.`);
  return { name: row.name || nameOf(recipe.title), recipe, channels };
}

// ---- Encoding.

/** Where originals are kept between runs, by their SHA-256: one copy a machine. */
export const cacheDir = (): string => join(process.env.SNARK_CACHE || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "snark"), "video-sources");

const sha256Of = (file: string): string => new Bun.CryptoHasher("sha256").update(readFileSync(file)).digest("hex");

async function run(args: string[]): Promise<Buffer> {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${args.slice(0, 2).join(" ")} failed:\n${err.slice(-2000)}`);
  return Buffer.from(out);
}

const FFMPEG = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-filter_threads", "1"];

/** Keeps a copy of `file` in the cache under its digest, and gives the digest. */
function keep(file: string): string {
  const sha = sha256Of(file), dir = cacheDir(), to = join(dir, sha + extname(file).toLowerCase());
  mkdirSync(dir, { recursive: true });
  if (!existsSync(to)) {
    try {
      linkSync(file, to);
    } catch {
      copyFileSync(file, `${to}.part`);
      renameSync(`${to}.part`, to);
    }
  }
  return sha;
}

/** The original of `name` in the cache, fetched from its url where it is missing, held to its digest. */
async function original(name: string, r: Recipe): Promise<string> {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const ext = r.from.url ? extname(new URL(r.from.url).pathname).toLowerCase() : "";
  const known = readdirSync(dir).find((f) => f.startsWith(r.from.sha256)) ?? (ext && existsSync(join(dir, name + ext)) ? name + ext : undefined);
  let file = known ? join(dir, known) : "";
  if (!file) {
    if (!r.from.url) throw new Error(`${name}: its original (SHA-256 ${r.from.sha256}) is not in ${dir}. Add it again with bun run screens add.`);
    console.log(`fetch        ${r.from.url}`);
    const res = await fetch(r.from.url, { headers: { "user-agent": "snark-clip-tool/1" } });
    if (!res.ok) throw new Error(`${r.from.url}: ${res.status}`);
    file = join(dir, r.from.sha256 + ext);
    writeFileSync(`${file}.part`, new Uint8Array(await res.arrayBuffer()));
    renameSync(`${file}.part`, file);
  }
  const got = sha256Of(file);
  if (got !== r.from.sha256) throw new Error(`${file} has SHA-256 ${got}, not the recipe's ${r.from.sha256}`);
  return file;
}

interface Probe { width: number; height: number; fps: number; seconds: number; audio: boolean }

async function probe(file: string): Promise<Probe> {
  const out = JSON.parse((await run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate:format=duration", "-of", "json", file])).toString());
  const video = out.streams.find((st: { codec_type: string }) => st.codec_type === "video");
  if (!video) throw new Error(`${file} has no picture.`);
  const [n, d] = String(video.avg_frame_rate).split("/").map(Number);
  return { width: video.width, height: video.height, fps: n! / (d || 1), seconds: Number(out.format.duration), audio: out.streams.some((st: { codec_type: string }) => st.codec_type === "audio") };
}

/** The largest even size of aspect w:h within long × short, the long side along the picture's own. */
export function fit(w: number, h: number, long: number, short: number): [number, number] {
  const [bw, bh] = w >= h ? [long, short] : [short, long];
  const k = Math.min(1, bw / w, bh / h);
  const even = (x: number): number => Math.max(2, 2 * Math.round(x / 2));
  return [even(w * k), even(h * k)];
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);

/**
 * One sample's colours from an RGB24 frame w × h: the mean, then the top, right, bottom and left bands, each about an
 * eighth of the frame, averaged in linear light and written back as sRGB bytes.
 */
export function frameColours(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const rows = Math.max(1, Math.round(h / 8)), cols = Math.max(1, Math.round(w / 8));
  const inPart = [
    () => true,
    (_x: number, y: number) => y < rows,
    (x: number) => x >= w - cols,
    (_x: number, y: number) => y >= h - rows,
    (x: number) => x < cols,
  ];
  const out = new Uint8Array(COLOUR_PARTS * 3);
  for (let p = 0; p < COLOUR_PARTS; p++) {
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!inPart[p]!(x, y)) continue;
        for (let c = 0; c < 3; c++) sum[c]! += srgbToLinear(rgb[(y * w + x) * 3 + c]! / 255);
        n++;
      }
    }
    for (let c = 0; c < 3; c++) out[p * 3 + c] = Math.round(Math.min(1, Math.max(0, linearToSrgb(sum[c]! / n))) * 255);
  }
  return out;
}

/** The colour track of an encoded clip: COLOUR_RATE samples a second of tiny frames. */
async function colourTrack(file: string, width: number, height: number): Promise<Uint8Array> {
  const [w, h] = fit(width, height, 32, 18);
  const raw = await run([...FFMPEG, "-threads", "1", "-i", file, "-vf", `fps=${COLOUR_RATE},scale=${w}:${h}:flags=area:in_color_matrix=bt709:in_range=tv,format=rgb24`, "-f", "rawvideo", "-"]);
  const frame = w * h * 3, samples = Math.floor(raw.length / frame);
  const track = new Uint8Array(samples * COLOUR_PARTS * 3);
  for (let i = 0; i < samples; i++) track.set(frameColours(raw.subarray(i * frame, (i + 1) * frame), w, h), i * COLOUR_PARTS * 3);
  return track;
}

/** Encodes clip `name` from its recipe into its folder: clip.mp4, poster.jpg and clip.json. */
async function makeClip(name: string, dir = SCREENS_DIR): Promise<Clip> {
  const r = readRecipe(name, dir), src = await original(name, r), info = await probe(src);
  const [cw, ch] = r.crop ? (r.crop.split(":").map(Number) as [number, number]) : [info.width, info.height];
  const [w, h] = fit(cw, ch, LONG, SHORT);
  const fps = Math.max(1, Math.round(info.fps)), kbps = Math.min(r.kbps ?? KBPS, CLIP_MAX_KBPS - 100);
  const start = r.start ?? 0, length = Math.min(r.length ?? info.seconds - start, CLIP_MAX_SECONDS);
  const filters = [...(r.crop ? [`crop=${r.crop}`] : []), ...(r.denoise ? ["hqdn3d=2:1.5:4:4"] : []), `scale=${w}:${h}:flags=lanczos:out_color_matrix=bt709:out_range=tv`, "setsar=1", "format=yuv420p"].join(",");
  const work = mkdtempSync(join(tmpdir(), "snark-clip-"));
  try {
    const input = ["-ss", String(start), "-t", String(length), "-i", src];
    const video = ["-map", "0:v:0", "-vf", filters, "-c:v", "libx264", "-threads", "1", "-preset", "slow", "-profile:v", "main", "-level:v", "3.1", "-pix_fmt", "yuv420p",
      "-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.5)}k`, "-bufsize", `${kbps * 2}k`, "-g", String(fps * 2), "-keyint_min", String(fps * 2), "-sc_threshold", "0",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-passlogfile", join(work, "pass")];
    await run([...FFMPEG, ...input, ...video, "-pass", "1", "-an", "-f", "null", "-"]);
    const audio = r.audio && info.audio ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "64k", "-ac", "1"] : ["-an"];
    const part = join(work, "clip.mp4");
    await run([...FFMPEG, ...input, ...video, "-pass", "2", ...audio, "-map_metadata", "-1", "-map_chapters", "-1", "-fflags", "+bitexact", "-flags", "+bitexact", "-movflags", "+faststart", part]);
    const out = await probe(part), bytes = statSync(part).size, seconds = Math.round(out.seconds * 1000) / 1000;
    const colours = await colourTrack(part, out.width, out.height);
    // The poster: the given moment, the sample where the mean is brightest, or a tenth of the way in.
    let at = typeof r.poster === "number" ? r.poster : seconds / 10;
    if (r.poster === "brightest") {
      let best = -1;
      for (let i = 0; i < colours.length / (3 * COLOUR_PARTS); i++) {
        const lum = colours[i * 15]! + colours[i * 15 + 1]! + colours[i * 15 + 2]!;
        if (lum > best) (best = lum, at = i / COLOUR_RATE);
      }
    }
    const [pw, ph] = fit(out.width, out.height, 320, 320), jpg = join(work, "poster.jpg");
    for (let q = 3; ; q++) {
      await run([...FFMPEG, "-threads", "1", "-ss", String(at), "-i", part, "-frames:v", "1", "-vf", `scale=${pw}:${ph}:flags=lanczos:in_color_matrix=bt709:in_range=tv:out_range=pc,format=yuvj420p`, "-c:v", "mjpeg", "-q:v", String(q), "-map_metadata", "-1", "-fflags", "+bitexact", "-flags", "+bitexact", "-f", "image2", jpg]);
      if (statSync(jpg).size <= POSTER_BYTES || q >= 31) break;
    }
    const clip: Clip = {
      id: clipId(sha256Of(part)), title: r.title, file: "clip.mp4", poster: "poster.jpg", width: out.width, height: out.height,
      seconds, bytes, audio: out.audio, rights: r.rights, starter: true, colours: Buffer.from(colours).toString("base64"),
      ...(r.types ? { types: r.types } : {}),
    };
    const rate = (bytes * 8) / seconds / 1000;
    if (Math.max(clip.width, clip.height) > CLIP_MAX_WIDE || Math.min(clip.width, clip.height) > CLIP_MAX_HIGH || rate > CLIP_MAX_KBPS || bytes > CLIP_MAX_BYTES) {
      throw new Error(`${name} is over the caps: ${clip.width}×${clip.height}, ${rate.toFixed(0)} kbit/s, ${bytes} bytes`);
    }
    // In place by a rename each, so a reader sees the old clip or the new one.
    renameSync(part, join(dir, name, "clip.mp4"));
    renameSync(jpg, join(dir, name, "poster.jpg"));
    writeJson(join(dir, name, "clip.json"), clip);
    console.log(`${name.padEnd(28)} ${clip.width}×${clip.height} ${seconds} s ${(bytes / 1e6).toFixed(2)} MB ${rate.toFixed(0)} kbit/s`);
    return clip;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The size an image is fitted to: IMAGE_MAX_LONG on its long side at most, never upscaled. */
export function fitImage(w: number, h: number): [number, number] {
  const k = Math.min(1, IMAGE_MAX_LONG / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Encodes image `name` from its recipe into its folder: image.jpg or image.png, poster.jpg and clip.json. */
async function makeImage(name: string, dir = SCREENS_DIR): Promise<Clip> {
  const r = readRecipe(name, dir), src = await original(name, r), info = await probe(src);
  const [w, h] = fitImage(info.width, info.height), [file, posterFile] = artFiles(r), png = r.format === "png";
  const work = mkdtempSync(join(tmpdir(), "snark-image-"));
  try {
    // Laid on black, so a transparent part is a dark part of the screen.
    const flat = (fw: number, fh: number, fmt: string): string[] => ["-filter_complex", `color=black:s=${fw}x${fh}[bg];[0:v]scale=${fw}:${fh}:flags=lanczos[fg];[bg][fg]overlay=shortest=1,format=${fmt}`];
    const still = ["-threads", "1", "-i", src, "-frames:v", "1", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags", "+bitexact", "-f", "image2"];
    const part = join(work, file);
    if (png) await run([...FFMPEG, ...still, ...flat(w, h, "rgb24"), "-c:v", "png", "-pred", "mixed", "-compression_level", "9", part]);
    else {
      for (let q = 2; ; q++) {
        await run([...FFMPEG, ...still, ...flat(w, h, "yuvj420p"), "-c:v", "mjpeg", "-q:v", String(q), part]);
        if (statSync(part).size <= IMAGE_PACK_BYTES || q >= 31) break;
      }
    }
    const bytes = new Uint8Array(readFileSync(part)), checked = probeImage(bytes);
    if (typeof checked === "string") throw new Error(`${name}: ${checked}`);
    if (bytes.length > IMAGE_PACK_BYTES) throw new Error(`${name} is ${Math.round(bytes.length / 1024)} KB as ${png ? "a PNG; make it a JPEG" : "a JPEG"}, over ${IMAGE_PACK_BYTES / 1024} KB.`);
    // One colour sample from a tiny copy, as a clip's track is made.
    const [cw, ch] = fit(w, h, 32, 18);
    const raw = await run([...FFMPEG, "-threads", "1", "-i", part, "-vf", `scale=${cw}:${ch}:flags=area,format=rgb24`, "-frames:v", "1", "-f", "rawvideo", "-"]);
    const colours = frameColours(raw.subarray(0, cw * ch * 3), cw, ch);
    const [pw, ph] = fit(w, h, 320, 320), jpg = join(work, posterFile);
    for (let q = 3; ; q++) {
      await run([...FFMPEG, "-threads", "1", "-i", part, "-frames:v", "1", "-vf", `scale=${pw}:${ph}:flags=lanczos,format=yuvj420p`, "-c:v", "mjpeg", "-q:v", String(q), "-map_metadata", "-1", "-fflags", "+bitexact", "-flags", "+bitexact", "-f", "image2", jpg]);
      if (statSync(jpg).size <= POSTER_BYTES || q >= 31) break;
    }
    const clip: Clip = {
      id: clipId(sha256Of(part)), title: r.title, file, poster: posterFile, width: checked.width, height: checked.height,
      seconds: 0, bytes: bytes.length, audio: false, rights: r.rights, starter: true, colours: Buffer.from(colours).toString("base64"),
      kind: "image", ...(r.types ? { types: r.types } : {}),
    };
    for (const old of ["image.png", "image.jpg"]) if (old !== file) rmSync(join(dir, name, old), { force: true });
    renameSync(part, join(dir, name, file));
    renameSync(jpg, join(dir, name, posterFile));
    writeJson(join(dir, name, "clip.json"), clip);
    console.log(`${name.padEnd(28)} ${clip.width}×${clip.height} image ${(bytes.length / 1024).toFixed(0)} KB`);
    return clip;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Encodes item `name` from its recipe, a clip or an image, into its folder `dir`. */
export const makeItem = (name: string, dir = SCREENS_DIR): Promise<Clip> => (isImageRecipe(readRecipe(name, dir)) ? makeImage(name, dir) : makeClip(name, dir));

/** Runs `each` over `items`, `jobs` at once. */
async function pool<T>(items: readonly T[], jobs: number, each: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, items.length)) }, async () => {
    while (next < items.length) await each(items[next++]!);
  }));
}

/** The inventory with every item folder's two art files listed once, in place of what it listed of them before. */
function listInInventory(): void {
  const lines = readFileSync(INVENTORY, "utf8").split("\n").filter(Boolean), prefix = PREFIX;
  const at = Math.max(0, lines.findIndex((l) => l.startsWith(prefix)));
  const others = lines.filter((l) => !l.startsWith(prefix));
  const ours = itemNames().flatMap((n) => artFiles(readRecipe(n)).map((f) => `${prefix}${n}/${f}`)).sort();
  others.splice(at === 0 && !lines[0]?.startsWith(prefix) ? others.findIndex((l) => l > prefix) : at, 0, ...ours);
  writeFileSync(INVENTORY, `${others.join("\n")}\n`);
}

/** SOURCES.md: every default item, where it is from, its licence as its source words it, and what we changed. */
function sourcesPage(dir = SCREENS_DIR): string {
  const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");
  const rows = itemNames(dir).map((name) => {
    const r = readRecipe(name, dir), c = readItem(name, dir);
    const from = r.from.url ? `[page](${r.from.page}), [file](${r.from.url})` : `supplied by ${cell(r.from.by ?? "")}`;
    return `| ${cell(r.title)} | ${r.year ?? ""} | ${from} | ${cell(r.licence)} | ${cell(r.changes ?? "")} | \`${name}\` \`${c?.id ?? "not encoded"}\` |`;
  });
  return [
    "# Where the default screen media come from",
    "",
    "`bun run screens` writes this page from each item's `source.json` (README.md says how to add one). Every item is",
    "public domain, CC0, or made for the game by whoever supplied it, and held to its original's SHA-256.",
    "",
    "Every clip is H.264 (main profile, yuv420p, faststart, a keyframe each 2 s) at its original's frame rate, at most",
    `640×360. Every image is a JPEG, or a PNG for flat art, at most ${IMAGE_MAX_LONG} pixels on its long side and`,
    `${IMAGE_PACK_BYTES / 1024} KB. The poster is one frame, 320 pixels on its long side.`,
    "",
    "| Title | Year | Source | Licence, as the source states it | What we changed | Folder, clip id |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** `bun run screens add`: each file's row from the sheet, its original kept, its folder written and encoded, and its channels joined. */
async function add(paths: readonly string[], sheet: string, jobs: number): Promise<void> {
  const rows = parseCsv(readFileSync(sheet, "utf8"));
  const files = paths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => VIDEO_FILES.test(f) || IMAGE_FILES.test(f)).sort().map((f) => join(p, f)) : [p]));
  if (!files.length) throw new Error("No video or image files were given.");
  const taken = new Set(itemNames());
  const plans = files.map((file) => {
    const row = rows.find((r) => r.file === basename(file));
    if (!row) throw new Error(`${basename(file)} has no row in ${sheet}.`);
    const plan = recipeOf(row, "");
    if (!isItemName(plan.name)) throw new Error(`${basename(file)}: "${plan.name}" is not a folder name (lower case words joined by hyphens).`);
    if (taken.has(plan.name)) throw new Error(`${basename(file)}: an item named ${plan.name} is there already. Give the row another name.`);
    taken.add(plan.name);
    return { file, ...plan };
  });
  // Every row is checked before any work, so a sheet with a fault changes nothing.
  for (const p of plans) {
    const sha = keep(p.file);
    mkdirSync(join(SCREENS_DIR, p.name), { recursive: true });
    writeJson(join(SCREENS_DIR, p.name, "source.json"), { ...p.recipe, from: { ...p.recipe.from, sha256: sha } });
  }
  const done: string[] = [];
  await pool(plans, jobs, async (p) => {
    await makeItem(p.name);
    done.push(p.name);
  });
  const channels = readChannels();
  for (const p of plans) for (const name of p.channels) {
    const at = channels.findIndex((c) => c.name === name);
    // A channel the sheet makes is for the first type its first item is offered on.
    const type = p.recipe.types?.[0] ?? "orb";
    if (at < 0) channels.push({ name, shuffle: false, items: [p.name], ...(type !== "orb" ? { type } : {}) });
    else channels[at] = { ...channels[at]!, items: [...channels[at]!.items, p.name] };
  }
  writeJson(CHANNELS_FILE, channels);
  listInInventory();
  writeFileSync(SOURCES_FILE, sourcesPage());
  console.log(`added ${done.length} items. Then: python3 tools/release/pack.py art var/release --only core-screens- and upload what it names.`);
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { list: { type: "string" }, jobs: { type: "string" } } });
  const [command, ...rest] = positionals;
  const jobs = Number(values.jobs) || Math.max(1, Math.floor(availableParallelism() / 2));
  if (command !== "check") for (const tool of ["ffmpeg", "ffprobe"]) if (!Bun.which(tool)) throw new Error(`${tool} is needed`);
  if (command === "add") {
    if (!values.list || !rest.length) throw new Error("bun run screens add <file or folder>... --list sheet.csv");
    await add(rest, values.list, jobs);
  } else if (command === "make") {
    const names = rest.length ? rest : itemNames();
    await pool(names, jobs, (n) => makeItem(n));
    listInInventory();
    writeFileSync(SOURCES_FILE, sourcesPage());
  } else if (command !== "check") throw new Error("bun run screens add | make | check");
  const found = problems();
  for (const p of found) console.log(p);
  console.log(found.length ? `${found.length} problems` : `${itemNames().length} default items, ${readChannels().length} channels: all well`);
  if (found.length) process.exit(1);
}
