// The starter clips the Vegas ball ships with (planning/workstreams/screen-video.md). Each source is fetched once into
// the machine's cache and held to its SHA-256, cut, encoded to H.264 at 640×360 or less, and given a poster and a colour
// track. ffmpeg runs here alone: the game never encodes or decodes a clip itself.
//
//   bun tools/video/clips.ts        fetch what is missing, encode every clip, write clips.json and SOURCES.md
//
// The same sources and the same ffmpeg give the same bytes: one thread, fixed flags, no dates in the files.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CLIP_MAX_BYTES, CLIP_MAX_HIGH, CLIP_MAX_KBPS, CLIP_MAX_SECONDS, CLIP_MAX_WIDE, COLOUR_PARTS, COLOUR_RATE, clipId, type Clip } from "../../shared/video/clip.ts";

export const ROOT = resolve(import.meta.dir, "../..");
export const CLIPS_DIR = join(ROOT, "assets/source/core/video/clips");
export const SOURCES_FILE = join(ROOT, "assets/source/core/video/SOURCES.md");

/** What a clip is made from and how. Times are seconds into the source. */
export interface Source {
  readonly name: string;
  readonly title: string;
  readonly year: number;
  /** The file fetched, exactly. */
  readonly url: string;
  /** The page that states its rights. */
  readonly page: string;
  readonly sha256: string;
  readonly rights: string;
  /** The rights as the page words them, quoted in SOURCES.md. */
  readonly licence: string;
  readonly start: number;
  readonly length: number;
  /** An ffmpeg crop that takes off black bars, before the scale. */
  readonly crop?: string;
  /** Grain is taken down a little before the encode: old film's grain costs bits and shows nothing at puck size. */
  readonly denoise: boolean;
  readonly audio: boolean;
  readonly kbps: number;
  /** Seconds into the cut clip, or the brightest sample of its colour track. */
  readonly poster: number | "brightest";
  /** In the default strip of clips. A clip that flashes is left out. */
  readonly strip: boolean;
  /** What was done to it, for SOURCES.md. */
  readonly changes: string;
}

const LOC_RIGHTS = "The Library of Congress is not aware of any U.S. copyright or other restrictions in the vast majority of motion pictures in these collections. Absent any such restrictions, these materials are free to use and reuse.";
const CC0_DEED = "This file is made available under the Creative Commons CC0 1.0 Universal Public Domain Dedication. The person who associated a work with this deed has dedicated the work to the public domain by waiving all of their rights to the work worldwide under copyright law, including all related and neighboring rights, to the extent allowed by law. You can copy, modify, distribute and perform the work, even for commercial purposes, all without asking permission.";

