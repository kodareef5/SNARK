// Trees, rocks and bushes past the near node field, placed by the client from the map (farnodes.ts).
import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FAR_NODE_BUFFERS, NodeChanges, farNodeOf } from "../../client/core/render/farnodes.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { DRAW_TEXTURED, FRAME, type FramePacket } from "../../client/core/render/packet.ts";
import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz, type MapDims } from "../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { formOf, mix, type NodeForms, type NodeSource } from "../../shared/world/nodes.ts";
import { FarCells, farTopByte } from "../../shared/world/tactical.ts";
import { HELD, WOOD, nodeWorld, type NodeWorld } from "../fixtures/nodeworld.ts";

/** A node as a frame draws it: its mesh, level, place in the world, turn and size. */
interface Drawn {
  mesh: number;
  level: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  size: number;
  far: boolean;
}

/** Every node a frame draws, by chunk * 65536 + slot. Throws if one is drawn twice. */
function drawnNodes(w: NodeWorld, p: FramePacket): Map<number, Drawn> {
  const out = new Map<number, Drawn>();
  // A draw in both depth ranges is listed once in each.
  const runs = new Set<string>();
  for (let d = 0; d < p.drawCount; d++) {
    const buffer = p.drawBuffer[d]!;
    const far = buffer >= FAR_NODE_BUFFERS;
    if (!far && (buffer < NODE_BUFFERS || buffer >= NODE_BUFFERS * 2)) continue;
    const run = `${buffer}/${p.drawFirst[d]}/${p.drawInstances[d]}`;
    if (runs.has(run)) continue;
    runs.add(run);
    const held = w.card.get(buffer)!;
    const view = new DataView(held.data.buffer);
    const [ox, oy, oz] = [p.drawOffset[d * 3]! + p.camX, p.drawOffset[d * 3 + 1]! + p.camY, p.drawOffset[d * 3 + 2]! + p.camZ];
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
      const [chunk, slot] = far ? farNodeOf(w.dims, buffer, held.slots[i]!) : [buffer - NODE_BUFFERS, held.slots[i]!];
      const key = chunk * 65536 + slot;
      if (out.has(key)) throw new Error(`node ${chunk}/${slot} drawn twice`);
      const at = i * INSTANCE_BYTES;
      out.set(key, { mesh: p.drawMesh[d]!, level: p.drawLod[d]!, x: view.getFloat32(at, true) + ox, y: view.getFloat32(at + 4, true) + oy, z: view.getFloat32(at + 8, true) + oz, yaw: view.getUint16(at + 12, true), size: held.data[at + 19]!, far });
    }
  }
  return out;
}

const wood = (): NodeWorld => nodeWorld({ chunksX: 24, chunksZ: 12, kinds: [WOOD, WOOD, "core:tree", "core:rock", "core:bush"], ground: (x, z) => 20 + 6 * Math.sin(x / 90) * Math.cos(z / 70) });

test("a node drawn far stands where the near store puts it, with the same mesh, turn and size, at its mesh's last level", () => {
  const w = wood();
  const z = 6 * CHUNK_SIZE + 20;
  // The body stands in chunk 4 of its row, so the near field holds chunks 1 to 7 and chunk 8 is far. The camera looks along it.
  w.stand(4 * CHUNK_SIZE + 60, z);
  w.look(4 * CHUNK_SIZE + 60, 24, z, Math.PI / 2, -0.05);
  w.scene.nodesFar!.makes = Infinity;
  w.frame();
  const before = drawnNodes(w, w.frame());
  const chunk = chunkAt(w.dims, 8 * CHUNK_SIZE + 1, z);
  w.stand(5 * CHUNK_SIZE + 1, z);
  w.cam.x = 5 * CHUNK_SIZE + 1;
  const after = drawnNodes(w, w.frame());
  let compared = 0;
  const meshes = new Set<number>();
  for (const [key, b] of before) {
    if (Math.floor(key / 65536) !== chunk) continue;
    const a = after.get(key)!;
    expect([b.far, a.far]).toEqual([true, false]);
    expect([b.mesh, b.yaw, b.size]).toEqual([a.mesh, a.yaw, a.size]);
    for (const k of ["x", "y", "z"] as const) expect(Math.abs(b[k] - a[k])).toBeLessThan(0.002);
    // Far, a node is its mesh's last level; near, here, the near store's rule gives that or the one before.
    expect(b.level).toBe(w.scene.assets.table.error[b.mesh]!.length - 1);
    expect(Math.abs(b.level - a.level)).toBeLessThanOrEqual(1);
    meshes.add(a.mesh);
    compared++;
  }
  // Every node of the chunk drawn far is drawn near after: both of the wood's variants and the three grey boxes.
  expect(compared).toBeGreaterThan(30);
  expect(meshes.size).toBe(5);
});

