// What hides what. Once the near store has drawn, a picture is made of what is sure to be drawn whole this frame (../hide.ts):
// the ground, and the near store's meshes. What it hides of the frame so far is left out, and from here on every pass is
// handed it (Frame.hider) to leave out what it hides of theirs.

import { CHUNK_SIZE, YAW_UNITS, chunkCx, chunkCz } from "../../../../shared/coords.ts";
import type { Assets } from "../../assets/assets.ts";
import type { Camera } from "../camera.ts";
import type { Casting } from "../casting.ts";
import type { Draws } from "../draws.ts";
import type { FarCity } from "../farcity.ts";
import { HIDE_PIXELS, OCCLUDER, type Hiding } from "../hide.ts";
import { DRAW_RANGED, DRAW_TEXTURED, MAX_DRAWS, PASS_FAR, PASS_NEAR, TILE_CASTS, TILE_QUADS, type FramePacket } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import type { RenderWorld } from "../scene.ts";
import type { TerrainLod } from "../terrain.ts";
import { CHUNK_CELLS, type NearStore } from "./near-store.ts";

const NEAR = 1 << PASS_NEAR;
const FAR = 1 << PASS_FAR;
/** Metres round the camera within which Occlusion.nearPiece finds the nearest piece. */
const CLEAR = 8;
/** Metres over the lowest ground drawn a tile's ground must stand for the box under it to be put in the picture. */
const RELIEF = 2;

export class Occlusion implements Pass {
  /** Whether a frame leaves out what something drawn in it wholly hides. A page turns it off for a before and after (Scene.hide). */
  on = true;
  /** The far city, once the scene has made it: a chunk it draws whole closes its neighbours' faces. */
  city: FarCity | null = null;
  private readonly world: RenderWorld;
  private readonly assets: Assets;
  private readonly packet: FramePacket;
  private readonly put: Draws;
  private readonly casting: Casting;
  private readonly terrain: TerrainLod;
  private readonly hiding: Hiding;
  private readonly store: NearStore;
  private readonly trisOfMesh: readonly (readonly number[])[];
  /** The frame being drawn, and the coarsest quad of its ground, for `under`. */
  private f!: Frame;
  private quad = 0;
  /** Over a rectangle, camera-relative, the lowest the ground drawn stands: no lower than the samples a quad round it. */
  private readonly under = (x0: number, z0: number, x1: number, z1: number): number => {
    const cam = this.f.cam, hf = this.world.hf, quad = this.quad;
    const ax = cam.x + x0 - quad, az = cam.z + z0 - quad, bx = cam.x + x1 + quad, bz = cam.z + z1 + quad;
    return ax < 0 || az < 0 || bx > hf.sizeX || bz > hf.sizeZ ? -Infinity : this.terrain.lowest(ax, az, bx, bz) - cam.y;
  };

  constructor(world: RenderWorld, assets: Assets, packet: FramePacket, put: Draws, casting: Casting, terrain: TerrainLod, hiding: Hiding, store: NearStore) {
    this.world = world;
    this.assets = assets;
    this.packet = packet;
    this.put = put;
    this.casting = casting;
    this.terrain = terrain;
    this.hiding = hiding;
    this.store = store;
    this.trisOfMesh = assets.table.tris;
  }

  draw(f: Frame): void {
    this.f = f;
    this.closes.clear();
    if (this.on) this.hideDrawn(f.cam);
    f.hider = this.hiding.on ? this.hiding : undefined;
  }

  /** The map's statics were handed over again: what was found of the ones before is let go. */
  forget(): void {
    this.boxes.clear();
    this.clearAt.fill(NaN, 0, 3);
    this.clearAt[3] = 0;
  }

