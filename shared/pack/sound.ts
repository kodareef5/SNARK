// Sounds in an asset build. A sound is a name a definition owns, such as `core:dodo/sound/call`, and one or more takes
// of it, of which the engine plays one at a time. A build keeps every sound in one file of its own:
//
//   0   "SNSD"
//   4   u16 version, u16 0
//   8   the takes, one after another, each sound's takes together, where the manifest says
//
// A take is mono, at its sound's rate, coded as IMA ADPCM (four bits a sample, as the IMA's 1992 recommendation
// for digital audio on personal computers and Microsoft's WAVE format 0x11 code it):
//
//   0   i16 the first sample, which is also where the prediction starts
//   2   u8  the step index the prediction starts at, 0 to 88
//   3   u8  0
//   4   a nibble for each sample after the first, the low nibble of a byte first
//
// A client fetches a sound's takes together as one range, checks each against its hash, and decodes them to floats.

export const SOUND_MAGIC = 0x44534e53; // "SNSD" little-endian
export const SOUND_VERSION = 1;
export const SOUND_HEADER_BYTES = 8;
export const TAKE_HEADER_BYTES = 4;

/** A take of a sound: its samples, its bytes as coded, their hash, and the model or method that made it. */
export interface ManifestTake {
  samples: number;
  bytes: number;
  hash: string;
  from?: string;
}

export interface ManifestSound {
  /** `<owner>/sound/<name>`: the definition that owns it, and the occasion it is for. */
  id: string;
  /** Index into the manifest's files, and where in that file its first take starts. Its takes follow one another. */
  file: number;
  at: number;
  /** Samples a second. */
  rate: number;
  /** Metres from its source at which it can no longer be heard. */
  range: number;
  /** Semitones of pitch a play may be moved by at random, either way. */
  vary: number;
  takes: ManifestTake[];
}

const STEPS = Int16Array.from([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279,
  307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428,
  4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]);
const INDEX_MOVE = Int8Array.from([-1, -1, -1, -1, 2, 4, 6, 8]);
const LAST_INDEX = STEPS.length - 1;

/** Bytes of a take of `samples` samples. */
export function takeBytes(samples: number): number {
  return TAKE_HEADER_BYTES + Math.ceil(Math.max(0, samples - 1) / 2);
}

/** The prediction after `code`, from `pred` at step index `index`. */
function predict(pred: number, index: number, code: number): number {
  const step = STEPS[index]!;
  let diff = step >> 3;
  if (code & 1) diff += step >> 2;
  if (code & 2) diff += step >> 1;
  if (code & 4) diff += step;
  const p = code & 8 ? pred - diff : pred + diff;
  return p < -32768 ? -32768 : p > 32767 ? 32767 : p;
}

function moveIndex(index: number, code: number): number {
  const i = index + INDEX_MOVE[code & 7]!;
  return i < 0 ? 0 : i > LAST_INDEX ? LAST_INDEX : i;
}

/** Writes `samples` (16-bit values) as a take into `out` from `at`, and returns the bytes written. */
export function encodeTake(samples: Int16Array, out: Uint8Array, at = 0): number {
  const n = samples.length;
  const bytes = takeBytes(n);
  if (n === 0) {
    out.fill(0, at, at + bytes);
    return bytes;
  }
  let pred = samples[0]!;
  // The first step suits the first few changes, so the start is not smeared while the step grows into the sound.
  let change = 0;
  for (let i = 1; i < Math.min(n, 9); i++) change += Math.abs(samples[i]! - samples[i - 1]!);
  change /= Math.max(1, Math.min(n, 9) - 1);
  let index = 0;
  while (index < LAST_INDEX && STEPS[index]! < change) index++;
  out[at] = pred & 255;
  out[at + 1] = (pred >> 8) & 255;
  out[at + 2] = index;
  out[at + 3] = 0;
  out.fill(0, at + TAKE_HEADER_BYTES, at + bytes);
  for (let i = 1; i < n; i++) {
    // Each code is chosen by the error it leaves on this sample and on the best of the next, so the step keeps up with an
    // attack. Any IMA decoder reads the result.
    const want = samples[i]!;
    const next = i + 1 < n ? samples[i + 1]! : want;
    let best = 0;
    let bestCost = Infinity;
    for (let code = 0; code < 16; code++) {
      const p = predict(pred, index, code);
      const e = p - want;
      let cost = e * e;
      if (cost >= bestCost) continue;
      if (i + 1 < n) {
        const ni = moveIndex(index, code);
        let least = Infinity;
        for (let c2 = 0; c2 < 16; c2++) {
          const e2 = predict(p, ni, c2) - next;
          if (e2 * e2 < least) least = e2 * e2;
        }
        cost += least;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = code;
      }
    }
    pred = predict(pred, index, best);
    index = moveIndex(index, best);
    const k = at + TAKE_HEADER_BYTES + ((i - 1) >> 1);
    out[k]! |= (i - 1) & 1 ? best << 4 : best;
  }
  return bytes;
}

/**
 * Decodes a take of `samples` samples from `data` into `out` as floats from -1 to 1. Returns false, with `out` left as far as
 * it got, when the data is too short or its start index is not one.
 */
export function decodeTake(data: Uint8Array, samples: number, out: Float32Array): boolean {
  if (samples === 0) return true;
  if (data.length < takeBytes(samples) || out.length < samples) return false;
  let pred = ((data[0]! | (data[1]! << 8)) << 16) >> 16;
  let index = data[2]!;
  if (index > LAST_INDEX) return false;
  out[0] = pred / 32768;
  for (let i = 1; i < samples; i++) {
    const byte = data[TAKE_HEADER_BYTES + ((i - 1) >> 1)]!;
    const code = (i - 1) & 1 ? byte >> 4 : byte & 15;
    pred = predict(pred, index, code);
    index = moveIndex(index, code);
    out[i] = pred / 32768;
  }
  return true;
}

/** What is wrong with a manifest's sounds against its files, or "" if nothing. */
export function soundFault(sounds: readonly ManifestSound[], files: readonly { role: string; bytes: number }[]): string {
  const seen = new Set<string>();
  for (const s of sounds) {
    if (typeof s.id !== "string" || !/^[a-z0-9_]+:[a-z0-9_]+\/sound\/[a-z0-9_/]+$/.test(s.id) || seen.has(s.id)) return `sound "${String(s.id)}" is listed twice or is not named <owner>/sound/<name>`;
    seen.add(s.id);
    const file = files[s.file];
    if (file?.role !== "sound") return `sound ${s.id} names a file that holds no sounds`;
    if (!(s.rate >= 8000 && s.rate <= 96000) || !(s.range > 0) || !(s.vary >= 0 && s.vary <= 12)) return `sound ${s.id} has a rate, range or variation out of bounds`;
    if (!Array.isArray(s.takes) || s.takes.length === 0) return `sound ${s.id} has no take`;
    let bytes = 0;
    for (const t of s.takes) {
      if (!(t.samples > 0) || t.bytes !== takeBytes(t.samples) || typeof t.hash !== "string") return `a take of ${s.id} is not the size its samples give`;
      bytes += t.bytes;
    }
    if (!(s.at >= SOUND_HEADER_BYTES) || s.at + bytes > file.bytes) return `sound ${s.id} lies outside its file`;
  }
  return "";
}
