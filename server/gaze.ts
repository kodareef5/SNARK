// What a survivor looks at through a sight (D1032). A session looking through one says how many times it magnifies and how
// far off what the middle of its view is on (CMD_GAZE). The server holds the zoom to what the survivor holds or wears that
// magnifies, and while the gaze lasts adds the chunks along its look, past its own, to its view, those nearest what it is on
// first (GameServer.cone), and holds the creatures round what it is on awake, as a body nearby would, so that what is seen
// far off lives. Each session's cone is its own: two survivors side by side looking two ways see two different things.

import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz } from "../shared/coords.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { CMD_GAZE, GAZE_FARTHEST, GAZE_REACH, GAZE_TICKS, RESULT_DENIED, RESULT_INVALID, RESULT_OK } from "../shared/net/protocol.ts";
import type { ItemDef } from "../shared/content/defs.ts";
import { ARMOR_SLOTS } from "../shared/sim/items.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** The tangent of the widest half of a view across that a session may have: 50 degrees up on a screen 2.4 times as wide. */
const WIDEST = Math.tan((50 * Math.PI) / 180) * 2.4;
/** A chunk's half diagonal: a chunk whose middle is this far outside the cone may still show in it. */
const SLACK = (CHUNK_SIZE * Math.SQRT2) / 2;
/** The most chunks a cone holds. */
export const CONE_CHUNKS = 48;
/** Chunks a side held awake round what a sight is on, and the most a server holds so for all its sessions. */
export const WAKE_SIDE = 3;
export const WAKE_MOST = 64;
/** Ticks between a cone's chunks found again as its survivor turns. */
const REFRESH = 6;

export interface GazeContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly items: Items;
  readonly game: GameServer;
  /** Holds `chunk`'s creatures awake (1) or lets them go (-1), as a body round them does (Creatures.watch). */
  wake(chunk: number, delta: number): void;
}

/** One session's gaze. */
class Look {
  zoom = 0;
  focus = 0;
  /** The tick it ends without another CMD_GAZE, and the tick its chunks were last found. */
  until = 0;
  at = -1;
  readonly chunks = new Int32Array(CONE_CHUNKS);
  count = 0;
  /** The chunks it holds awake. */
  readonly waking: number[] = [];
}

export class Gaze {
  readonly ctx: GazeContext;
  private readonly looks = new Map<Client, Look>();
  /** Per chunk, the cones it is in. */
  private readonly coned: Uint16Array;
  /** Chunks held awake by every cone together. */
  private woken = 0;
  private readonly found: { chunk: number; score: number }[] = [];

  constructor(ctx: GazeContext) {
    this.ctx = ctx;
    this.coned = new Uint16Array(ctx.world.dims.chunksX * ctx.world.dims.chunksZ);
    ctx.game.handle(CMD_GAZE, (c, r) => this.command(c, r));
    ctx.game.cone = (c) => {
      const look = this.looks.get(c);
      return look && look.count > 0 ? look : null;
    };
  }

