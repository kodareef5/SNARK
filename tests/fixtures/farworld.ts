// A map with bases on it seen from far off: a server's store the bases are built in and their far cells baked from, a
// client's near store that holds a chunk's rows only when a test sends them, and the far feed's store between, seen
// through a scene and the software rasterizer. The pack is the core grey boxes and the far mesh.

import { CORE_CONTENT } from "../../content/core.ts";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import type { FarSource } from "../../client/core/render/far.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz, type MapDims } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Summary, bakeChunk, pieceShapes, writeFar, type FarCells } from "../../shared/world/tactical.ts";
import { farMesh, grayboxMeshes } from "../../tools/pack/build.ts";
import { mannequinMeshes } from "../../tools/pack/mannequin.ts";
import { weaponMeshes } from "../../tools/pack/weapons.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { PICK_FAR, PICK_STRUCTURE, Rasterizer } from "../../tools/snap/raster.ts";

let registry: Registry | null = null;
let pack: Pack | null = null;

export function farRegistry(): Registry {
  return (registry ??= compileContent(CORE_CONTENT).registry!);
}

/** The core content's grey boxes, the bodies, and the far mesh. Built once per process. */
export function farPack(): Pack {
  return (pack ??= parsePack(buildPack([...grayboxMeshes(CORE_CONTENT), farMesh(), ...mannequinMeshes(), ...weaponMeshes()], defaultPalette(), authoredClips())));
}

export interface FarWorldOptions {
  /** Chunks a side. */
  chunks: number;
  /** The ground's height at (x, z), flat at 0 if not given. */
  ground?: (x: number, z: number) => number;
  tier?: Partial<Tier>;
  width?: number;
  height?: number;
  pack?: Pack;
}

export type FarWorld = ReturnType<typeof farWorld>;

export function farWorld(o: FarWorldOptions) {
  const reg = farRegistry();
  const dims: MapDims = { chunksX: o.chunks, chunksZ: o.chunks };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, o.ground?.(i * hf.cell, j * hf.cell) ?? 0);
  hf.tint.fill(12);
  const server = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const cells = new FarStore();
  const whole = new Uint8Array(dims.chunksX * dims.chunksZ);
  const far: FarSource = { cells, complete: (chunk) => whole[chunk] === 1 };
  const thePack = o.pack ?? farPack();
  const scene = new Scene({ dims, hf, structs, far }, reg, thePack);
  scene.assets.tier = { ...tierOf("medium"), ...o.tier };
  const [W, H] = [o.width ?? 160, o.height ?? 90];
  scene.viewHeight = H;
  const cam = new Camera();
  cam.aspect = W / H;
  const raster = new Rasterizer(W, H, thePack, hf);
  const shapes = pieceShapes(reg);
  const w = new BitWriter(1024);
  const r = new BitReader();
  const id = (name: string): number => reg.index.get(name)!;
  let now = 0;
  return {
    reg, dims, hf, server, structs, cells, whole, far, scene, cam, raster, pack: thePack, id, W, H,
    /** Bakes `chunk`'s far cells from the server's store and hands them to the far store, as S_FAR does. */
    send(chunk: number): void {
      const s = new Summary();
      bakeChunk(server.chunks[chunk] ?? null, chunkCx(dims, chunk) * CHUNK_SIZE, chunkCz(dims, chunk) * CHUNK_SIZE, shapes, hf, s);
      this.sendCells(chunk, s.far);
    },
    /** Hands `far` to the far store as `chunk`'s cells. */
    sendCells(chunk: number, far: FarCells): void {
      w.reset();
      writeFar(w, chunk, far);
      r.reset(w.bytes());
      cells.read(r, dims);
    },
    /** Every chunk of the server's store with pieces in it, sent. */
    sendAll(): number[] {
      const sent: number[] = [];
      server.chunks.forEach((t, chunk) => {
        if (!t || t.live === 0) return;
        this.send(chunk);
        sent.push(chunk);
      });
      return sent;
    },
    /** Copies the server's rows of `chunk` from slot `from` up to `to` into the near store, and with `last` marks it whole. */
    rows(chunk: number, from = 0, to = Infinity, last = true): void {
      const t = server.chunks[chunk]!;
      for (let s = from; s < Math.min(to, t.high); s++) structs.put(chunk, s, t.kind[s]!, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, t.owner[s]!, t.hp[s]!, t.version);
      if (!last) return;
      structs.setVersion(chunk, t.version);
      whole[chunk] = 1;
    },
    /** The near store lets go of `chunk`, as S_CHUNK_DROP has it do. */
    drop(chunk: number): void {
      structs.dropChunk(chunk);
      whole[chunk] = 0;
    },
    /** One frame a sixtieth of a second after the last, drawn by the rasterizer, with the ground or, for speed, without. */
    frame(ground = false): FramePacket {
      scene.now = now += 1000 / 60;
      const p = scene.build(cam, null);
      const tiles = p.tileCount;
      if (!ground) p.tileCount = 0;
      raster.render(p);
      p.tileCount = tiles;
      return p;
    },
    /** Pixels of far blocks and of real pieces in the rasterizer's last frame, a 1 each. */
    covered(): { far: Uint8Array; near: Uint8Array } {
      return { far: raster.pickKind.map((k) => (k === PICK_FAR ? 1 : 0)), near: raster.pickKind.map((k) => (k === PICK_STRUCTURE ? 1 : 0)) };
    },
    /** Stands the camera `metres` from (x, z) on the side of `yaw`, `up` metres over the ground there, looking at (x, y, z). */
    look(x: number, y: number, z: number, metres: number, yaw: number, up = 1.6): void {
      cam.x = x - Math.sin(yaw) * metres;
      cam.z = z - Math.cos(yaw) * metres;
      cam.y = hf.heightAt(cam.x, cam.z) + up;
      cam.yaw = yaw;
      cam.pitch = Math.atan2(y - cam.y, Math.hypot(x - cam.x, z - cam.z));
    },
  };
}

