// A map with a city of its own: static pieces set down with the map, which a server's store holds and a client's far city
// draws from the map, a client near store that holds a chunk's rows only when a test sends them, and the far feed between,
// seen through a scene and the software rasterizer. Its buildings are frames of the Miami ruin kit's boxes.

import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import type { CityMaker } from "../../client/core/render/citymake.ts";
import type { CitySource } from "../../client/core/render/farcity.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { slopeKind } from "../../content/slopes.ts";
import { CHUNK_SIZE, STRUCT_UNITS, YAW_UNITS, chunkAt, chunkCx, chunkCz, type MapDims } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Summary, bakeChunk, pieceShapes, writeFar } from "../../shared/world/tactical.ts";
import { PICK_FAR, PICK_STRUCTURE, Rasterizer } from "../../tools/snap/raster.ts";
import { farPack, farRegistry } from "./farworld.ts";

export const FLOOR = "core:zruin_floor8_concrete";
export const PIER = "core:zruin_pier4_concrete";
export const BEAM = "core:zruin_beam8_concrete";
export const WALL = "core:zruin_wall8_limestone";
export const STEP = "core:zruin_step_concrete";
export const FLOOR16 = "core:zruin_floor16_concrete";
export const SLOPE_RAMP = slopeKind("ramp");
export const SLOPE_RUBBLE = slopeKind("rubble");
export const SLOPE_STAIRS = slopeKind("stairs");
export const SLOPE_STAIRS_SOLID = slopeKind("stairs_solid");
export const SLOPE_SLAB30 = slopeKind("slab30");
export const SLOPE_SLAB60 = slopeKind("slab60");
export const SLOPE_ROOF = slopeKind("roof");

/**
 * A frame building of `storeys` 4 m storeys at (x, z), turned by `yaw` (in 1/65,536 turns): a floor of `side` by `side`
 * 8 m plates each storey, piers at the plates' corners, beams along the outer edges, a wall on the north face of each
 * storey and a step inside. `y0` is the ground under it.
 */
export function building(x: number, z: number, y0: number, storeys: number, side = 2, yaw = 0): MapStatic[] {
  const out: MapStatic[] = [];
  const a = (yaw / YAW_UNITS) * 2 * Math.PI;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  // A point of the building's own frame, (u, v) from its middle, in the world, turned as a piece's vertices are.
  const put = (kind: string, u: number, y: number, v: number, quarter = 0): void => void out.push({ kind, x: x + c * u + s * v, y: y0 + y, z: z + c * v - s * u, yaw: (yaw + quarter * 16384) % YAW_UNITS });
  const half = side * 4;
  for (let k = 0; k < storeys; k++) {
    const base = k * 4;
    for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) put(FLOOR, -half + 4 + i * 8, base + 0.2, -half + 4 + j * 8);
    for (let i = 0; i <= side; i++) for (let j = 0; j <= side; j++) put(PIER, -half + i * 8, base + 2.4, -half + j * 8);
    for (let i = 0; i < side; i++) {
      put(BEAM, -half + 4 + i * 8, base + 0.1, -half);
      put(BEAM, -half + 4 + i * 8, base + 0.1, half);
      put(WALL, -half + 4 + i * 8, base + 1.8, half - 0.4);
    }
    put(STEP, 0, base + 0.6, 0);
  }
  return out;
}

/**
 * The sloped proof kinds (content/slopes.ts) as a ruin might lay them, about (x, z) on flat ground at `y0`, turned by `yaw`,
 * in groups: a ramp up to a deck with a step under its high end; a floor slab fallen onto the plate below, its low end in
 * it; rubble heaped against a wall over a step; flights of stairs up to two decks; a wall panel gone over against a wall;
 * a pitched roof on four walls.
 */
export function slopes(x: number, z: number, y0: number, yaw = 0): Record<"ramp" | "slab" | "rubble" | "stairs" | "panel" | "roof" | "all", MapStatic[]> {
  const a = (yaw / YAW_UNITS) * 2 * Math.PI;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const at = (u0: number, v0: number) => {
    const out: MapStatic[] = [];
    const put = (kind: string, u: number, y: number, v: number, quarter = 0): number => out.push({ kind, x: x + c * (u0 + u) + s * (v0 + v), y: y0 + y, z: z + c * (v0 + v) - s * (u0 + u), yaw: (yaw + quarter * 16384) % YAW_UNITS });
    return { out, put };
  };
  const ramp = at(-16, -8);
  // The deck's top 2 m up; the ramp rises 2 m to it over 6 m, its high end against the deck's side.
  ramp.put(FLOOR, 0, 1.8, 0);
  ramp.put(SLOPE_RAMP, 0, 0.8, -7);
  ramp.put(STEP, 0, 0.2, -5);
  const slab = at(0, -8);
  // Fallen 30 degrees, its low end 2 cm into the plate under it.
  slab.put(FLOOR16, 0, 0.2, 0);
  slab.put(SLOPE_SLAB30, 0, 2.193, 0);
  const rubble = at(16, -8);
  rubble.put(WALL, 0, 1.4, 2.25);
  rubble.put(SLOPE_RUBBLE, 0, 0.75, 0);
  rubble.put(STEP, 0, 0.2, 1);
  const stairs = at(-16, 12);
  // A flight 4 m up to a deck, and a solid one 3 m up to another, beside it.
  stairs.put(FLOOR, 0, 3.8, 6.75);
  stairs.put(SLOPE_STAIRS, 0, 2, 0);
  stairs.put(FLOOR, 8, 2.8, 5.8);
  stairs.put(SLOPE_STAIRS_SOLID, 8, 1.5, 0);
  const panel = at(4, 12);
  // A wall panel gone over against a wall, its foot on the ground.
  panel.put(WALL, 0, 1.4, 1.5);
  panel.put(SLOPE_SLAB60, 0, 1.43, 0.25);
  const roof = at(18, 12);
  roof.put(WALL, 0, 1.4, -3.75);
  roof.put(WALL, 0, 1.4, 3.75);
  roof.put(WALL, -3.75, 1.4, 0, 1);
  roof.put(WALL, 3.75, 1.4, 0, 1);
  roof.put(SLOPE_ROOF, 0, 2.8 + 1.375, 0);
  const groups = { ramp: ramp.out, slab: slab.out, rubble: rubble.out, stairs: stairs.out, panel: panel.out, roof: roof.out };
  return { ...groups, all: Object.values(groups).flat() };
}

