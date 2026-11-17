// Trees, rocks and bushes past the near store's hand-over band, placed by the client from the map (farnodes.ts, hand.ts).
import { expect, test } from "bun:test";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { FAR_NODE_BUFFERS, PULL_SLOTS, farNodeOf } from "../../client/core/render/farnodes.ts";
import { HAND_FAR, HAND_NEAR } from "../../client/core/render/hand.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { ATLAS_REGION, DRAW_PULLED, DRAW_TEXTURED, FRAME, type FramePacket } from "../../client/core/render/packet.ts";
import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz, frameKey, type MapDims } from "../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { SIZE_UNITS, formOf, mix, scatterNodes, type NodeForms, type NodeSource } from "../../shared/world/nodes.ts";
import { FarCells, farTopByte } from "../../shared/world/tactical.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { HELD, WOOD, nodeWorld, type NodeWorld } from "../fixtures/nodeworld.ts";
import { corePack } from "../fixtures/pack.ts";

/** A node as a draw of a frame draws it: its mesh, level, place in the world, turn and size, which store, and its hand-over. */
interface Drawn {
  mesh: number;
  level: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  size: number;
  far: boolean;
  hand: number;
}

/** Every node a frame draws, by chunk * 65536 + slot: a draw by each store that draws it. */
function drawnNodes(w: NodeWorld, p: FramePacket): Map<number, Drawn[]> {
  const out = new Map<number, Drawn[]>();
  const table = w.scene.assets.table;
  // A draw in both depth ranges is listed once in each, and a level of several materials once a material.
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
      const at = i * INSTANCE_BYTES;
      // A far draw holds every mesh, each instance its row of the atlas at its last level.
      const mesh = (p.drawFlags[d]! & DRAW_PULLED) !== 0 ? w.scene.nodesFar!.meshOfRow(held.data[at + 14 + ATLAS_REGION]!) : p.drawMesh[d]!;
      const level = far ? table.tris[mesh]!.length - 1 : p.drawLod[d]!;
      const list = out.get(chunk * 65536 + slot) ?? [];
      list.push({ mesh, level, x: view.getFloat32(at, true) + ox, y: view.getFloat32(at + 4, true) + oy, z: view.getFloat32(at + 8, true) + oz, yaw: view.getUint16(at + 12, true), size: held.data[at + 19]!, far, hand: p.drawHand[d]! });
      out.set(chunk * 65536 + slot, list);
    }
  }
  return out;
}

const wood = (): NodeWorld => nodeWorld({ chunksX: 24, chunksZ: 12, kinds: [WOOD, WOOD, "core:tree", "core:rock", "core:bush"], ground: (x, z) => 20 + 6 * Math.sin(x / 90) * Math.cos(z / 70) });

/** How far a drawn node's foot is from the camera. */
const off = (w: NodeWorld, n: Drawn): number => Math.hypot(n.x - w.cam.x, n.y - w.cam.y, n.z - w.cam.z);

/** The draws of a node that keep any of it: one fading out keeps nothing past the band, and one fading in nothing short of it. */
function shown(w: NodeWorld, draws: readonly Drawn[]): Drawn[] {
  const [from, to] = w.scene.assets.tier.nodes.band;
  return draws.filter((n) => (n.hand === HAND_NEAR ? off(w, n) < to : n.hand === HAND_FAR ? off(w, n) > from : true));
}

