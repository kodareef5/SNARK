// A wood seen from near and far: the map's nodes on its ground, a near node field that follows a body as the session's
// does, used-up nodes as the server tells them, the far feed's cells, and a scene drawing it all, with what the packets
// put on the card kept as the shell keeps it. Beside the core content's grey boxes is a kind of two variants, one with
// three levels, so a tree's variant and level can be told apart near and far.

import { CORE_CONTENT } from "../../content/core.ts";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import type { FarSource } from "../../client/core/render/far.ts";
import { NodeChanges, type FarNodeSource } from "../../client/core/render/farnodes.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { chunkAt, type MapDims } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { NodeField, nodeForms, scatterNodes, type NodeForms, type NodeSource } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { writeFar, type FarCells } from "../../shared/world/tactical.ts";
import { farMesh, grayboxMeshes } from "../../tools/pack/build.ts";
import { mannequinMeshes } from "../../tools/pack/mannequin.ts";
import { weaponMeshes } from "../../tools/pack/weapons.ts";
import { boxMesh, buildPack, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";

/** A tree of two variants: the first has three levels, a trunk and crown, a smaller crown, and one box; the second is one box. */
export const WOOD = "test:wood";
/** The chunks round the body's that the near field holds: the session's NODE_RADIUS. */
export const HELD = 3;

const DEFS: readonly Def[] = [
  ...CORE_CONTENT,
  { type: "node", id: WOOD, mesh: "box", color: 3, half: [0.3, 3, 0.3], hits: 10, respawnHours: 1, material: "wood", yields: [{ item: "core:wood", min: 1, max: 2 }], xp: 1, size: [0.8, 1.25], variants: [{ mesh: `${WOOD}_1`, weight: 2 }, { mesh: `${WOOD}_2` }] },
];

/** Boxes standing on the origin, each a half extent, its middle's height and a colour, as one level. */
function boxes(parts: readonly [number, number, number, number, number][], error: number): SourceLod {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const [hx, hy, hz, y, color] of parts) {
    const one = boxMesh([hx, hy, hz], color);
    const first = positions.length / 3;
    one.positions.forEach((v, i) => positions.push(i % 3 === 1 ? v + y : v));
    colors.push(...one.colors);
    for (const v of one.indices) indices.push(v + first);
  }
  return { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices), error };
}

function woodMeshes(): SourceMesh[] {
  return [
    { id: `${WOOD}_1`, lods: [boxes([[0.3, 3, 0.3, 3, REGION_BASE], [1.6, 1.8, 1.6, 6.8, 7]], 0), boxes([[0.3, 3, 0.3, 3, REGION_BASE], [1.4, 1.6, 1.4, 6.8, 7]], 0.06), boxes([[1.2, 4.3, 1.2, 4.3, 7]], 0.3)] },
    { id: `${WOOD}_2`, lods: [boxes([[1, 3.5, 1, 3.5, 12]], 0)] },
  ];
}

let registry: Registry | null = null;
let pack: Pack | null = null;

export function nodeRegistry(): Registry {
  if (registry) return registry;
  const made = compileContent(DEFS);
  if (!made.registry) throw new Error(made.errors.join("\n"));
  return (registry = made.registry);
}

/** The grey boxes, the wood's two meshes, the far mesh and the bodies. Built once per process. */
export function nodePack(): Pack {
  return (pack ??= parsePack(buildPack([...grayboxMeshes(DEFS), ...woodMeshes(), farMesh(), ...mannequinMeshes(), ...weaponMeshes()], defaultPalette(), authoredClips())));
}

export interface NodeWorldOptions {
  chunksX: number;
  chunksZ: number;
  /** Content ids of what grows, repeated for weight. */
  kinds: readonly string[];
  /** The ground's height at (x, z): 20 m if not given. */
  ground?: (x: number, z: number) => number;
  perChunk?: number;
  seed?: number;
  /** Places the nodes in place of scatterNodes, given the kinds by content index. */
  place?: (dims: MapDims, hf: Heightfield, forms: NodeForms, kinds: number[]) => NodeSource;
  tier?: Partial<Tier>;
  width?: number;
  height?: number;
  pack?: Pack;
}

