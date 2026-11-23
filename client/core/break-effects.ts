// What structures breaking throw up and are heard by. Pieces a removal took (ClientSession.rubble) and rows changed in
// place (onStructure: a city piece taking a form, crossing a stage, losing its panes) are merged by 8 m cell and server
// tick before anything is asked for, so a street that falls asks for a few bursts and sounds, not one a piece. A cell
// gives the details dust and, above low poly, chips, glass and sparks (details/breaks.ts); the sounds one impact, crack
// or pane (sound/build.ts `breaking`); and a view near it a shake (sight.ts). Nothing here is read by the simulation.

import { FORM_WHOLE } from "../../shared/content/breaks.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { paned, stageOf } from "../../shared/world/breaking.ts";
import { GONE_BLAST, GONE_FELL } from "../../shared/world/structures.ts";
import type { Tier } from "./assets/tiers.ts";
import { BREAK_CHIPS, BREAK_DUST, BREAK_GLASS, BREAK_SHARE, BREAK_SPARKS } from "./details/breaks.ts";
import type { Details } from "./details/details.ts";
import type { ClientSession, Rubble } from "./session.ts";

/** Metres a side of the cells breaks are merged in. */
export const CELL = 8;
/** The most cells held between two flushes, and the most given a burst and a sound in one: the nearest the eye. */
const MOST_CELLS = 512;
export const MOST_EMITTERS = 8;
/** A cell not among those folds into one of them within this many metres, so its pieces still count, and else is left out. */
const FOLD_REACH = 24;
/** The tiers, and for each the particles of a piece destroyed, of a rocket's whole event, and of a stage crossed or a bullet's end. */
const TIER_ROWS = ["lowpoly", "medium", "high", "ultra"];
export const PIECE = [4, 14, 24, 36], EVENT = [19, 123, 246, 492], BULLET = [2, 5, 7, 9];
/** A row and a removal in one cell are one break when their ticks are this near: a row's tick is the client's own guess. */
const SAME_BREAK_TICKS = 15;
/** Dust is the pieces' colour taken this far toward pale dust; a piece of no known finish is this masonry grey. sRGB. */
const DUSTED = 0.45;
const PALE = [200, 194, 184] as const, MASONRY = [150, 146, 138] as const;
/** What a material does besides dust and chips. */
const SPARKS = 1, GLASS = 2;
/** What `BreakSounds.breaking` is asked to sound: pieces gone or broken open, a stage crossed, panes gone, a collapse's rumble. */
export const HEARD_IMPACT = 0, HEARD_CRACK = 1, HEARD_GLASS = 2, HEARD_RUMBLE = 3;
/** One rumble is asked for a collapse: none again for these ticks within these metres of the last. */
const RUMBLE_TICKS = 6 * TICK_RATE, RUMBLE_REACH = 60;
/** A blast, or this many pieces going in a cell, shakes a view within these metres. */
const SHAKE_PIECES = 3, SHAKE_REACH = 30;

export type StructureListener = NonNullable<ClientSession["onStructure"]>;

/** Adds `listener` to those a session tells of its structure rows, after any it tells already. */
export function hearStructures(session: { onStructure: StructureListener | null }, listener: StructureListener): void {
  const before = session.onStructure;
  session.onStructure = !before ? listener : (was, kind, x, y, z, hpWas, hp, cause) => {
    before(was, kind, x, y, z, hpWas, hp, cause);
    listener(was, kind, x, y, z, hpWas, hp, cause);
  };
}

/** Where a cell's bursts go (Details), its sounds (sound/build.ts BuildSounds) and its shake (Sight). */
export type BreakDetails = Pick<Details, "breakBurst">;
export interface BreakSounds {
  breaking(what: number, kind: number, x: number, y: number, z: number, level: number): void;
}
export interface BreakShake {
  jolt(amount: number): void;
}

/** What broke in one cell at one tick. */
class Cell {
  key = 0;
  coords = 0;
  tick = 0;
  /** The pieces' places summed, how many, and the lowest of their feet. */
  x = 0;
  y = 0;
  z = 0;
  n = 0;
  floor = Infinity;
  /** Pieces a removal took, pieces that took a form, stages crossed and panes gone. */
  pieces = 0;
  swaps = 0;
  steps = 0;
  panes = 0;
  /** Cubic metres that left. */
  volume = 0;
  /** The finishes' colours summed, and how many. */
  r = 0;
  g = 0;
  b = 0;
  dyed = 0;
  /** How many were of a material that sparks, and of glass. */
  metal = 0;
  glass = 0;
  blast = false;
  fell = false;
  /** One of its pieces, whose sounds are heard. */
  kind = 0;
  /** In a flush: its distance from the eye squared, the particles it wants, and those it is given. */
  far = 0;
  want = 0;
  give = 0;
  kept = false;
}