test("across the hand-over band both stores draw a node, each fading the other way, at the same spot, turn and size; short of it only the near store, past it only the far", () => {
  const w = wood();
  const z = 6 * CHUNK_SIZE + 20;
  const [from, to] = tierOf("medium").nodes.band;
  // The body stands in chunk 4 of its row, so the near field holds chunks 1 to 7, and the camera, at the body, looks along it.
  w.stand(4 * CHUNK_SIZE + 60, z);
  w.look(4 * CHUNK_SIZE + 60, 24, z, Math.PI / 2, -0.05);
  w.scene.nodesFar!.makes = Infinity;
  w.frame();
  let [both, near, far] = [0, 0, 0];
  const meshes = new Set<number>();
  for (const all of drawnNodes(w, w.frame()).values()) {
    const draws = shown(w, all);
    const d = off(w, all[0]!);
    if (draws.length === 1) {
      const [one] = draws;
      // Short of the band the near store's draw keeps every pixel, faded or not; past it the far store's.
      if (d < from - 0.01) expect(one!.far).toBe(false);
      if (d > to + 0.01) expect(one!.far).toBe(true);
      if (one!.far) far++;
      else near++;
      continue;
    }
    // The near store leaves out a node out of view, where the far store may draw it among the cells it bridges.
    if (draws.length === 0) {
      const n = all[0]!, t = w.scene.assets.table, k = n.size / SIZE_UNITS, r = t.side[n.mesh]! * k;
      expect(w.cam.boxVisible(n.x - r - w.cam.x, n.y + t.low[n.mesh]! * k - w.cam.y, n.z - r - w.cam.z, n.x + r - w.cam.x, n.y + t.high[n.mesh]! * k - w.cam.y, n.z + r - w.cam.z)).toBe(false);
      continue;
    }
    expect(draws.length).toBe(2);
    const [a, b] = draws.sort((p, q) => Number(p.far) - Number(q.far)) as [Drawn, Drawn];
    expect([a.far, a.hand, b.far, b.hand]).toEqual([false, HAND_NEAR, true, HAND_FAR]);
    expect(d).toBeGreaterThan(from - 0.01);
    expect(d).toBeLessThan(to + 0.01);
    expect([b.mesh, b.yaw, b.size]).toEqual([a.mesh, a.yaw, a.size]);
    for (const k of ["x", "y", "z"] as const) expect(Math.abs(b[k] - a[k])).toBeLessThan(0.002);
    // Far, a node is its mesh's last level.
    expect(b.level).toBe(w.scene.assets.table.error[b.mesh]!.length - 1);
    meshes.add(a.mesh);
    both++;
  }
  // Both of the wood's variants and the three grey boxes, in the band and either side of it.
  expect(both).toBeGreaterThan(30);
  expect(meshes.size).toBe(5);
  expect([near, far].every((n) => n > 100)).toBe(true);
});

test("a wood looks the same whichever store holds it: the camera still, the near field moved by a chunk; with the band past the near field it pops", () => {
  // Low poly draws no rocks or bushes far, so its wood is of trees. The wood's three levels make a near tree and a far one
  // differ. A meadow to 448 m east, so the chunk taken stands in plain view.
  const place = (dims: MapDims, hf: Heightfield, forms: NodeForms, kinds: number[]): NodeSource => scatterNodes(dims, hf, 5, 64, forms, (x) => (x >= 7 * CHUNK_SIZE ? kinds : null));
  for (const [name, kinds] of [["medium", [WOOD, "core:oak", "core:rock", "core:bush"]], ["lowpoly", [WOOD, "core:oak"]]] as const) {
    for (const band of [tierOf(name).nodes.band, [10000, 10001] as const]) {
      const w = nodeWorld({ chunksX: 16, chunksZ: 8, kinds, place, tier: { ...tierOf(name), nodes: { chunks: HELD, band } }, width: 200, height: 112 });
      const z = 4 * CHUNK_SIZE + 10;
      w.scene.nodesFar!.makes = Infinity;
      // Levels are chosen for a view 1,080 rows tall, as a player's is.
      w.scene.viewHeight = 1080;
      w.cam.fovY = (24 * Math.PI) / 180;
      w.look(3 * CHUNK_SIZE + 60, 23, z, Math.PI / 2, -0.03);
      const shot = (x: number): { color: Uint8ClampedArray; kind: Uint8Array } => {
        w.stand(x, z);
        w.frame(true);
        return { color: w.raster.color.slice(), kind: w.raster.pickKind.slice() };
      };
      // The body steps over a chunk border where the camera stands, as in play: the chunk 196 to 260 m ahead is taken.
      const [before, after] = [shot(3 * CHUNK_SIZE + 60), shot(4 * CHUNK_SIZE + 1)];
      let [nodes, changed] = [0, 0];
      for (let i = 0; i < w.W * w.H; i++) {
        const [a, b] = [before.kind[i]!, after.kind[i]!];
        if (a < 2 && b < 2) continue;
        nodes++;
        if (a < 2 !== b < 2 || [0, 1, 2].some((c) => Math.abs(before.color[i * 4 + c]! - after.color[i * 4 + c]!) > 1)) changed++;
      }
      expect(nodes).toBeGreaterThan(1500);
      if (band[0] < 1000) expect(changed).toBeLessThanOrEqual(nodes * 0.003);
      else expect(changed).toBeGreaterThan(nodes * 0.05);
    }
  }
});