export type NodeWorld = ReturnType<typeof nodeWorld>;

export function nodeWorld(o: NodeWorldOptions) {
  const reg = nodeRegistry();
  const dims: MapDims = { chunksX: o.chunksX, chunksZ: o.chunksZ };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  hf.setSample(0, 0, 20);
  if (o.ground) for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, o.ground(i * hf.cell, j * hf.cell));
  else hf.heights.fill(hf.heights[0]!);
  hf.tint.fill(12);
  const kinds = o.kinds.map((id) => reg.index.get(id)!);
  const source = o.place?.(dims, hf, nodeForms(reg), kinds) ?? scatterNodes(dims, hf, o.seed ?? 0xbe7c, o.perChunk ?? 64, nodeForms(reg), () => kinds);
  const field = new NodeField(dims, reg, source);
  const changes = new NodeChanges(dims);
  const gone = new Map<number, number[]>();
  const cells = new FarStore();
  const far: FarSource = { cells, complete: () => false };
  const farNodes: FarNodeSource = { nodes: source, held: (c) => field.isLoaded(c), gone: (c) => gone.get(c), changes };
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const thePack = o.pack ?? nodePack();
  const scene = new Scene({ dims, hf, structs, nodes: field.store, far, farNodes }, reg, thePack);
  scene.assets.tier = { ...tierOf("medium"), ...o.tier };
  const [W, H] = [o.width ?? 160, o.height ?? 90];
  scene.viewHeight = H;
  const cam = new Camera();
  cam.aspect = W / H;
  const raster = new Rasterizer(W, H, thePack, hf);
  /** What the packets have put on the card: each instance buffer's bytes and slots. */
  const card = new Map<number, { data: Uint8Array; slots: Uint16Array }>();
  const w = new BitWriter(1024);
  const r = new BitReader();
  let center = -1;
  return {
    reg, dims, hf, source, field, changes, gone, cells, scene, cam, raster, card, W, H, pack: thePack,
    kind: (id: string): number => reg.index.get(id)!,
    mesh: (id: string): number => scene.assets.table.find(id),
    /** The body stands at (x, z), and the near field holds the chunks round its chunk, taking them before letting the old ones go, as the session does. */
    stand(x: number, z: number): void {
      const chunk = chunkAt(dims, x, z);
      if (chunk === center) return;
      const told = (c: number, i: number): boolean => gone.get(c)?.includes(i) ?? false;
      field.retain(chunk, HELD, 1, told);
      if (center >= 0) field.retain(center, HELD, -1, told);
      changes.moved(center, chunk, HELD);
      center = chunk;
    },
    /** The server says which nodes of `chunk` are used up, as S_NODES does. */
    tell(chunk: number, slots: number[]): void {
      const before = gone.get(chunk) ?? [];
      gone.set(chunk, slots);
      for (const i of before) if (!slots.includes(i)) field.set(chunk, i, true);
      for (const i of slots) if (!before.includes(i)) field.set(chunk, i, false);
      changes.touch(chunk);
    },
    /** Hands `cells` to the far store as `chunk`'s, as S_FAR does. */
    sendCells(chunk: number, cellsOf: FarCells): void {
      w.reset();
      writeFar(w, chunk, cellsOf);
      r.reset(w.bytes());
      cells.read(r, dims);
    },
    /**
     * One frame a sixtieth of a second after the last, drawn by the rasterizer if `draw`, with the ground if `ground`.
     * The rasterizer holds only what the frames it draws upload, so a test draws every frame or none.
     */
    frame(draw = false, ground = false): FramePacket {
      scene.now += 1000 / 60;
      const p = scene.build(cam, null);
      for (const u of p.uploads) card.set(u.buffer, { data: u.data.slice(), slots: u.slots.slice() });
      for (const id of p.drops) card.delete(id);
      if (draw) {
        const tiles = p.tileCount;
        if (!ground) p.tileCount = 0;
        raster.render(p);
        p.tileCount = tiles;
      }
      return p;
    },
    /** Stands the camera at (x, y, z) looking along `yaw`, `pitch` up. */
    look(x: number, y: number, z: number, yaw: number, pitch = 0): void {
      [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [x, y, z, yaw, pitch];
    },
  };
}