  /**
   * Makes the picture of what hides what from what is sure to be drawn whole this frame, and leaves out what it hides of
   * the frame so far: the ground's tiles from the view, and from the sun's maps those whose shadow it hides; the near
   * store's draws; and its chunks' casters where it hides all their shadows can fall on. Nothing is hidden on a frame
   * that has left anything out, nor while the near plane may cut into the ground or into a piece of the near store's
   * meshes, which would open them. What is in the picture:
   * - the ground: under each tile drawn whose farthest point is within the view, a box up to its lowest sample. A line of
   *   sight from the camera, over the ground, that reaches such a box has met the ground drawn on its way. What of a box
   *   of the near store, a body or a shadow lies under the samples round it is hidden the same way (Hiding.hidesOver).
   * - the near store's meshes: the occluders of a chunk whose mesh is drawn (nearcity.ts), where each chunk round it whose
   *   pieces may hold its faces has its mesh drawn too, or none of its pieces in view, or none at all. A face the mesh
   *   leaves out is held by another piece drawn, or lies under the ground.
   */
  private hideDrawn(cam: Camera): void {
    const p = this.packet, h = this.hiding, hf = this.world.hf;
    // The meshes are drawn after: room for each cell of them in view a draw in each range, or no picture.
    let cells = 0;
    for (let k = 0; k < this.store.later.length; k += 5) for (const v of this.store.batches.get(this.store.later[k]!)!.inView) cells += v;
    if (p.dropped > 0 || p.drawCount + this.put.doubled + 2 * cells > MAX_DRAWS) return;
    const slope = Math.tan(cam.fovY / 2);
    const reach = cam.near * Math.sqrt(1 + slope * slope * (1 + cam.aspect * cam.aspect));
    // The highest the ground stands round the camera, as the tile under it draws it: the samples of its quad and those round it.
    let stride = 1;
    for (let t = 0; t < p.tileCount; t++) {
      const size = p.tiles[t * 4 + 2]! * TILE_QUADS;
      if (p.tiles[t * 4]! <= 0 && p.tiles[t * 4]! + size > 0 && p.tiles[t * 4 + 1]! <= 0 && p.tiles[t * 4 + 1]! + size > 0) stride = p.tiles[t * 4 + 3]!;
    }
    const cell = hf.cell;
    if (cam.x < 0 || cam.z < 0 || cam.x >= hf.sizeX || cam.z >= hf.sizeZ) return;
    const ci = Math.floor(cam.x / cell / stride) * stride, cj = Math.floor(cam.z / cell / stride) * stride;
    let ground = -Infinity;
    for (let j = cj - stride; j <= cj + 2 * stride; j += stride) for (let i = ci - stride; i <= ci + 2 * stride; i += stride) ground = Math.max(ground, hf.sample(Math.min(Math.max(i, 0), hf.nx - 1), Math.min(Math.max(j, 0), hf.nz - 1)));
    if (cam.y - ground <= reach) return;
    h.begin(cam);
    // Under each tile drawn wholly within the view, a box from far under the ground up to its lowest sample; but where
    // that stands no higher than RELIEF over the lowest ground drawn, as all of a flat map's does, it hides only what is
    // under the ground, which a box tested over it is cut to.
    const floor = hf.minY - 1 - cam.y, low = this.terrain.low, up = this.terrain.farthestFrom(cam.y);
    let lowest = Infinity;
    for (let t = 0; t < p.tileCount; t++) if ((p.tilePass[t]! & (NEAR | FAR)) !== 0) lowest = Math.min(lowest, low[t]!);
    // Over a rectangle the ground drawn stands no lower than the samples a quad round it, the coarsest drawn's.
    let quad = 0;
    for (let t = 0; t < p.tileCount; t++) quad = Math.max(quad, p.tiles[t * 4 + 2]!);
    this.quad = quad;
    h.under = this.under;
    h.underReach = this.f.view;
    for (let t = 0; t < p.tileCount; t++) {
      if ((p.tilePass[t]! & (NEAR | FAR)) === 0 || low[t]! <= lowest + RELIEF) continue;
      const x0 = p.tiles[t * 4]!, z0 = p.tiles[t * 4 + 1]!, size = p.tiles[t * 4 + 2]! * TILE_QUADS;
      if (Math.hypot(Math.max(-x0, x0 + size), Math.max(-z0, z0 + size), up) > this.f.view || low[t]! <= floor) continue;
      h.box(x0 + size / 2, (floor + low[t]!) / 2, z0 + size / 2, size / 2, (low[t]! - floor) / 2, size / 2, 1, 0);
    }
    if (this.store.near && !this.nearPiece(cam, reach)) {
      // An occluder whose face is too small on the picture to cover a pixel or two whole is left out: it would add little.
      const across = h.height / (2 * Math.tan(cam.fovY / 2)) / HIDE_PIXELS;
      for (const chunk of this.store.meshDrawn) {
        if (!this.sealed(cam, chunk)) continue;
        const o = this.store.batches.get(chunk)!.mesh!.occluders;
        for (let k = 0; k < o.length; k += OCCLUDER) {
          const x = o[k]! - cam.x, y = o[k + 1]! - cam.y, z = o[k + 2]! - cam.z, r = o[k + 8]!;
          const d = Math.sqrt(x * x + y * y + z * z) - r;
          if ((d > 0 && o[k + 9]! * across < d) || !cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
          h.box(x, y, z, o[k + 3]!, o[k + 4]!, o[k + 5]!, o[k + 6]!, o[k + 7]!);
        }
      }
    }
    if (!h.on) return;
    h.end();
    // The ground's tiles, in view and cast.
    const high = this.terrain.high;
    for (let t = 0; t < p.tileCount; t++) {
      const x0 = p.tiles[t * 4]!, z0 = p.tiles[t * 4 + 1]!, quad = p.tiles[t * 4 + 2]!, size = quad * TILE_QUADS;
      const skirt = low[t]! - 2 * quad;
      if ((p.tilePass[t]! & (NEAR | FAR)) !== 0 && h.hidesOver(x0, skirt, z0, x0 + size, high[t]!, z0 + size)) {
        p.tilePass[t] = p.tilePass[t]! & ~(NEAR | FAR);
        p.triangles -= TILE_QUADS * TILE_QUADS * 2;
      }
      if (p.tilePass[t]! < TILE_CASTS) continue;
      const s = this.casting.stretch(x0, z0, x0 + size, z0 + size, high[t]!);
      const sx = -this.casting.sunAt[0]! * s, sy = -this.casting.sunAt[1]! * s, sz = -this.casting.sunAt[2]! * s;
      if (this.casting.shadeHidden(Math.min(x0, x0 + sx), Math.min(skirt, skirt + sy), Math.min(z0, z0 + sz), Math.max(x0 + size, x0 + size + sx), Math.max(high[t]!, high[t]! + sy), Math.max(z0 + size, z0 + size + sz))) p.tilePass[t] = p.tilePass[t]! & (NEAR | FAR);
    }
    // A tile neither drawn nor cast leaves the list.
    let tiles = 0;
    for (let t = 0; t < p.tileCount; t++) {
      if (p.tilePass[t] === 0) continue;
      if (tiles !== t) {
        p.tiles.copyWithin(tiles * 4, t * 4, t * 4 + 4);
        p.tileOrigin.copyWithin(tiles * 2, t * 2, t * 2 + 2);
        p.tileSource.copyWithin(tiles * 4, t * 4, t * 4 + 4);
        p.tilePass[tiles] = p.tilePass[t]!;
      }
      tiles++;
    }
    p.tileCount = tiles;
    // The near store's draws, and its chunks' casters.
    const tris = this.trisOfMesh, box = this.put.boxOf;
    let kept = 0;
    for (let d = 0; d < p.drawCount; d++) {
      const o = d * 6;
      if (this.put.boxed[d] === 0 || !h.hidesOver(box[o]!, box[o + 1]!, box[o + 2]!, box[o + 3]!, box[o + 4]!, box[o + 5]!)) {
        if (kept !== d) this.put.moveRow(d, kept);
        kept++;
        continue;
      }
      const copies = this.put.passOf[d] === (NEAR | FAR) ? 2 : 1;
      p.triangles -= ((p.drawFlags[d]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? p.drawIndexCount[d]! / 3 : tris[p.drawMesh[d]!]![p.drawLod[d]!]!) * p.drawInstances[d]! * copies;
      this.put.doubled -= copies - 1;
    }
    // The rows let go take what beginFrame gives every row, which draws that leave them alone count on.
    p.drawFade.fill(0, kept, p.drawCount);
    p.drawHand.fill(0, kept, p.drawCount);
    p.drawLayer.fill(0, kept, p.drawCount);
    p.drawWear.fill(0, kept, p.drawCount);
    p.drawSwap.fill(0, kept, p.drawCount);
    p.drawEffect.fill(0, kept * 4, p.drawCount * 4);
    p.drawCount = kept;
    const casts = this.store.chunkCasts;
    let at = 0, next = 0;
    for (let k = 0; k < casts.length; k += 8) {
      const e0 = casts[k]!, e1 = casts[k + 1]!;
      for (; next < e0; next++) this.casting.moveCaster(next, at++);
      if (!this.casting.shadeHidden(casts[k + 2]!, casts[k + 3]!, casts[k + 4]!, casts[k + 5]!, casts[k + 6]!, casts[k + 7]!)) for (; next < e1; next++) this.casting.moveCaster(next, at++);
      for (; next < e1; next++) {
        const maps = this.casting.maps(p.casterCascades[next]!);
        p.castDraws -= maps;
        p.castTriangles -= ((p.casterFlags[next]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? p.casterIndexCount[next]! / 3 : tris[p.casterMesh[next]!]![p.casterLod[next]!]!) * p.casterInstances[next]! * maps;
      }
    }
    for (; next < p.casterCount; next++) this.casting.moveCaster(next, at++);
    p.casterCount = at;
  }

  /**
   * Whether the pieces chunk `chunk` of the near store draws in its mesh are closed this frame: whether each chunk round
   * it, whose pieces may hold its faces, has its mesh drawn, or is drawn by the far city at a form that holds every piece
   * whole, or has none of its pieces in view, or none at all; so that no face of the chunk's another holds is open.
   */
  private sealed(cam: Camera, chunk: number): boolean {
    const dims = this.world.dims, city = this.world.city!.statics, reach = this.f.alongGround(this.assets.tier.reach.city);
    const cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, z = cz + dz;
        if ((dx === 0 && dz === 0) || x < 0 || z < 0 || x >= dims.chunksX || z >= dims.chunksZ) continue;
        const n = z * dims.chunksX + x;
        let closed = this.closes.get(n);
        if (closed === undefined) this.closes.set(n, (closed = this.store.meshDrawn.has(n) || city.in(n) === 0 || this.unseen(cam, n) || (this.city?.isFar(n) === true && this.city.exactly(n, cam, reach))));
        if (!closed) return false;
      }
    }
    return true;
  }

  /** Per chunk asked of this frame, whether it leaves no face of a neighbour's open (`sealed`). */
  private readonly closes = new Map<number, boolean>();

  /** Per chunk of the map's statics, found when first asked for: per cell of 16 m, the box round the pieces whose middles are in it. */
  private readonly boxes = new Map<number, Float64Array>();

  /** Whether no piece of chunk `chunk` of the map's statics is in view: each its turned box of its kind's half extents. */
  private unseen(cam: Camera, chunk: number): boolean {
    let b = this.boxes.get(chunk);
    if (!b) {
      const { first, kind, yaw, x, y, z, halfX, halfY, halfZ } = this.world.city!.statics;
      b = new Float64Array(CHUNK_CELLS * CHUNK_CELLS * 6);
      for (let k = 0; k < b.length; k += 6) b.fill(Infinity, k, k + 3).fill(-Infinity, k + 3, k + 6);
      const x0 = chunkCx(this.world.dims, chunk) * CHUNK_SIZE, z0 = chunkCz(this.world.dims, chunk) * CHUNK_SIZE;
      for (let i = first[chunk]!; i < first[chunk + 1]!; i++) {
        const k = kind[i]!, a = (yaw[i]! / YAW_UNITS) * Math.PI * 2;
        const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
        const rx = c * halfX[k]! + s * halfZ[k]! + 0.01, rz = s * halfX[k]! + c * halfZ[k]! + 0.01;
        const ci = Math.min(CHUNK_CELLS - 1, Math.max(0, Math.floor(((x[i]! - x0) * CHUNK_CELLS) / CHUNK_SIZE)));
        const cj = Math.min(CHUNK_CELLS - 1, Math.max(0, Math.floor(((z[i]! - z0) * CHUNK_CELLS) / CHUNK_SIZE)));
        const o = (cj * CHUNK_CELLS + ci) * 6;
        b[o] = Math.min(b[o]!, x[i]! - rx);
        b[o + 1] = Math.min(b[o + 1]!, y[i]! - halfY[k]!);
        b[o + 2] = Math.min(b[o + 2]!, z[i]! - rz);
        b[o + 3] = Math.max(b[o + 3]!, x[i]! + rx);
        b[o + 4] = Math.max(b[o + 4]!, y[i]! + halfY[k]!);
        b[o + 5] = Math.max(b[o + 5]!, z[i]! + rz);
      }
      this.boxes.set(chunk, b);
    }
    for (let o = 0; o < b.length; o += 6) if (b[o]! <= b[o + 3]! && cam.boxVisible(b[o]! - cam.x, b[o + 1]! - cam.y, b[o + 2]! - cam.z, b[o + 3]! - cam.x, b[o + 4]! - cam.y, b[o + 5]! - cam.z)) return false;
    return true;
  }

  /**
   * Whether a piece the near store's meshes draw may come within `reach` of the camera, where the near plane would cut
   * it open: any of the map's pieces whose turned box of its kind's half extents (which hold all of its form) comes that
   * near. Those of the chunks round the camera's are looked at for the nearest within CLEAR, which holds while the
   * camera moves less than the difference; a piece of a chunk farther reaches no nearer than 48 m.
   */
  private nearPiece(cam: Camera, reach: number): boolean {
    const dims = this.world.dims, city = this.world.city;
    if (!city) return false;
    // No piece came nearer than `clear` from where it was last looked for: none can be within reach until the camera has moved the difference.
    const at = this.clearAt;
    if (Math.hypot(cam.x - at[0]!, cam.y - at[1]!, cam.z - at[2]!) < at[3]! - reach * 1.1) return false;
    let clear = CLEAR;
    const { first, kind, yaw, x, y, z, halfX, halfY, halfZ } = city.statics;
    const cx = Math.floor(cam.x / CHUNK_SIZE), cz = Math.floor(cam.z / CHUNK_SIZE);
    for (let j = Math.max(0, cz - 1); j <= Math.min(dims.chunksZ - 1, cz + 1); j++) {
      for (let i = Math.max(0, cx - 1); i <= Math.min(dims.chunksX - 1, cx + 1); i++) {
        const c = j * dims.chunksX + i;
        for (let s = first[c]!; s < first[c + 1]!; s++) {
          const k = kind[s]!;
          const dx = cam.x - x[s]!, dy = cam.y - y[s]!, dz = cam.z - z[s]!, r = halfX[k]! + halfY[k]! + halfZ[k]! + CLEAR;
          if (this.store.near!.kinds[k] !== 1 || Math.abs(dx) > r || Math.abs(dy) > r || Math.abs(dz) > r) continue;
          const a = (yaw[s]! / YAW_UNITS) * Math.PI * 2, co = Math.cos(a), si = Math.sin(a);
          const lx = Math.max(Math.abs(co * dx - si * dz) - halfX[k]!, 0), ly = Math.max(Math.abs(dy) - halfY[k]!, 0), lz = Math.max(Math.abs(si * dx + co * dz) - halfZ[k]!, 0);
          clear = Math.min(clear, Math.sqrt(lx * lx + ly * ly + lz * lz));
        }
      }
    }
    at[0] = cam.x;
    at[1] = cam.y;
    at[2] = cam.z;
    at[3] = clear;
    return clear < reach * 1.1;
  }

  /** Where the camera was when `nearPiece` last looked, and how far the nearest piece was then. */
  private readonly clearAt = Float64Array.of(NaN, NaN, NaN, 0);
}
