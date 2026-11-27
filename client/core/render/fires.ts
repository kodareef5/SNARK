// Fire that stands and burns where it is: a wreck ablaze in a marina (StructureDef.ablaze) and a lit campfire, torch,
// cooking pot, fireplace or forge, where its kind says its flames stand (StructureDef.flames). Each flame is a low bed
// and a few tongues on the fire program's cone (fire-light.ts FIRE_BLAZE), more tongues the larger it is on the screen,
// with smoke rising off it, embers off the nearest, and a glow alone where it is too small for a flame. Nothing is
// simulated: where each tongue, puff and ember is, is the scene's clock and the fire's place. Burning kinds are found in
// the chunks the client holds, as the lit lamps are (street-lamps.ts), and read again only when a chunk's table changes.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE } from "../../../shared/coords.ts";
import type { ChunkTable, StructureStore } from "../../../shared/world/structures.ts";
import type { Assets } from "../assets/assets.ts";
import type { Tier } from "../assets/tiers.ts";
import { LOW } from "./atmosphere.ts";
import type { Camera } from "./camera.ts";
import type { Draws } from "./draws.ts";
import { BLAZE_REACH, FIRE_BLAZE, blazePhase, putBlaze } from "./fire-light.ts";
import { FIRE_BY_DAY, FIRE_COLOUR, FIRE_LIGHT, type FireLights } from "./fire-lights.ts";
import type { Mirage } from "./mirage.ts";
import { DETAIL, DETAIL_GLOW, DETAIL_SMOKE, DRAW_BLEND, DRAW_FIRE, DRAW_PLAIN, GLOW_STEPS, SMOKE_STEPS, TRANSIENT_BUFFER, type FramePacket } from "./packet.ts";
import { lampsOn } from "./surface.ts";
import { VehicleCards } from "./vehicle-cards.ts";

/** Metres out to which a fire's flames are drawn, and from which they fade to nothing there; its smoke is the tier's. */
export const FIRE_REACH = 320;
const FADE_FROM = 260;
/** Fires drawn at once at the most whatever the tier, tongues of one flame, puffs of one fire's smoke, and embers of one fire. */
export const MOST_FIRES = 16;
const TONGUES = 4, PUFFS = 20, THIN_PUFFS = 7, EMBERS = 8;
/** Fires that throw embers at once. */
const EMBER_FIRES = 2;
/** Cards held at the most: each fire's puffs, a glow and a pool for each of two flames, and the embers. */
const CARDS = MOST_FIRES * (PUFFS + 4) + EMBER_FIRES * EMBERS;
/** Pixels high on the screen past which each tongue in turn is drawn, and the share either side over which it comes in. */
export const TONGUE_AT = [40, 90, 160, 230] as const;
const TONGUE_BAND = 0.25;
/** Pixels high under which a fire is a glow alone, crossing over from the one to the other. */
export const GLOW_UNDER = 10;
const GLOW_OVER = 16;
/** Pixels high from which the air over a fire begins to waver. */
const MIRAGE_OVER = 50;
/** Pixels high over which a fire throws embers. */
const EMBERS_OVER = 60;
/** The share of the tier's fill of the screen the fires may take: past it a fire has its bed alone and half its smoke. */
export const FIRE_SHARE = 0.25;
/** The ground wind is the low clouds' turned down to this share, and gusts, as the details have it. */
const WIND_SHARE = 0.1, GUST = 0.4;
/** How far a metre a second of wind carries a flame's tip, as a share of the most it leans. */
const LEAN_PER_WIND = 0.45;
/** How far over the middle of its box a wreck's deck is, as a share of its half height, where its kind lists no flames. */
const DECK = 0.35;
const word = (r: number, g: number, b: number): number => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const FLAME = word(255, 150, 58), EMBER = word(255, 170, 80), WOODSMOKE = word(122, 118, 112);

/** Floats a burning thing keeps in a chunk's list: where its box's middle is, its yaw in radians, and its kind. */
const HELD = 5;
/** Floats a flame keeps in a kind's layout: its foot across, over its bottom and along, its height and width. */
const FLAME_FLOATS = 5;
/** Floats a blaze is held in for `draw`: its foot from the eye, height, width, lean, power, pace, seed and distance. */
const BLAZE = 11;
const MAX_BLAZES = MOST_FIRES * 2 * (TONGUES + 1);