export class BreakEffects {
  /** Cells left out of a flush for being far from every one it made, and pieces that found no cell free. */
  dropped = 0;
  private readonly cells: Cell[] = Array.from({ length: MOST_CELLS }, () => new Cell());
  private used = 0;
  private readonly open = new Map<number, Cell>();
  /** By a cell's place alone: the cell rows opened there, which a removal of nearly their tick takes as its own. */
  private readonly rows = new Map<number, Cell>();
  private readonly near: Cell[] = [];
  /** By kind: its finish as a colour word (-1 for none), what its material does, and its volume. */
  private readonly finish: Int32Array;
  private readonly does: Uint8Array;
  private readonly volume: Float32Array;
  private readonly halfY: Float32Array;
  private rumbleAt = -Infinity;
  private rumbleX = 0;
  private rumbleZ = 0;

  constructor(reg: Registry, palette: Uint8Array) {
    const n = reg.defs.length;
    this.finish = new Int32Array(n).fill(-1);
    this.does = new Uint8Array(n);
    this.volume = new Float32Array(n);
    this.halfY = reg.halfY;
    reg.defs.forEach((d, kind) => {
      if (d?.type !== "structure") return;
      this.volume[kind] = 8 * reg.halfX[kind]! * reg.halfY[kind]! * reg.halfZ[kind]!;
      const c = d.color * 4;
      if (c >= 0 && c + 2 < palette.length) this.finish[kind] = palette[c]! | (palette[c + 1]! << 8) | (palette[c + 2]! << 16);
      const material = reg.defs[reg.structMaterial[kind]!]?.id ?? "";
      const name = material.slice(Math.max(material.lastIndexOf(":"), material.lastIndexOf("mat_") + 3) + 1);
      this.does[kind] = name === "steel" || name === "sheet" || name === "metal" ? SPARKS : name === "glass" ? GLASS : 0;
    });
  }

  /** The cell of a place at a tick, opened if it is not yet; null where none is free. */
  private cell(x: number, y: number, z: number, tick: number, row: boolean): Cell | null {
    const coords = ((Math.floor(x / CELL) & 0xfff) * 4096 + (Math.floor(z / CELL) & 0xfff)) * 256 + (Math.floor(y / CELL) & 0xff);
    const key = coords * 0x100000 + (tick & 0xfffff);
    let c = this.open.get(key);
    if (c) return c;
    // A removal takes the cell its own blast's rows opened a moment before, so the two are one burst and one sound.
    const rows = row ? undefined : this.rows.get(coords);
    if (rows && rows.pieces === 0 && Math.abs(rows.tick - tick) <= SAME_BREAK_TICKS) {
      this.open.delete(rows.key);
      this.rows.delete(coords);
      c = rows;
    } else {
      if (this.used === MOST_CELLS) {
        this.dropped++;
        return null;
      }
      c = this.cells[this.used++]!;
      c.x = c.y = c.z = c.n = c.pieces = c.swaps = c.steps = c.panes = c.volume = c.r = c.g = c.b = c.dyed = c.metal = c.glass = c.kind = 0;
      c.floor = Infinity;
      c.blast = c.fell = false;
      c.coords = coords;
      if (row) this.rows.set(coords, c);
    }
    c.key = key;
    c.tick = tick;
    this.open.set(key, c);
    return c;
  }

  /** Adds a piece of `kind` at a place to `c`, `share` of it leaving, in the finish and material of `map` (0 where the map's kind is not known). */
  private add(c: Cell, map: number, kind: number, x: number, y: number, z: number, share: number): void {
    c.x += x;
    c.y += y;
    c.z += z;
    c.n++;
    const foot = y - (this.halfY[kind] ?? 0);
    if (foot < c.floor) c.floor = foot;
    c.volume += share * ((this.volume[kind] ?? 0) || (this.volume[map] ?? 0));
    const rgb = this.finish[map] ?? -1;
    c.r += rgb < 0 ? MASONRY[0] : rgb & 255;
    c.g += rgb < 0 ? MASONRY[1] : (rgb >>> 8) & 255;
    c.b += rgb < 0 ? MASONRY[2] : (rgb >>> 16) & 255;
    c.dyed++;
    if (this.does[map] === SPARKS) c.metal++;
    else if (this.does[map] === GLASS) c.glass++;
    if (c.kind === 0) c.kind = map || kind;
  }

