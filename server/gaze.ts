// What a survivor looks at through a sight (D1079, D1084). A session looking through one says how many times it magnifies
// (CMD_GAZE). The server believes none of it but the zoom, and that only within what the sight raised now gives: a held
// glass or a weapon's scope with the secondary held, or a worn visor with BTN_VISOR held. Until it sees the sight raised the
// cone is empty, and a claim it never sees raised ends. It finds for itself what the look is on, along the survivor's own
// look from its own eye, and adds the chunks of the cone to the view, past the survivor's own square, those nearest what it
// is on first and only those the ground does not hide (Replication.cone); and holds the creatures round what it is on awake,
// as a body nearby would, so that what is seen far off lives. Each session's cone is its own.

import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz } from "../shared/coords.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { CMD_GAZE, CMD_MARK, DRONE_LOOK, GAZE_FARTHEST, GAZE_REACH, GAZE_TICKS, RESULT_DENIED, RESULT_INVALID, RESULT_OK, SPOT_TICKS } from "../shared/net/protocol.ts";
import { F_ALIVE, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import { BTN_SECONDARY, BTN_VISOR, stanceEye } from "../shared/sim/character.ts";
import { HIT_NONE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import { CUE_SCOPED } from "../shared/anim/pose.ts";
import type { ItemDef, OpticFacet } from "../shared/content/defs.ts";
import { ARMOR_SLOTS } from "../shared/sim/items.ts";
import type { Client, GameServer } from "./game.ts";
import type { RemoteEye } from "./players.ts";
import type { Items } from "./items.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** The tangent of the widest half of a view across that a session may have: 50 degrees up on a screen 2.4 times as wide. */
const WIDEST = Math.tan((50 * Math.PI) / 180) * 2.4;
/** A chunk's half diagonal: a chunk whose middle is this far outside the cone may still show in it. */
const SLACK = (CHUNK_SIZE * Math.SQRT2) / 2;
/** The most chunks a cone holds. */
export const CONE_CHUNKS = 48;
/** Chunks a side held awake round what a sight is on, and the most distinct ones a server holds so for all its sessions. */
export const WAKE_SIDE = 3;
export const WAKE_MOST = 64;
/** The farthest a zero may be dialled, metres. */
export const ZERO_MOST = 2000;
/** Ticks a claimed gaze may go unseen raised before it ends: an input lagging its command. */
const RAISE_GRACE = 45;
/** Metres over the ground a far creature's head may stand, which the line of sight to a chunk aims at, and that line's step. */
const OVER_GROUND = 5;
const SIGHT_STEP = 24;
/** Metres a gaze sees a survivor for each time its sight magnifies (a standing one is pixels tall there), and its head's height. */
export const PLAYER_REACH = 500;
const PLAYER_HEAD = 1.6;
/** The most chunks of a cone tested against the ground in a finding. */
const TESTED_MOST = 160;
/** Ticks between a cone's chunks found again as its survivor turns. */
const REFRESH = 6;

export interface GazeContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly items: Items;
  readonly game: GameServer;
  /** Holds `chunk`'s creatures awake (1) or lets them go (-1), as a body round them does (Creatures.watch). */
  wake(chunk: number, delta: number): void;
  /** Marks creature `e` for tribe `team` until tick `until` (Tactical.spot). */
  spot(team: number, e: number, until: number): void;
}

/** One session's gaze. */
class Look {
  /** The zoom claimed, and the zoom held to the sight raised (0 while none is). */
  claim = 0;
  zoom = 0;
  /** Metres to what the look is on, as the server finds it (0 for nothing within reach). */
  focus = 0;
  /** The last tick the sight was seen raised; one not seen raised for RAISE_GRACE ends. */
  raisedAt = -1;
  /** The zero dialled, metres (D1083). */
  zero = 0;
  /** The tick it ends without another CMD_GAZE, and the tick its chunks were last found. */
  until = 0;
  at = -1;
  readonly chunks = new Int32Array(CONE_CHUNKS);
  count = 0;
  /** The survivors its sight could see wherever they stand in it, past the chunks' budget (D1088). */
  readonly players: number[] = [];
  /** The chunks it holds awake. */
  readonly waking: number[] = [];
}

export class Gaze {
  readonly ctx: GazeContext;
  private readonly looks = new Map<Client, Look>();
  /** Per chunk, the cones it is in. */
  private readonly coned: Uint16Array;
  /**
   * Per chunk, the gazes holding it awake, and how many distinct chunks gazes hold: two survivors watching one place cost
   * the server's WAKE_MOST that place once (D1088).
   */
  private readonly watching: Uint16Array;
  private woken = 0;
  private readonly found: { chunk: number; score: number }[] = [];
  private readonly dir = [0, 0, 0];

  constructor(ctx: GazeContext) {
    this.ctx = ctx;
    this.coned = new Uint16Array(ctx.world.dims.chunksX * ctx.world.dims.chunksZ);
    this.watching = new Uint16Array(ctx.world.dims.chunksX * ctx.world.dims.chunksZ);
    ctx.game.handle(CMD_GAZE, (c, r) => this.command(c, r));
    ctx.game.handle(CMD_MARK, (c, r) => this.mark(c, r));
    ctx.game.replication.cone = (c) => {
      const look = this.looks.get(c);
      return look && (look.count > 0 || look.players.length > 0) ? look : null;
    };
  }

  /**
   * The optic `c`'s survivor has raised now, or null: a held glass's or the held weapon's own, or the attachment fitted to
   * it, with the secondary held; or a worn helmet's that is not worn out, with BTN_VISOR held.
   */
  sightOf(c: Client): OpticFacet | null {
    const { records, items, world } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec || c.ent < 0 || c.drive >= 0) return null;
    const inv = items.inv(rec);
    const defs = world.reg.defs;
    const optic = (item: number): OpticFacet | null => (item !== 0 ? ((defs[item] as ItemDef | null)?.optic ?? null) : null);
    const slot = inv.hotbar >= 0 && rec.held >= 0 ? inv.hotbar + rec.held : -1;
    if ((c.heldButtons & BTN_SECONDARY) !== 0 && slot >= 0) {
      const raised = optic(inv.item[slot]!) ?? optic(inv.attach[slot]!);
      if (raised) return raised;
    }
    if ((c.heldButtons & BTN_VISOR) !== 0 && inv.armor >= 0) {
      for (let k = 0; k < ARMOR_SLOTS; k++) {
        const at = inv.armor + k, worn = optic(inv.item[at]!);
        if (worn && (inv.dur[at]! > 0 || !(world.reg.uses[inv.item[at]!]! > 0))) return worn;
      }
    }
    return null;
  }

  /** How many times the most that `c`'s survivor holds or wears magnifies, raised or not: what a claim may be held to. 0 for none. */
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
    if (inv.armor >= 0) for (let k = 0; k < ARMOR_SLOTS; k++) if (inv.dur[inv.armor + k]! > 0 || !(world.reg.uses[inv.item[inv.armor + k]!]! > 0)) of(inv.item[inv.armor + k]!);
    return best;
  }

  /** CMD_GAZE. A zoom of 1 or less, or one nothing the survivor has gives, ends the gaze. */
  private command(c: Client, r: BitReader): number {
    const zoom = r.u16() / 16;
    const focus = r.u16();
    const zero = r.u16();
    if (r.overflow) return RESULT_INVALID;
    void focus;
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
    // The zoom claimed, held to the sight raised as `step` finds it; what the look is on the server finds for itself.
    look.claim = Math.min(zoom, most);
    if (look.raisedAt < 0) look.raisedAt = this.ctx.world.tick;
    look.zero = Math.min(zero, ZERO_MOST);
    look.until = this.ctx.world.tick + GAZE_TICKS;
    look.at = -1;
    return RESULT_OK;
  }

  /** The zero `c` dialled for its sight, metres, or 0 with no gaze (server/projectiles.ts zero). */
  zeroOf(c: Client): number {
    return this.looks.get(c)?.zero ?? 0;
  }

  /** Sets or clears `c`'s body's glint (CUE_SCOPED), which its view tells those it faces. */
  private glint(c: Client, on: boolean): void {
    const { world } = this.ctx, ents = world.ents, e = c.ent;
    if (e < 0) return;
    const word = on ? (ents.cue[e]! | CUE_SCOPED) >>> 0 : (ents.cue[e]! & ~CUE_SCOPED) >>> 0;
    if (word === ents.cue[e]) return;
    ents.cue[e] = word;
    world.history.cued(e);
  }

  /** How far `c`'s look reaches what it tells of a creature (server/overhead.ts): its gaze's reach, or 0 with none. */
  lookReach(c: Client): number {
    const look = this.looks.get(c);
    return look ? this.reach(look.zoom) : 0;
  }

  /** Whether creature `e` stands where `c` may see it: round it, or in its gaze's cone. */
  inView(c: Client, e: number): boolean {
    const dims = this.ctx.world.dims, ents = this.ctx.world.ents;
    const chunk = chunkAt(dims, ents.x[e]!, ents.z[e]!), r = this.ctx.game.opts.entityRadius;
    if (Math.abs(chunkCx(dims, chunk) - chunkCx(dims, c.chunk)) <= r && Math.abs(chunkCz(dims, chunk) - chunkCz(dims, c.chunk)) <= r) return true;
    const look = this.looks.get(c);
    for (let k = 0; look && k < look.count; k++) if (look.chunks[k] === chunk) return true;
    return false;
  }

  /** Whether creature `e` stands within DRONE_LOOK of a drone's camera `eye`, in the view round the chunk the camera is over. */
  droneSees(eye: RemoteEye, e: number): boolean {
    const dims = this.ctx.world.dims, ents = this.ctx.world.ents;
    if (Math.hypot(ents.x[e]! - eye.x, ents.y[e]! - eye.y, ents.z[e]! - eye.z) > DRONE_LOOK) return false;
    const chunk = chunkAt(dims, ents.x[e]!, ents.z[e]!), home = chunkAt(dims, eye.x, eye.z), r = this.ctx.game.opts.entityRadius;
    return Math.abs(chunkCx(dims, chunk) - chunkCx(dims, home)) <= r && Math.abs(chunkCz(dims, chunk) - chunkCz(dims, home)) <= r;
  }

  /** CMD_MARK: the creature looked at through a sight, marked for the tribe (D1082). */
  private mark(c: Client, r: BitReader): number {
    const e = r.u32();
    const gen = r.u16();
    if (r.overflow) return RESULT_INVALID;
    const { world, records } = this.ctx;
    const ents = world.ents;
    const team = records.byPid.get(c.pid)?.team ?? 0;
    // A drone flown marks what its camera sees: near it, in the chunks round its own.
    const eye = this.ctx.game.players.remoteEye?.(c) ?? null;
    if (c.ent < 0 || team === 0 || (!eye && !this.looks.has(c))) return RESULT_DENIED;
    if (e >= ents.gen.length || ents.gen[e] !== gen || (ents.flags[e]! & (F_ALIVE | F_PROP | F_PLAYER)) !== F_ALIVE) return RESULT_INVALID;
    if (eye ? !this.droneSees(eye, e) : !this.inView(c, e)) return RESULT_INVALID;
    this.ctx.spot(team, e, world.tick + SPOT_TICKS);
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
      const sight = this.sightOf(c);
      if (!sight) {
        // Not raised: nothing is shown, and a claim not raised for long ends.
        look.at = tick;
        look.zoom = 0;
        this.clear(look);
        this.glint(c, false);
        if (tick - look.raisedAt > RAISE_GRACE) this.end(c);
        continue;
      }
      look.raisedAt = tick;
      look.zoom = Math.min(sight.max ?? sight.min, Math.max(sight.min, look.claim));
      this.glint(c, true);
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

  /** Empties `look`'s cone and lets go of what it held awake. */
  private clear(look: Look): void {
    for (let k = 0; k < look.count; k++) this.coned[look.chunks[k]!]!--;
    look.count = 0;
    look.players.length = 0;
    for (const chunk of look.waking) this.release(chunk);
    look.waking.length = 0;
  }

  /** Ends `c`'s gaze: its cone goes from its view and the creatures it held awake may sleep. */
  end(c: Client): void {
    const look = this.looks.get(c);
    if (!look) return;
    this.clear(look);
    this.looks.delete(c);
    this.glint(c, false);
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
    // What the look is on, found here along the survivor's own look from its own eye: nothing the session says.
    const ey = ents.y[e]! + stanceEye(world.reg.move[ents.kind[e]!]!, ents.stance[e]!), d = this.dir;
    lookDirection(ents.yaw[e]!, ents.pitch[e]!, d);
    look.focus = castWorld(world, ex, ey, ez, d[0]!, d[1]!, d[2]!, reach) === HIT_NONE ? 0 : rayHit.t;
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
        // Nearest the point it is on first, both ways; with none, nearest the eye.
        found.push({ chunk: j * dims.chunksX + i, score: focus > 0 ? Math.hypot(along - focus, vx * dz - vz * dx) : along });
      }
    }
    found.sort((a, b) => a.score - b.score || a.chunk - b.chunk);
    for (let k = 0; k < look.count; k++) this.coned[look.chunks[k]!]!--;
    // Only what the ground leaves in sight: a chunk behind a hill is not sent, however the session looks.
    let n = 0;
    for (let k = 0; k < found.length && k < TESTED_MOST && n < CONE_CHUNKS; k++) {
      const chunk = found[k]!.chunk;
      if (this.sighted(ex, ey, ez, chunk)) this.coned[(look.chunks[n++] = chunk)]!++;
    }
    look.count = n;
    // Survivors, wherever they stand in the cone out to PLAYER_REACH a zoom, the ground not hiding them: what a sniper aims at
    // is not left to the chunks' budget.
    look.players.length = 0;
    const far = Math.min(GAZE_FARTHEST, PLAYER_REACH * look.zoom);
    for (const o of game.clients) {
      const t = o?.active ? o.ent : -1;
      if (t < 0 || t === e || (ents.flags[t]! & F_ALIVE) === 0) continue;
      const vx = ents.x[t]! - ex, vz = ents.z[t]! - ez, along = vx * dx + vz * dz;
      if (along <= 0 || along > far || Math.abs(vx * dz - vz * dx) > along * slope + SLACK) continue;
      if (this.lineOpen(ex, ey, ez, ents.x[t]!, ents.y[t]! + PLAYER_HEAD, ents.z[t]!)) look.players.push(t);
    }
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
      // One another gaze holds already costs nothing more; a new one, a place of the WAKE_MOST.
      if (look.waking.includes(chunk) || (this.watching[chunk] === 0 && this.woken >= WAKE_MOST)) continue;
      look.waking.push(chunk);
      if (this.watching[chunk]!++ > 0) continue;
      this.woken++;
      this.ctx.wake(chunk, 1);
    }
  }

  /**
   * Whether the ground leaves a line from the eye (ex, ey, ez) to OVER_GROUND over the middle of `chunk` open: a head standing
   * there could be seen. Sampled each SIGHT_STEP metres short of its end.
   */
  sighted(ex: number, ey: number, ez: number, chunk: number): boolean {
    const { hf, dims } = this.ctx.world;
    const tx = (chunkCx(dims, chunk) + 0.5) * CHUNK_SIZE, tz = (chunkCz(dims, chunk) + 0.5) * CHUNK_SIZE;
    return this.lineOpen(ex, ey, ez, tx, hf.heightAt(tx, tz) + OVER_GROUND, tz);
  }

  /** Whether the ground leaves the line from (ex, ey, ez) to (tx, ty, tz) open, sampled each SIGHT_STEP metres short of its end. */
  private lineOpen(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number): boolean {
    const hf = this.ctx.world.hf;
    const far = Math.hypot(tx - ex, tz - ez);
    for (let t = SIGHT_STEP; t < far - SIGHT_STEP; t += SIGHT_STEP) {
      const a = t / far;
      if (hf.heightAt(ex + (tx - ex) * a, ez + (tz - ez) * a) > ey + (ty - ey) * a) return false;
    }
    return true;
  }

  private release(chunk: number): void {
    if (--this.watching[chunk]! > 0) return;
    this.woken--;
    this.ctx.wake(chunk, -1);
  }

  /** How many distinct chunks gazes hold awake, for tests and the admin page. */
  get awake(): number {
    return this.woken;
  }
}
