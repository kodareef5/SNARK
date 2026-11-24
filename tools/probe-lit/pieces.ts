// A near chunk's mesh drawn by its pieces' states on a GPU (client/core/render/pieces.ts), a check of tools/probe-lit.ts.
// A frame building across a chunk border on medium, whole, then with a floor plate, a pier and a wall gone by their
// states alone: the meshes the card holds are those made with them. The plate that goes held the edge of the plate
// beside it, which is the next chunk's, so that edge shows by a row of the states that is not its mesh's own. Held to
// the software rasterizer pixel by pixel over what the building covered while whole, so a face the vertex text failed
// to drop, or one it kept and failed to show, is a patch of wrong colour. Then two of what stands are worn, which the
// vertex text darkens by their states (PIECE_SHADE) and the lit text marks.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { nearMeshSlot } from "../../client/core/render/nearcity.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { bodyHealth } from "../../shared/world/breaking.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { FLOOR, PIER, WALL, building, cityWorld } from "../../tests/fixtures/cityworld.ts";
import { buildCorePack } from "../pack/build.ts";
import { PICK_STRUCTURE } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [640, 360];
/** A channel within this many levels of the rasterizer's is the same colour, as in the far city's check. */
const SAME = 6;
const MOST_OFF = 0.01;

interface Held {
  frame: number;
  name: string;
  color: Uint8Array;
  /** Pixels the building covered while whole, a 1 each. */
  covered: Uint8Array;
}

const made = { key: "", held: [] as Held[], uploads: 0, gone: 0 };

/** Of the pixels `h` marks whose 3 by 3 neighbours are of one colour in the rasterizer: how many, and how many the GPU has more than SAME off. */
function compare(gpu: Uint8Array, h: Held): { n: number; bad: number; worst: number } {
  const out = { n: 0, bad: 0, worst: 0 };
  const off = (a: Uint8Array, b: Uint8Array, at: number, bt = at): number => Math.max(...[0, 1, 2].map((c) => Math.abs(a[at * 4 + c]! - b[bt * 4 + c]!)));
  for (let y = 1; y < H - 1; y++) {
    next: for (let x = 1; x < W - 1; x++) {
      const at = y * W + x;
      if (h.covered[at] !== 1) continue;
      for (let dy = -W; dy <= W; dy += W) for (let dx = -1; dx <= 1; dx++) if (off(h.color, h.color, at + dy + dx, at) > 2) continue next;
      const o = off(gpu, h.color, at);
      out.n++;
      if (o > SAME) out.bad++;
      out.worst = Math.max(out.worst, o);
    }
  }
  return out;
}