/** Where a kind's fire stands, worked out once. */
interface Layout {
  flames: Float32Array;
  /** Metres over its box's bottom its smoke leaves from, the highest tip, and the widest flame. */
  smoke: number;
  tip: number;
  wide: number;
  /** For a wreck's guessed fire, the metres its seed may slide it along its hull, as (x, z); else none. */
  slideX: number;
  slideZ: number;
  /** A wreck's smoke is black and thick; wood smoke is pale grey and thin. */
  sooty: boolean;
  /** How far its flames reach out from its middle. */
  spread: number;
  /** The square metres of its flames, which its light is by. */
  area: number;
}

interface Held { version: number; at: Float32Array }

/** 0 under `a`, 1 over `b`, and eased between. */
function smooth(a: number, b: number, v: number): number {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
}
const fract = (v: number): number => v - Math.floor(v);

/** A blaze's clock's pace for its height: a small flame rises and sways faster for its size, as a real one does. */
export const blazePace = (high: number): number => Math.max(1, Math.min(4, Math.round(2.2 / Math.sqrt(Math.max(high, 0.05)))));

/**
 * A flame `high` metres high and `wide` across with its foot at (x, y, z), as it is drawn `px` pixels high on the screen:
 * its bed, and over it up to `tongues` tongues, each coming in by degrees as the flame grows on the screen. Each is handed
 * to `hold` with its foot, height, width, how much of it shows and its seed. The bed is the whole flame while it is alone,
 * and lower and wider once its tongues come in; under GLOW_UNDER pixels there is none, and a glow stands in.
 */
export function layFlame(hold: (x: number, y: number, z: number, high: number, wide: number, power: number, seed: number) => void, x: number, y: number, z: number, high: number, wide: number, px: number, tongues: number, seed: number, fade: number): void {
  const bed = smooth(GLOW_UNDER, GLOW_OVER, px) * fade, alone = 1 - smooth(30, 60, px);
  if (bed > 0.01) hold(x, y, z, high * (0.6 + 0.4 * alone), wide * (1 - 0.15 * alone), bed, seed);
  for (let j = 0; j < tongues; j++) {
    const power = smooth(TONGUE_AT[j]! * (1 - TONGUE_BAND), TONGUE_AT[j]! * (1 + TONGUE_BAND), px) * fade;
    if (power <= 0.01) break;
    // Each stands somewhere over the bed, taller or shorter, and of its own seed.
    const r1 = fract(seed * 7.13 + j * 0.618034), r2 = fract(seed * 3.71 + j * 0.381966), a = 6.2831853 * (seed + j * 0.38);
    const out = 0.36 * wide * (0.45 + 0.55 * r1);
    hold(x + Math.cos(a) * out, y + 0.04 * high, z + Math.sin(a) * out, high * (0.8 + 0.45 * r2), wide * (0.36 + 0.18 * r1), power, fract(seed + 0.29 * (j + 1)));
  }
}

export class Fires extends VehicleCards {
  /** Off, nothing of it is drawn: a page's before and after (client/core/passes.ts "fires"). */
  on = true;
  /** The hour, which says when a pool stands in for a fire's light on low poly, whose frame holds no sky. The scene sets it. */
  hour = 12;
  /** What takes the hot air over the fires near the eye (mirage.ts), or null. The scene sets it. */
  mirage: Mirage | null = null;
  /** False where no kind burns: the pass then does nothing at all. */
  readonly any: boolean;
  /** Fires drawn in the last frame, the blazes of their flames, their draws, and the share of the screen they cover. */
  fires = 0;
  blazes = 0;
  draws = 0;
  fill = 0;