export const SOURCES: readonly Source[] = [
  {
    name: "sneeze", title: "Fred Ott's Sneeze", year: 1894,
    url: "https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00180290/00180290.mp4",
    page: "https://www.loc.gov/item/00694192/",
    sha256: "7c4c96f0f072ea64c3d8946dee17bd7ec7c9e1577aafe6318d0082a2a30ba9e4",
    rights: "Edison Manufacturing Co., 1894 (copyright 1894, expired): public domain in the U.S. Library of Congress, Motion Picture, Broadcasting, and Recorded Sound Division.",
    licence: `"${LOC_RIGHTS}" Catalogue: "(c) W. K. L. Dickson; 9Jan1894; 2887".`,
    start: 13.08, length: 14.55, denoise: true, audio: false, kbps: 400, poster: 1, strip: true,
    changes: "Cut to the film from 13.08 s for 14.55 s, which leaves out the Library's slate and title card; the Library's copy shows the sneeze several times. Grain softened, scaled to 480×360, silent track removed.",
  },
  {
    name: "black-diamond", title: "New Black Diamond Express", year: 1900,
    url: "https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00064200/00064200.mp4",
    page: "https://www.loc.gov/item/00694259/",
    sha256: "04481cf84937f473543c1a1785bf9386a367a3406066e407151c47dee5f43e4e",
    rights: "Thomas A. Edison, 1900 (copyright 1900, expired): public domain in the U.S. Library of Congress, Motion Picture, Broadcasting, and Recorded Sound Division.",
    licence: `"${LOC_RIGHTS}" Catalogue: "Copyright: Thomas A. Edison; 26May1900; D11027."`,
    start: 13.08, length: 37.9, denoise: true, audio: false, kbps: 400, poster: 26, strip: true,
    changes: "Cut to the film from 13.08 s for 37.9 s, which leaves out the Library's slate and title card. Grain softened, scaled to 480×360, silent track removed.",
  },
  {
    name: "train-robbery", title: "The Great Train Robbery (excerpt)", year: 1903,
    url: "https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00000765/00000765.mp4",
    page: "https://www.loc.gov/item/00694220/",
    sha256: "fd9ad5affe38208ac8afa1cd311a109ba86daa200aaef75a9485a2b06ee032d9",
    rights: "Edwin S. Porter for Thomas A. Edison, 1903 (copyright 1903, expired): public domain in the U.S. Library of Congress, Motion Picture, Broadcasting, and Recorded Sound Division.",
    licence: `"${LOC_RIGHTS}" Catalogue: "Copyright: Thomas A. Edison; 1Dec1903; H38748."`,
    start: 586.5, length: 111.5, crop: "1524:1080:166:0", denoise: true, audio: false, kbps: 400, poster: 110, strip: true,
    changes: "Cut to the last scenes, from 586.5 s for 111.5 s: the chase, the shoot-out and the bandit firing at the camera. Black side bars cropped, grain softened, scaled to 508×360, silent track removed.",
  },
  {
    name: "clouds", title: "Flight over clouds", year: 2025,
    url: "https://upload.wikimedia.org/wikipedia/commons/2/2d/Flight_over_clouds.webm",
    page: "https://commons.wikimedia.org/wiki/File:Flight_over_clouds.webm",
    sha256: "b9fb9f05b919a6f45248fdfd463bde2421fbd1c33d31560a8c3d124d232298f2",
    rights: "L. Shyamal, 2025, Wikimedia Commons: CC0 1.0, dedicated to the public domain.",
    licence: `"${CC0_DEED}"`,
    start: 0, length: 12.4, denoise: false, audio: false, kbps: 600, poster: 6, strip: true,
    changes: "Whole. Scaled from 1080×1920 to 360×640. It has no sound.",
  },
  {
    name: "lightning", title: "Lightning storm over Colorado", year: 2023,
    url: "https://upload.wikimedia.org/wikipedia/commons/6/66/Lightning_storm_over_Colorado%2C_USA.ogg",
    page: "https://commons.wikimedia.org/wiki/File:Lightning_storm_over_Colorado,_USA.ogg",
    sha256: "6b67ad1c08df58964f196b8423dc7081d5e6a15c32035f26d02b93e78fc155b5",
    rights: "NathanScientific, 2023, Wikimedia Commons: CC0 1.0, dedicated to the public domain.",
    licence: `"I, the copyright holder of this work, hereby publish it under the following license: ${CC0_DEED}"`,
    start: 0, length: 24.8, denoise: false, audio: false, kbps: 600, poster: "brightest", strip: false,
    changes: "Whole. Scaled from 1920×1080 to 640×360. Its Vorbis track is digital silence (a time-lapse of a frame each 5 s has no sound of its own), so it was removed. It flashes, so it is not in the strip.",
  },
];

/** Where sources are kept between runs: one copy a machine. */
export const cacheDir = (): string => join(process.env.SNARK_CACHE || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "snark"), "video-sources");

const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

function run(args: string[]): Buffer {
  const r = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${args.slice(0, 2).join(" ")} failed:\n${r.stderr.toString().slice(-2000)}`);
  return r.stdout;
}

const FFMPEG = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-filter_threads", "1"];

/** The source's file in the cache, fetched if it is missing, held to its digest. */
async function fetchSource(s: Source): Promise<string> {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${s.name}.${s.url.split(".").pop()}`);
  if (!existsSync(file)) {
    console.log(`fetch        ${s.url}`);
    const res = await fetch(s.url, { headers: { "user-agent": "snark-clip-tool/1" } });
    if (!res.ok) throw new Error(`${s.url}: ${res.status}`);
    writeFileSync(`${file}.part`, new Uint8Array(await res.arrayBuffer()));
    renameSync(`${file}.part`, file);
  }
  const got = sha256(readFileSync(file));
  if (got !== s.sha256) throw new Error(`${file} has SHA-256 ${got}, not the pinned ${s.sha256}`);
  return file;
}