artTest("a used-up node's stump is the near store's alone: drawn short of the band, fading out over it, and by neither store past it", () => {
  // The core pack, whose trees and rocks leave stumps and broken bases.
  const w = nodeWorld({ chunksX: 16, chunksZ: 8, kinds: ["core:tree", "core:tree", "core:rock"], pack: corePack() });
  const z = 4 * CHUNK_SIZE + 10;
  const [from, to] = tierOf("medium").nodes.band;
  w.stand(CHUNK_SIZE + 20, z);
  w.look(CHUNK_SIZE + 20, 24, z, Math.PI / 2, -0.05);
  w.scene.nodesFar!.makes = Infinity;
  // Every node of the row of chunks the camera looks along is used up, from 44 m to 300 m ahead.
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const used = new Set<number>();
  for (let cx = 2; cx <= 5; cx++) {
    const chunk = chunkAt(w.dims, cx * CHUNK_SIZE + 1, z);
    const slots = [...Array(w.source.perChunk).keys()].filter((i) => (w.source.at(chunk, i, spot), spot.kind !== 0));
    w.tell(chunk, slots);
    for (const i of slots) used.add(chunk * 65536 + i);
  }
  w.frame();
  const drawn = drawnNodes(w, w.frame());
  let [short, band, past] = [0, 0, 0];
  for (const key of used) {
    const draws = drawn.get(key) ?? [];
    expect(draws.every((n) => !n.far && w.field.forms.depleted[w.field.store.chunks[Math.floor(key / 65536)]!.kind[key % 65536]!] === 1)).toBe(true);
    if (draws.length === 0) continue;
    const d = off(w, draws[0]!);
    if (d < from) short++;
    else if (d < to) band += draws[0]!.hand === HAND_NEAR ? 1 : 0;
    else past += shown(w, draws).length;
  }
  expect([short > 20, band > 5, past]).toEqual([true, true, 0]);
});

test("over a 2 km walk across chunk borders a node in view is drawn by the near store short of the band, by the far store past it, and by both, fading, in it; past it a chunk changing hands changes nothing drawn", () => {
  const w = nodeWorld({ chunksX: 38, chunksZ: 10, kinds: [WOOD, WOOD, "core:tree", "core:rock", "core:bush"] });
  const z = 5 * CHUNK_SIZE + 30;
  const [from, to] = tierOf("medium").nodes.band;
  w.stand(160, z);
  w.look(160, 26, z, Math.PI / 2, -0.04);
  w.scene.nodesFar!.makes = Infinity;
  w.frame();
  const reach = (kind: number): number => w.scene.nodesFar!.reachOf(kind);
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const table = w.scene.assets.table;
  let [checked, wrong, handed, apart] = [0, 0, 0, 0];
  let last = new Map<number, Drawn[]>();
  const STEP = 32;
  for (let x = 160; x <= 2260; x += STEP) {
    w.stand(x, z);
    w.cam.x = x;
    const drawn = drawnNodes(w, w.frame());
    // Every standing node of the chunks round the body's, in view and in reach, by where its foot is.
    const body = chunkAt(w.dims, x, z);
    for (let cz = chunkCz(w.dims, body) - HELD - 1; cz <= chunkCz(w.dims, body) + HELD + 1; cz++) {
      for (let cx = Math.max(0, chunkCx(w.dims, body) - HELD - 1); cx <= Math.min(w.dims.chunksX - 1, chunkCx(w.dims, body) + HELD + 1); cx++) {
        const chunk = cz * w.dims.chunksX + cx;
        for (let i = 0; i < w.source.perChunk; i++) {
          w.source.at(chunk, i, spot);
          if (spot.kind === 0) continue;
          const own = w.field.forms.mesh[spot.form] ? table.find(w.field.forms.mesh[spot.form]!) : -1;
          const mesh = own >= 0 ? own : w.scene.meshOfKind[spot.kind]!;
          const size = w.field.forms.size[spot.form]! / SIZE_UNITS;
          const [dx, dy, dz] = [spot.x - w.cam.x, spot.y - w.cam.y, spot.z - w.cam.z];
          const [r, lo, hi] = [table.side[mesh]! * size, table.low[mesh]! * size, table.high[mesh]! * size];
          if (!w.cam.boxVisible(dx - r, dy + lo, dz - r, dx + r, dy + hi, dz + r)) continue;
          const d = Math.hypot(dx, dy, dz);
          if (Math.abs(d - from) < 0.5 || Math.abs(d - to) < 0.5 || d > reach(spot.kind) * 0.9) continue;
          // In the band each store's draw keeps the pixels the other's drops; either side of it a draw keeps them all.
          const by = shown(w, drawn.get(chunk * 65536 + i) ?? []).map((n) => (n.far ? "far" : "near") + (d < from || d > to ? "" : n.hand)).sort();
          const want = d < from ? ["near"] : d > to ? ["far"] : [`far${HAND_FAR}`, `near${HAND_NEAR}`];
          if (by.join() !== want.join()) wrong++;
          checked++;
        }
      }
    }
    // On the frame the body crosses into a chunk, what is past the band is drawn as on the frame before, the body a step back.
    if (chunkAt(w.dims, x, z) !== chunkAt(w.dims, x - STEP, z)) {
      for (const [key, all] of last) {
        const [a, b] = [shown(w, drawn.get(key) ?? []), shown(w, all)];
        if (a.length === 0 || b.length !== 1 || !b[0]!.far || off(w, b[0]!) < to + 1) continue;
        handed++;
        if (a.length !== 1 || !a[0]!.far || a[0]!.mesh !== b[0]!.mesh || a[0]!.yaw !== b[0]!.yaw || Math.abs(a[0]!.x - b[0]!.x) > 0.002) apart++;
      }
    }
    if (chunkAt(w.dims, x + STEP, z) !== chunkAt(w.dims, x, z)) last = drawn;
  }
  expect([wrong, apart]).toEqual([0, 0]);
  expect(checked).toBeGreaterThan(20000);
  expect(handed).toBeGreaterThan(500);
});

