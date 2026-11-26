// Which parts of its map a page wants, from where it looks: the body and where it heads, the camera, a sight's focus and
// the map screen while it is open. Each kind is wanted within its reach of a centre: overviews and tops within the view,
// statics and their buildings within the statics reach (the far city's, nearer on a phone), and ground within the larger
// of that and the fine window's reach, as far as its budget, but always within the fine window's. A part held is kept
// until it is a sector past its reach from every centre, so a body on a border does not ask for a part and let it go by
// turns (client/core/mapload.ts).

import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { OVERVIEW_CHUNKS, squareOf, type MapHead, type MapPart } from "../../shared/world/mapfile.ts";
import type { App } from "./app.ts";
import { forTouch, tierOf, type Tier } from "./assets/tiers.ts";
import { WINDOW, WINDOW_MOVE } from "./render/terrain.ts";

/**
 * Metres round the body whose sectors' road parts are held: as far as the terrain window, which alone draws them, reaches
 * from where it is filled round the body. Its ground is wanted as far.
 */
export const ROAD_REACH = ((WINDOW - 1) * TERRAIN_CELL) / 2 + WINDOW_MOVE;
/** Metres round the body whose statics a touch-first device holds: its detailed levels end at 1,400 m. */
export const PHONE_STATICS = 1536;
/** Metres past a reach that a part held is kept: one sector. */
export const KEEP_PAST = SECTOR_CHUNKS * CHUNK_SIZE;
/** Metres round a sight's focus whose statics are wanted, for the chunks the server sends along its cone. */
export const FOCUS_STATICS = SECTOR_CHUNKS * CHUNK_SIZE;

/** Metres from a centre each kind of part is wanted within. */
export interface Reach {
  readonly overview: number;
  readonly ground: number;
  readonly statics: number;
  readonly tops: number;
}

/** A place the page wants its map round, and how far. */
export interface Centre {
  readonly x: number;
  readonly z: number;
  readonly reach: Reach;
}

/** What the page looks from besides the body: the tier's reaches, the camera, a sight's focus, the map screen open. */
export interface WantFrom {
  /** Metres to the end of the view, and round the body whose statics are held. */
  readonly view: number;
  readonly statics: number;
  /** Bytes of statics held at most: past it those kept beyond their reach go, farthest first. */
  readonly budget?: number;
  /** Bytes of ground pages held at most, as `budget` is for statics; those round the body and the camera are kept past it. */
  readonly ground?: number;
  readonly camera?: { readonly x: number; readonly z: number } | null;
  readonly focus?: { readonly x: number; readonly z: number } | null;
  /** The map screen's middle and half its window's diagonal, in metres. */
  readonly screen?: { readonly x: number; readonly z: number; readonly half: number } | null;
}

/** The reaches round the body, or round the camera, for a view of `view` m and statics held to `statics` m. */
export const bodyReach = (view: number, statics: number): Reach => ({ overview: view, ground: Math.max(ROAD_REACH, statics), statics, tops: view });

/** Metres round the body whose statics `tier` holds: its far city's reach, and on a touch-first device no more than PHONE_STATICS. */
export const staticsReach = (tier: Tier, touchFirst: boolean): number => (touchFirst ? Math.min(PHONE_STATICS, tier.reach.city) : tier.reach.city);

/** Bytes of statics a tier holds at most, and a touch-first device on any tier. */
export const STATICS_BUDGET: Readonly<Record<Tier["name"] | "touch", number>> = { lowpoly: 30e6, medium: 30e6, high: 40e6, ultra: 40e6, touch: 14e6 };

/** Bytes of ground pages a tier holds at most, and a touch-first device on any tier. */
export const GROUND_BUDGET: Readonly<Record<Tier["name"] | "touch", number>> = { lowpoly: 14e6, medium: 14e6, high: 17e6, ultra: 22e6, touch: 10e6 };

/** What a tier wants with nothing else to look from. */
export function tierWant(tier: Tier, touchFirst = false): WantFrom {
  const name = touchFirst ? "touch" : tier.name;
  return { view: tier.viewDistance, statics: staticsReach(tier, touchFirst), budget: STATICS_BUDGET[name], ground: GROUND_BUDGET[name] };
}

