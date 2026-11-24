// Rows for the builder's preview by itself (client/core/build.ts): what one frame of it costs with a piece in hand, the
// look still and the look sweeping, beside a base of 2,000 pieces and one of 20,000; the first reading of the view; and
// a row of 32 dragged out. `bun tools/bench/preview.ts` runs these alone; `bun run bench` does not.

import { Builder } from "../../client/core/build.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { boxBase } from "./base.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const TEAM = 9000;
const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;
const worst = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.99)] ?? 0;

export function previewRows(section: Section, record: Row): void {
  const { registry: reg, errors } = compileContent(CORE_CONTENT);
  if (!reg) throw new Error(errors.join("\n"));
  const dims = { chunksX: 8, chunksZ: 8 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const item = (name: string): number => reg.index.get(`core:piece_${name}_stone`)!;

  for (const [pieces, side] of [[2000, 14], [20000, 40]] as const) {
    section(`The builder's preview beside a base of ${pieces.toLocaleString("en-US")} pieces`);
    const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    for (const [kind, x, y, z, yaw] of boxBase(reg, "stone", 190, 0, 190, side, 3, pieces)) structs.add(kind, x, y, z, yaw, TEAM, 100);
    const world: CollisionWorld = { hf, structs };
    // The builder stands outside the south wall, at its middle, with walls in hand.
    const own = { x: 190 + side * 1.5, y: 0, z: 186 };
    const inventory = { hotbar: 0, cap: 10, version: 1, count: new Uint16Array(10).fill(100), item: new Uint16Array(10).fill(item("wall")), total: () => 100 };
    const session = { inventory, held: 0, handChanging: false, tribe: { team: TEAM }, own, ownKind: reg.index.get("core:human")!, ownHandle: 1, world } as unknown as ClientSession;
    const b = new Builder();
    const dir = [0, 0, 0];
    let frame = 0;
    const step = (yaw: number, pitch: number): number => {
      lookDirection(Math.round((yaw / (2 * Math.PI)) * 65536) & 0xffff, Math.round((pitch / (Math.PI / 2)) * 16384), dir);
      const t0 = performance.now();
      b.update(session, world, reg, own.x, own.y + 1.62, own.z, dir[0]!, dir[1]!, dir[2]!, yaw, frame++ * 16);
      return performance.now() - t0;
    };
    // The view is read over the first frames with a piece in hand.
    const reading: number[] = [];
    for (let f = 0; f < 60; f++) reading.push(step(0, -0.2));
    record("frames until the view holds the base", reading.findIndex((ms, f) => f > 0 && ms < 0.05) , "");
    record("a frame while the view is first read, worst", Math.max(...reading), "ms");
    for (const [name, piece] of [["a wall", "wall"], ["a ceiling", "ceiling"], ["a foundation", "foundation"]] as const) {
      inventory.item.fill(item(piece));
      for (let f = 0; f < 30; f++) step(0, -0.2);
      const still: number[] = [];
      for (let f = 0; f < 600; f++) still.push(step(0, -0.2));
      record(`${name}: a frame with the look still, median`, median(still), "ms", 0.02);
      const sweeping: number[] = [];
      for (let f = 0; f < 1200; f++) sweeping.push(step(0.5 * Math.sin(f / 37), -0.25 + 0.35 * Math.sin(f / 23)));
      record(`${name}: a frame with the look sweeping, median`, median(sweeping), "ms", 0.5);
      record(`${name}: a frame with the look sweeping, 99 in 100`, worst(sweeping), "ms");
      b.showOthers = false;
      const plain: number[] = [];
      for (let f = 0; f < 1200; f++) plain.push(step(0.5 * Math.sin(f / 37), -0.25 + 0.35 * Math.sin(f / 23)));
      b.showOthers = true;
      record(`${name}: the other slots' marks in that, median`, median(sweeping) - median(plain), "ms", 0.1);
    }
  }
}

if (import.meta.main) {
  previewRows((title) => console.log(`\n${title}`), (name, value, unit, budget = null) => {
    const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
    console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 4 : 1).padStart(12)} ${unit}${verdict}`);
  });
}
