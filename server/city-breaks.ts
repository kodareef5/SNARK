// How a city piece takes harm. A city piece is a row in a map slot owned by nobody: its material and full health are those
// of the kind the map placed, its form is its row's kind, and its stage is worked out from its health. Harm that changes
// neither form nor stage is kept and told to no client. A piece is breached at a third of its body's health, opened at
// none, and at none again falls: to its heap where it rests on something, else to nothing. What a building's piece rests
// on, and what comes down once it carries no more, is its building's to say (`support`, server/city-collapse.ts).

import { BREAK_FAMILIES, FORM_BREACH_A, FORM_BREACH_B, FORM_HEAP, FORM_HUNG, FORM_OPEN, FORM_WHOLE, formKind } from "../shared/content/breaks.ts";
import type { ItemDef, MaterialDef } from "../shared/content/defs.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { DAMAGE_TYPES, DMG_EXPLOSIVE, DMG_MELEE } from "../shared/sim/damage.ts";
import { F_ALIVE, F_HELD, F_PROP } from "../shared/sim/entities.ts";
import { capsuleBox, capsuleFree } from "../shared/world/collide.ts";
import { OPEN_SHARE, bodyHealth, breachAt, breachHealth, formOf, heapAt, heapHealth, paned, shows, variantAt } from "../shared/world/breaking.ts";
import { frame, frameOf } from "../shared/world/frame.ts";
import { Found, GONE_BLAST, GONE_DESTROYED, GONE_TAKEN, type Leaves } from "../shared/world/structures.ts";
import type { Items } from "./items.ts";
import { XP_HARVEST, type Progression } from "./progression.ts";
import type { EntityRecord } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

/** A piece rests on the ground, or on a piece whose top is this near under its foot, in metres. */
const REST_GAP = 0.5;
/** Its footprint is drawn in this far for that, so a neighbour beside it is not under it. */
const REST_INSET = 0.25;
/** Bodies are looked for this far past a new heap's reach, and one in it is raised by this much until it has room. */
const LIFT_REACH = 2, LIFT_STEP = 0.125;
/** Past this many allowances, those full again are forgotten. */
const ALLOWANCES_KEPT = 1024;
/** A breached piece is left at least this much health by the hit that breached it. */
const BREACH_LEAST = 1;
/** Experience for a swing at a heap, as a tree's blow gives. */
const HEAP_XP = 1;
/** Bare hands do this share of their damage to a city piece. */
const FISTS = 0.1;
/** Concrete of these families holds a building up, and nothing rams through it. */
const BEARING = new Set(["slab", "pier", "beam", "wall", "deck", "shell"].map((f) => BREAK_FAMILIES.indexOf(f as (typeof BREAK_FAMILIES)[number])));
const SHELL = BREAK_FAMILIES.indexOf("shell");

export interface CityContext {
  readonly world: ServerWorld;
  readonly rules: Rules;
  /** Who mines a heap is given what it yields, and experience. Null where nothing is given. */
  readonly items: Items | null;
  readonly progression: Progression | null;
  /** The kind survivors are. */
  readonly survivor: number;
  /** Whether the rules cancel what `by` does to something of `team` with damage of `type` (Combat.spared). */
  readonly spared: (by: EntityRecord | null, team: number, type: number) => boolean;
  /** Who a hit by `by` is counted against: its rider, for a mount. */
  readonly rider: (by: EntityRecord) => EntityRecord | null;
}

/** What judges a building's support (server/city-collapse.ts). */
export interface CitySupport {
  /** The city piece `ref` took another form, or with `going` is about to go. */
  changed(ref: number, going: boolean): void;
  /**
   * Which of `falls` rest on something that stands once all of `going` are gone, added to `into`. Returns false where it
   * judges nothing, and the look straight down is used.
   */
  resting(falls: readonly number[], going: ReadonlySet<number> | null, into: Set<number>): boolean;
}

/** A survivor's allowance of city pieces broken: what is left of it, and the tick it was last counted at. */
interface Allowance {
  left: number;
  at: number;
}