test("a wood looks the same whichever store draws it: the camera still, the near field moved by a chunk", () => {
  // Low poly draws no rocks or bushes far, so its wood is of trees.
  for (const [tier, kinds] of [["medium", ["core:tree", "core:tree", "core:rock", "core:bush"]], ["lowpoly", ["core:tree"]]] as const) {
    const w = nodeWorld({ chunksX: 16, chunksZ: 8, kinds, tier: tierOf(tier), seed: 5, width: 200, height: 112 });
    const z = 4 * CHUNK_SIZE + 10;
    w.scene.nodesFar!.makes = Infinity;
    w.cam.fovY = (24 * Math.PI) / 180;
    w.look(3 * CHUNK_SIZE + 60, 23, z, Math.PI / 2, -0.03);
    const shot = (x: number): { color: Uint8ClampedArray; kind: Uint8Array } => {
      w.stand(x, z);
      w.frame(true);
      return { color: w.raster.color.slice(), kind: w.raster.pickKind.slice() };
    };
    // The chunk 196 to 260 m ahead is far, then near.
    const [far, near] = [shot(3 * CHUNK_SIZE + 60), shot(4 * CHUNK_SIZE + 1)];
    let [nodes, moved, off] = [0, 0, 0];
    for (let i = 0; i < w.W * w.H; i++) {
      const [a, b] = [far.kind[i]!, near.kind[i]!];
      if (a < 2 && b < 2) continue;
      nodes++;
      if (a === 4 && b === 2) moved++;
      if (a < 2 !== b < 2 || [0, 1, 2].some((c) => Math.abs(far.color[i * 4 + c]! - near.color[i * 4 + c]!) > 1)) off++;
    }
    // Pixels of nodes that were far and are near, and the share of all node pixels that changed at all.
    expect(moved).toBeGreaterThan(20);
    expect(off).toBeLessThanOrEqual(nodes * 0.003);
  }
});

test("over a 2 km walk across chunk borders no node is drawn by both stores or by neither, and one handed over keeps its level within one", () => {
  const w = nodeWorld({ chunksX: 38, chunksZ: 10, kinds: [WOOD, WOOD, "core:tree", "core:rock", "core:bush"] });
  const forms = w.field.forms;
  const z = 5 * CHUNK_SIZE + 30;
  w.stand(160, z);
  w.look(160, 26, z, Math.PI / 2, -0.04);
  const makes = w.scene.nodesFar!.makes;
  w.scene.nodesFar!.makes = Infinity;
  w.frame();
  w.scene.nodesFar!.makes = makes;
  const reach = (kind: number): number => w.scene.nodesFar!.reachOf(kind);
  // What grows in each slot of the map, worked out once.
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const grows = new Uint16Array(w.dims.chunksX * w.dims.chunksZ * w.source.perChunk);
  for (let k = 0; k < grows.length; k++) {
    w.source.at(Math.floor(k / w.source.perChunk), k % w.source.perChunk, spot);
    grows[k] = spot.kind;
  }
  let last = new Map<number, Drawn>();
  let [handed, apart, checked, both, neither] = [0, 0, 0, 0, 0];
  const STEP = 32;
  const tilesX = Math.ceil(w.dims.chunksX / 4);
  for (let x = 160; x <= 2260; x += STEP) {
    w.stand(x, z);
    w.cam.x = x;
    const p = w.frame();
    // What each node is drawn as on the frame before the body crosses into a chunk, and on the frame it does.
    if (chunkAt(w.dims, x, z) !== chunkAt(w.dims, x - STEP, z)) {
      for (const [key, a] of drawnNodes(w, p)) {
        const b = last.get(key);
        if (!b || b.far === a.far) continue;
        handed++;
        if (Math.abs(a.level - b.level) > 1 || a.mesh !== b.mesh || a.yaw !== b.yaw || a.size !== b.size) apart++;
      }
    }
    if (chunkAt(w.dims, x + STEP, z) !== chunkAt(w.dims, x, z)) last = drawnNodes(w, p);
    // What the card holds, in the chunks round the body's: each standing node by one store, and every node of a kind
    // whose reach is well past it by one or the other.
    const body = chunkAt(w.dims, x, z);
    const [lo, hi] = [chunkCx(w.dims, body) - HELD - 1, chunkCx(w.dims, body) + HELD + 1];
    const far = new Set<number>();
    for (const [buffer, held] of w.card) {
      const t = buffer - FAR_NODE_BUFFERS;
      if (t < 0 || (t % tilesX) * 4 > hi || (t % tilesX) * 4 + 3 < lo) continue;
      for (const s of held.slots) far.add(farNodeOf(w.dims, buffer, s).reduce((c, i) => c * 65536 + i));
    }
    for (let cz = chunkCz(w.dims, body) - HELD - 1; cz <= chunkCz(w.dims, body) + HELD + 1; cz++) {
      for (let cx = Math.max(0, lo); cx <= Math.min(w.dims.chunksX - 1, hi); cx++) {
        const chunk = cz * w.dims.chunksX + cx;
        const near = w.field.store.chunks[chunk];
        const off = Math.hypot(cx * CHUNK_SIZE + 32 - x, cz * CHUNK_SIZE + 32 - z) + 200;
        for (let i = 0; i < w.source.perChunk; i++) {
          const kind = grows[chunk * w.source.perChunk + i]!;
          if (kind === 0) continue;
          const isNear = near ? near.kind[i] !== 0 && forms.depleted[near.kind[i]!] === 0 : false;
          const isFar = far.has(chunk * 65536 + i);
          if (isNear && isFar) both++;
          if (!isNear && !isFar && reach(kind) > off) neither++;
          checked++;
        }
      }
    }
  }
  expect([both, neither, apart]).toEqual([0, 0, 0]);
  expect(handed).toBeGreaterThan(500);
  expect(checked).toBeGreaterThan(100000);
});

