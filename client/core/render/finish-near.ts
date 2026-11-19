// How near the eye each world finish's surfaces come, and the walls and the glass the facades are drawn on: what the
// finishes' and the facades' textures are wanted at (world-surfaces.ts WorldFinishes, facade.ts FacadeAtlases). It is
// looked for all round the eye, not in the view alone, so turning never changes it: the ground's covers, and the near
// store's pieces by the colours of their kinds. A look goes over at most LOOK_WORK samples and pieces a frame, the
// nearest first, and is begun again once the eye has gone MOVE metres, the store has changed or LOOK_EVERY frames have
// passed. Until one is through the one before stands, each distance less the way the eye has gone since that began,
// which is never more than it can be; a jump starts afresh.

import { SURFACE_NAMES, surfaceIndex } from "../../../content/surfaces.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, YAW_UNITS } from "../../../shared/coords.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import { FACADE_COLOURS, KINDS, facadeKind } from "./facade.ts";

/**
 * The slots of the distances after the finishes': the nearest wall of a piece, the nearest face of one that wears an
 * element of the facades (a window, a door, a shutter, a sign), and the nearest glass with a room behind it.
 */
export const NEAR_WALL = SURFACE_NAMES.length;
export const NEAR_FRONT = NEAR_WALL + 1;
export const NEAR_GLASS = NEAR_WALL + 2;
const SLOTS = NEAR_GLASS + 1;
/** Samples of the ground and pieces of the store a frame's look goes over at most. */
export const LOOK_WORK = 4096;
/** Metres the eye goes and frames that pass before a look is begun again, and metres in one frame that are a jump. */
export const MOVE = 4;
const LOOK_EVERY = 120;
const JUMP = 64;
/**
 * Metres a tile of the widest that a finish's surfaces are read at where they are near: of the ground's finishes and the
 * masks a walk reads, 4; of the road's macro, 32 (world-surfaces.ts ROAD_MACRO); and on a piece, the facades' elements'
 * atlas, 16 (facade.ts FACADE_TOP over DENSITY). A look reaches as far as these at their first step's 64 pixels.
 */
const GROUND_TILE = 4;
const ROAD_TILE = 32;
const PIECE_TILE = 16;
const FIRST = 64;
/** Cells between the samples of the ground looked at past the near ground, where only asphalt and sand are looked for. */
const FAR_STEP = 8;
const ASPHALT = SURFACE_NAMES.indexOf("asphalt"), SAND = SURFACE_NAMES.indexOf("sand");

export class FinishNear {
  /** Metres from the eye to the nearest surface of each finish, by its index, then to a wall, a front and glass; Infinity for none within reach. */
  readonly metres = new Float32Array(SLOTS).fill(Infinity);
  /** Samples and pieces looked at in the last frame, in all, and looks finished. */
  readonly stats = { work: 0, looks: 0 };
  /** The last finished look's distances, and this one's so far. */
  private readonly last = new Float32Array(SLOTS).fill(Infinity);
  private readonly found = new Float32Array(SLOTS).fill(Infinity);
  /** Per content index, a bit for each finish its colours take, and for a wall, a front and glass. */
  private readonly kinds: Uint32Array;
  private readonly halfX: Float32Array;
  private readonly halfY: Float32Array;
  private readonly halfZ: Float32Array;
  /** The ground's finish by its tint. */
  private readonly ground: Uint8Array;
  /** Metres the eye has gone in all, and where it had got to when the last finished look and this one began. */
  private travel = 0;
  private lastFrom = 0;
  private from = 0;
  private readonly eye = Float64Array.of(NaN, NaN, NaN);
  /** This look's stage (-1 for none under way: 0 the near ground, 1 the pieces, 2 the far ground), and where in it. */
  private stage = -1;
  private row = 0;
  private col = 0;
  private chunks: number[] = [];
  private frame = 0;
  private begun = -LOOK_EVERY;
  private shapes = -1;
  /** This look's reaches in metres, the eye's place when it began, and its height over the ground there. */
  private readonly reach = { ground: 0, far: 0, pieces: 0 };
  private readonly at = Float64Array.of(0, 0, 0, 0);