export class CityBreaks {
  private readonly ctx: CityContext;
  /** What panes take of each type of damage, and the energy that rams through one half's. */
  private readonly glassTakes: Float32Array;
  private readonly glassRam: number;
  private readonly concrete: number;
  private readonly allowances = new Map<number, Allowance>();
  private readonly found = new Found();
  /** Between `gather` and `settle` (a blast), what falls and what is destroyed waits to go as one batch a chunk. */
  private gathering = false;
  private readonly falls: number[] = [];
  private readonly gone: number[] = [];
  private refs = new Uint32Array(64);
  /** Set by the host where buildings are judged for support. */
  support: CitySupport | null = null;
  /** Of the last hit: the health left (0 for a piece gone), and whether the piece changed form, fell or was emptied. */
  left = 0;
  broke = false;
  /** Pieces that changed form, fell or were emptied since the start, and hits that changed health alone and were told to nobody. */
  breaks = 0;
  silent = 0;

  constructor(ctx: CityContext) {
    this.ctx = ctx;
    const reg = ctx.world.reg;
    const glass = reg.index.get("core:zzzzzzmat_glass");
    const def = glass !== undefined ? (reg.defs[glass] as MaterialDef) : null;
    this.glassTakes = Float32Array.from(DAMAGE_TYPES, (t) => def?.takes[t] ?? 0);
    this.glassRam = glass !== undefined ? reg.ramEnergy[glass]! : 0;
    this.concrete = reg.index.get("core:zzzzzzmat_concrete") ?? -1;
  }

  /** The kind the map placed in the slot of `ref`, if it holds a city piece: a map's piece owned by nobody. Else 0. */
  kindOf(ref: number): number {
    const structs = this.ctx.world.structs;
    const chunk = Math.floor(ref / 65536), slot = ref & 0xffff;
    const t = structs.chunks[chunk];
    return t && slot < t.mapped && t.kind[slot] !== 0 && t.owner[slot] === 0 ? structs.mapKind(chunk, slot) : 0;
  }

