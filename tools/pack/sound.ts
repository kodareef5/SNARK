// Builds the sound file (shared/pack/sound.ts) from every asset's cue sheet: `<asset folder>/sound/sounds.json` names its
// sounds, and for each the takes, as files of the asset's own and the seconds of each file that hold the sound. A take is
// read from its WAV file, mixed to mono, cut, rid of rumble, brought to the sound's rate, faded at its ends, levelled
// and coded losslessly (shared/pack/rice.ts), all here; nothing outside the repository touches it. What is coded is
// kept under .cache by what went in.
//
// The cue sheet:
//
//   { "sounds": { "<name>": { "range": metres, "level": dB, "vary": semitones, "rate"?: Hz, "highpass"?: Hz,
//       "takes": [ { "file": "takes/...wav", "from": "<model>", "start"?: s, "end"?: s, "gain"?: dB } ] } } }
//
// `level` is the loudness, in dB of full scale, of the loud part of each take (the 10 ms windows within 30 dB of its
// loudest), so that takes of one sound play alike. A take whose peak would then pass -1 dB is made quieter to fit.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { SOUND_HEADER_BYTES, SOUND_MAGIC, SOUND_VERSION, encodeTake, takeFits, type ManifestSound } from "../../shared/pack/sound.ts";
import { SOURCE, filesUnder } from "../art/source.ts";
import { partHash } from "./manifest.ts";

export const SOUND_CACHE = resolve(import.meta.dir, "../../.cache/sounds");
/** Samples a second of a sound whose sheet does not say. */
export const SOUND_RATE = 32000;
const PEAK = 10 ** (-1 / 20);
const FADE_IN_MS = 3;
const FADE_OUT_MS = 25;
const HIGHPASS_HZ = 40;

export interface TakeCue {
  file: string;
  from?: string;
  start?: number;
  end?: number;
  gain?: number;
}

export interface SoundCue {
  range: number;
  level: number;
  vary?: number;
  rate?: number;
  highpass?: number;
  takes: TakeCue[];
}

export interface SoundSheet {
  sounds: Record<string, SoundCue>;
}

/** A WAV file's channels as floats from -1 to 1, and its rate. */
export interface Wav {
  rate: number;
  channels: Float32Array[];
}

/** Reads PCM of 8 to 32 bits and floats of 32 or 64, plain or WAVE_FORMAT_EXTENSIBLE. Throws on anything else. */
export function readWav(bytes: Uint8Array): Wav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("wav: not a RIFF WAVE file");
  let format = -1;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: Uint8Array | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE keeps the real format in the first two bytes of its sub-format GUID.
      if (format === 0xfffe && size >= 40) format = view.getUint16(body + 24, true);
    } else if (id === "data") data = bytes.subarray(body, Math.min(bytes.length, body + size));
    at = body + size + (size & 1);
  }
  if (!data || channels === 0) throw new Error("wav: no fmt or data chunk");
  const float = format === 3;
  if (!(format === 1 || float) || (float && bits !== 32 && bits !== 64) || (!float && (bits < 8 || bits > 32 || bits % 8 !== 0))) throw new Error(`wav: format ${format} at ${bits} bits is not read here`);
  const width = bits / 8;
  const frames = Math.floor(data.length / (width * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const at = (f * channels + c) * width;
      let v: number;
      if (float) v = bits === 32 ? d.getFloat32(at, true) : d.getFloat64(at, true);
      else if (bits === 8) v = (d.getUint8(at) - 128) / 128;
      else if (bits === 16) v = d.getInt16(at, true) / 32768;
      else if (bits === 24) v = (((d.getUint8(at + 2) << 24) | (d.getUint8(at + 1) << 16) | (d.getUint8(at) << 8)) >> 8) / 8388608;
      else v = d.getInt32(at, true) / 2147483648;
      out[c]![f] = v;
    }
  }
  return { rate, channels: out };
}

/** A mono 16-bit PCM WAV file, for tests and for listening outside the game. */
export function writeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const put = (at: number, s: string): void => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), true);
  return out;
}

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

