// Rows for rooms on a frame's cells: what telling a base's pieces to a flood costs, what the flood costs, and what the
// renderer's finder costs on a chunk laid out whole and after one outer wall goes or comes. On the bases the render
// census draws: 2,000 pieces with a wall every third line, 20,000 with one on every line.
// `bun tools/bench/rooms.ts` runs these alone; `bun run bench` does not.

import "../../client/core/render/city-late.ts";
import { RoomFinder, Rooms } from "../../client/core/render/rooms.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { Enclosure, enclose } from "../../shared/world/lattice/rooms.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { corePack } from "../../tests/fixtures/pack.ts";
import { boxBase } from "./base.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const DIMS = { chunksX: 8, chunksZ: 8 };
const AT = 64 * 6 + 0.5;

/** The least of `runs` timings of `run`, in milliseconds. */
function least(runs: number, run: () => void): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    run();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

export function roomsRows(section: Section, record: Row): void {
  const { registry: reg, errors } = compileContent(CORE_CONTENT);
  if (!reg) throw new Error(errors.join("\n"));
  const hf = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 64);
  const make = (): StructureStore => new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims: DIMS, hf, structs: make() }, reg, corePack());
  const finder = new RoomFinder(reg, scene.meshOfKind, corePack().header.meshes, scene.assets.table.error);
  for (const [n, every, most] of [[14, 3, 2000], [21, 1, 20000]] as const) {
    section(`Rooms of a base of ${most.toLocaleString("en")} wooden pieces in one chunk`);
    const structs = make();
    for (const [kind, x, y, z, yaw] of boxBase(reg, "wood", AT, 0, AT, n, every, most)) structs.add(kind, x, y, z, yaw, 1, 1000);
    const [f] = [...structs.frames.all()];
    const chunk = structs.held[0]!;
    const t = structs.chunks[chunk]!;
    const enc = new Enclosure(reg.forms);
    record("to tell a flood every piece", least(30, () => enclose(structs, f!.gid, enc)), "ms");
    enc.flood();
    record("air cells", enc.found.cells, "");
    record("of them in rooms", enc.found.inside, "");
    record("rooms", enc.found.rooms, "");
    // An outer wall of the first storey: without it the room behind it is open.
    const wall = reg.index.get("core:wall_wood")!;
    let slot = 0;
    while (t.kind[slot] !== wall || Math.abs(t.z[slot]! - AT) > 0.01) slot++;
    const row = [t.kind[slot]!, t.k0![slot]!, t.k1![slot]!] as const;
    const flip = (): void => {
      enc.remove(...row, slot);
      enc.flood();
      enc.add(...row, slot);
      enc.flood();
    };
    record("to flood it again after one wall goes or comes", least(200, flip) / 2, "ms", 3);
    enc.remove(...row, slot);
    record("one slice of 256 faces or cells of that flood", least(400, () => {
      if (!enc.flood(256)) return;
      enc.add(...row, slot);
      enc.remove(...row, slot);
    }), "ms");
    // The renderer's finder on the chunk: laid out whole, then brought up to date as that wall goes and comes.
    record("the renderer's finder, the chunk whole", least(20, () => finder.find(t, 384, 384, new Rooms(), structs.frames)), "ms");
    const rooms = new Rooms();
    finder.find(t, 384, 384, rooms, structs.frames);
    const pose = [t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!] as const;
    let spent = 0;
    for (let i = 0; i < 100; i++) {
      structs.remove(chunk * 65536 + slot);
      let t0 = performance.now();
      finder.find(t, 384, 384, rooms, structs.frames);
      spent += performance.now() - t0;
      if ((structs.add(...pose, 1, 1000) & 0xffff) !== slot) throw new Error("the wall came back in another slot");
      t0 = performance.now();
      finder.find(t, 384, 384, rooms, structs.frames);
      spent += performance.now() - t0;
    }
    record("the renderer's finder after that wall goes or comes, the mean", spent / 200, "ms");
    let shell = 0;
    for (let s = 0; s < t.high; s++) if (rooms.shell[s] === 1) shell++;
    record("pieces it leaves to be drawn from outside", shell, "");
  }
}

if (import.meta.main) {
  roomsRows(
    (title) => console.log(`\n${title}`),
    (name, value, unit) => console.log(`  ${name.padEnd(72)} ${value.toFixed(value < 10 ? 3 : 0).padStart(12)} ${unit}`),
  );
}