  /** `desert` takes the desert's ground (content/surfaces.ts surfaceIndex). */
  constructor(reg: Registry, desert: boolean) {
    this.halfX = reg.halfX;
    this.halfY = reg.halfY;
    this.halfZ = reg.halfZ;
    this.ground = Uint8Array.from({ length: 256 }, (_, t) => surfaceIndex(t, true, desert ? "las-vegas" : "default"));
    this.kinds = Uint32Array.from(reg.defs, (d, k) => {
      if (d?.type !== "structure" || !(reg.halfX[k]! > 0)) return 0;
      const shape = d.shape !== undefined ? reg.defs[reg.index.get(d.shape) ?? 0] : null;
      const boxes = shape?.type === "shape" && shape.look?.boxes ? shape.look.boxes.map((b) => ({ half: b.half, color: b.color ?? d.color })) : [{ half: [reg.halfX[k]!, reg.halfY[k]!, reg.halfZ[k]!], color: d.color }];
      let bits = 1 << NEAR_WALL | 1 << surfaceIndex(d.under ?? d.color, false);
      for (const { half, color } of boxes) {
        bits |= 1 << surfaceIndex(color, false);
        const cls = FACADE_COLOURS[color] ?? 0;
        for (const w of [half[0]!, half[2]!]) {
          const kind = KINDS[facadeKind(cls, w * 2, half[1]! * 2, 0)]!;
          if (kind.element !== "") bits |= 1 << NEAR_FRONT;
          if (kind.room) bits |= 1 << NEAR_GLASS;
        }
      }
      return bits;
    });
  }

  /** Whether no look is under way: none has begun since the eye, the store and the ground last stood as one looked at them. */
  get through(): boolean {
    return this.stage < 0;
  }

  /**
   * A frame with the eye at (x, y, z): the look goes on, or begins, over `hf` and `store`, out to the reaches that
   * `scale` pixels a metre a metre off and `taps` (2 where the tier reads at a slant, else 1) give.
   */
  update(x: number, y: number, z: number, hf: Heightfield, store: StructureStore, scale: number, taps: number): void {
    this.frame++;
    const moved = Number.isNaN(this.eye[0]!) ? 0 : Math.hypot(x - this.eye[0]!, y - this.eye[1]!, z - this.eye[2]!);
    this.eye[0] = x;
    this.eye[1] = y;
    this.eye[2] = z;
    this.travel += moved;
    if (moved > JUMP) {
      this.last.fill(Infinity);
      this.stage = -1;
    }
    const ground = Math.min(256, (taps * scale * GROUND_TILE) / FIRST), far = Math.min(1024, (taps * scale * ROAD_TILE) / FIRST);
    const pieces = Math.min(256, (Math.max(taps * GROUND_TILE, PIECE_TILE) * scale) / FIRST);
    if (this.stage < 0 && (this.travel - this.from >= MOVE || store.shapes !== this.shapes || this.frame - this.begun >= LOOK_EVERY || ground !== this.reach.ground)) {
      this.begin(x, y, z, hf, store, ground, far, pieces);
    }
    let work = 0;
    while (this.stage >= 0 && work < LOOK_WORK) {
      if (this.stage === 0) work += this.groundRow(hf, 1, this.reach.ground, -1);
      else if (this.stage === 1) work += this.pieces(store, LOOK_WORK - work);
      else work += this.groundRow(hf, FAR_STEP, this.reach.far, this.reach.ground);
    }
    this.stats.work = work;
    const since = this.travel - this.lastFrom, now = this.travel - this.from;
    for (let k = 0; k < SLOTS; k++) this.metres[k] = Math.max(0, Math.min(this.last[k]! - since, this.stage >= 0 ? this.found[k]! - now : Infinity));
  }

  private begin(x: number, y: number, z: number, hf: Heightfield, store: StructureStore, ground: number, far: number, pieces: number): void {
    this.stage = 0;
    this.row = 0;
    this.col = 0;
    this.begun = this.frame;
    this.shapes = store.shapes;
    this.from = this.travel;
    this.found.fill(Infinity);
    Object.assign(this.reach, { ground, far, pieces });
    this.at[0] = x;
    this.at[1] = y;
    this.at[2] = z;
    this.at[3] = Math.max(0, y - hf.heightAt(Math.min(Math.max(x, 0), hf.sizeX), Math.min(Math.max(z, 0), hf.sizeZ)));
    // The chunks the pieces' reach meets, nearest first.
    const { chunksX, chunksZ } = store.dims, r = Math.ceil(pieces / CHUNK_SIZE) + 1, cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const near: number[] = [];
    for (let j = Math.max(0, cz - r); j <= Math.min(chunksZ - 1, cz + r); j++) {
      for (let i = Math.max(0, cx - r); i <= Math.min(chunksX - 1, cx + r); i++) {
        const dx = Math.max(i * CHUNK_SIZE - x, x - (i + 1) * CHUNK_SIZE, 0), dz = Math.max(j * CHUNK_SIZE - z, z - (j + 1) * CHUNK_SIZE, 0);
        if (Math.hypot(dx, dz) <= pieces) near.push(j * chunksX + i);
      }
    }
    const away = (c: number): number => Math.hypot(((c % chunksX) + 0.5) * CHUNK_SIZE - x, (Math.floor(c / chunksX) + 0.5) * CHUNK_SIZE - z);
    this.chunks = near.sort((a, b) => away(a) - away(b));
  }

