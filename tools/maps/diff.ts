// Two built maps compared part by part:
//
//   bun tools/maps/diff.ts <a.snmap> <b.snmap> [--near <lattice x>,<lattice z>] [--list]
//
// A part is named by its kind and its square on the lattice, so two cuts of one city compare square by square. Each part
// that differs is told with how far its square stands inside the edge the two maps share, and from --near (metres on the
// lattice, a chunk's column times 64) where given. A square a map holds only in part is "clipped": its bytes differ by
// the cut alone. Exits 1 when any part differs.

import { closeSync, openSync, readSync } from "node:fs";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { OVERVIEW_CHUNKS, readHead, type MapHead, type MapPart, type PartKind } from "../../shared/world/mapfile.ts";

/** One square's part as the two maps have it. */
export interface PartDiff {
  readonly kind: PartKind | "head";
  readonly col: number;
  readonly row: number;
  /** "same", "changed", or held by one map alone. */
  readonly state: "same" | "changed" | "only a" | "only b";
  /** Whether either map holds only some of its square's chunks. */
  readonly clipped: boolean;
  /** Metres from its square to the nearest edge of the ground both maps hold; negative outside it. */
  readonly inside: number;
  /** Metres from its square to `near`, where given. */
  readonly from?: number;
}

/** A map's chunk rectangle on the lattice: west to east as columns count, south to north as rows do. */
const extent = (h: MapHead): [number, number, number, number] => [h.dims.frameX, h.dims.frameZ, h.dims.frameX + h.dims.chunksX, h.dims.frameZ + h.dims.chunksZ];
const sizeOf = (kind: PartKind): number => (kind === "overview" || kind === "tops" ? OVERVIEW_CHUNKS : SECTOR_CHUNKS);
const keyOf = (p: MapPart): string => `${p.kind} ${p.col} ${p.row}`;

/** How each part of `a` and `b` compares, the head first, then by kind, row and column. */
export function diffMaps(a: MapHead, b: MapHead, near?: { readonly x: number; readonly z: number }): PartDiff[] {
  const [ea, eb] = [extent(a), extent(b)];
  const both = [Math.max(ea[0], eb[0]), Math.max(ea[1], eb[1]), Math.min(ea[2], eb[2]), Math.min(ea[3], eb[3])];
  const square = (p: MapPart): [number, number, number, number] => {
    const s = p.kind === "land" ? 0 : sizeOf(p.kind);
    return s === 0 ? [both[0]!, both[1]!, both[2]!, both[3]!] : [p.col * s, p.row * s, (p.col + 1) * s, (p.row + 1) * s];
  };
  const within = (sq: number[], e: number[]): boolean => sq[0]! >= e[0]! && sq[1]! >= e[1]! && sq[2]! <= e[2]! && sq[3]! <= e[3]!;
  const row = (p: MapPart, state: PartDiff["state"]): PartDiff => {
    const sq = square(p);
    const inside = Math.min(sq[0]! - both[0]!, sq[1]! - both[1]!, both[2]! - sq[2]!, both[3]! - sq[3]!) * CHUNK_SIZE;
    const clipped = p.kind !== "land" && (!within(sq, ea) || !within(sq, eb));
    const from = near && Math.hypot(Math.max(sq[0]! * CHUNK_SIZE - near.x, near.x - sq[2]! * CHUNK_SIZE, 0), Math.max(sq[1]! * CHUNK_SIZE - near.z, near.z - sq[3]! * CHUNK_SIZE, 0));
    return { kind: p.kind, col: p.col, row: p.row, state, clipped, inside, ...(from === undefined ? {} : { from }) };
  };
  const inB = new Map(b.parts.map((p) => [keyOf(p), p]));
  const out: PartDiff[] = [{ kind: "head", col: 0, row: 0, state: a.hash === b.hash ? "same" : "changed", clipped: false, inside: 0 }];
  for (const p of a.parts) {
    const q = inB.get(keyOf(p));
    inB.delete(keyOf(p));
    out.push(row(p, !q ? "only a" : q.hash === p.hash ? "same" : "changed"));
  }
  for (const q of inB.values()) out.push(row(q, "only b"));
  return out;
}

/** The head of the map file at `path`, read alone. */
export function headOf(path: string): MapHead {
  const fd = openSync(path, "r");
  try {
    const start = new Uint8Array(16);
    readSync(fd, start, 0, 16, 0);
    const bytes = new Uint8Array(new DataView(start.buffer).getUint32(12, true));
    readSync(fd, bytes, 0, bytes.length, 0);
    return readHead(bytes, false);
  } finally {
    closeSync(fd);
  }
}

/** Lines for the owner: counts by kind, then each part that differs, nearest first where `near` is given. */
export function report(rows: readonly PartDiff[], list: boolean): string[] {
  const lines: string[] = [];
  const kinds = [...new Set(rows.map((r) => r.kind))];
  for (const k of kinds) {
    const of = rows.filter((r) => r.kind === k), differ = of.filter((r) => r.state !== "same");
    const unclipped = differ.filter((r) => !r.clipped);
    const deepest = unclipped.reduce((m, r) => Math.max(m, r.inside), -Infinity);
    lines.push(`${k}: ${of.length - differ.length} same, ${differ.length} differ${differ.length > unclipped.length ? ` (${differ.length - unclipped.length} clipped)` : ""}${unclipped.length > 0 && k !== "head" && k !== "land" ? `, deepest ${deepest} m inside the shared edge` : ""}`);
  }
  if (list) {
    const differ = rows.filter((r) => r.state !== "same").sort((p, q) => (p.from ?? 0) - (q.from ?? 0) || q.inside - p.inside);
    for (const r of differ) lines.push(`  ${r.kind} ${r.col}-${r.row} ${r.state}${r.clipped ? " clipped" : ""}, ${r.inside} m inside${r.from === undefined ? "" : `, ${Math.round(r.from)} m from the point`}`);
  }
  return lines;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const files = args.filter((a, k) => !a.startsWith("--") && args[k - 1] !== "--near");
  if (files.length !== 2) {
    console.error("bun tools/maps/diff.ts <a.snmap> <b.snmap> [--near <lattice x>,<lattice z>] [--list]");
    process.exit(2);
  }
  const at = args.indexOf("--near");
  const [x, z] = at >= 0 ? args[at + 1]!.split(",").map(Number) : [NaN, NaN];
  const rows = diffMaps(headOf(files[0]!), headOf(files[1]!), Number.isFinite(x) ? { x: x!, z: z! } : undefined);
  for (const line of report(rows, args.includes("--list"))) console.log(line);
  process.exit(rows.every((r) => r.state === "same") ? 0 : 1);
}