/** Brings `input` from rate `from` to rate `to` with a Kaiser-windowed sinc, low-passed below the lower rate's half. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  const ratio = to / from;
  // The cut-off, in cycles per input sample, a little under the lower of the two halves.
  const fc = 0.5 * Math.min(1, ratio) * 0.94;
  const half = Math.ceil(16 / Math.min(1, ratio));
  const beta = 9;
  const i0b = besselI0(beta);
  // The kernel, tabled at FINE points an input sample from its middle out to `half`, and read between them.
  const FINE = 512;
  const table = new Float64Array(half * FINE + 2);
  for (let i = 0; i < table.length; i++) {
    const u = i / FINE;
    const w = u / half;
    const x = 2 * fc * u;
    table[i] = w >= 1 ? 0 : 2 * fc * (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * (besselI0(beta * Math.sqrt(1 - w * w)) / i0b);
  }
  const kernel = (u: number): number => {
    const f = Math.abs(u) * FINE;
    const i = Math.floor(f);
    return i + 1 >= table.length ? 0 : table[i]! + (table[i + 1]! - table[i]!) * (f - i);
  };
  const n = Math.floor(input.length * ratio);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const t = k / ratio;
    const c = Math.floor(t);
    let sum = 0;
    let weight = 0;
    for (let j = c - half + 1; j <= c + half; j++) {
      const h = kernel(t - j);
      weight += h;
      if (j >= 0 && j < input.length) sum += input[j]! * h;
    }
    out[k] = weight > 0 ? sum / weight : 0;
  }
  return out;
}

/** A second-order Butterworth high-pass at `hz`, run forward over the samples in place. */
export function highpass(x: Float32Array, rate: number, hz: number): void {
  if (!(hz > 0)) return;
  const w = (2 * Math.PI * hz) / rate;
  const q = Math.SQRT1_2;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/** The loudness, as RMS in dB of full scale, of the 10 ms windows within 30 dB of the loudest. */
export function loudness(x: Float32Array, rate: number): number {
  const win = Math.max(1, Math.round(rate / 100));
  const energies: number[] = [];
  for (let at = 0; at < x.length; at += win) {
    let e = 0;
    const end = Math.min(x.length, at + win);
    for (let i = at; i < end; i++) e += x[i]! * x[i]!;
    energies.push(e / (end - at));
  }
  const most = Math.max(0, ...energies);
  if (most === 0) return -Infinity;
  const loud = energies.filter((e) => e >= most / 1000);
  return 10 * Math.log10(loud.reduce((a, b) => a + b, 0) / loud.length);
}

export interface PreparedTake {
  /** At the sound's rate, from -1 to 1, before coding. */
  samples: Float32Array;
  /** dB of gain applied to bring it to its level, and whether its peak then had to be brought down to -1 dB. */
  gain: number;
  limited: boolean;
}

/** One take as it goes into the build, before coding. */
export function prepareTake(wav: Wav, take: TakeCue, cue: Pick<SoundCue, "level" | "rate" | "highpass">): PreparedTake {
  const frames = wav.channels[0]!.length;
  const mono = new Float32Array(frames);
  for (const ch of wav.channels) for (let i = 0; i < frames; i++) mono[i]! += ch[i]! / wav.channels.length;
  // Rumble is taken off the whole file, so a cut starts from where the filter has settled.
  highpass(mono, wav.rate, cue.highpass ?? HIGHPASS_HZ);
  const from = Math.max(0, Math.round((take.start ?? 0) * wav.rate));
  const to = Math.min(frames, take.end === undefined ? frames : Math.round(take.end * wav.rate));
  if (to - from < wav.rate / 100) throw new Error(`sound: take ${take.file} from ${take.start} to ${take.end} s is under 10 ms`);
  const rate = cue.rate ?? SOUND_RATE;
  const x = resample(mono.subarray(from, to), wav.rate, rate);
  const fadeIn = Math.min(x.length >> 2, Math.round((rate * FADE_IN_MS) / 1000));
  const fadeOut = Math.min(x.length >> 1, Math.round((rate * FADE_OUT_MS) / 1000));
  for (let i = 0; i < fadeIn; i++) x[i]! *= Math.sin(((i + 0.5) / fadeIn) * (Math.PI / 2)) ** 2;
  for (let i = 0; i < fadeOut; i++) x[x.length - 1 - i]! *= Math.sin(((i + 0.5) / fadeOut) * (Math.PI / 2)) ** 2;
  const now = loudness(x, rate);
  let gain = Number.isFinite(now) ? cue.level + (take.gain ?? 0) - now : 0;
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const limited = peak * 10 ** (gain / 20) > PEAK;
  if (limited) gain = 20 * Math.log10(PEAK / peak);
  const k = 10 ** (gain / 20);
  for (let i = 0; i < x.length; i++) x[i]! *= k;
  return { samples: x, gain, limited };
}

/** 16-bit values of floats from -1 to 1. */
export function toPcm16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(x[i]! * 32767)));
  return out;
}

/** A sound sheet found under the asset folders, and the id of the definition that owns its sounds. */
export interface FoundSheet {
  owner: string;
  dir: string;
  sheet: SoundSheet;
}

