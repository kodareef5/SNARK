// The light of the street lamps that still work (content/street.ts `lamp_lit`), as the lamps are on (surface.ts
// `lampsOn`): round each one near enough, a soft warm disc on the ground under its head, and a glow about its lens
// turned to the eye; see-through detail cards (packet.ts DETAIL_POOL), the cheapest light that reads. The lens itself
// glows on the lamp's own mesh (its material's emissive). Where the tier lets it, the nearest within LAMP_REACH lights
// as a light too (lamp.ts): its pool card fades out as its light fades in, and when another lamp is the nearest the
// light fades back into the first one's card before the next one's card fades into its light, so one lamp lights at a
// time. There every lamp's pool card is laid out as the light's pool is and shows on the road as the light does, so
// the light going into a card and out of another changes little but the light on what stands in it. Where the tier's
// shadows say so (medium, high and ultra off a phone), every pool card takes the shadows of the bodies and cars of the
// frame's contact list (lamp.ts poolShade), so each lamp's pool has the shadows a player looks for, not the one lamp's.

import type { Registry } from "../../../shared/content/registry.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import { CHUNK_SIZE } from "../../../shared/coords.ts";
import type { Camera } from "./camera.ts";
import { LAMP_FADE, LAMP_HOLD, LAMP_LONG, LAMP_OUT, LAMP_POOL, LAMP_REACH, LAMP_WIDE, lensWord, poolCasters } from "./lamp.ts";
import { DETAIL, DETAIL_POOL, DETAIL_SHADED_POOL, FRAME, MAX_CONTACTS, type FramePacket } from "./packet.ts";
import { LENS_FROM, LENS_TO, lampsOn } from "./surface.ts";
import { VehicleCards } from "./vehicle-cards.ts";

/** Lamps lit at once, nearest first, each two cards. */
export const MAX_LIT_LAMPS = 48;
/** Metres out to which a lamp's pool is drawn, and from which it fades to nothing there. */
const REACH = 140, FADE_FROM = 100;
/**
 * The same for its glow, which stands for the lamp's light where its lens is too small to show it steadily (surface.ts
 * LENS_FROM): as far as a street is seen down, and from there as small as GLOW_PIXELS of the scene's pixels across its
 * radius, never smaller, so that the camera's least move or a step of the scene's share does not turn it on and off
 * between pixels. Where the lens has given up its glow, the card shows FAR_GLOW_SHOWS of its colour, of 255, for it.
 */
const GLOW_REACH = 500, GLOW_FADE_FROM = 420, GLOW_PIXELS = 2, FAR_GLOW_SHOWS = 200;
/**
 * Where a lamp's lens is in the lamp's own frame (its head over the road, +z), and the radius of its pool and its glow: a
 * cobra head at nearly 9 m lights the road about one and a half times its height each way.
 */
const LENS = [0, 8.85, 2.9] as const;
const POOL = 13, GLOW = 0.6;
/** The light's colours (RGBA bytes, least significant first): a high-pressure sodium lamp's warm white. */
const POOL_COLOUR = 0xff5096ff, GLOW_COLOUR = 0xff64aaff;
/** How much of each shows at its strongest, of 255. */
const POOL_SHOWS = 210, GLOW_SHOWS = 110;
/**
 * On a tier where a lamp lights as a light, how much of the pool card shows at its middle, of 255: the share of its
 * colour, which is the light's, that the road's asphalt shows under the light's pool there, seen along the street.
 * The asphalt sends back ROAD_SEEN of the light seen from 10 m off: its own 0.034 and half as much again as gloss,
 * which the flat card cannot show and so takes into its strength.
 */
const ROAD_SEEN = 0.052;
export const LIT_POOL_SHOWS = Math.round(255 * Math.min(1, ROAD_SEEN * LAMP_POOL));
/** The farthest along the ground from under its lens such a card reaches: its middle out over the road, and its half length along it. */
const LIT_POOL_REACH = LAMP_OUT + Math.max(LAMP_WIDE, LAMP_LONG);
/** Metres such a card lies over the ground the heightfield gives under it, for the road's crown and the ground's grain. */
const CARD_LIFT = 0.08;

/** The light's share eased at both ends, so that it comes and goes without a step. */
const eased = (s: number): number => s * s * (3 - 2 * s);