  /**
   * A structure row changed in place (ClientSession.onStructure) at about server tick `tick`: a city piece that took a
   * form, crossed a stage or lost its panes. A form's map kind is not told, so its stages are passed over and it is grey.
   */
  row(reg: Registry, tick: number, was: number, kind: number, x: number, y: number, z: number, hpWas: number, hp: number): void {
    if (was === 0 || kind === 0 || reg.breakSet[was] === 0) return;
    const whole = reg.breakForm[was] === FORM_WHOLE;
    const swapped = was !== kind;
    if (swapped ? reg.breakSet[kind] !== reg.breakSet[was] : !whole || !(hp < hpWas)) return;
    const stepped = !swapped && stageOf(reg, was, hp) > stageOf(reg, was, hpWas);
    const panes = whole && paned(reg, was, hpWas) && !paned(reg, was, hp);
    if (!swapped && !stepped && !panes) return;
    const c = this.cell(x, y, z, tick, true);
    if (!c) return;
    this.add(c, whole ? was : 0, was, x, y, z, swapped ? 0.5 : 0);
    if (swapped) c.swaps++;
    if (stepped) c.steps++;
    if (panes) c.panes++;
  }

  /** Takes in the pieces removals took. `list` is left as it is: rubble.ts empties it. */
  take(list: readonly Rubble[]): void {
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!;
      const c = this.cell(r.x, r.y, r.z, r.tick, false);
      if (!c) continue;
      this.add(c, r.map || r.kind, r.kind, r.x, r.y, r.z, 1);
      c.pieces++;
      if (r.cause === GONE_BLAST) c.blast = true;
      else if (r.cause === GONE_FELL) c.fell = true;
    }
  }

  /** Asks for the bursts and sounds of the cells taken in, the nearest the eye first, and forgets them. `tick` is the details' now. */
  flush(details: BreakDetails | null, tier: Tier, tick: number, ex: number, ey: number, ez: number, sounds: BreakSounds | null = null, view: BreakShake | null = null): void {
    if (this.used === 0) return;
    const near = this.near;
    near.length = 0;
    for (let i = 0; i < this.used; i++) {
      const c = this.cells[i]!;
      c.x /= c.n;
      c.y /= c.n;
      c.z /= c.n;
      c.far = (c.x - ex) * (c.x - ex) + (c.y - ey) * (c.y - ey) + (c.z - ez) * (c.z - ez);
      c.kept = false;
      let at = near.length;
      if (at < MOST_EMITTERS) near.push(c);
      else if (c.far >= near[at - 1]!.far) continue;
      else at--;
      for (; at > 0 && near[at - 1]!.far > c.far; at--) near[at] = near[at - 1]!;
      near[at] = c;
    }
    for (let k = 0; k < near.length; k++) near[k]!.kept = true;
    if (this.used > near.length) for (let i = 0; i < this.used; i++) if (!this.cells[i]!.kept) this.fold(this.cells[i]!);
    const row = Math.max(0, TIER_ROWS.indexOf(tier.name));
    const most = Math.min(EVENT[row]!, Math.floor((tier.details.pool * BREAK_SHARE) / MOST_EMITTERS));
    for (let k = 0; k < near.length; k++) {
      const c = near[k]!;
      // Low poly makes no glass, so panes alone are given nothing there.
      const want = c.pieces * PIECE[row]! + c.swaps * Math.ceil(PIECE[row]! / 2) + c.steps * BULLET[row]! + (row > 0 ? c.panes * PIECE[row]! : 0);
      c.want = Math.min(most, want);
    }
    for (let k = 0; k < near.length; k++) {
      const c = near[k]!;
      // The cells of one blast share a rocket's whole event.
      let all = 0;
      if (c.blast) for (let j = 0; j < near.length; j++) if (near[j]!.blast && near[j]!.tick === c.tick) all += near[j]!.want;
      c.give = all > EVENT[row]! ? Math.max(1, Math.floor((c.want * EVENT[row]!) / all)) : c.want;
    }
    for (let k = 0; k < near.length; k++) {
      const c = near[k]!;
      if (details) this.burst(details, c, row, tick);
      if (sounds) this.sound(sounds, c, tick);
      const broke = c.pieces + c.swaps;
      if (view && c.far < SHAKE_REACH * SHAKE_REACH && (c.blast ? broke > 0 : broke >= SHAKE_PIECES)) view.jolt((1 - Math.sqrt(c.far) / SHAKE_REACH) * Math.min(1, 0.4 + 0.1 * broke));
    }
    this.used = 0;
    this.open.clear();
    this.rows.clear();
  }

  /** Adds what broke in `c`, which is given no burst of its own, to the nearest cell that is, if one is near. */
  private fold(c: Cell): void {
    let to: Cell | null = null;
    let least = FOLD_REACH * FOLD_REACH;
    for (let k = 0; k < this.near.length; k++) {
      const o = this.near[k]!;
      const d = (o.x - c.x) * (o.x - c.x) + (o.y - c.y) * (o.y - c.y) + (o.z - c.z) * (o.z - c.z);
      if (d <= least) {
        least = d;
        to = o;
      }
    }
    if (!to) {
      this.dropped++;
      return;
    }
    to.pieces += c.pieces;
    to.swaps += c.swaps;
    to.steps += c.steps;
    to.panes += c.panes;
    to.volume += c.volume;
    to.r += c.r;
    to.g += c.g;
    to.b += c.b;
    to.dyed += c.dyed;
    to.metal += c.metal;
    to.glass += c.glass;
    if (c.blast) to.blast = true;
    if (c.fell) to.fell = true;
  }

  /** The bursts of one cell: on low poly dust alone, else dust, chips, and glass and sparks by the share of its pieces that give them. */
  private burst(details: BreakDetails, c: Cell, row: number, tick: number): void {
    const n = c.give;
    if (n <= 0) return;
    const broke = c.pieces + c.swaps + c.steps + c.panes;
    const glass = row === 0 ? 0 : Math.round(n * Math.min(1, (c.panes + c.glass) / broke));
    const dust = row === 0 ? n : Math.ceil((n - glass) / 2);
    const bits = n - glass - dust;
    const sparks = c.metal > 0 ? Math.round(bits * 0.35 * Math.min(1, c.metal / broke)) : 0;
    const r = c.r / c.dyed, g = c.g / c.dyed, b = c.b / c.dyed;
    const dusty = Math.round(r + (PALE[0] - r) * DUSTED) | (Math.round(g + (PALE[1] - g) * DUSTED) << 8) | (Math.round(b + (PALE[2] - b) * DUSTED) << 16);
    const across = Math.cbrt(c.volume);
    const id = Math.imul(c.coords | 0, 0x9e3779b1) >>> 0;
    const floor = c.floor < c.y ? c.floor : NaN;
    if (dust > 0) details.breakBurst(BREAK_DUST, id, c.x, c.y, c.z, floor, c.tick, tick, Math.min(3, Math.max(0.4, across * 0.5)), dust, dusty);
    const size = Math.min(2, Math.max(0.7, across * 0.45));
    if (bits > sparks) details.breakBurst(BREAK_CHIPS, id, c.x, c.y, c.z, floor, c.tick, tick, size, bits - sparks, Math.round(r) | (Math.round(g) << 8) | (Math.round(b) << 16));
    if (glass > 0) details.breakBurst(BREAK_GLASS, id, c.x, c.y, c.z, floor, c.tick, tick, size, glass, -1);
    if (sparks > 0) details.breakBurst(BREAK_SPARKS, id, c.x, c.y, c.z, floor, c.tick, tick, 1, sparks, -1);
  }

  /** The sounds of one cell: an impact louder the more pieces went, else a crack; its panes; and a collapse's one rumble. */
  private sound(sounds: BreakSounds, c: Cell, tick: number): void {
    const broke = c.pieces + c.swaps * 0.5;
    if (broke > 0) sounds.breaking(HEARD_IMPACT, c.kind, c.x, c.y, c.z, Math.min(1, 0.7 + 0.06 * broke));
    else if (c.steps > 0) sounds.breaking(HEARD_CRACK, c.kind, c.x, c.y, c.z, 0.9);
    if (c.panes + c.glass > 0) sounds.breaking(HEARD_GLASS, c.kind, c.x, c.y, c.z, Math.min(1, 0.7 + 0.1 * (c.panes + c.glass)));
    if (!c.fell || (tick - this.rumbleAt < RUMBLE_TICKS && Math.hypot(c.x - this.rumbleX, c.z - this.rumbleZ) < RUMBLE_REACH)) return;
    sounds.breaking(HEARD_RUMBLE, c.kind, c.x, c.y, c.z, 0.7);
    this.rumbleAt = tick;
    this.rumbleX = c.x;
    this.rumbleZ = c.z;
  }
}