test("at the benchmark's density each tier's far triangles in view stay within its row, the reach of a heavier kind cut to hold it", () => {
  // Every one of 160 slots a chunk filled, trees, rocks and bushes 3 to 2 to 1, seen from the middle of a 4.6 km map at
  // 1,080 rows across 102 degrees. The rows are the round 8 plan's, nodes in view to each tier's reach at 12 triangles
  // a tree and 8 a rock or bush. The grey boxes are a tree of 24 and a rock or bush of 12, so their reaches are cut by
  // 0.71 and 0.82. The nodes are placed as scatterNodes places them on level ground, where every slot is filled.
  const place = (dims: MapDims, hf: Heightfield, forms: NodeForms, kinds: number[]): NodeSource => ({
    perChunk: 160,
    at(chunk, index, out) {
      const h = mix(7, chunk, index);
      const g = mix(h, index, chunk);
      out.kind = kinds[g % kinds.length]!;
      out.form = formOf(forms, out.kind, mix(g, chunk, 7));
      out.x = (chunkCx(dims, chunk) + (h & 0xffff) / 65536) * CHUNK_SIZE;
      out.z = (chunkCz(dims, chunk) + (h >>> 16) / 65536) * CHUNK_SIZE;
      out.y = hf.minY + hf.heights[0]! * hf.stepY;
      out.yaw = (g >>> 8) & 0xffff;
    },
  });
  const w = nodeWorld({ chunksX: 72, chunksZ: 72, kinds: ["core:tree", "core:tree", "core:tree", "core:rock", "core:rock", "core:bush"], place, width: 16, height: 9 });
  const mid = 36 * CHUNK_SIZE + 10;
  w.stand(mid, mid);
  w.look(mid, 21.7, mid, 0.3, 0);
  w.cam.fovY = (70 * Math.PI) / 180;
  w.cam.aspect = 16 / 9;
  w.scene.viewHeight = 1080;
  w.scene.nodesFar!.makes = Infinity;
  const rows: Record<string, number> = { ultra: 2.0e6, high: 0.9e6, medium: 315e3, lowpoly: 39e3 };
  const tris = w.scene.assets.table.tris;
  const cam = w.cam;
  for (const name of ["ultra", "high", "medium", "lowpoly"]) {
    const tier = (w.scene.assets.tier = tierOf(name));
    const p = w.frame();
    const far = w.scene.nodesFar!;
    // Triangles of the nodes drawn that stand in view and in reach, and of every draw, once in each depth range.
    let [seen, sent] = [0, 0];
    const runs = new Set<string>();
    for (let d = 0; d < p.drawCount; d++) {
      const buffer = p.drawBuffer[d]!;
      if (buffer < FAR_NODE_BUFFERS) continue;
      const each = tris[p.drawMesh[d]!]![p.drawLod[d]!]!;
      sent += each * p.drawInstances[d]!;
      const run = `${buffer}/${p.drawFirst[d]}`;
      if (runs.has(run)) continue;
      runs.add(run);
      const { data, slots } = w.card.get(buffer)!;
      const f32 = new Float32Array(data.buffer);
      for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
        const [x, y, z] = [f32[i * 5]! + p.drawOffset[d * 3]!, f32[i * 5 + 1]! + p.drawOffset[d * 3 + 1]!, f32[i * 5 + 2]! + p.drawOffset[d * 3 + 2]!];
        const [chunk, slot] = farNodeOf(w.dims, buffer, slots[i]!);
        if (Math.hypot(x, y, z) < far.reachOf(w.field.kindAt(chunk, slot)) && cam.boxVisible(x, y, z, x, y, z)) seen += each;
      }
    }
    expect(seen).toBeLessThanOrEqual(rows[name]!);
    // What is sent beside it: whole chunks at the view's sides, its reach and the split between its depth ranges.
    expect(sent).toBeLessThanOrEqual(rows[name]! * 1.35);
    expect(far.reachOf(w.kind("core:tree"))).toBeCloseTo(tier.reach.trees * Math.sqrt(12 / 24), 3);
    expect(far.reachOf(w.kind("core:rock"))).toBeCloseTo(tier.reach.rocks * Math.sqrt(8 / 12), 3);
  }
});