  private readonly reg: Registry;
  private readonly assets: Assets | null;
  private readonly put: Draws | null;
  private readonly cone: number;
  private readonly layouts: (Layout | null | undefined)[];
  private readonly chunks = new WeakMap<ChunkTable, Held>();
  /** This frame's fires in view: HELD floats each, and for each an index into that, its distance and its pixels high. */
  private readonly found: number[] = [];
  private readonly near: number[] = [];
  private readonly ranked: number[] = [];
  /** This frame's blazes, and the order they are drawn in, far to near. */
  private readonly blaze = new Float32Array(MAX_BLAZES * BLAZE);
  private held = 0;
  private readonly keys: number[] = [];
  private screen = 1;
  private spent = 0;
  private low: Float32Array | null = null;
  private readonly bySize = (a: number, b: number): number => this.near[b * 3 + 2]! - this.near[a * 3 + 2]!;
  private readonly byFar = (a: number, b: number): number => this.blaze[b * BLAZE + 10]! - this.blaze[a * BLAZE + 10]!;

  /** `assets` holds the cone, and `put` writes its draws; without them it writes its cards and draws no flame. */
  constructor(reg: Registry, assets: Assets | null = null, put: Draws | null = null) {
    super(CARDS);
    this.reg = reg;
    this.assets = assets;
    this.put = put;
    this.cone = assets ? assets.table.find("core:fire_cone") : -1;
    this.layouts = new Array(reg.ablaze.length);
    this.any = reg.ablaze.some((b) => b === 1) || reg.flames.some((f) => f !== null);
  }