interface Probe { width: number; height: number; fps: number; seconds: number; audio: boolean }

function probe(file: string): Probe {
  const out = JSON.parse(run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate:format=duration", "-of", "json", file]).toString());
  const video = out.streams.find((st: { codec_type: string }) => st.codec_type === "video");
  const [n, d] = String(video.avg_frame_rate).split("/").map(Number);
  return { width: video.width, height: video.height, fps: n! / (d || 1), seconds: Number(out.format.duration), audio: out.streams.some((st: { codec_type: string }) => st.codec_type === "audio") };
}

/** The largest even size of aspect w:h within long × short, the long side along the picture's own. */
export function fit(w: number, h: number, long: number, short: number): [number, number] {
  const [bw, bh] = w >= h ? [long, short] : [short, long];
  const k = Math.min(bw / w, bh / h);
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
function colourTrack(file: string, width: number, height: number): Uint8Array {
  const [w, h] = fit(width, height, 32, 18);
  const raw = run([...FFMPEG, "-threads", "1", "-i", file, "-vf", `fps=${COLOUR_RATE},scale=${w}:${h}:flags=area:in_color_matrix=bt709:in_range=tv,format=rgb24`, "-f", "rawvideo", "-"]);
  const frame = w * h * 3, samples = Math.floor(raw.length / frame);
  const track = new Uint8Array(samples * COLOUR_PARTS * 3);
  for (let i = 0; i < samples; i++) track.set(frameColours(raw.subarray(i * frame, (i + 1) * frame), w, h), i * COLOUR_PARTS * 3);
  return track;
}

/** Encodes one clip into `dir` as <name>.mp4 and <name>.jpg and gives its manifest entry. */
async function makeClip(s: Source, dir: string): Promise<Clip> {
  const src = await fetchSource(s);
  const info = probe(src);
  const [cw, ch] = s.crop ? s.crop.split(":").map(Number) as [number, number] : [info.width, info.height];
  const [w, h] = fit(cw, ch, 640, 360);
  const fps = Math.round(info.fps);
  const filters = [...(s.crop ? [`crop=${s.crop}`] : []), ...(s.denoise ? ["hqdn3d=2:1.5:4:4"] : []), `scale=${w}:${h}:flags=lanczos:out_color_matrix=bt709:out_range=tv`, "setsar=1", "format=yuv420p"].join(",");
  const work = mkdtempSync(join(tmpdir(), "snark-clip-"));
  try {
    const input = ["-ss", String(s.start), "-t", String(s.length), "-i", src];
    const video = ["-map", "0:v:0", "-vf", filters, "-c:v", "libx264", "-threads", "1", "-preset", "slow", "-profile:v", "main", "-level:v", "3.1", "-pix_fmt", "yuv420p",
      "-b:v", `${s.kbps}k`, "-maxrate", `${Math.round(s.kbps * 1.5)}k`, "-bufsize", `${s.kbps * 2}k`, "-g", String(fps * 2), "-keyint_min", String(fps * 2), "-sc_threshold", "0",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-passlogfile", join(work, "pass")];
    run([...FFMPEG, ...input, ...video, "-pass", "1", "-an", "-f", "null", "-"]);
    const audio = s.audio ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "64k", "-ac", "1"] : ["-an"];
    const part = join(work, `${s.name}.mp4`);
    run([...FFMPEG, ...input, ...video, "-pass", "2", ...audio, "-map_metadata", "-1", "-map_chapters", "-1", "-fflags", "+bitexact", "-flags", "+bitexact", "-movflags", "+faststart", part]);
    const mp4 = join(dir, `${s.name}.mp4`);
    renameSync(part, mp4);
    const out = probe(mp4);
    const bytes = statSync(mp4).size;
    const seconds = Math.round(out.seconds * 1000) / 1000;
    const colours = colourTrack(mp4, out.width, out.height);
    // The poster: the given moment, or the sample where the mean is brightest.
    let at = typeof s.poster === "number" ? s.poster : 0;
    if (s.poster === "brightest") {
      let best = -1;
      for (let i = 0; i < colours.length / (3 * COLOUR_PARTS); i++) {
        const lum = colours[i * 15]! + colours[i * 15 + 1]! + colours[i * 15 + 2]!;
        if (lum > best) (best = lum, at = i / COLOUR_RATE);
      }
    }
    const [pw, ph] = fit(out.width, out.height, 320, 320);
    const jpg = join(dir, `${s.name}.jpg`);
    for (let q = 3; ; q++) {
      run([...FFMPEG, "-threads", "1", "-ss", String(at), "-i", mp4, "-frames:v", "1", "-vf", `scale=${pw}:${ph}:flags=lanczos:in_color_matrix=bt709:in_range=tv:out_range=pc,format=yuvj420p`, "-c:v", "mjpeg", "-q:v", String(q), "-map_metadata", "-1", "-fflags", "+bitexact", "-flags", "+bitexact", "-f", "image2", jpg]);
      if (statSync(jpg).size <= 40 * 1024 || q >= 31) break;
    }
    const clip: Clip = {
      id: clipId(sha256(readFileSync(mp4))), title: s.title, file: `${s.name}.mp4`, poster: `${s.name}.jpg`, width: out.width, height: out.height,
      seconds, bytes, audio: out.audio, rights: s.rights, starter: true, colours: Buffer.from(colours).toString("base64"),
    };
    const kbps = (bytes * 8) / seconds / 1000;
    if (Math.max(clip.width, clip.height) > CLIP_MAX_WIDE || Math.min(clip.width, clip.height) > CLIP_MAX_HIGH || kbps > CLIP_MAX_KBPS || seconds > CLIP_MAX_SECONDS || bytes > CLIP_MAX_BYTES) {
      throw new Error(`${s.name} is over the caps: ${clip.width}×${clip.height}, ${kbps.toFixed(0)} kbit/s, ${seconds} s, ${bytes} bytes`);
    }
    console.log(`${s.name.padEnd(14)}${clip.width}×${clip.height} ${seconds} s ${(bytes / 1e6).toFixed(2)} MB ${kbps.toFixed(0)} kbit/s, poster ${statSync(jpg).size} bytes`);
    return clip;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function sourcesPage(clips: readonly Clip[], ffmpeg: string): string {
  const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");
  const rows = SOURCES.map((s, i) => {
    const c = clips[i]!;
    const hash = sha256(readFileSync(join(CLIPS_DIR, c.file)));
    return `| ${cell(s.title)} | ${s.year} | [page](${s.page}), [file](${s.url}) | ${cell(s.licence)} | ${cell(s.changes)} | \`${c.file}\` \`${hash}\` |`;
  });
  return [
    "# Where the starter clips come from",
    "",
    "`bun tools/video/clips.ts` writes this page, the clips and their posters, and `clips/clips.json`. Each source is",
    "public domain or CC0, fetched from the file named here and held to its SHA-256 in the tool's table. The Library of",
    "Congress films were published in the U.S. before 1930, so their copyright has run out.",
    "",
    "Every clip is H.264 (main profile, yuv420p, faststart, a keyframe each 2 s) at the source's frame rate. The",
    "poster is one frame of the clip, 320 pixels on its long side. No later music or sound was added to any of them.",
    "",
    `Made with ${ffmpeg}.`,
    "",
    "| Title | Year | Source | Licence, as the page states it | What we changed | File, SHA-256 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

if (import.meta.main) {
  for (const tool of ["ffmpeg", "ffprobe"]) if (!Bun.which(tool)) throw new Error(`${tool} is needed`);
  mkdirSync(CLIPS_DIR, { recursive: true });
  const clips: Clip[] = [];
  for (const s of SOURCES) clips.push(await makeClip(s, CLIPS_DIR));
  const strip = SOURCES.flatMap((s, i) => (s.strip ? [clips[i]!.id] : []));
  writeFileSync(join(CLIPS_DIR, "clips.json"), `${JSON.stringify({ clips, strip }, null, 2)}\n`);
  const ffmpeg = run(["ffmpeg", "-version"]).toString().split("\n")[0]!.replace(/ Copyright.*/, "");
  writeFileSync(SOURCES_FILE, sourcesPage(clips, ffmpeg));
  const total = clips.reduce((n, c) => n + c.bytes, 0);
  console.log(`clips        ${clips.length}, ${(total / 1e6).toFixed(2)} MB, in ${CLIPS_DIR}`);
}