/** The slots of `chunk` the card's far tiles hold. */
function farSlots(w: NodeWorld, chunk: number): number[] {
  const out: number[] = [];
  for (const [buffer, held] of w.card) {
    if (buffer < FAR_NODE_BUFFERS) continue;
    for (const s of held.slots) {
      const [c, slot] = farNodeOf(w.dims, buffer, s);
      if (c === chunk) out.push(slot);
    }
  }
  return out.sort((a, b) => a - b);
}

test("nodes the client was told are used up, and nodes in a 4 m cell the far feed shows built on, are left out far until they are not", () => {
  const w = wood();
  const z = 6 * CHUNK_SIZE + 20;
  w.stand(4 * CHUNK_SIZE + 60, z);
  w.look(4 * CHUNK_SIZE + 60, 24, z, Math.PI / 2);
  w.frame();
  const chunk = chunkAt(w.dims, 9 * CHUNK_SIZE + 1, z);
  while (w.scene.nodesFar!.pending > 0) w.frame();
  const all = farSlots(w, chunk);
  expect(all.length).toBeGreaterThan(40);
  // The server says five are used up: the tile is made again in that frame.
  const used = all.slice(3, 8);
  w.tell(chunk, used);
  w.frame();
  expect(farSlots(w, chunk)).toEqual(all.filter((s) => !used.includes(s)));
  // A base goes up over the chunk's first four rows of 4 m cells, as the far feed sends it.
  const base = new FarCells();
  for (let c = 0; c < 64; c++) [base.top[c], base.tint[c]] = [farTopByte(6), 5];
  base.filled = 64;
  w.sendCells(chunk, base);
  w.frame();
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const under = all.filter((s) => (w.source.at(chunk, s, spot), spot.z - chunkCz(w.dims, chunk) * CHUNK_SIZE < 16));
  expect(under.length).toBeGreaterThan(5);
  expect(farSlots(w, chunk)).toEqual(all.filter((s) => !used.includes(s) && !under.includes(s)));
  // They grow back and the base is razed: every node is there again.
  w.tell(chunk, []);
  w.sendCells(chunk, new FarCells());
  w.frame();
  expect(farSlots(w, chunk)).toEqual(all);
});