  /** How many times the most that `c`'s survivor holds or wears magnifies: the held item, its attachment, its armour. 0 for none. */
  most(c: Client): number {
    const { records, items, world } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec || c.ent < 0) return 0;
    const inv = items.inv(rec);
    const defs = world.reg.defs;
    let best = 0;
    const of = (item: number): void => {
      const optic = item !== 0 ? (defs[item] as ItemDef | null)?.optic : undefined;
      if (optic) best = Math.max(best, optic.max ?? optic.min);
    };
    const slot = inv.hotbar >= 0 && rec.held >= 0 ? inv.hotbar + rec.held : -1;
    if (slot >= 0) {
      of(inv.item[slot]!);
      of(inv.attach[slot]!);
    }
    if (inv.armor >= 0) for (let k = 0; k < ARMOR_SLOTS; k++) of(inv.item[inv.armor + k]!);
    return best;
  }

  /** CMD_GAZE. A zoom of 1 or less, or one nothing the survivor has gives, ends the gaze. */
  private command(c: Client, r: BitReader): number {
    const zoom = r.u16() / 16;
    const focus = r.u16();
    if (r.overflow) return RESULT_INVALID;
    if (zoom <= 1) {
      this.end(c);
      return RESULT_OK;
    }
    const most = this.most(c);
    if (most <= 1) {
      this.end(c);
      return RESULT_DENIED;
    }
    let look = this.looks.get(c);
    if (!look) this.looks.set(c, (look = new Look()));
    look.zoom = Math.min(zoom, most);
    look.focus = Math.min(focus, this.reach(look.zoom));
    look.until = this.ctx.world.tick + GAZE_TICKS;
    look.at = -1;
    return RESULT_OK;
  }

  /** Metres a cone `zoom` times reaches. */
  reach(zoom: number): number {
    return Math.min(GAZE_FARTHEST, GAZE_REACH * zoom);
  }

  /** Each tick: gazes that ended, or whose survivor no longer has what gave them, go; the rest find their chunks as they turn. */
  step(tick: number): void {
    for (const [c, look] of this.looks) {
      if (!c.active || c.ent < 0 || tick >= look.until) {
        this.end(c);
        continue;
      }
      if (look.at >= 0 && tick - look.at < REFRESH) continue;
      const most = this.most(c);
      if (most <= 1) {
        this.end(c);
        continue;
      }
      look.zoom = Math.min(look.zoom, most);
      this.aim(c, look, tick);
    }
  }

  /** Whether the point (x, z) lies in a chunk some session's cone holds: what is there is seen, if far off. */
  seen(x: number, z: number): boolean {
    const dims = this.ctx.world.dims;
    if (x < 0 || z < 0 || x >= dims.chunksX * CHUNK_SIZE || z >= dims.chunksZ * CHUNK_SIZE) return false;
    return this.coned[chunkAt(dims, x, z)]! > 0;
  }

  /** The gazes now, for tests and the admin page. */
  get count(): number {
    return this.looks.size;
  }

  /** Ends `c`'s gaze: its cone goes from its view and the creatures it held awake may sleep. */
  end(c: Client): void {
    const look = this.looks.get(c);
    if (!look) return;
    for (let k = 0; k < look.count; k++) this.coned[look.chunks[k]!]!--;
    look.count = 0;
    for (const chunk of look.waking) this.release(chunk);
    look.waking.length = 0;
    this.looks.delete(c);
  }

  /**
   * Finds the chunks of `c`'s cone: along its look from its eye, as wide as the widest screen's view at its zoom and a
   * chunk more, as far as its zoom reaches, past the square round it that its view already holds; those nearest what it is
   * on first, or the nearest where it is on nothing. And holds those round what it is on awake.
   */
  private aim(c: Client, look: Look, tick: number): void {
    const { world, game } = this.ctx;
    const ents = world.ents, dims = world.dims, e = c.ent;
    look.at = tick;
    const yaw = (ents.yaw[e]! * 2 * Math.PI) / 65536, pitch = (ents.pitch[e]! * (Math.PI / 2)) / 16384;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const ex = ents.x[e]!, ez = ents.z[e]!;
    const reach = this.reach(look.zoom), slope = WIDEST / look.zoom;
    const focus = look.focus * Math.cos(pitch);
    const own = game.opts.entityRadius, ocx = chunkCx(dims, c.chunk), ocz = chunkCz(dims, c.chunk);
    // The box the cone lies in: a narrow one's ends and sides, a wide one's square.
    const half = Math.atan(slope);
    let x0 = ex - reach, x1 = ex + reach, z0 = ez - reach, z1 = ez + reach;
    if (half < Math.PI / 6) {
      const c1 = Math.cos(half), s1 = Math.sin(half);
      const px = [ex, ex + reach * (dx * c1 - dz * s1), ex + reach * (dx * c1 + dz * s1), ex + reach * dx];
      const pz = [ez, ez + reach * (dz * c1 + dx * s1), ez + reach * (dz * c1 - dx * s1), ez + reach * dz];
      [x0, x1, z0, z1] = [Math.min(...px), Math.max(...px), Math.min(...pz), Math.max(...pz)];
    }
    const i0 = Math.max(0, Math.floor((x0 - SLACK) / CHUNK_SIZE)), i1 = Math.min(dims.chunksX - 1, Math.floor((x1 + SLACK) / CHUNK_SIZE));
    const j0 = Math.max(0, Math.floor((z0 - SLACK) / CHUNK_SIZE)), j1 = Math.min(dims.chunksZ - 1, Math.floor((z1 + SLACK) / CHUNK_SIZE));
    const found = this.found;
    found.length = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (Math.abs(i - ocx) <= own && Math.abs(j - ocz) <= own) continue;
        const vx = (i + 0.5) * CHUNK_SIZE - ex, vz = (j + 0.5) * CHUNK_SIZE - ez;
        const along = vx * dx + vz * dz;
        if (along <= -SLACK || along > reach + SLACK) continue;
        if (Math.abs(vx * dz - vz * dx) > Math.max(0, along) * slope + SLACK) continue;
        found.push({ chunk: j * dims.chunksX + i, score: focus > 0 ? Math.abs(along - focus) : along });
      }
    }
    found.sort((a, b) => a.score - b.score || a.chunk - b.chunk);
    for (let k = 0; k < look.count; k++) this.coned[look.chunks[k]!]!--;
    look.count = Math.min(CONE_CHUNKS, found.length);
    for (let k = 0; k < look.count; k++) this.coned[(look.chunks[k] = found[k]!.chunk)]!++;
    // What it is on, and the chunks round it, past its own square, are held awake while it looks.
    const want: number[] = [];
    if (focus > 0) {
      const fx = Math.floor(Math.min(Math.max(ex + dx * focus, 0), dims.chunksX * CHUNK_SIZE - 1) / CHUNK_SIZE);
      const fz = Math.floor(Math.min(Math.max(ez + dz * focus, 0), dims.chunksZ * CHUNK_SIZE - 1) / CHUNK_SIZE);
      const r = (WAKE_SIDE - 1) / 2;
      for (let j = Math.max(0, fz - r); j <= Math.min(dims.chunksZ - 1, fz + r); j++) {
        for (let i = Math.max(0, fx - r); i <= Math.min(dims.chunksX - 1, fx + r); i++) {
          if (Math.abs(i - ocx) > own || Math.abs(j - ocz) > own) want.push(j * dims.chunksX + i);
        }
      }
    }
    for (let k = look.waking.length - 1; k >= 0; k--) {
      const chunk = look.waking[k]!;
      if (want.includes(chunk)) continue;
      this.release(chunk);
      look.waking.splice(k, 1);
    }
    for (const chunk of want) {
      if (look.waking.includes(chunk) || this.woken >= WAKE_MOST) continue;
      look.waking.push(chunk);
      this.woken++;
      this.ctx.wake(chunk, 1);
    }
  }

  private release(chunk: number): void {
    this.woken--;
    this.ctx.wake(chunk, -1);
  }
}
