// What a piece leaving a near chunk's mesh costs a client's frame (client/core/render/nearcity.ts): one piece shot out of
// the Miami slice's busiest chunk, 1,024 gone in one tick, and the chunk's mesh made again once it is quiet. Each as
// the near city's own milliseconds in the frame (NearCity.of and NearCity.end) over a frame in which nothing changes,
// and as bytes put on the card. The whole frame is given beside it: the far layers follow a piece that goes too (the far
// city's levels, the far shadow, the street's reflections), which is their work and not counted here.
// `bun tools/bench/breaking.ts` runs these alone.

import { nearMeshSlot } from "../../client/core/render/nearcity.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { miamiSlice } from "../../tests/fixtures/cityslice.ts";
import { nearClient } from "../../tests/fixtures/nearclient.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;

export function benchBreaking(section: Section, record: Row): void {
  const w = nearClient(miamiSlice().map);
  const { cam, hf, city, dims, scene, structs } = w;
  const near = scene.near!;
  // The chunk with most pieces a mesh draws, seen from its middle at eye height with the window round it whole.
  let chunk = 0, most = 0;
  for (let c = 0; c < dims.chunksX * dims.chunksZ; c++) {
    let n = 0;
    for (let i = city.first[c]!; i < city.first[c + 1]!; i++) n += near.kinds[city.kind[i]!]!;
    if (n > most) [chunk, most] = [c, n];
  }
  const [x, z] = [(chunkCx(dims, chunk) + 0.5) * CHUNK_SIZE, (chunkCz(dims, chunk) + 0.5) * CHUNK_SIZE];
  [cam.x, cam.z, cam.y, cam.yaw] = [x, z, hf.heightAt(x, z) + 1.7, 0.6];
  w.follow(x, z);
  near.pieces = Infinity;
  for (let f = 0; f < 6; f++) w.frame();
  near.pieces = 400;
  scene.city!.makeMs = 2;
  // The near city's own milliseconds in a frame, and the frame's.
  let own = 0, whole = 0;
  const timed = near as unknown as Record<"of" | "end", (...a: unknown[]) => unknown>;
  for (const name of ["of", "end"] as const) {
    const fn = timed[name].bind(near);
    timed[name] = (...a) => {
      const t = performance.now();
      const out = fn(...a);
      own += performance.now() - t;
      return out;
    };
  }
  const frame = (): number => {
    own = 0;
    const t = performance.now();
    w.frame();
    whole = performance.now() - t;
    return own;
  };
  const mesh = near.chunk(chunk)!.mesh!;
  section(`A piece leaving a near mesh: the Miami slice's chunk ${chunk}, ${most} pieces, ${mesh.shown} faces shown and ${mesh.faces - mesh.shown} kept, ${(mesh.bytes / 1024).toFixed(0)} KB`);
  const wholes: number[] = [];
  const still = median(Array.from({ length: 120 }, () => (frame(), wholes.push(whole), own)));
  const stillFrame = median(wholes);
  record("a frame in which nothing changes: the near city's own work", still, "ms");
  record("a frame in which nothing changes: the whole frame", stillFrame, "ms");

  // One piece a frame, 60 times over: each frame's cost over a still one, and the most it put on the card.
  const rng = new Rng(3);
  const mine = (c: number): number[] => Array.from(near.chunk(c)!.drawn, (v, s) => (v === 1 ? s : -1)).filter((s) => s >= 0);
  const pieces = mine(chunk);
  const ms: number[] = [], all: number[] = [];
  let bytes = 0, laid = 0, dropped = 0;
  const count = (p: ReturnType<typeof w.frame>): void => {
    bytes = Math.max(bytes, near.stats.states);
    laid += near.stats.laid;
    dropped += p.assetDrops.filter(nearMeshSlot).length;
  };
  for (let k = 0; k < 60; k++) {
    w.remove(chunk, pieces.splice(rng.int(pieces.length), 1)[0]!);
    own = 0;
    const t = performance.now();
    const p = w.frame();
    all.push(performance.now() - t);
    ms.push(own);
    count(p);
  }
  record("one piece from the chunk: the near city's work over a still frame's, aimed under 0.2", Math.max(0, median(ms) - still), "ms");
  record("one piece from the chunk: the whole frame over a still one, the far layers' following among it", Math.max(0, median(all) - stillFrame), "ms");
  record("one piece from the chunk: bytes of states on the card", bytes, "bytes", 16384);
  record("one piece from the chunk: meshes let go and pieces laid out", dropped + laid, "", 0);

  // 1,024 pieces of the nine chunks in one tick.
  const round: number[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) round.push(chunk + dz * dims.chunksX + dx);
  const standing = round.filter((c) => near.chunk(c)?.mesh).flatMap((c) => mine(c).map((s) => [c, s] as const));
  for (let n = 0; n < 1024 && standing.length > 0; n++) {
    const [c, s] = standing.splice(rng.int(standing.length), 1)[0]!;
    w.remove(c, s);
  }
  bytes = laid = dropped = 0;
  own = 0;
  let t = performance.now();
  let p = w.frame();
  const wave = performance.now() - t;
  count(p);
  record("1,024 pieces of nine chunks in one tick: the near city's work over a still frame's, aimed under 1.5", Math.max(0, own - still), "ms");
  record("1,024 pieces: the whole frame over a still one", Math.max(0, wave - stillFrame), "ms");
  record("1,024 pieces: bytes of states on the card", bytes, "bytes", 147 * 1024);
  record("1,024 pieces: meshes let go and pieces laid out", dropped + laid, "", 0);
  const opened = near.chunk(chunk)!.mesh!;
  record("the chunk's kept faces now drawn, of those it shows", (100 * opened.opened) / opened.shown, "%");

  // Left alone, its meshes are made again of what stands, a band a frame, the old one drawn until the new is on the card.
  const making: number[] = [];
  let without = 0, uploaded = 0, remade = 0, frames = 0;
  for (; frames < 1500 && round.some((c) => near.chunk(c)?.stale); frames++) {
    own = 0;
    p = w.frame();
    if (near.stats.steps > 0) making.push(own);
    for (const c of structs.held) if (!near.chunk(c)?.mesh) without++;
    for (const u of p.assetUploads) if (nearMeshSlot(u.slot)) uploaded += u.data.length + (u.piece?.length ?? 0);
    laid += near.stats.laid;
    remade += near.stats.remade;
  }
  record("the quiet remake: meshes made again", remade, `in ${making.length} frames of making, done ${(frames / 60).toFixed(1)} s after the wave`);
  record("the quiet remake: the near city's work in a frame of making over a still one's, median, aimed under 1", Math.max(0, median(making) - still), "ms");
  record("the quiet remake: the same in the worst frame of making", Math.max(0, Math.max(...making) - still), "ms");
  record("the quiet remake: bytes of meshes put on the card", uploaded, "bytes");
  record("the quiet remake: frames a chunk went without a mesh, and pieces laid out", without + laid, "", 0);
}

if (import.meta.main) {
  let missed = false;
  benchBreaking(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => {
      const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
      if (verdict.includes("MISS")) missed = true;
      console.log(`  ${name.padEnd(112)} ${value.toFixed(value < 10 && !Number.isInteger(value) ? 3 : 0).padStart(10)} ${unit}${verdict}`);
    },
  );
  if (missed) process.exit(1);
}