export class StreetLamps extends VehicleCards {
  private readonly kind: number;
  /** The lit lamps of each chunk: x, y, z and yaw (radians), four numbers each, as of the chunk's version. */
  private readonly chunks = new Map<number, { version: number; lamps: Float64Array }>();
  private readonly near: number[] = [];
  /** Whether the frame draws their light (passes.ts `lamps`). */
  on = true;
  /** Whether the nearest lamp may light as a light (passes.ts `lamp`), where the frame's tier lets it. */
  light = true;
  /** Whether the pool cards take the shadows of the bodies near them (passes.ts `pools`), where the frame's tier lets them. */
  shaded = true;
  /**
   * The lamp whose light lights, by its lens in the world and the way its head faces (x and z), while one is held; how
   * much of its light shows, 0 to 1, rising and falling over LAMP_FADE seconds; and the scene's clock at the frame
   * before, in ms.
   */
  private readonly held = new Float64Array(5);
  private readonly wanted = new Float64Array(5);
  private readonly at = new Float64Array(5);
  private holding = false;
  private share = 0;
  private last = -1;
  /**
   * This frame's: the lens of the lamp that lights, camera-relative, the way its head faces along the ground, x and z,
   * and how much of its light shows, 0 for none.
   */
  readonly lens = new Float64Array(3);
  readonly way = new Float64Array(2);
  shows = 0;

  constructor(reg: Registry) {
    super(MAX_LIT_LAMPS * 2);
    this.kind = reg.index.get("core:zzstreet_lamp_lit") ?? -1;
  }

