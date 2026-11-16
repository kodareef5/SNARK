// Sounds in an asset build. A sound is a name a definition owns, such as `core:dodo/sound/call`, and one or more takes
// of it, of which the engine plays one at a time. A build keeps the sounds the game plays in one file of its own:
//
//   0   "SNSD"
//   4   u16 version, u16 0
//   8   the takes, one after another, each sound's takes together, where the manifest says
//
// A take is mono at its sound's rate, coded as shared/pack/transform.ts says. A client fetches a sound's takes together
// as one range, checks each against its hash, and decodes them to floats.

import { decodeTransform } from "./transform.ts";

export const SOUND_MAGIC = 0x44534e53; // "SNSD" little-endian
export const SOUND_VERSION = 2;
export const SOUND_HEADER_BYTES = 8;

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

/** Whether `bytes` could hold a take of `samples` samples: its frame and a coded byte, and no more than 32 bits a sample
 * past what its first frames take however short it is. */
export function takeFits(samples: number, bytes: number): boolean {
  return bytes >= 2 && bytes <= 1024 + samples * 4;
}

/**
 * Decodes a take of `samples` samples from `data` into `out` as floats from -1 to 1. Returns false, with `out` left as far as
 * it got, when the data is not such a take.
 */
export function decodeTake(data: Uint8Array, samples: number, out: Float32Array): boolean {
  return out.length >= samples && samples > 0 && decodeTransform(data, samples, out);
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
      if (!(t.samples > 0) || !takeFits(t.samples, t.bytes) || typeof t.hash !== "string") return `a take of ${s.id} is not the size its samples give`;
      bytes += t.bytes;
    }
    if (!(s.at >= SOUND_HEADER_BYTES) || s.at + bytes > file.bytes) return `sound ${s.id} lies outside its file`;
  }
  return "";
}