export interface CityWorldOptions {
  chunks: number;
  statics: MapStatic[];
  tier?: Partial<Tier>;
  width?: number;
  height?: number;
  /** The ground's height at (x, z), flat at 0 if not given. */
  ground?: (x: number, z: number) => number;
  pack?: Pack;
  /** The statics come after the scene is made, when `arrive` is called, as they do after a client's first frame. */
  late?: boolean;
  /** Where the far city's levels are made, if not on this thread a frame's budget at a time. */
  maker?: CityMaker;
}

export type CityWorld = ReturnType<typeof cityWorld>;

/** Statics as a map file gives them back: centres to 1/512 m (shared/world/mapfile.ts STAT). */
export function asWritten(statics: readonly MapStatic[]): MapStatic[] {
  const snap = (v: number): number => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS;
  return statics.map((s) => ({ ...s, x: snap(s.x), y: snap(s.y), z: snap(s.z), yaw: Math.round(s.yaw) % YAW_UNITS }));
}

export function cityWorld(options: CityWorldOptions) {
  const o = { ...options, statics: asWritten(options.statics) };
  const reg = farRegistry();
  const dims: MapDims = { chunksX: o.chunks, chunksZ: o.chunks };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, o.ground?.(i * hf.cell, j * hf.cell) ?? 0);
  hf.tint.fill(12);
  const statics = new CityStatics(dims, o.statics, reg);
  const server = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  for (const s of o.statics) {
    const k = reg.index.get(s.kind)!;
    server.add(k, s.x, s.y, s.z, s.yaw, 0, 1000);
  }
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const cells = new FarStore();
  const whole = new Uint8Array(dims.chunksX * dims.chunksZ);
  const complete = (chunk: number): boolean => whole[chunk] === 1;
  const pack = o.pack ?? farPack();
  const world: { dims: MapDims; hf: Heightfield; structs: StructureStore; far: { cells: FarStore; complete: typeof complete }; city?: CitySource } = { dims, hf, structs, far: { cells, complete } };
  const maker = o.maker ? { maker: o.maker } : {};
  if (!o.late) world.city = { statics, complete, ...maker };
  const scene = new Scene(world, reg, pack);
  scene.assets.tier = { ...tierOf("medium"), ...o.tier };
  if (scene.city) scene.city.makeMs = Infinity;
  const [W, H] = [o.width ?? 320, o.height ?? 180];
  scene.viewHeight = H;
  const cam = new Camera();
  cam.aspect = W / H;
  const raster = new Rasterizer(W, H, pack, hf);
  const shapes = pieceShapes(reg);
  const w = new BitWriter(1024);
  const r = new BitReader();
  let now = 0;
  return {
    reg, dims, hf, statics, server, structs, cells, whole, scene, cam, raster, pack, W, H,
    /** Bakes `chunk`'s far cells from the server's store and hands them to the far store, as S_FAR does. */
    send(chunk: number): void {
      const s = new Summary();
      bakeChunk(server.chunks[chunk] ?? null, chunkCx(dims, chunk) * CHUNK_SIZE, chunkCz(dims, chunk) * CHUNK_SIZE, shapes, hf, s);
      w.reset();
      writeFar(w, chunk, s.far);
      r.reset(w.bytes());
      cells.read(r, dims);
    },
    /** Copies the server's rows of `chunk` into the near store and marks it whole. */
    rows(chunk: number): void {
      const t = server.chunks[chunk];
      if (t) for (let s = 0; s < t.high; s++) structs.put(chunk, s, t.kind[s]!, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, t.owner[s]!, t.hp[s]!, t.version);
      structs.setVersion(chunk, t?.version ?? 0);
      whole[chunk] = 1;
    },
    /** The statics of a `late` world come. */
    arrive(): void {
      world.city = { statics, complete, ...maker };
    },
    /** The near store lets go of `chunk`. */
    drop(chunk: number): void {
      structs.dropChunk(chunk);
      whole[chunk] = 0;
    },
    chunkOf(x: number, z: number): number {
      return chunkAt(dims, x, z);
    },
    /** One frame a sixtieth of a second after the last, drawn by the rasterizer without the ground. */
    frame(ground = false): FramePacket {
      scene.now = now += 1000 / 60;
      const p = scene.build(cam, null);
      const tiles = p.tileCount;
      if (!ground) p.tileCount = 0;
      raster.render(p);
      p.tileCount = tiles;
      return p;
    },
    /** Pixels the far city or far blocks drew, and pixels of real pieces, in the last frame: a 1 each. */
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