/** Every `sound/sounds.json` under `root`. The owner is the pack (the first folder) and the asset's folder: `core:dodo`. */
export function findSheets(root: string = SOURCE): FoundSheet[] {
  return filesUnder(root, "sounds.json")
    .filter((f) => basename(dirname(f)) === "sound")
    .map((f) => {
      const dir = dirname(f);
      const pack = relative(root, dir).split(sep)[0]!;
      return { owner: `${pack}:${basename(dirname(dir))}`, dir, sheet: JSON.parse(readFileSync(f, "utf8")) as SoundSheet };
    });
}

export interface SoundReport {
  sounds: number;
  takes: number;
  seconds: number;
  bytes: number;
  /** Takes coded anew rather than taken from the cache, and takes whose peak was brought down. */
  made: number;
  limited: string[];
  /** Bytes the takes would be as 16-bit samples, against `bytes`. */
  raw: number;
}

const sha = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/**
 * The sound file of every sheet under `root` and its manifest entries, which say it is file `file`. Null when there is
 * no sheet. `cache` is where coded takes are kept, or null for nowhere.
 */
export function buildSounds(file: number, root: string = SOURCE, cache: string | null = SOUND_CACHE): { bytes: Uint8Array; sounds: ManifestSound[]; report: SoundReport } | null {
  const sheets = findSheets(root);
  if (sheets.length === 0) return null;
  const tools = sha(readFileSync(import.meta.path, "utf8") + readFileSync(resolve(import.meta.dir, "../../shared/pack/sound.ts"), "utf8"));
  const report: SoundReport = { sounds: 0, takes: 0, seconds: 0, bytes: 0, made: 0, limited: [], raw: 0 };
  const chunks: Uint8Array[] = [];
  let at = SOUND_HEADER_BYTES;
  const sounds: ManifestSound[] = [];
  const wavs = new Map<string, { bytes: Uint8Array; hash: string }>();
  for (const { owner, dir, sheet } of sheets) {
    for (const [name, cue] of Object.entries(sheet.sounds).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const id = `${owner}/sound/${name}`;
      if (!(cue.range > 0) || !Number.isFinite(cue.level) || !Array.isArray(cue.takes) || cue.takes.length === 0) throw new Error(`sound: ${id} needs a range, a level and a take`);
      const rate = cue.rate ?? SOUND_RATE;
      const entry: ManifestSound = { id, file, at, rate, range: cue.range, vary: cue.vary ?? 0, takes: [] };
      for (const take of cue.takes) {
        const path = join(dir, take.file);
        if (!existsSync(path)) throw new Error(`sound: ${id} names ${take.file}, which is not in ${dir}`);
        let wav = wavs.get(path);
        if (!wav) {
          const bytes = new Uint8Array(readFileSync(path));
          wavs.set(path, (wav = { bytes, hash: sha(bytes) }));
        }
        const key = sha(tools + wav.hash + JSON.stringify([take.start, take.end, take.gain, cue.level, rate, cue.highpass]));
        const kept = cache ? join(cache, key.slice(0, 2), key) : "";
        let coded: Uint8Array | null = null;
        let samples = 0;
        if (kept && existsSync(kept)) {
          const k = new Uint8Array(readFileSync(kept));
          samples = new DataView(k.buffer, k.byteOffset).getUint32(0, true);
          coded = k.subarray(4);
          if (!takeFits(samples, coded.length)) coded = null;
        }
        if (!coded) {
          const prepared = prepareTake(readWav(wav.bytes), take, { ...cue, rate });
          const pcm = toPcm16(prepared.samples);
          samples = pcm.length;
          coded = encodeTake(pcm);
          report.made++;
          if (prepared.limited) report.limited.push(`${id} ${take.file}`);
          if (kept) {
            mkdirSync(dirname(kept), { recursive: true });
            const k = new Uint8Array(4 + coded.length);
            new DataView(k.buffer).setUint32(0, samples, true);
            k.set(coded, 4);
            writeFileSync(`${kept}.${process.pid}.tmp`, k);
            renameSync(`${kept}.${process.pid}.tmp`, kept);
          }
        }
        entry.takes.push({ samples, bytes: coded.length, hash: partHash(coded), ...(take.from ? { from: take.from } : {}) });
        report.raw += samples * 2;
        chunks.push(coded);
        at += coded.length;
        report.takes++;
        report.seconds += samples / rate;
      }
      sounds.push(entry);
      report.sounds++;
    }
  }
  const bytes = new Uint8Array(at);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, SOUND_MAGIC, true);
  view.setUint16(4, SOUND_VERSION, true);
  let w = SOUND_HEADER_BYTES;
  for (const c of chunks) {
    bytes.set(c, w);
    w += c.length;
  }
  report.bytes = bytes.length;
  return { bytes, sounds, report };
}