  /**
   * Whether a tribe's structure stands within CityProtectRadius of the city piece `ref`, and the rules would spare that
   * tribe's own from `by`: then the piece is spared too. With `rolling`, nobody's doing (a car that rolls by itself) is
   * spared on a PvE server, as another tribe's would be. Only chunks that hold something built are looked at.
   */
  spares(by: EntityRecord | null, ref: number, mapKind: number, type: number, rolling = false): boolean {
    const { world, rules, spared } = this.ctx;
    const reach = rules.num("CityProtectRadius");
    const nobody = rolling && !by;
    if (!(reach > 0) || (nobody && !rules.on("serverPVE"))) return false;
    const structs = world.structs, dims = world.dims;
    const t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
    const [x, y, z] = [t.x[slot]!, t.y[slot]!, t.z[slot]!];
    // From the piece's box, in its own frame.
    frameOf(t.yaw[slot]!);
    const [cos, sin] = [frame.cos, frame.sin];
    const [hx, hy, hz] = [structs.halfXOf(mapKind), structs.halfYOf(mapKind), structs.halfZOf(mapKind)];
    const out = reach + Math.max(hx, hz);
    const cx0 = Math.max(0, Math.floor((x - out) / 64)), cx1 = Math.min(dims.chunksX - 1, Math.floor((x + out) / 64));
    const cz0 = Math.max(0, Math.floor((z - out) / 64)), cz1 = Math.min(dims.chunksZ - 1, Math.floor((z + out) / 64));
    let last = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const u = structs.chunks[cz * dims.chunksX + cx];
        // What differs past the changed map slots is what was built here.
        if (!u || u.differs === u.changed) continue;
        for (let s = u.mapped; s < u.high; s++) {
          const team = u.owner[s]!;
          if (team === 0 || team === last || u.kind[s] === 0) continue;
          const dx = u.x[s]! - x, dz = u.z[s]! - z;
          const lx = Math.abs(dx * cos - dz * sin) - hx, ly = Math.abs(u.y[s]! - y) - hy, lz = Math.abs(dx * sin + dz * cos) - hz;
          const [ex, ey, ez] = [lx > 0 ? lx : 0, ly > 0 ? ly : 0, lz > 0 ? lz : 0];
          if (ex * ex + ey * ey + ez * ez > reach * reach) continue;
          if (nobody || spared(by, team, type)) return true;
          // The same tribe's next piece would say the same.
          last = team;
        }
      }
    }
    return false;
  }

  /** Who `by`'s breaks are counted against. */
  private payer(by: EntityRecord): number {
    return (this.ctx.rider(by) ?? by).pid;
  }

  /** Whether `by` has broken all the city pieces a survivor may in a minute (CityBreaksPerMinute). Nobody's hits are never capped. */
  capped(by: EntityRecord | null): boolean {
    if (!by) return false;
    const most = this.ctx.rules.num("CityBreaksPerMinute");
    const tick = this.ctx.world.tick;
    const pid = this.payer(by);
    let a = this.allowances.get(pid);
    if (!a) {
      // An allowance a minute old is full again, and need not be kept.
      if (this.allowances.size >= ALLOWANCES_KEPT) for (const [who, old] of this.allowances) if (tick - old.at >= 60 * TICK_RATE) this.allowances.delete(who);
      this.allowances.set(pid, (a = { left: most, at: tick }));
    }
    a.left = Math.min(most, a.left + ((tick - a.at) * most) / (60 * TICK_RATE));
    a.at = tick;
    return a.left < 1;
  }

  /** One city piece was broken by `by`. */
  private spend(by: EntityRecord | null): void {
    this.breaks++;
    this.broke = true;
    const a = by ? this.allowances.get(this.payer(by)) : undefined;
    if (a) a.left -= 1;
  }

  /**
   * A hit lands on the city piece `ref`, placed by the map as `mapKind`, at (x, y, z): `raw` is its damage before the
   * piece's material, of `type`, from the weapon `item`. Returns the damage done, and sets `left` and `broke`.
   */
  hit(by: EntityRecord | null, ref: number, mapKind: number, raw: number, type: number, item: number, x: number, y: number, z: number): number {
    const { world, rules } = this.ctx;
    const reg = world.reg, structs = world.structs;
    const t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
    const hp = t.hp[slot]!;
    this.left = hp;
    this.broke = false;
    if (by && item === 0 && type === DMG_MELEE && by.kind === this.ctx.survivor) raw *= FISTS;
    const takes = reg.structTakes[mapKind];
    const body = takes ? raw * takes[type]! : 0;
    const form = formOf(reg, t.kind[slot]!);
    const family = reg.breakFamily[mapKind]!;
    if (!rules.on("AllowCityDamage")) {
      // The city as it was: explosives alone harm it, and a piece out of health is gone, whatever it is.
      if (type !== DMG_EXPLOSIVE || !(body > 0)) return 0;
      return hp - body > 0 ? this.keep(ref, mapKind, hp, hp - body) : this.fell(by, ref, false, x, y, z, hp);
    }
    if (form === FORM_HEAP) {
      if (type === DMG_MELEE) return this.mine(by, ref, mapKind, item);
      // An explosive clears a heap, and what it held is lost.
      if (type !== DMG_EXPLOSIVE || !(body > 0)) return 0;
      return hp - body > 0 ? this.keep(ref, mapKind, hp, hp - body) : this.fell(by, ref, false, x, y, z, hp);
    }
    if (type === DMG_MELEE && !rules.on("CityToolSalvage")) return 0;
    // A shell stays solid when opened, and direct harm takes it no further.
    if (family === SHELL && form === FORM_OPEN) return 0;
    // Panes are the top slice of a glazed piece's health and go first, by what glass takes of the hit.
    const whole = bodyHealth(reg, mapKind);
    const panes = hp > whole ? hp - whole : 0;
    const glass = raw * this.glassTakes[type]!;
    let harm = body;
    if (panes > 0 && glass > 0) {
      const spent = Math.min(panes, glass);
      harm = spent + body * (1 - spent / glass);
    }
    if (!(harm > 0)) return 0;
    const left = hp - harm;
    if (family === 0) return left > 0 ? this.keep(ref, mapKind, hp, left) : this.fell(by, ref, false, x, y, z, hp);
    if (form === FORM_WHOLE) {
      const breach = breachAt(reg, mapKind, t.yaw[slot]!, x - t.x[slot]!, y - t.y[slot]!, z - t.z[slot]!);
      // One hit moves a piece no further than one new breach, however large.
      if (breach !== 0 && left <= breachHealth(reg, mapKind)) return this.reform(by, ref, mapKind, breach, Math.max(left, BREACH_LEAST), hp);
      if (breach !== 0 || left > 0) return this.keep(ref, mapKind, hp, left);
    } else if (left > 0) return this.keep(ref, mapKind, hp, left);
    if (form === FORM_WHOLE || form === FORM_BREACH_A || form === FORM_BREACH_B) {
      if (formKind(reg, mapKind, FORM_OPEN, 0) !== 0) return this.reform(by, ref, mapKind, FORM_OPEN, whole * OPEN_SHARE, hp);
    }
    return this.fell(by, ref, true, x, y, z, hp);
  }

  /** The piece keeps its form with `left` health: told to clients only where its stage or its panes change. */
  private keep(ref: number, mapKind: number, was: number, left: number): number {
    const reg = this.ctx.world.reg, structs = this.ctx.world.structs;
    if (shows(reg, mapKind, was) !== shows(reg, mapKind, left)) structs.mend(ref, left);
    else {
      structs.wear(ref, left);
      this.silent++;
    }
    this.left = left;
    return was - left;
  }

  /** The piece takes `form` in its place's variant, with `health`. Returns the health it lost: all it had, where it is given more. */
  private reform(by: EntityRecord | null, ref: number, mapKind: number, form: number, health: number, was: number): number {
    const world = this.ctx.world;
    const t = world.structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
    const kind = formKind(world.reg, mapKind, form, variantAt(t.x[slot]!, t.y[slot]!, t.z[slot]!));
    world.structs.swap(ref, kind, health);
    this.support?.changed(ref, false);
    this.spend(by);
    this.left = health;
    return health < was ? was - health : was;
  }

  /** The piece is out of health. It falls to its heap or to nothing if `heaps`, else it is gone: now, or with the blast being gathered. */
  private fell(by: EntityRecord | null, ref: number, heaps: boolean, x: number, y: number, z: number, was: number): number {
    this.spend(by);
    this.left = 0;
    (heaps ? this.falls : this.gone).push(ref);
    if (!this.gathering) this.drop(GONE_DESTROYED, x, y, z, 0);
    return was;
  }

  /** From here to `settle`, what falls or is destroyed is kept, to go as one batch a chunk with the blast's own centre. */
  gather(): void {
    this.gathering = true;
    this.ctx.world.structs.hold();
  }

  /** A piece that is no city piece is destroyed by the blast being gathered. */
  destroyed(ref: number): void {
    this.gone.push(ref);
  }

  /** Whether a blast is being gathered. */
  get held(): boolean {
    return this.gathering;
  }

  /** Breaks what was gathered: a blast centred (x, y, z) that reached `radius` metres. */
  settle(x: number, y: number, z: number, radius: number): void {
    this.gathering = false;
    this.drop(GONE_BLAST, x, y, z, radius);
    this.ctx.world.structs.release();
  }

  /** Breaks `falls` and `gone` together. What falls leaves its heap where it rests on something that still stands. */
  private drop(cause: number, x: number, y: number, z: number, radius: number): void {
    const { falls, gone } = this;
    const n = falls.length + gone.length;
    if (n === 0) return;
    const world = this.ctx.world, reg = world.reg, structs = world.structs;
    if (this.refs.length < n) this.refs = new Uint32Array(n * 2);
    const refs = this.refs;
    const going = n > 1 ? new Set<number>([...falls, ...gone]) : null;
    const heaps = new Set<number>();
    if (!this.support?.resting(falls, going, heaps)) for (const ref of falls) if (this.rests(ref, going)) heaps.add(ref);
    for (const ref of falls) this.support?.changed(ref, true);
    for (const ref of gone) this.support?.changed(ref, true);
    refs.set(falls);
    refs.set(gone, falls.length);
    falls.length = gone.length = 0;
    const leaves = (ref: number, out: Leaves): void => {
      if (!heaps.has(ref)) return;
      const t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
      out.kind = heapAt(reg, t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!);
      out.hp = heapHealth(reg, out.kind);
    };
    structs.breakMany(refs, n, cause, heaps.size > 0 ? leaves : null, x, y, z, world.tick, radius);
    for (const ref of heaps) this.lift(ref);
  }

  /**
   * Stands each living body the new heap `ref` is solid round on top of what it is in. A body in something that became
   * solid is not pushed out by its own step, and stays stuck there.
   */
  lift(ref: number): void {
    const world = this.ctx.world, reg = world.reg, structs = world.structs, ents = world.ents, dims = world.dims;
    const t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
    const heap = t.kind[slot]!;
    if (heap === 0) return;
    const [x, z, top] = [t.x[slot]!, t.z[slot]!, t.y[slot]! + structs.top[heap]!];
    const reach = structs.spread[heap]! + LIFT_REACH;
    const cx0 = Math.max(0, Math.floor((x - reach) / 64)), cx1 = Math.min(dims.chunksX - 1, Math.floor((x + reach) / 64));
    const cz0 = Math.max(0, Math.floor((z - reach) / 64)), cz1 = Math.min(dims.chunksZ - 1, Math.floor((z + reach) / 64));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let e = ents.chunkHead[cz * dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
          const kind = ents.kind[e]!;
          if ((ents.flags[e]! & (F_ALIVE | F_PROP | F_HELD)) !== F_ALIVE || ents.seat[e] !== 0 || reg.vehicle[kind]) continue;
          const [r, tall] = [reg.bodyRadius[kind]!, reg.bodyHeight[kind]!];
          if (!(r > 0) || ents.y[e]! >= top || !capsuleBox(structs, ref, ents.x[e]!, ents.y[e]!, ents.z[e]!, r, tall, 0)) continue;
          // The lowest place over where it stood that has room for it. With none, under a floor that still stands, it stays.
          for (let y = ents.y[e]! + LIFT_STEP; y < top + LIFT_STEP; y += LIFT_STEP) {
            if (!capsuleFree(world, ents.x[e]!, y, ents.z[e]!, r, tall)) continue;
            ents.y[e] = y;
            ents.vy[e] = 0;
            break;
          }
        }
      }
    }
  }

  /**
   * Whether the piece `ref` rests on the ground or on a piece that stands under its foot and is not `going` too: a look
   * straight down through its footprint. What holds up a piece of no building, and every piece where buildings are not
   * judged for support (CityCollapse off, or a map without its buildings).
   */
  rests(ref: number, going: ReadonlySet<number> | null): boolean {
    const world = this.ctx.world, reg = world.reg, structs = world.structs;
    const chunk = Math.floor(ref / 65536), slot = ref & 0xffff;
    const t = structs.chunks[chunk]!;
    const kind = structs.mapKind(chunk, slot) || t.kind[slot]!;
    const [x, z] = [t.x[slot]!, t.z[slot]!];
    const foot = t.y[slot]! + structs.low[kind]!;
    if (foot <= world.hf.heightAt(x, z) + REST_GAP) return true;
    frameOf(t.yaw[slot]!);
    const [c, s] = [Math.abs(frame.cos), Math.abs(frame.sin)];
    const ex = Math.max(0.05, c * structs.halfXOf(kind) + s * structs.halfZOf(kind) - REST_INSET);
    const ez = Math.max(0.05, s * structs.halfXOf(kind) + c * structs.halfZOf(kind) - REST_INSET);
    const n = structs.query(x - ex, z - ez, x + ex, z + ez, this.found, foot - REST_GAP, foot + 0.05);
    for (let k = 0; k < n; k++) {
      const other = this.found.refs[k]!;
      if (other === ref || going?.has(other)) continue;
      const u = structs.chunks[Math.floor(other / 65536)]!, o = other & 0xffff;
      const under = u.kind[o]!;
      const form = formOf(reg, under);
      if (form === FORM_HEAP || form === FORM_HUNG || structs.isSoft(under)) continue;
      // Its top is at the foot, and its box is under the footprint.
      const top = u.y[o]! + structs.top[under]!;
      if (top < foot - REST_GAP || top > foot + 0.05) continue;
      frameOf(u.yaw[o]!);
      const [uc, us] = [Math.abs(frame.cos), Math.abs(frame.sin)];
      const ux = uc * structs.halfXOf(under) + us * structs.halfZOf(under), uz = us * structs.halfXOf(under) + uc * structs.halfZOf(under);
      if (Math.abs(u.x[o]! - x) < ex + ux && Math.abs(u.z[o]! - z) < ez + uz) return true;
    }
    return false;
  }

  /**
   * A blow lands on a heap. A survivor mines it: what its material gives for the share of it struck away, times
   * RubbleYieldMultiplier, with a tool's power as a rock's. Mined out, its slot is emptied and stays the map's.
   */
  private mine(by: EntityRecord | null, ref: number, mapKind: number, item: number): number {
    const { world, rules, items, progression } = this.ctx;
    const reg = world.reg, structs = world.structs;
    if (!by || by.kind !== this.ctx.survivor || !rules.on("CityToolSalvage")) return 0;
    const t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
    const tool = item !== 0 ? (reg.defs[item] as ItemDef).tool : undefined;
    const force = rules.num("PlayerHarvestingDamageMultiplier");
    const full = heapHealth(reg, mapKind);
    const was = Math.min(full, t.hp[slot]!);
    const struck = Math.min(was, (tool?.power ?? 1) * force);
    if (!(struck > 0)) return 0;
    const left = was - struck;
    const all = reg.breakHalves[mapKind]! * rules.num("RubbleYieldMultiplier");
    for (const y of reg.heapYield[reg.structMaterial[mapKind]!] ?? []) {
      // What the heap gives in all, by how much of it has been struck away: so the whole is given whatever the blows.
      const n = Math.floor((y.count * all * (full - left)) / full + 1e-9) - Math.floor((y.count * all * (full - was)) / full + 1e-9);
      if (n > 0) items?.mint(by, y.item, n, 0, 0, -1, "harvest");
    }
    progression?.addXp(by, HEAP_XP * force, XP_HARVEST);
    if (left > 0) {
      structs.wear(ref, left);
      this.silent++;
      this.left = left;
      return struck;
    }
    this.spend(by);
    this.left = 0;
    const refs = this.refs;
    refs[0] = ref;
    structs.breakMany(refs, 1, GONE_TAKEN, null, 0, 0, 0, world.tick);
    return struck;
  }

  /**
   * A body rams the city piece `ref` at (x, y, z) with `energy` joules. Panes go first, at glass's figure. With its
   * material's energy for a half left over, a whole piece is breached in the half struck, and a breached one opened.
   * Concrete that bears is never rammed through. Returns the joules the piece took, 0 if it stands as it was.
   */
  ram(by: EntityRecord | null, ref: number, energy: number, x: number, y: number, z: number): number {
    const { world, rules } = this.ctx;
    const reg = world.reg, structs = world.structs;
    const mapKind = this.kindOf(ref);
    if (mapKind === 0 || reg.breakFamily[mapKind] === 0 || !rules.on("AllowCityDamage") || !rules.on("CityRamming")) return 0;
    const t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
    const form = formOf(reg, t.kind[slot]!);
    if (form !== FORM_WHOLE && form !== FORM_BREACH_A && form !== FORM_BREACH_B) return 0;
    if (this.capped(by) || this.spares(by, ref, mapKind, DMG_MELEE, true)) return 0;
    const tough = rules.num("CityResistanceMultiplier");
    const material = reg.structMaterial[mapKind]!;
    const hp = t.hp[slot]!;
    this.broke = false;
    let spent = 0;
    let left = hp;
    if (paned(reg, mapKind, hp)) {
      if (energy < this.glassRam * tough) return 0;
      spent = this.glassRam * tough;
      left = bodyHealth(reg, mapKind);
    }
    const half = reg.ramEnergy[material]! * tough;
    const through = half > 0 && energy - spent >= half && !(material === this.concrete && BEARING.has(reg.breakFamily[mapKind]!));
    if (!through) {
      // The panes alone: news, as their going is seen.
      if (spent > 0) structs.mend(ref, left);
      return spent;
    }
    const breach = form === FORM_WHOLE ? breachAt(reg, mapKind, t.yaw[slot]!, x - t.x[slot]!, y - t.y[slot]!, z - t.z[slot]!) : 0;
    if (breach !== 0) this.reform(by, ref, mapKind, breach, Math.max(BREACH_LEAST, Math.min(left, breachHealth(reg, mapKind))), hp);
    else if (formKind(reg, mapKind, FORM_OPEN, 0) !== 0) this.reform(by, ref, mapKind, FORM_OPEN, bodyHealth(reg, mapKind) * OPEN_SHARE, hp);
    else {
      if (spent > 0) structs.mend(ref, left);
      return spent;
    }
    return spent + half;
  }
}
