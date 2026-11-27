// The lab's decisions on disk (tools/decide/dataset.ts): what is written is read back exactly.
import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PROFILES, RING_FAR, RING_MID } from "../../shared/decide/profiles.ts";
import { Writer, decode, emptyManifest, encode, meanCosts, pack, readData, targetOf, unpack, type Decision } from "../../tools/decide/dataset.ts";

const ROOT = join(import.meta.dir, "../..");

function decision(seed: number): Decision {
  const k = 12, S = 3, R = 3;
  const tables = [RING_MID, RING_FAR].map((p, n) => ({
    profile: p.name, k,
    state: Float32Array.from(p.state, (_, i) => (i + seed) / 7),
    rows: Float32Array.from({ length: k * p.columns.length }, (_, i) => Math.sin(i * (n + 1) + seed)),
    bias: Float32Array.from({ length: k }, (_, i) => (i === 3 ? 0.5 : 0)),
    mask: Uint8Array.from({ length: k }, (_, i) => (i % 5 === 0 ? 1 : 0)),
  }));
  const costs = Float32Array.from({ length: k * S * R }, (_, i) => (Math.floor(i / (S * R)) % 5 === 0 ? NaN : 100 + ((i * 37) % 23) + 1 / 3));
  return { seed, family: seed % 2 ? "trees" : "pen", map: seed > 2 ? "miami" : "flat", ordinal: seed * 3, tick: 400 + seed, pick: seed % k, label: 0, seeds: S, readings: R, tables, costs, today: Float32Array.of(1, 2, 3, NaN, 5, 6, 7, 8, 9) };
}

test("decisions written are read back bit for bit, NaN and all", () => {
  const m = emptyManifest("lab.ring", "choice");
  const ds = [1, 2, 3].map(decision);
  const bytes = new Uint8Array(ds.flatMap((d) => [...encode(d, m, PROFILES)]));
  const back = decode(bytes, m);
  expect(back.length).toBe(3);
  // Bytes of every typed array compared, so a NaN must come back as the same NaN.
  const raw = (d: Decision) => JSON.stringify(d, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(new Uint8Array((v as Uint8Array).buffer, (v as Uint8Array).byteOffset, (v as Uint8Array).byteLength)) : v));
  for (let i = 0; i < 3; i++) expect(raw(back[i]!)).toBe(raw(ds[i]!));
  expect(m.families).toEqual(["trees", "pen"]);
  expect(m.maps).toEqual(["flat", "miami"]);
  expect(raw(unpack(pack(ds[2]!)))).toBe(raw(ds[2]!));
});

test("a dataset folder keeps its manifest and rows, and a second run appends", () => {
  const dir = join(ROOT, ".cache/decide/test", `dataset-${process.pid}`);
  try {
    const run = { made: "now", revision: "test", under: "rule" };
    const w = new Writer(dir, "lab.ring", "choice", PROFILES, run, true);
    w.add(decision(1));
    w.add(decision(2));
    w.save();
    const more = new Writer(dir, "lab.ring", "choice", PROFILES, { ...run, under: "a.json" });
    more.add(decision(3));
    more.save();
    const { manifest, decisions } = readData(dir, PROFILES);
    expect([manifest.decisions, manifest.runs.map((r) => [r.under, r.decisions]), manifest.scenes.map((s) => s.seed)]).toEqual([3, [["rule", 2], ["a.json", 1]], [1, 2, 3]]);
    expect(decisions.map((d) => d.ordinal)).toEqual([3, 6, 9]);
    expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).profiles.map((p: { name: string }) => p.name)).toEqual(["ring.mid", "ring.far"]);
    // A manifest of other columns is refused.
    expect(() => readData(dir, PROFILES.filter((p) => p !== RING_FAR))).toThrow("ring.far");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a candidate's target is how often it was best across seeds, ties sharing", () => {
  const d = decision(1);
  d.tables = d.tables.map((t) => ({ ...t, k: 3 }));
  d.seeds = 2;
  d.readings = 1;
  // Candidate 0 best in seed 0; 1 and 2 tie for best in seed 1.
  d.costs = Float32Array.of(5, 9, 7, 8, NaN, 8);
  expect(Array.from(targetOf(d, 0))).toEqual([0.5, 0.25, 0.25]);
  expect(Array.from(meanCosts(d, 0))).toEqual([7, 7.5, 8]);
});