  /**
   * The next row of the ground's samples `step` cells apart within `reach` of where the look began, rows outward from
   * there, past `inside` metres either way only (or all for -1), asphalt and sand alone where `step` is more than 1.
   * Returns the samples looked at; the stage ends after its last row.
   */
  private groundRow(hf: Heightfield, step: number, reach: number, inside: number): number {
    const [x, , z, over] = this.at as unknown as [number, number, number, number];
    const cell = hf.cell, rows = Math.ceil(reach / (cell * step));
    const k = this.row++;
    // A server's ground has no tints, and draws nothing.
    if (k > 2 * rows || hf.tint.length === 0) return this.next();
    const jc = Math.round(z / (cell * step)) * step, j = jc + (k % 2 === 0 ? k / 2 : -(k + 1) / 2) * step;
    if (j < 0 || j >= hf.nz) return 1;
    const ic = Math.round(x / (cell * step)) * step, i0 = Math.max(0, ic - rows * step), i1 = Math.min(hf.nx - 1, ic + rows * step);
    // A sample's cover shows within a cell of it, a diagonal at most.
    const spread = cell * step * Math.SQRT2, dz = j * cell - z, row = j * hf.nx;
    let n = 0;
    for (let i = i0; i <= i1; i += step) {
      const dx = i * cell - x;
      if (inside > 0 && Math.abs(dx) < inside && Math.abs(dz) < inside) continue;
      n++;
      const f = this.ground[hf.tint[row + i]!]!;
      if (step > 1 && f !== ASPHALT && f !== SAND) continue;
      const h = Math.max(0, Math.sqrt(dx * dx + dz * dz) - spread), d = Math.sqrt(h * h + over * over);
      if (d < this.found[f]!) this.found[f] = d;
    }
    return Math.max(1, n);
  }

  /** The pieces of the next chunks within the pieces' reach, at most `most` of them; the stage ends after the last chunk's. */
  private pieces(store: StructureStore, most: number): number {
    const [x, y, z] = this.at as unknown as [number, number, number];
    const reach = this.reach.pieces;
    let n = 0;
    while (n < most) {
      const c = this.chunks[this.row];
      if (c === undefined) return n + this.next();
      const t = store.chunks[c];
      const high = t ? t.high : 0;
      for (; this.col < high && n < most; this.col++, n++) {
        const s = this.col, k = t!.kind[s]!, bits = this.kinds[k] ?? 0;
        if (bits === 0) continue;
        const hx = this.halfX[k]!, hy = this.halfY[k]!, hz = this.halfZ[k]!, r = hx + hy + hz + reach;
        const dx = x - t!.x[s]!, dy = y - t!.y[s]!, dz = z - t!.z[s]!;
        if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
        const a = (t!.yaw[s]! / YAW_UNITS) * Math.PI * 2, co = Math.cos(a), si = Math.sin(a);
        const lx = Math.max(Math.abs(co * dx - si * dz) - hx, 0), ly = Math.max(Math.abs(dy) - hy, 0), lz = Math.max(Math.abs(si * dx + co * dz) - hz, 0);
        const d = Math.sqrt(lx * lx + ly * ly + lz * lz);
        if (d > reach) continue;
        for (let b = bits; b !== 0; b &= b - 1) {
          const f = 31 - Math.clz32(b & -b);
          if (d < this.found[f]!) this.found[f] = d;
        }
      }
      if (this.col >= high) {
        this.row++;
        this.col = 0;
      }
    }
    return n;
  }

  /** The look's next stage, or its end, where what it found becomes the last look's. Returns 1, for the step. */
  private next(): number {
    this.row = 0;
    this.col = 0;
    if (++this.stage <= 2) return 1;
    this.stage = -1;
    this.last.set(this.found);
    this.lastFrom = this.from;
    this.stats.looks++;
    return 1;
  }
}
