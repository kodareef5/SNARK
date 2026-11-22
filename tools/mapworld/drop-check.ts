// Whether every kerb the street model lets down is laid let down, read from a built map (planning/workstreams/bent-sections.md):
//
//   bun tools/mapworld/drop-check.ts <file.snmap> [--list]
//
// Each drop its streets parts mark on a kerb line (a crossing, a drive, a corner's ramp; shared/world/streets.ts
// kerbLines), at the middle of its stretch, against the bent pieces whose kerb's face passes within 2 cm of it there:
// flush, a flare, a raised or worn kerb, or a kerb alone, or none. A raised or worn kerb or a kerb alone at a drop's middle
// is a drop lost (a kerb alone is cut where it is dropped), and there must be none: the tool says how many, and fails if
// there are any. --list says where each is, in the map's metres.

import { readFileSync } from "node:fs";
import { MODEL_HALF, bendVertex, unpackBend } from "../../shared/world/bends.ts";
import { holdStreets, parseMap, readHead, readPart, type StreetsPiece } from "../../shared/world/mapfile.ts";
import { DROP_CROSSING, DROP_DRIVE, DROP_RAMP, StreetSectors, kerbLines, walkOf } from "../../shared/world/streets.ts";

/** How near a piece's kerb's face must pass a drop's middle to be the kerb there. */
const NEAR = 0.02;
/** Points along a piece's face, and the bins pieces are found by. */
const ALONG = 16, BIN = 8;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error("bun tools/mapworld/drop-check.ts <file.snmap> [--list]");
const bytes = new Uint8Array(readFileSync(file));
const head = readHead(bytes, false);

// Every bent piece's kerb's face as a line of points, by the bins it passes through.
const map = parseMap(bytes, false);
const faces: { kind: string; at: Float64Array }[] = [];
const bins = new Map<string, number[]>();
const key = (x: number, z: number): string => `${Math.floor(x / BIN)},${Math.floor(z / BIN)}`;
const out = new Float64Array(11);
for (const s of map.statics) {
  if (!s.bend || !s.kind.startsWith("core:zzzzzbend_")) continue;
  const b = unpackBend(s.bend), a = (s.yaw / 65536) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
  const at = new Float64Array((ALONG + 1) * 2);
  const k = faces.length, seen = new Set<string>();
  for (let q = 0; q <= ALONG; q++) {
    bendVertex(out, b, (q / ALONG - 0.5) * 2 * MODEL_HALF, 0, 0, 0, 1, 0, 1, 0, 0);
    at[q * 2] = s.x + c * out[0]! + sn * out[2]!;
    at[q * 2 + 1] = s.z - sn * out[0]! + c * out[2]!;
    const bin = key(at[q * 2]!, at[q * 2 + 1]!);
    if (!seen.has(bin)) (bins.get(bin) ?? bins.set(bin, []).get(bin)!).push(k), seen.add(bin);
  }
  faces.push({ kind: s.kind, at });
}

/** How far (x, z) is from face `f`'s line. */
function apart(f: Float64Array, x: number, z: number): number {
  let least = Infinity;
  for (let q = 0; q < ALONG; q++) {
    const ax = f[q * 2]!, az = f[q * 2 + 1]!, ex = f[q * 2 + 2]! - ax, ez = f[q * 2 + 3]! - az, l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
    least = Math.min(least, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return least;
}

/** What a piece's kind is at a drop: flush, a flare to or from flush, a raised or worn kerb, or a kerb alone. */
function what(kind: string): "flush" | "flare" | "raised" | "alone" {
  const name = kind.slice("core:zzzzzbend_".length);
  if (name.startsWith("median")) return "alone";
  if (name === "flush_s" || name === "flush_c") return "flush";
  return name.includes("flush") ? "flare" : "raised";
}

const held = new StreetSectors();
for (const p of head.parts) if (p.kind === "streets") holdStreets(held, readPart(head, p, bytes.subarray(p.at, p.at + p.length), false) as StreetsPiece);
const names: Record<number, string> = { [DROP_CROSSING]: "crossing", [DROP_DRIVE]: "drive", [DROP_RAMP]: "ramp" };
const count = { drops: 0, flush: 0, flare: 0, raised: 0, alone: 0, none: 0, gap: 0 };
const byKind: Record<string, number> = {};
const lost: string[] = [];
for (const part of held.parts()) for (const line of kerbLines(held, part)) {
  const d = line.drops;
  if (!d) continue;
  for (let k = 0; k + 2 < d.length; k += 3) {
    count.drops++;
    // The middle of its stretch, on the line between its points.
    const m = (d[k]! + d[k + 1]!) / 2, st = line.stations;
    let q = 0;
    while (q + 2 < st.length && st[q + 1]! < m) q++;
    const t = st[q + 1]! > st[q]! ? Math.max(0, Math.min(1, (m - st[q]!) / (st[q + 1]! - st[q]!))) : 0;
    const x = line.xz[q * 2]! + (line.xz[q * 2 + 2]! - line.xz[q * 2]!) * t, z = line.xz[q * 2 + 1]! + (line.xz[q * 2 + 3]! - line.xz[q * 2 + 1]!) * t;
    const found = new Set<"flush" | "flare" | "raised" | "alone">(), near = new Set<number>();
    for (const dz of [-1, 0, 1]) for (const dx of [-1, 0, 1]) for (const f of bins.get(key(x + dx * BIN, z + dz * BIN)) ?? []) near.add(f);
    for (const f of near) if (apart(faces[f]!.at, x, z) <= NEAR) found.add(what(faces[f]!.kind));
    const worst = found.has("raised") ? "raised" : found.has("alone") ? "alone" : found.has("flare") ? "flare" : found.has("flush") ? "flush" : "none";
    // A kerb alone (no walk, or a verge of half a metre or more behind it: bent-walks.ts) is cut where it is dropped.
    count[worst === "none" && (walkOf(line.kinds) === 0 || line.verge >= 0.5) ? "gap" : worst]++;
    if (worst === "raised" || worst === "alone") {
      const name = `${names[d[k + 2]!] ?? d[k + 2]} ${worst}`;
      byKind[name] = (byKind[name] ?? 0) + 1;
      lost.push(`${name} at ${x.toFixed(2)}, ${z.toFixed(2)}, ${(d[k + 1]! - d[k]!).toFixed(2)} m long`);
    }
  }
}
console.log(`drops marked: ${count.drops}; at each one's middle: flush ${count.flush}, a flare ${count.flare}, a kerb alone's gap ${count.gap}, no kerb on a line with a walk ${count.none}, a raised or worn kerb ${count.raised}, a kerb alone ${count.alone}`);
console.log(`drops lost (a raised or worn kerb or a kerb alone at the middle): ${count.raised + count.alone}${Object.keys(byKind).length > 0 ? ` (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}`);
if (args.includes("--list")) for (const l of lost) console.log(`  ${l}`);
if (count.raised + count.alone > 0) process.exit(1);