  /**
   * The cards for this frame, the camera at `cam` and the scene's clock at `now` ms: none by day, or where the content
   * has no lit lamp. With `lights`, where the tier lets a lamp light, the pool cards laid out as its light is, each on
   * the ground `hf` has under its middle out over the road, and the lamp that lights (`lens`, `way` and `shows`). With
   * `pools`, where the tier's shadows say so, each pool card takes the shadows of the bodies of the frame's contact list
   * that may stand in it (lamp.ts `poolShade`, `poolCasters`), and holds where its lens is from its middle for that. The lamp that lights is the one nearest
   * `focus`, the viewer's own body where it has one: in third person the camera stands metres behind it. The scene is
   * `rows` pixels high, for how small a glow far off may be, or 0 for no least size.
   */
  build(p: FramePacket, cam: Camera, structs: StructureStore, chunksX: number, chunksZ: number, now = 0, lights = false, hf: Heightfield | null = null, pools = false, focus: { readonly x: number; readonly z: number } = cam, rows = 0): void {
    this.begin();
    this.shows = 0;
    const step = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const on = lampsOn(p.frame);
    if (!this.on || this.kind < 0 || on <= 0.004) {
      this.holding = false;
      this.share = 0;
      return;
    }
    const near = this.near; near.length = 0;
    const c0 = Math.max(0, Math.floor((cam.x - GLOW_REACH) / CHUNK_SIZE)), c1 = Math.min(chunksX - 1, Math.floor((cam.x + GLOW_REACH) / CHUNK_SIZE));
    const r0 = Math.max(0, Math.floor((cam.z - GLOW_REACH) / CHUNK_SIZE)), r1 = Math.min(chunksZ - 1, Math.floor((cam.z + GLOW_REACH) / CHUNK_SIZE));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const lamps = this.lampsOf(structs, r * chunksX + c);
      for (let i = 0; i < lamps.length; i += 4) {
        const d = Math.hypot(lamps[i]! - cam.x, lamps[i + 2]! - cam.z);
        if (d < GLOW_REACH) near.push(d, r * chunksX + c, i);
      }
    }
    // The nearest first, as many as there is room for. Where more are near than that, they fade to nothing by the
    // distance of the first left out, as they fade by their reach, so none is cut off as another comes nearer.
    const all = Array.from({ length: near.length / 3 }, (_, k) => k).sort((a, b) => near[a * 3]! - near[b * 3]!);
    const order = all.slice(0, MAX_LIT_LAMPS), edge = all.length > MAX_LIT_LAMPS ? near[all[MAX_LIT_LAMPS]! * 3]! : Infinity;
    const poolEdge = Math.min(edge, REACH), glowEdge = Math.min(edge, GLOW_REACH);
    // A scene pixel's height a metre off, for the glow's least size.
    const pixel = rows > 0 ? (2 * Math.tan(cam.fovY / 2)) / rows : 0;
    /** Lamp k's lens over the road and the way its head faces: local +z is (sin yaw, cos yaw). */
    const lensOf = (k: number, out: Float64Array): void => {
      const lamps = this.chunks.get(near[k * 3 + 1]!)!.lamps, i = near[k * 3 + 2]!, yaw = lamps[i + 3]!;
      out[3] = Math.sin(yaw);
      out[4] = Math.cos(yaw);
      out[0] = lamps[i]! + out[3] * LENS[2];
      out[1] = lamps[i + 1]! + LENS[1];
      out[2] = lamps[i + 2]! + out[4] * LENS[2];
    };
    if (lights && this.light) this.hand(this.choose(order, lensOf, focus), lensOf, step);
    const lens = this.lens, at = this.at, shared = lights && this.light && this.holding ? eased(this.share) : 0, shaded = pools && this.shaded;
    // The eye's right and up (camera.ts), for the glow turned to it.
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    const rx = -cy, rz = sy, ux = -sy * sp, uy = cp, uz = -cy * sp;
    for (const k of order) {
      const d = near[k * 3]!, lamps = this.chunks.get(near[k * 3 + 1]!)!.lamps, i = near[k * 3 + 2]!;
      const fade = on * Math.min(1, Math.max(0, (poolEdge - d) / ((poolEdge * (REACH - FADE_FROM)) / REACH)));
      const glowFade = on * Math.min(1, Math.max(0, (glowEdge - d) / ((glowEdge * (GLOW_REACH - GLOW_FADE_FROM)) / GLOW_REACH)));
      lensOf(k, at);
      // The lamp that lights shows as much less of its pool as its light shows.
      const lit = shared > 0 && this.same(at, this.held) ? shared : 0;
      const lx = at[0]! - cam.x, ly = at[1]! - cam.y, lz = at[2]! - cam.z, y = lamps[i + 1]! - cam.y, wx = at[3]!, wz = at[4]!;
      // Lying flat, its face up: across along z and along x, so that across x along is up. Where a lamp lights, as
      // its light's pool lies, out over the road from under the lens, and on the road there, tilted as the ground
      // under it leans either way, which may stand higher or lower than the ground at the mast and rise across it.
      if (lights) {
        const mx = at[0]! + wx * LAMP_OUT, mz = at[2]! + wz * LAMP_OUT, ax = (wx * LAMP_WIDE) / 2, az = (wz * LAMP_WIDE) / 2, bx = (wz * LAMP_LONG) / 2, bz = (-wx * LAMP_LONG) / 2;
        const my = (hf ? hf.heightAt(mx, mz) - cam.y : y) + CARD_LIFT;
        const ay = hf ? hf.heightAt(mx + ax, mz + az) - hf.heightAt(mx - ax, mz - az) : 0, by = hf ? hf.heightAt(mx + bx, mz + bz) - hf.heightAt(mx - bx, mz - bz) : 0;
        const casters = shaded ? poolCasters(p.frame, FRAME.contact, MAX_CONTACTS, lx, lz, LIT_POOL_REACH) : 0;
        this.card(mx - cam.x, my, mz - cam.z, 2 * ax, ay, 2 * az, 2 * bx, by, 2 * bz, POOL_COLOUR, Math.round(LIT_POOL_SHOWS * fade * (1 - lit)), casters ? lensWord(lx - mx + cam.x, ly - my, lz - mz + cam.z) : -1, casters);
      } else {
        const casters = shaded ? poolCasters(p.frame, FRAME.contact, MAX_CONTACTS, lx, lz, POOL) : 0;
        this.card(lx, y + 0.04, lz, 0, 0, POOL, POOL, 0, 0, POOL_COLOUR, Math.round(POOL_SHOWS * fade * (1 - lit)), casters ? lensWord(0, ly - y - 0.04, 0) : -1, casters);
      }
      // The glow: as big as it is, or GLOW_PIXELS, and as the lens gives up its glow, the more of its colour shown for it.
      const g = Math.max(GLOW, GLOW_PIXELS * pixel * Math.hypot(lx, ly, lz)), far = Math.min(1, Math.max(0, (d - LENS_FROM) / (LENS_TO - LENS_FROM)));
      this.card(lx, ly - 0.25, lz, rx * g, 0, rz * g, ux * g, uy * g, uz * g, GLOW_COLOUR, Math.round((GLOW_SHOWS + (FAR_GLOW_SHOWS - GLOW_SHOWS) * eased(far)) * glowFade), -1, 0);
    }
    lens[0] = this.held[0]! - cam.x;
    lens[1] = this.held[1]! - cam.y;
    lens[2] = this.held[2]! - cam.z;
    this.way[0] = this.held[3]!;
    this.way[1] = this.held[4]!;
    this.shows = shared * on;
  }

  /** Whether two lamps, as `lensOf` gives them, are the same one. */
  private same(a: Float64Array, b: Float64Array): boolean {
    return Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!) < 0.5;
  }

  /**
   * The lamp of this frame's (`order`) whose light should light, -1 for none: the one whose pool's middle is nearest
   * `focus` along the ground, within LAMP_REACH; but the one held while its pool is within reach and no other's is
   * LAMP_HOLD metres nearer.
   */
  private choose(order: readonly number[], lensOf: (k: number, out: Float64Array) => void, focus: { readonly x: number; readonly z: number }): number {
    const at = this.at;
    let best = -1, nearest = LAMP_REACH, kept = -1, keptAt = Infinity;
    for (const k of order) {
      lensOf(k, at);
      const d = Math.hypot(at[0]! + at[3]! * LAMP_OUT - focus.x, at[2]! + at[4]! * LAMP_OUT - focus.z);
      if (d < nearest) {
        best = k;
        nearest = d;
      }
      if (this.holding && this.same(at, this.held)) {
        kept = k;
        keptAt = d;
      }
    }
    return kept >= 0 && keptAt < LAMP_REACH && keptAt < nearest + LAMP_HOLD ? kept : best;
  }

  /**
   * Hands the light on toward lamp `want` of this frame's (-1 for none), its lens by `lensOf`, `step` seconds on: the lamp
   * held brightens while it is the one wanted and dims while it is not, and once it is out the one wanted is held.
   */
  private hand(want: number, lensOf: (k: number, out: Float64Array) => void, step: number): void {
    const at = this.wanted;
    if (want >= 0) lensOf(want, at);
    const same = this.holding && want >= 0 && this.same(at, this.held);
    this.share = Math.min(1, Math.max(0, this.share + (same ? step : -step) / LAMP_FADE));
    if (same || (this.holding && this.share > 0)) return;
    this.holding = want >= 0;
    this.held.set(at);
    this.share = 0;
  }

  /**
   * A card at (x, y, z) from the camera with half axes across and along it, its face where across x along points; a
   * shaded pool where `lens` is where its lens is from its middle (lamp.ts lensWord), else -1, and `casters` the bodies
   * of the contact list that may stand in it, a bit each (lamp.ts poolCasters), held in its floor.
   */
  private card(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, colour: number, shows: number, lens: number, casters: number): void {
    if (shows <= 0) return;
    const i = this.next(), card = this.cards;
    card[i] = x; card[i + 1] = y; card[i + 2] = z;
    card[i + DETAIL.floor] = lens >= 0 ? casters : 0;
    card[i + DETAIL.across] = ax; card[i + DETAIL.across + 1] = ay; card[i + DETAIL.across + 2] = az;
    card[i + DETAIL.along] = bx; card[i + DETAIL.along + 1] = by; card[i + DETAIL.along + 2] = bz;
    this.words[i + DETAIL.colourA] = colour;
    this.words[i + DETAIL.colourB] = lens >= 0 ? lens : colour;
    this.words[i + DETAIL.misc] = ((255 << 24) | (Math.min(255, shows) << 16) | ((lens >= 0 ? DETAIL_SHADED_POOL : DETAIL_POOL) << 8)) >>> 0;
  }

  /** A chunk's lit lamps, read again only when its table has changed. */
  private lampsOf(structs: StructureStore, chunk: number): Float64Array {
    const t = structs.chunks[chunk];
    const version = t ? t.version : -1;
    const had = this.chunks.get(chunk);
    if (had && had.version === version) return had.lamps;
    const found: number[] = [];
    if (t) for (let s = 0; s < t.high; s++) if (t.kind[s] === this.kind) found.push(t.x[s]!, t.y[s]!, t.z[s]!, (t.yaw[s]! / 65536) * 2 * Math.PI);
    const lamps = new Float64Array(found);
    this.chunks.set(chunk, { version, lamps });
    return lamps;
  }
}
