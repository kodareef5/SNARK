// A scorer as a file: plain JSON, read into a Model only when it was made for the profile it is asked to score.

import type { Model } from "./forward.ts";
import { inputsOf, profileHash, type Profile } from "./profile.ts";

export interface ModelFile {
  profile: string;
  hash: number;
  inputs: number;
  hidden: number;
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number;
  temperature: number;
  /** Where it came from: the data, the revision, its scores. Not read by the scorer. */
  about?: Record<string, unknown>;
}

const numbers = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** The model in `file` for profile `p`, or in words why it cannot be used. */
export function readModel(file: unknown, p: Profile): Model | string {
  const f = file as Partial<ModelFile> | null;
  if (f === null || typeof f !== "object") return "not a weights file";
  if (f.profile !== p.name) return `made for ${String(f.profile)}, not ${p.name}`;
  if (f.hash !== profileHash(p)) return `made for other columns of ${p.name}`;
  const n = inputsOf(p), h = f.hidden;
  if (f.inputs !== n) return `reads ${String(f.inputs)} numbers where ${p.name} gives ${n}`;
  if (typeof h !== "number" || !Number.isInteger(h) || h < 0 || h > 256) return "a hidden layer of no size";
  if (!numbers(f.w1, (h === 0 ? 1 : h) * n) || !numbers(f.b1, h) || !numbers(f.w2, h)) return "weights of the wrong length";
  if (typeof f.b2 !== "number" || !Number.isFinite(f.b2)) return "no constant";
  const t = typeof f.temperature === "number" && f.temperature > 0 ? f.temperature : 1;
  return { profile: p.name, hash: f.hash, inputs: n, hidden: h, w1: Float32Array.from(f.w1), b1: Float32Array.from(f.b1), w2: Float32Array.from(f.w2), b2: f.b2, temperature: t };
}

export function writeModel(m: Model, about?: Record<string, unknown>): ModelFile {
  return { profile: m.profile, hash: m.hash, inputs: m.inputs, hidden: m.hidden, w1: Array.from(m.w1), b1: Array.from(m.b1), w2: Array.from(m.w2), b2: m.b2, temperature: m.temperature, ...(about ? { about } : {}) };
}