  /**
   * The frame's fires near the camera at `cam` at the scene's clock `now` ms, at the detail each takes by how high it is
   * on a screen `viewHeight` pixels high: their flames held for `draw`, and their cards. Each near enough to light what is
   * round the eye is handed to `lights`, in view or not. Before the details are written.
   */
  build(p: FramePacket, cam: Camera, structs: StructureStore, chunksX: number, chunksZ: number, now: number, tier: Tier, viewHeight = 720, lights: FireLights | null = null): void {
    this.begin();
    this.held = this.fires = this.spent = 0;
    this.fill = 0;
    if (!this.any || !this.on) return;
    this.low = structs.low;
    const near = this.near, found = this.found;
    near.length = found.length = 0;
    // Its smoke may be seen farther than its flames.
    const reach = Math.max(FIRE_REACH, tier.fires.plume);
    const c0 = Math.max(0, Math.floor((cam.x - reach) / CHUNK_SIZE)), c1 = Math.min(chunksX - 1, Math.floor((cam.x + reach) / CHUNK_SIZE));
    const r0 = Math.max(0, Math.floor((cam.z - reach) / CHUNK_SIZE)), r1 = Math.min(chunksZ - 1, Math.floor((cam.z + reach) / CHUNK_SIZE));
    const pixels = viewHeight / (2 * Math.tan(cam.fovY / 2));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const at = this.firesOf(structs, r * chunksX + c);
      for (let i = 0; i < at.length; i += HELD) {
        const kind = at[i + 4]!, lay = this.layoutOf(kind, structs)!;
        const x = at[i]! - cam.x, z = at[i + 2]! - cam.z, bottom = at[i + 1]! + structs.low[kind]! - cam.y;
        const d = Math.hypot(x, bottom + 0.5 * lay.tip, z);
        if (d >= reach) continue;
        if (lights && d < FIRE_REACH) this.light(lights, at, i, lay, x, bottom, z, d);
        // Seen by a box round its flames and the first of its smoke.
        const s = lay.spread + Math.hypot(lay.slideX, lay.slideZ) + lay.wide, top = bottom + Math.max(lay.tip, lay.smoke) + 4 * lay.wide;
        if (!cam.boxVisible(x - s, bottom, z - s, x + s, top, z + s)) continue;
        found.push(at[i]!, at[i + 1]!, at[i + 2]!, at[i + 3]!, kind);
        near.push(found.length / HELD - 1, d, (lay.tip / Math.max(d, 0.5)) * pixels);
      }
    }
    const count = near.length / 3;
    if (count === 0) return;
    // The largest on the screen first, as many as the tier draws.
    const order = this.ranked;
    order.length = 0;
    for (let k = 0; k < count; k++) order.push(k);
    order.sort(this.bySize);
    const t = now / 1000;
    const gust = 1 + GUST * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
    const wx = LOW.wind[0] * WIND_SHARE * gust, wz = LOW.wind[1] * WIND_SHARE * gust;
    this.screen = 4 * Math.tan(cam.fovY / 2) ** 2 * cam.aspect;
    const room = FIRE_SHARE * tier.details.fill;
    // Where the tier carries no light from fire, a warm pool on what a fire stands on stands in for it by night.
    this.pools = tier.lit && tier.fires.lights > 0 ? 0 : tier.lit ? lampsOn(p.frame) : 1 - smooth(-0.15, 0.1, Math.sin(((this.hour - 6) / 12) * Math.PI));
    let embers = 0;
    for (let o = 0, most = Math.min(MOST_FIRES, tier.fires.most, count); o < most; o++) {
      const k = order[o]!, f = near[k * 3]! * HELD, d = near[k * 3 + 1]!, px = near[k * 3 + 2]!;
      const lay = this.layoutOf(found[f + 4]!, structs)!;
      const fade = Math.min(1, Math.max(0, (FIRE_REACH - d) / (FIRE_REACH - FADE_FROM))), fades = Math.min(1, Math.max(0, (reach - d) / (0.2 * reach)));
      // A seed of its own from where it stands, so no two fires flicker, lean or puff together.
      const seed = fract(Math.abs(Math.sin(found[f]! * 12.9898 + found[f + 2]! * 78.233)) * 43758.5453);
      // Past their share of the screen the rest are drawn plainer: a bed alone and half the smoke.
      const plain = this.spent > room;
      this.fire(cam, f, lay, seed, px, fade, fades, plain ? 0 : Math.min(TONGUES, tier.fires.tongues), t, wx, wz, plain);
      if (px > EMBERS_OVER && embers < EMBER_FIRES && !plain) {
        this.embers(cam, f, lay, seed, t, wx, wz, fade * smooth(EMBERS_OVER, 1.5 * EMBERS_OVER, px));
        embers++;
      }
      this.fires++;
    }
    this.fill = this.spent;
  }

  /** Holds one fire's blazes and writes its glows and smoke, its flames shown `fade` of themselves and its smoke `fades`. */
  private fire(cam: Camera, f: number, lay: Layout, seed: number, px: number, fade: number, fades: number, tongues: number, t: number, wx: number, wz: number, plain: boolean): void {
    const found = this.found, yaw = found[f + 3]!, co = Math.cos(yaw), si = Math.sin(yaw);
    const bottom = found[f + 1]! + this.low![found[f + 4]!]! - cam.y;
    const flames = lay.flames, slide = seed - 0.5;
    const wind = Math.hypot(wx, wz) || 1, lean = Math.min(1, wind * LEAN_PER_WIND);
    this.leanX = (wx / wind) * lean;
    this.leanZ = (wz / wind) * lean;
    const cross = smooth(GLOW_UNDER, GLOW_OVER, px);
    for (let q = 0; q < flames.length; q += FLAME_FLOATS) {
      const fx = flames[q]! + slide * lay.slideX, fz = flames[q + 2]! + slide * lay.slideZ, high = flames[q + 3]!, wide = flames[q + 4]!;
      const x = found[f]! - cam.x + co * fx + si * fz, y = bottom + flames[q + 1]!, z = found[f + 2]! - cam.z + co * fz - si * fx;
      layFlame(this.holder, x, y, z, high, wide, px, tongues, fract(seed + q * 0.1309), fade);
      // The air over a flame large on the screen wavers, from within its tongues to well over their tips.
      if (this.mirage && !plain) this.mirage.over(x, y + 1.5 * high, z, 0.7 * wide + 0.25 * high, 1.3 * high, fade * smooth(MIRAGE_OVER, 2.5 * MIRAGE_OVER, px), fract(seed + q * 0.37));
      if (cross < 0.99) this.glow(x, y + 0.45 * high, z, 0.5 * wide + 0.2 * high, 0.55 * high, FLAME, 2.4, (1 - cross) * fade);
      if (this.pools > 0.01) this.pool(x, y + 0.03, z, wide + 1.5 * high, this.pools * fade);
    }
    this.smoke(cam, f, lay, seed, bottom, t, wx, wz, fades, px, plain);
  }

  /** How much a pool of light stands in for a fire's own this frame: 0 where the tier carries its light, or by day. */
  private pools = 0;

  /** A warm pool of light lying on what a fire stands on, `half` across, `shows` of it. */
  private pool(x: number, y: number, z: number, half: number, shows: number): void {
    const i = this.card(x, y, z, half, half, FLAME, (DETAIL_GLOW << 8) | (Math.round(0.9 * GLOW_STEPS) << 24), shows, 0);
    if (i < 0) return;
    const card = this.cards;
    card[i + DETAIL.along] = 0;
    card[i + DETAIL.along + 1] = 0;
    card[i + DETAIL.along + 2] = half;
    card[i + DETAIL.across] = half;
    card[i + DETAIL.across + 1] = 0;
    card[i + DETAIL.across + 2] = 0;
  }

  /**
   * Hands `lights` the light of the fire at `i` of `at`: from its first flame's middle, as strong as its flames are
   * large, flickering. `x`, `bottom` and `z` are its place from the eye, and `d` how far it is, by which it fades out.
   */
  private light(lights: FireLights, at: Float32Array, i: number, lay: Layout, x: number, bottom: number, z: number, d: number): void {
    const fl = lay.flames, yaw = at[i + 3]!, co = Math.cos(yaw), si = Math.sin(yaw);
    const seed = fract(Math.abs(Math.sin(at[i]! * 12.9898 + at[i + 2]! * 78.233)) * 43758.5453), slide = seed - 0.5;
    const fx = fl[0]! + slide * lay.slideX, fz = fl[2]! + slide * lay.slideZ;
    const fade = Math.min(1, Math.max(0, (FIRE_REACH - d) / (FIRE_REACH - FADE_FROM)));
    const [r, g, b] = FIRE_COLOUR;
    lights.add(x + co * fx + si * fz, bottom + fl[1]! + 0.45 * fl[3]!, z + co * fz - si * fx, FIRE_LIGHT * lay.area * fade, r, g, b, FIRE_BY_DAY, 0.16, seed);
  }

  /** The lean of the fire being laid, for `holder`. */
  private leanX = 0;
  private leanZ = 0;
  private readonly holder = (x: number, y: number, z: number, high: number, wide: number, power: number, seed: number): void => this.hold(x, y, z, high, wide, this.leanX, this.leanZ, power, seed);

  /** Holds a blaze for `draw`: its foot from the eye, its height and width, its lean, how much shows and its seed. */
  private hold(x: number, y: number, z: number, high: number, wide: number, lx: number, lz: number, power: number, seed: number): void {
    if (this.held >= MAX_BLAZES) return;
    const o = this.held++ * BLAZE, b = this.blaze, d = Math.hypot(x, y + 0.5 * high, z);
    b[o] = x;
    b[o + 1] = y;
    b[o + 2] = z;
    b[o + 3] = high;
    b[o + 4] = wide;
    b[o + 5] = lx;
    b[o + 6] = lz;
    b[o + 7] = power;
    b[o + 8] = blazePace(high);
    b[o + 9] = seed;
    b[o + 10] = d;
    this.spent += Math.min(1, (0.7 * high * BLAZE_REACH * wide) / (Math.max(d, 0.5) ** 2 * this.screen)) * power;
  }

  /**
   * A fire's smoke: a column of puffs born in its flames, or at a hearth's chimney, each rising fast and then slower,
   * growing, greying and thinning as it goes, and carried downwind more the higher it is. They follow close enough that
   * the column has no gaps; fewer and larger far off, so it keeps its outline.
   */
  private smoke(cam: Camera, f: number, lay: Layout, seed: number, bottom: number, t: number, wx: number, wz: number, fade: number, px: number, plain: boolean): void {
    const found = this.found, yaw = found[f + 3]!, co = Math.cos(yaw), si = Math.sin(yaw), fl = lay.flames, slide = seed - 0.5;
    const chimney = lay.smoke > lay.tip;
    const fx = chimney ? 0 : fl[0]! + slide * lay.slideX, fz = chimney ? 0 : fl[2]! + slide * lay.slideZ;
    const x0 = found[f]! - cam.x + co * fx + si * fz, z0 = found[f + 2]! - cam.z + co * fz - si * fx;
    const y0 = bottom + (chimney ? lay.smoke : fl[1]! + 0.55 * fl[3]!);
    const big = lay.wide, sooty = lay.sooty;
    // A wreck's hot column climbs fast and high; a hearth's wisp slowly, and not far. Seconds its first rise takes to slow.
    const v0 = sooty ? 1.2 + 0.4 * big : 0.4 + 0.5 * big, slows = sooty ? 4 : 2.5, still = sooty ? 0.45 : 0.2, life = sooty ? 13 : 7;
    const many = sooty ? PUFFS : THIN_PUFFS, level = px > 60 ? 1 : px > 20 ? 0.6 : 0.35;
    const puffs = Math.max(4, Math.round(many * level * (plain ? 0.5 : 1))), swell = Math.sqrt(many / puffs);
    for (let q = 0; q < puffs; q++) {
      const u = fract(t / life + q / puffs + seed), a = u * life;
      const up = v0 * slows * (1 - Math.exp(-a / slows)) + still * a;
      // Wind's metres a second times these seconds: the higher, the farther it is carried.
      const out = a * (0.6 + 0.06 * up);
      const size = big * swell * (sooty ? 0.8 + 1.5 * Math.sqrt(u) : 0.35 + 0.8 * Math.sqrt(u));
      const shows = (sooty ? 0.9 : 0.35) * fade * smooth(0, 0.06, u) * (1 - smooth(0.5, 1, u)) * (1 - 0.3 * u);
      const wob = Math.sin(6.2831853 * (u * 1.3 + seed + q * 0.37)) * 0.2 * size;
      // Black where it leaves a wreck, greying as it thins.
      const grey = sooty ? Math.round(40 + 55 * u) : 122;
      this.puff(x0 + wx * out + wob, y0 + up, z0 + wz * out - wob, size, shows, Math.floor(fract(seed + q / puffs) * 255), Math.round(200 * u), sooty ? word(grey, grey - 2, grey - 4) : WOODSMOKE);
    }
  }

  /** Embers off a near fire: sparks thrown up out of its flames that drift downwind, flicker and go out. */
  private embers(cam: Camera, f: number, lay: Layout, seed: number, t: number, wx: number, wz: number, shows: number): void {
    if (shows <= 0.01) return;
    const found = this.found, yaw = found[f + 3]!, co = Math.cos(yaw), si = Math.sin(yaw);
    const bottom = found[f + 1]! + this.low![found[f + 4]!]! - cam.y;
    const fl = lay.flames, slide = seed - 0.5, n = lay.sooty ? EMBERS : EMBERS / 2;
    for (let e = 0; e < n; e++) {
      const k = (e * FLAME_FLOATS) % fl.length;
      const fx = fl[k]! + slide * lay.slideX, fz = fl[k + 2]! + slide * lay.slideZ, high = fl[k + 3]!, wide = fl[k + 4]!;
      const life = 1.4 + 0.8 * fract(seed * 5.3 + e * 0.41);
      const age = t / life + e * 0.618034 + seed, u = fract(age);
      // Each time round, from somewhere else over the bed.
      const r1 = fract(Math.sin(Math.floor(age) * 12.9898 + e * 78.233 + seed * 37.7) * 43758.5453), r2 = fract(r1 * 7.13 + 0.3);
      const ox = fx + (r1 - 0.5) * wide, oz = fz + (r2 - 0.5) * wide;
      const sway = 0.3 * high * Math.sin(6.2831853 * (u * 1.7 + r1));
      const x = found[f]! - cam.x + co * ox + si * oz + wx * u * life * 1.5 + sway, z = found[f + 2]! - cam.z + co * oz - si * ox + wz * u * life * 1.5;
      const y = bottom + fl[k + 1]! + high * (0.4 + 2.2 * u - 0.5 * u * u);
      const flick = 0.6 + 0.4 * Math.sin(37 * t + e * 2.1);
      this.card(x, y, z, 0.02 + 0.012 * high, 0.06 + 0.1 * high, EMBER, (DETAIL_GLOW << 8) | (Math.round(6 * GLOW_STEPS) << 24), shows * (1 - smooth(0.6, 1, u)) * smooth(0, 0.05, u) * flick, 0);
    }
  }

  /** A puff of smoke, square to the eye from any side, over it too. */
  private puff(x: number, y: number, z: number, size: number, shows: number, seed: number, torn: number, colour: number): void {
    const i = this.card(x, y, z, size, size, colour, (DETAIL_SMOKE << 8) | (SMOKE_STEPS << 24), shows, -1e6);
    if (i < 0) return;
    // Its up is square to the way to it and to its across, so seen from over it, it still faces the eye.
    const d = Math.hypot(x, y, z) || 1, ex = x / d, ey = y / d, ez = z / d, l = Math.hypot(x, z) || 1, rx = z / l, rz = -x / l, card = this.cards;
    card[i + DETAIL.along] = ey * rz * size;
    card[i + DETAIL.along + 1] = (ez * rx - ex * rz) * size;
    card[i + DETAIL.along + 2] = -ey * rx * size;
    this.words[i + DETAIL.colourB] = ((seed & 255) | ((torn & 255) << 8)) >>> 0;
    // A puff covers about two thirds of its card.
    this.spent += Math.min(1, (2.6 * size * size) / (Math.max(Math.hypot(x, y, z), 0.5) ** 2 * this.screen)) * shows;
  }

  /** A card of light with no surface, square to the eye: `half` across and `tall` up, `bright` times its colour. */
  private glow(x: number, y: number, z: number, half: number, tall: number, colour: number, bright: number, shows: number): void {
    this.card(x, y, z, half, tall, colour, (DETAIL_GLOW << 8) | (Math.max(1, Math.min(255, Math.round(bright * GLOW_STEPS))) << 24), shows, 0);
  }

  /** A card standing up and turned across the eye: `half` across and `tall` up, its colour, kind and steps in `misc`. Where its words begin, or -1. */
  private card(x: number, y: number, z: number, half: number, tall: number, colour: number, misc: number, shows: number, floor: number): number {
    if (shows <= 0.004 || this.count >= CARDS) return -1;
    const l = Math.hypot(x, z) || 1, rx = z / l, rz = -x / l;
    const i = this.next(), card = this.cards;
    card[i] = x;
    card[i + 1] = y;
    card[i + 2] = z;
    card[i + DETAIL.along] = 0;
    card[i + DETAIL.along + 1] = tall;
    card[i + DETAIL.along + 2] = 0;
    card[i + DETAIL.across] = rx * half;
    card[i + DETAIL.across + 1] = 0;
    card[i + DETAIL.across + 2] = rz * half;
    card[i + DETAIL.floor] = floor;
    this.words[i + DETAIL.colourA] = this.words[i + DETAIL.colourB] = colour;
    this.words[i + DETAIL.misc] = (misc | (Math.round(Math.min(1, shows) * 255) << 16)) >>> 0;
    return i;
  }

  /** Queues the frame's flames, far to near, one draw for each depth range they are in. After the details are written. */
  draw(p: FramePacket, cam: Camera, nowMs: number): void {
    this.blazes = this.draws = 0;
    p.detailFill += this.fill;
    const assets = this.assets, put = this.put, n = this.held;
    if (!assets || !put || this.cone < 0 || n === 0 || !this.on) return;
    const keys = this.keys;
    keys.length = 0;
    for (let b = 0; b < n; b++) keys.push(b);
    keys.sort(this.byFar);
    const bytes = p.transient, ids = p.transientIds, bl = this.blaze;
    for (let range = 1; range <= 3; range++) {
      const first = p.transientCount;
      let m = 0, nearest = Infinity, tallest = 0.1;
      for (const b of keys) {
        const o = b * BLAZE, x = bl[o]!, y = bl[o + 1]!, z = bl[o + 2]!, reach = bl[o + 3]! * BLAZE_REACH * 1.2, w = 0.5 * bl[o + 4]! + 0.7 * reach;
        if (first + m >= ids.length || cam.passes(x - w, y, z - w, x + w, y + reach, z + w) !== range) continue;
        putBlaze(bytes, first + m, x, y, z, bl[o + 3]!, bl[o + 4]!, bl[o + 5]!, bl[o + 6]!, bl[o + 7]!, bl[o + 8]!, bl[o + 9]!);
        ids[first + m] = 0;
        m++;
        nearest = Math.min(nearest, bl[o + 10]!);
        tallest = Math.max(tallest, reach);
      }
      if (m === 0) continue;
      p.transientCount = first + m;
      // The cone's level for the nearest, measured in its own height.
      const level = assets.choose(assets.table.error[this.cone]!, Math.max(1, nearest) / tallest, -1);
      assets.want(this.cone, level, nearest);
      put.effect[0] = FIRE_BLAZE;
      put.effect[1] = blazePhase(nowMs);
      put.effect[2] = put.effect[3] = 0;
      const before = p.drawCount;
      put.draw(this.cone, level, TRANSIENT_BUFFER, first, m, 0, 0, 0, DRAW_BLEND | DRAW_PLAIN | DRAW_FIRE, range);
      put.effect.fill(0);
      if (p.drawCount > before) {
        this.blazes += m;
        this.draws++;
      }
    }
  }

  /** Where a kind's fire stands, worked out the first time it is asked: null for a kind that does not burn. */
  private layoutOf(kind: number, structs: StructureStore): Layout | null {
    const had = this.layouts[kind];
    if (had !== undefined) return had;
    const reg = this.reg, listed = reg.flames[kind] ?? null, ablaze = reg.ablaze[kind] === 1;
    if (!listed && !ablaze) return (this.layouts[kind] = null);
    let flames: Float32Array, slideX = 0, slideZ = 0;
    if (listed) flames = listed;
    else {
      // A wreck's: over its deck toward one end of its hull, as wide as most of its beam, and a smaller one forward on a
      // long hull; each hull's seed slides it along, so no two of a kind burn in the same place.
      const hx = reg.halfX[kind]!, hy = reg.halfY[kind]!, hz = reg.halfZ[kind]!;
      const alongX = hx > hz, long = Math.max(hx, hz), beam = 2 * Math.min(hx, hz);
      const high = Math.min(7, Math.max(1.6, 1.3 * beam)), wide = Math.min(5, 0.75 * beam, long), up = hy * (1 + DECK);
      const a = -0.25 * long, b = 0.4 * long;
      flames = Float32Array.from(long > 2.2 * beam
        ? [alongX ? a : 0, up, alongX ? 0 : a, high, wide, alongX ? b : 0, up, alongX ? 0 : b, 0.6 * high, 0.7 * wide]
        : [alongX ? a : 0, up, alongX ? 0 : a, high, wide]);
      slideX = alongX ? 0.4 * long : 0;
      slideZ = alongX ? 0 : 0.4 * long;
    }
    let tip = 0, wide = 0, spread = 0, area = 0;
    for (let q = 0; q < flames.length; q += FLAME_FLOATS) {
      area += flames[q + 3]! * flames[q + 4]!;
      tip = Math.max(tip, flames[q + 1]! + flames[q + 3]!);
      wide = Math.max(wide, flames[q + 4]!);
      spread = Math.max(spread, Math.hypot(flames[q]!, flames[q + 2]!));
    }
    // A hearth's smoke leaves by its chimney, the top of its box; a wreck's and an open fire's off its tips.
    const height = structs.top[kind]! - structs.low[kind]!;
    const smoke = listed && height > tip ? height : tip;
    return (this.layouts[kind] = { flames, smoke, tip, wide, slideX, slideZ, sooty: ablaze, spread, area });
  }

  /** A chunk's burning things, HELD numbers each: where its box's middle is, its yaw in radians and its kind. Read again only when its table has changed. */
  private firesOf(structs: StructureStore, chunk: number): Float32Array {
    const t = structs.chunks[chunk];
    if (!t) return NONE;
    const held = this.chunks.get(t);
    if (held && held.version === t.shape) return held.at;
    const at: number[] = [];
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind !== 0 && this.layoutOf(kind, structs)) at.push(t.x[s]!, t.y[s]!, t.z[s]!, (t.yaw[s]! / 65536) * 2 * Math.PI, kind);
    }
    const made = at.length ? Float32Array.from(at) : NONE;
    this.chunks.set(t, { version: t.shape, at: made });
    return made;
  }
}
const NONE = new Float32Array(0);