test("low poly draws trees far to its 500 m, cut for the grey box's 24 triangles, and no rocks or bushes; flat, through the fade", () => {
  const w = nodeWorld({ chunksX: 24, chunksZ: 12, kinds: ["core:tree", "core:rock", "core:bush"], tier: tierOf("lowpoly") });
  const z = 6 * CHUNK_SIZE + 20;
  w.stand(4 * CHUNK_SIZE + 60, z);
  w.look(4 * CHUNK_SIZE + 60, 24, z, Math.PI / 2);
  w.scene.nodesFar!.makes = Infinity;
  w.frame();
  const p = w.frame();
  const tree = w.mesh("core:tree");
  const reach = 500 * Math.sqrt(12 / 24);
  let draws = 0;
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d]! < FAR_NODE_BUFFERS) continue;
    expect([p.drawMesh[d], p.drawFade[d], p.drawFlags[d]! & DRAW_TEXTURED]).toEqual([tree, Math.fround(reach), 0]);
    draws++;
  }
  expect(draws).toBeGreaterThan(0);
  expect(p.frame[FRAME.fade]).toBeCloseTo(0.1, 6);
  // No tile holds a node past reach by more than half a tile.
  for (const [buffer, held] of w.card) {
    if (buffer < FAR_NODE_BUFFERS) continue;
    const f32 = new Float32Array(held.data.buffer);
    const t = buffer - FAR_NODE_BUFFERS;
    for (let i = 0; i < held.slots.length; i++) expect(Math.hypot(f32[i * 5]! + (t % 6) * 256 - w.cam.x, f32[i * 5 + 2]! + Math.floor(t / 6) * 256 - w.cam.z)).toBeLessThan(reach + 128 + 256 * Math.SQRT2);
  }
});

test("tiles go on the card again after a lost context, tiles past reach are let go, what is held is reserved, and a tier that reaches nowhere draws none", () => {
  const w = wood();
  const z = 6 * CHUNK_SIZE + 20;
  w.stand(4 * CHUNK_SIZE + 60, z);
  w.look(4 * CHUNK_SIZE + 60, 24, z, Math.PI / 2);
  w.scene.nodesFar!.makes = Infinity;
  w.frame();
  const p = w.frame();
  const tiles = [...w.card.keys()].filter((b) => b >= FAR_NODE_BUFFERS).sort();
  const bytes = [...w.card].filter(([b]) => b >= FAR_NODE_BUFFERS).reduce((n, [, held]) => n + held.data.length, 0);
  expect([p.uploads.length, w.scene.nodesFar!.bytes]).toEqual([0, bytes]);
  w.scene.resetUploads();
  expect(w.frame().uploads.filter((u) => u.buffer >= FAR_NODE_BUFFERS).map((u) => u.buffer).sort()).toEqual(tiles);
  // Trees reach 300 m: the tiles more than a tile past that are let go, and the rest kept as they are.
  w.scene.assets.tier = { ...tierOf("medium"), reach: { bases: 2048, trees: 300, rocks: 0, bushes: 0 } };
  expect(w.frame().uploads.length).toBe(0);
  const left = [...w.card.keys()].filter((b) => b >= FAR_NODE_BUFFERS);
  const start = (b: number): number => ((b - FAR_NODE_BUFFERS) % 6) * 256;
  expect(tiles.filter((b) => !left.includes(b)).map(start)).toEqual(tiles.filter((b) => start(b) - w.cam.x > 556).map(start));
  expect(left.length).toBeGreaterThan(4);
  const [reserved, held] = [w.scene.assets.residency.reserved, w.scene.nodesFar!.bytes];
  w.scene.assets.tier = { ...tierOf("medium"), reach: { bases: 2048, trees: 0, rocks: 0, bushes: 0 } };
  const none = w.frame();
  expect([[...w.card.keys()].filter((b) => b >= FAR_NODE_BUFFERS).length, [...none.drawBuffer.subarray(0, none.drawCount)].filter((b) => b >= FAR_NODE_BUFFERS).length]).toEqual([0, 0]);
  expect([held > 100000, reserved - w.scene.assets.residency.reserved]).toEqual([true, held]);
});

test("the chunks the near field took or let go of are the ones marked changed", () => {
  const dims = { chunksX: 12, chunksZ: 12 };
  const ch = new NodeChanges(dims);
  const at = (cx: number, cz: number): number => cz * 12 + cx;
  ch.moved(-1, at(1, 1), 3);
  // The square round chunk (1, 1), cut by the map's edge.
  expect([...ch.changed].filter((v) => v > 0).length).toBe(5 * 5);
  const before = ch.version;
  ch.moved(at(1, 1), at(2, 1), 3);
  const marked = [...ch.changed.keys()].filter((c) => ch.changed[c]! > before).map((c) => [c % 12, Math.floor(c / 12)]);
  // Column 5 came in and nothing went out, since column -2 is off the map.
  expect(marked.sort((a, b) => a[1]! - b[1]!)).toEqual([0, 1, 2, 3, 4].map((cz) => [5, cz]));
  // Squares apart: the old one's 6 by 5 chunks and the new one's 6 by 6, cut by the map's edges.
  ch.moved(at(2, 1), at(9, 9), 3);
  expect(ch.version - before).toBe(5 + 30 + 36);
});