/**
 * A castle 39 m square on a 3 m lattice in the server's store, its middle at (cx, cz) on ground at `y0`: foundations,
 * four floors of walls with a doorway and windows, a cross of inner walls, a ceiling over each floor, pillars, stairs, and
 * a tower of twelve floors more in one corner, to 48 m. As planning/reference/round8-far/bases.ts builds it, less what
 * is inside. Returns its chunk.
 */
export function castle(w: FarWorld, cx: number, cz: number, y0 = 0): number {
  const [foundation, wall, ceiling, doorway, window, pillar, stairs, door] = ["foundation_wood", "wall_wood", "ceiling_wood", "doorframe_wood", "windowframe_wood", "pillar_wood", "stairs_wood", "door_wood"].map((n) => w.id(`core:${n}`));
  const put = (kind: number, lx: number, y: number, lz: number, quarter: number): void => void w.server.add(kind, cx + lx, y0 + y, cz + lz, (quarter * 16384) & 0xffff, 1, 1000);
  const [N, S, RISE] = [13, 3, 3];
  const half = ((N - 1) / 2) * S;
  const F = 2 * w.reg.halfY[foundation!]!;
  const C = 2 * w.reg.halfY[ceiling!]!;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) put(foundation!, i * S - half, F / 2, j * S - half, 0);
  const floorAt = (k: number): number => F + k * RISE;
  const ring = (k: number, i0: number, i1: number, j0: number, j1: number, outer: boolean): void => {
    const y = floorAt(k) + RISE / 2;
    for (let i = i0; i <= i1; i++) {
      for (const [j, side] of [[j0 - 0.5, 0], [j1 + 0.5, 2]] as const) {
        const open = outer && k === 0 && i === 6 && side === 2;
        put(open ? doorway! : k > 0 && i % 3 === 1 ? window! : wall!, i * S - half, y, j * S - half, side);
        if (open) put(door!, i * S - half, floorAt(0) + w.reg.halfY[door!]!, j * S - half, side);
      }
    }
    for (let j = j0; j <= j1; j++) for (const [i, side] of [[i0 - 0.5, 1], [i1 + 0.5, 3]] as const) put(k > 0 && j % 3 === 1 ? window! : wall!, i * S - half, y, j * S - half, side);
  };
  for (let k = 0; k < 4; k++) {
    ring(k, 0, N - 1, 0, N - 1, true);
    for (let t = 1; t < N - 1; t++) {
      put(wall!, 6.5 * S - half, floorAt(k) + RISE / 2, t * S - half, 1);
      put(wall!, t * S - half, floorAt(k) + RISE / 2, 6.5 * S - half, 0);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) put(ceiling!, i * S - half, floorAt(k + 1) - C / 2, j * S - half, 0);
    for (const [i, j] of [[-0.5, -0.5], [N - 0.5, -0.5], [-0.5, N - 0.5], [N - 0.5, N - 0.5]] as const) put(pillar!, i * S - half, floorAt(k) + RISE / 2, j * S - half, 0);
    put(stairs!, 2 * S - half, floorAt(k) + RISE / 2, 2 * S - half, 0);
  }
  for (let k = 4; k < 16; k++) {
    ring(k, 10, 12, 10, 12, false);
    for (let i = 10; i < N; i++) for (let j = 10; j < N; j++) put(ceiling!, i * S - half, floorAt(k + 1) - C / 2, j * S - half, 0);
  }
  return chunkAt(w.dims, cx, cz);
}