test("at the benchmark's density each tier's far triangles in view stay within its row, the reach of a heavier kind cut to hold it", () => {
  // Every one of 160 slots a chunk filled, trees, rocks and bushes 3 to 2 to 1, seen from the middle of a 4.6 km map at
  // 1,080 rows across 102 degrees. The rows are the round 8 plan's, nodes in view to each tier's reach at 12 triangles
  // a tree and 8 a rock or bush, from the near field's edge. The grey boxes are a tree of 24 and a rock or bush of 12, so
  // their reaches are cut by 0.71 and 0.82, and again since the far layer begins at the hand-over band, short of that
  // edge. The nodes are placed as scatterNodes places them on level ground, where every slot is filled.
  const place = (dims: MapDims, hf: Heightfield, forms: NodeForms, kinds: number[]): NodeSource => ({
    perChunk: 160,
    at(chunk, index, out) {
      const key = frameKey(dims, chunk);
      const h = mix(7, key, index);
      const g = mix(h, index, key);
      out.kind = kinds[g % kinds.length]!;
      out.form = formOf(forms, out.kind, mix(g, key, 7));
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
  const cut = (tier: Tier, reach: number): number => {
    const [edge, from] = [((2 * tier.nodes.chunks + 1) * CHUNK_SIZE) / Math.sqrt(Math.PI), tier.nodes.band[0]];
    return Math.sqrt(reach * reach - edge * edge + from * from);
  };
  const tris = w.scene.assets.table.tris;
  const cam = w.cam;
  for (const name of ["ultra", "high", "medium", "lowpoly"]) {
    const tier = (w.scene.assets.tier = tierOf(name));
    w.stand(mid, mid);
    const p = w.frame();
    const far = w.scene.nodesFar!;
    // Triangles of the nodes drawn that stand in view and in reach, and that a draw fading them in over the band keeps
    // something of; and of every draw of chunks the near field does not hold, once in each depth range. A chunk it holds
    // is drawn from the band on, faded in over it, in the near store's place.
    let [seen, sent, unfaded] = [0, 0, 0];
    const runs = new Set<string>();
    for (let d = 0; d < p.drawCount; d++) {
      const buffer = p.drawBuffer[d]!;
      if (buffer < FAR_NODE_BUFFERS) continue;
      const { data, slots } = w.card.get(buffer)!;
      const f32 = new Float32Array(data.buffer);
      const run = `${buffer}/${p.drawFirst[d]}`;
      const again = runs.has(run);
      runs.add(run);
      for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
        const each = tris[far.meshOfRow(data[i * INSTANCE_BYTES + 14 + ATLAS_REGION]!)]!.at(-1)!;
        const [chunk, slot] = farNodeOf(w.dims, buffer, slots[i]!);
        if (!w.field.isLoaded(chunk)) sent += each;
        else if (p.drawHand[d] !== HAND_FAR) unfaded++;
        if (again) continue;
        const [x, y, z] = [f32[i * 5]! + p.drawOffset[d * 3]!, f32[i * 5 + 1]! + p.drawOffset[d * 3 + 1]!, f32[i * 5 + 2]! + p.drawOffset[d * 3 + 2]!];
        const dist = Math.hypot(x, y, z);
        if ((p.drawHand[d] === 0 || dist > tier.nodes.band[0]) && dist < far.reachOf(w.field.kindAt(chunk, slot)) && cam.boxVisible(x, y, z, x, y, z)) seen += each;
      }
    }
    expect([seen <= rows[name]!, unfaded]).toEqual([true, 0]);
    // What is sent beside it: whole chunks at the view's sides, its reach and the split between its depth ranges.
    expect(sent).toBeLessThanOrEqual(rows[name]! * 1.35);
    expect(far.reachOf(w.kind("core:tree"))).toBeCloseTo(cut(tier, tier.reach.trees * Math.sqrt(12 / 24)), 1);
    if (tier.reach.rocks > 0) expect(far.reachOf(w.kind("core:rock"))).toBeCloseTo(cut(tier, tier.reach.rocks * Math.sqrt(8 / 12)), 1);
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

test("low poly draws trees far to its 500 m, cut for the grey box's 24 triangles and for the band, and no rocks or bushes; flat, through the fade", () => {
  const w = nodeWorld({ chunksX: 24, chunksZ: 12, kinds: ["core:tree", "core:rock", "core:bush"], tier: tierOf("lowpoly") });
  const z = 6 * CHUNK_SIZE + 20;
  w.stand(4 * CHUNK_SIZE + 60, z);
  w.look(4 * CHUNK_SIZE + 60, 24, z, Math.PI / 2);
  w.scene.nodesFar!.makes = Infinity;
  w.frame();
  const p = w.frame();
  const tree = w.mesh("core:tree");
  // Cut for the grey box, and again for the band at 152 m, short of the near field, 7 by 7 chunks, as large as a circle of 253 m radius.
  const reach = Math.sqrt(500 * 500 * (12 / 24) - (7 * 64) ** 2 / Math.PI + 152 * 152);
  let draws = 0;
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d]! < FAR_NODE_BUFFERS) continue;
    expect([p.drawFade[d], p.drawFlags[d]! & (DRAW_TEXTURED | DRAW_PULLED)]).toEqual([Math.fround(reach), DRAW_PULLED]);
    const { data } = w.card.get(p.drawBuffer[d]!)!;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) expect(w.scene.nodesFar!.meshOfRow(data[i * INSTANCE_BYTES + 14 + ATLAS_REGION]!)).toBe(tree);
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
  // The tiles, and the atlas of every standing node's mesh, a row of 193 texels of four floats each: 20 rows, 16 until the
  // oil rock's, crystal's, obsidian rock's and clam's grey boxes (content/items/nodes.ts); without them it is 16 again.
  expect([p.uploads.length, p.atlasRows, w.scene.nodesFar!.bytes]).toEqual([0, 0, bytes + 20 * 193 * 16]);
  w.scene.resetUploads();
  const again = w.frame();
  expect(again.uploads.filter((u) => u.buffer >= FAR_NODE_BUFFERS).map((u) => u.buffer).sort()).toEqual(tiles);
  // With the atlas and the pulled draws' three levels.
  expect([again.atlasRows, again.assetUploads.filter((u) => u.slot >= PULL_SLOTS && u.slot < PULL_SLOTS + 3).map((u) => u.indexCount)]).toEqual([20, [48, 96, 192]]);
  // Trees reach 300 m: the tiles more than a tile past that are let go, and the rest kept as they are.
  w.scene.assets.tier = { ...tierOf("medium"), reach: { ...tierOf("medium").reach, trees: 300, rocks: 0, bushes: 0 } };
  expect(w.frame().uploads.length).toBe(0);
  const left = [...w.card.keys()].filter((b) => b >= FAR_NODE_BUFFERS);
  const start = (b: number): number => ((b - FAR_NODE_BUFFERS) % 6) * 256;
  expect(tiles.filter((b) => !left.includes(b)).map(start)).toEqual(tiles.filter((b) => start(b) - w.cam.x > 556).map(start));
  expect(left.length).toBeGreaterThan(4);
  const [reserved, held] = [w.scene.assets.residency.reserved, w.scene.nodesFar!.bytes];
  w.scene.assets.tier = { ...tierOf("medium"), reach: { ...tierOf("medium").reach, trees: 0, rocks: 0, bushes: 0 } };
  const none = w.frame();
  expect([[...w.card.keys()].filter((b) => b >= FAR_NODE_BUFFERS).length, [...none.drawBuffer.subarray(0, none.drawCount)].filter((b) => b >= FAR_NODE_BUFFERS).length]).toEqual([0, 0]);
  expect([held > 100000, reserved - w.scene.assets.residency.reserved]).toEqual([true, held]);
});