export const piecesCheck: LitCheck = {
  name: "a near mesh drawn by its pieces' states (pieces.ts)",

  shots(): Shot[] {
    const bytes = buildCorePack();
    const [x, z] = [3 * CHUNK_SIZE, 3.5 * CHUNK_SIZE];
    const w = cityWorld({ chunks: 8, statics: building(x, z, 0, 3, 2, 0), tier: tierOf("medium"), width: W, height: H, pack: parsePack(bytes) });
    // The rasterizer draws no haze (D264), so these frames carry none.
    w.scene.plainSky = true;
    w.scene.near!.pieces = Infinity;
    const shot = new Shot("pieces-medium", W, H, w.hf, bytes);
    made.key = shot.key;
    made.held.length = made.uploads = made.gone = 0;
    for (let cz = 2; cz <= 4; cz++) for (let cx = 2; cx <= 4; cx++) w.rows(cz * w.dims.chunksX + cx);
    let covered = new Uint8Array(W * H);
    // Every frame goes to the GPU, so what each puts on the card is there for the next.
    const frame = (read: boolean): void => {
      w.scene.now += 1000 / 60;
      const p = w.scene.build(w.cam, null);
      w.raster.render(p);
      made.uploads += p.assetUploads.filter((u) => nearMeshSlot(u.slot)).length;
      shot.add(p, read);
    };
    const hold = (name: string, whole: boolean): void => {
      frame(false);
      frame(true);
      if (whole) covered = w.raster.pickKind.map((k) => (k === PICK_STRUCTURE ? 1 : 0));
      made.held.push({ frame: shot.frames.length - 1, name, color: Uint8Array.from(w.raster.color), covered });
    };
    w.scene.resetUploads();
    // From the side of the higher chunk, so that the lower one's plate shows its edge once its neighbour is gone.
    w.look(x, 6, z, 34, 0.7 + Math.PI, 16);
    for (let f = 0; f < 3; f++) frame(false);
    hold("the building whole", true);
    // A plate of the top floor in the higher chunk, one of a merged box of two; a pier and a wall of the lower chunk.
    const meshes = made.uploads;
    const gone = (id: string, px: number): void => {
      const chunk = w.chunkOf(px, z), t = w.structs.chunks[chunk]!, first = w.statics.first[chunk]!;
      let best = -1;
      for (let s = 0; s < w.statics.in(chunk); s++) {
        if (w.reg.defs[w.statics.kind[first + s]!]!.id === id && t.kind[s] !== 0 && (best < 0 || w.statics.y[first + s]! >= w.statics.y[first + best]!)) best = s;
      }
      w.structs.put(chunk, best, 0, 0, 0, 0, 0, 0, 0, t.version + ++made.gone);
      hold(`${made.gone} gone, a ${id.split("_")[1]} of chunk ${chunk}`, false);
    };
    gone(FLOOR, x + 4);
    gone(PIER, x - 4);
    gone(WALL, x - 4);
    // What stands wears: a wall cracked and a pier failing are darker by their stage in the vertex text, by their
    // states alone, and the wall beside neither.
    let step = 0;
    const worn = (id: string, px: number, share: number): void => {
      const chunk = w.chunkOf(px, z), t = w.structs.chunks[chunk]!, first = w.statics.first[chunk]!;
      let best = -1;
      for (let s = 0; s < w.statics.in(chunk); s++) {
        if (w.reg.defs[w.statics.kind[first + s]!]!.id === id && t.kind[s] !== 0 && (best < 0 || w.statics.y[first + s]! >= w.statics.y[first + best]!)) best = s;
      }
      const version = t.version + made.gone + ++step;
      w.structs.put(chunk, best, t.kind[best]!, t.x[best]!, t.y[best]!, t.z[best]!, t.yaw[best]!, 0, Math.fround(bodyHealth(w.reg, t.kind[best]!) * share), version);
      w.structs.setVersion(chunk, version);
      hold(`a ${id.split("_")[1]} of chunk ${chunk} at ${share} of its health`, false);
    };
    worn(WALL, x - 4, 0.25);
    worn(PIER, x + 4, 0.1);
    made.uploads -= meshes;
    return [shot];
  },

  judge(back: Readback) {
    const lines: string[] = [];
    // The pieces left by their states: no mesh went on the card for them.
    let ok = made.uploads === 0 && made.gone === 3;
    lines.push(`${made.gone} pieces gone, ${made.uploads} meshes put on the card for them  ${ok ? "ok" : "FAIL"}`);
    let last: Uint8Array | null = null;
    for (const h of made.held) {
      const gpu = back.pixels(made.key, h.frame);
      if (!gpu) {
        lines.push(`${h.name}: NO PICTURE`);
        ok = false;
        continue;
      }
      const c = compare(gpu, h);
      // Each piece that goes changes what the card draws.
      let moved = 0;
      for (let i = 0; last && i < gpu.length; i += 4) if (Math.abs(gpu[i]! - last[i]!) + Math.abs(gpu[i + 1]! - last[i + 1]!) + Math.abs(gpu[i + 2]! - last[i + 2]!) > 3 * SAME) moved++;
      const pass = c.n >= 2000 && c.bad <= c.n * MOST_OFF && (!last || moved >= 50);
      ok &&= pass;
      lines.push(`${h.name}: ${c.n - c.bad} of ${c.n} pixels of the building within ${SAME} of the rasterizer, the worst ${c.worst} off${last ? `, ${moved} pixels changed` : ""}  ${pass ? "ok" : "FAIL"}`);
      last = gpu;
    }
    return { ok, lines };
  },
};