/** The centres the page wants its map round: the body and where it will be, then whatever else `from` names. */
export function centresOf(body: { readonly x: number; readonly z: number }, ahead: { readonly x: number; readonly z: number }, from: WantFrom): Centre[] {
  const near = bodyReach(from.view, from.statics);
  const out: Centre[] = [{ x: body.x, z: body.z, reach: near }];
  if (ahead.x !== body.x || ahead.z !== body.z) out.push({ x: ahead.x, z: ahead.z, reach: near });
  if (from.camera) out.push({ x: from.camera.x, z: from.camera.z, reach: near });
  // The fine window is drawn round a focus (render/scene.ts), and the server sends rows along the sight's cone.
  if (from.focus) out.push({ x: from.focus.x, z: from.focus.z, reach: { overview: 0, ground: ROAD_REACH, statics: FOCUS_STATICS, tops: 0 } });
  if (from.screen) out.push({ x: from.screen.x, z: from.screen.z, reach: { overview: from.screen.half, ground: 0, statics: 0, tops: 0 } });
  return out;
}

/** A part's square in metres, for each part the wanted set is made of: overviews, ground, statics, buildings and tops. */
export class PartBoxes {
  readonly parts: readonly MapPart[];
  /** x0, z0, x1, z1 of each part's square, in the order of `parts`. */
  private readonly box: Float64Array;

  constructor(head: MapHead) {
    this.parts = head.parts.filter((p) => p.kind === "overview" || p.kind === "ground" || p.kind === "statics" || p.kind === "buildings" || p.kind === "tops");
    this.box = new Float64Array(this.parts.length * 4);
    this.parts.forEach((p, k) => {
      const sq = squareOf(head.dims, p.kind === "overview" || p.kind === "tops" ? OVERVIEW_CHUNKS : SECTOR_CHUNKS, p.col, p.row)!;
      this.box.set([sq.cx0 * CHUNK_SIZE, sq.cz0 * CHUNK_SIZE, sq.cx1 * CHUNK_SIZE, sq.cz1 * CHUNK_SIZE], k * 4);
    });
  }

  /** Metres from (x, z) to the square of the `k`-th part. */
  off(k: number, x: number, z: number): number {
    const b = this.box;
    return Math.hypot(Math.max(b[k * 4]! - x, x - b[k * 4 + 2]!, 0), Math.max(b[k * 4 + 1]! - z, z - b[k * 4 + 3]!, 0));
  }
}

/** How far a kind of part is wanted. */
const reachOf = (p: MapPart, r: Reach): number => (p.kind === "overview" ? r.overview : p.kind === "ground" ? r.ground : p.kind === "tops" ? r.tops : r.statics);

/** The parts wanted, by the fewest metres from a centre that wants them, and those held that are kept. */
export class Wanted {
  readonly parts = new Map<MapPart, number>();
  readonly kept = new Set<MapPart>();

  /** Made again for `centres`, and `also` wanted wherever they are. */
  look(boxes: PartBoxes, centres: readonly Centre[], also: ReadonlySet<MapPart> = NONE): this {
    this.parts.clear();
    this.kept.clear();
    boxes.parts.forEach((p, k) => {
      let least = Infinity, keep = false;
      for (const c of centres) {
        const r = reachOf(p, c.reach);
        if (r <= 0) continue;
        const off = boxes.off(k, c.x, c.z);
        if (off <= r && off < least) least = off;
        if (off <= r + KEEP_PAST) keep = true;
      }
      if (also.has(p)) {
        least = Math.min(least, boxes.off(k, centres[0]!.x, centres[0]!.z));
        keep = true;
      }
      if (least < Infinity) this.parts.set(p, least);
      if (keep || least < Infinity) this.kept.add(p);
    });
    return this;
  }
}

const NONE: ReadonlySet<MapPart> = new Set();

/** What the game's page looks from: its tier, its camera once there is a scene, a sight's focus, and the map screen open. */
export function pageWant(app: App): WantFrom {
  const scene = app.scene, hf = app.session.world?.hf;
  const tier = scene?.assets.tier ?? forTouch(tierOf(app.ui.settings.tier), app.ui.settings.touchFirst);
  const chart = app.hud.chart, view = chart?.full.view;
  const open = hf && view && app.ui.opened("map");
  return {
    ...tierWant(tier, app.ui.settings.touchFirst),
    camera: scene ? { x: app.cam.x, z: app.cam.z } : null,
    focus: scene && !Number.isNaN(scene.focusX) ? { x: scene.focusX, z: scene.focusZ } : null,
    screen: open ? { x: (view.u0 + view.du / 2) * hf.sizeX, z: (view.v0 + view.dv / 2) * hf.sizeZ, half: Math.hypot(view.du * hf.sizeX, view.dv * hf.sizeZ) / 2 } : null,
  };
}
