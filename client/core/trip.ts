// The map trip's page (tools/map/trip.ts). With ?trip the page keeps, by its own clock, each frame at which one of the
// things the trip measures came or went, on globalThis.snarkTrip for the tool to read over DevTools. It reads the app and
// changes nothing of it: what the page fetches, draws and sends is the same with it as without.

import { SURFACE_PREFIX } from "../../content/surfaces.ts";
import { chunkAt, chunkCx, chunkCz } from "../../shared/coords.ts";
import type { App } from "./app.ts";
import { DRAW_TEXTURED } from "./render/packet.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { WINDOW } from "./render/terrain.ts";

/**
 * A frame at which `what` came ("street") or went ("-street"), by the page's clock in ms, where the body was, and the
 * bytes of art the page had been sent by then.
 */
export interface TripMark {
  readonly at: number;
  readonly what: string;
  readonly x: number;
  readonly z: number;
  readonly art: number;
}

/** Metres the body moves between two frames that the trip takes as a jump. */
const JUMP = 500;
/** Metres round the body whose ground the fine terrain draws: the window's half (client/core/render/terrain.ts). */
const FINE = ((WINDOW - 1) / 2) * TERRAIN_CELL;

/**
 * Watches the app's frames. Marks: `frame`, the first drawn; `street`, each chunk within one of the body's that the map
 * has statics in whole in the near store, every asset shown at the level and step it is wanted at and nothing on its way,
 * no look for how near the finishes come under way (render/finish-near.ts), and pieces drawn with their materials; `far`, the
 * far city drawn in the view; `blocks`, the city's blocks drawn in the view (render/cityblocks.ts); `colour`, the world's finishes drawn with their base colours, where before those come they
 * are drawn as their means (client/shell/gl.ts worldReady), or none to draw; `soft`, no texture shown without its first
 * step; `making`, the card making its textures (texgen); `weathered`, the walls' weathering come up from their first pass; `handed`, the statics round the body handed
 * to the session; `settled`, every part the page wants held and handed over (mapload.ts MapLoader.progress); `predicting`, the body predicted; `exact`, the ground the fine terrain draws all the map's own; `jump`, the body
 * moved more than JUMP metres in a frame. Each, but `frame` and `jump`, again with a minus when it went.
 */
export class TripProbe {
  readonly marks: TripMark[] = [];
  private readonly app: App;
  /** The map's statics a chunk, as its head counts them. */
  private readonly counts: Uint16Array;
  private seen = -1;
  private readonly on = new Set<string>();
  private x = NaN;
  private z = NaN;

  constructor(app: App, counts: Uint16Array) {
    this.app = app;
    this.counts = counts;
  }

  /** Watches every frame from now on, and is on `global` as snarkTrip. */
  static watch(app: App, counts: Uint16Array, global: Record<string, unknown>, nextFrame: (go: () => void) => void): TripProbe {
    const probe = new TripProbe(app, counts);
    global.snarkTrip = probe;
    const look = (): void => {
      probe.look();
      nextFrame(look);
    };
    nextFrame(look);
    return probe;
  }

  /** Looks at the frame the app built last, if it has not yet. */
  look(): void {
    const scene = this.app.scene, session = this.app.session, world = session.world;
    if (!scene || !world || scene.now === this.seen) return;
    this.seen = scene.now;
    const { x, z } = session.own;
    const jumped = Math.hypot(x - this.x, z - this.z) > JUMP;
    this.x = x;
    this.z = z;
    if (this.marks.length === 0) this.mark("frame");
    else if (jumped) this.mark("jump");
    const p = scene.packet, r = scene.assets.residency;
    let textured = false;
    for (let d = 0; d < p.drawCount && !textured; d++) textured = (p.drawFlags[d]! & DRAW_TEXTURED) !== 0;
    this.set("street", textured && r.flying === 0 && r.waiting === 0 && r.wanting() === 0 && scene.finishNear.through && this.near((c) => this.counts[c] === 0 || world.far.complete(c)));
    this.set("far", (scene.city?.drawn.reduce((n, t) => n + t, 0) ?? 0) > 0);
    this.set("blocks", (scene.blocks?.stats.draws ?? 0) > 0);
    this.set("colour", p.worldSide[0] === 0 || p.worldLevel[0]! >= 0);
    this.set("soft", r.bare() === 0);
    this.set("making", p.texgenSide > 0);
    this.set("weathered", (this.app.texgen?.ready ?? 0) > 0);
    const map = this.app.mapLoader?.progress();
    this.set("handed", map?.near ?? false);
    this.set("settled", map?.settled ?? false);
    this.set("predicting", session.predicting);
    this.set("exact", world.hf.exactIn(x - FINE, z - FINE, x + FINE, z + FINE));
  }

  /** What the trip asks at its end: whether every chunk's ground is the map's own, and the far city's pieces. */
  whole(): { ground: boolean; pieces: number } {
    const world = this.app.session.world;
    if (!world) return { ground: false, pieces: 0 };
    return { ground: world.hf.exactIn(0, 0, world.hf.sizeX, world.hf.sizeZ), pieces: world.city?.statics.count ?? 0 };
  }

  /**
   * Bytes of art fetched so far by kind: the textures of the world's finishes and their masks, of the facades, of the
   * sky, of the landmarks and the rest of the core's; and all else, the meshes, their surfaces, the pages and the clips.
   */
  art(): Record<string, number> {
    const out: Record<string, number> = { finishes: 0, facades: 0, sky: 0, landmarks: 0, textures: 0, meshes: 0 };
    const r = this.app.scene?.assets.residency;
    if (!r) return out;
    let textures = 0;
    for (const t of r.textureState()) {
      const kind = t.id.startsWith(SURFACE_PREFIX) ? "finishes" : t.id.startsWith("core:facade") ? "facades" : t.id.startsWith("core:sky") ? "sky" : t.id.startsWith("core:") ? "textures" : "landmarks";
      out[kind]! += t.fetched;
      textures += t.fetched;
    }
    out.meshes = r.stats.fetched - textures;
    return out;
  }

  /** What the street waits for, as it is now: requests under way and bytes waiting for the card, and the chunks round the body not whole. */
  state(): { flying: number; waiting: number; apart: number } {
    const scene = this.app.scene, world = this.app.session.world;
    if (!scene || !world) return { flying: -1, waiting: -1, apart: -1 };
    let apart = 0;
    this.near((c) => {
      if (this.counts[c]! > 0 && !world.far.complete(c)) apart++;
      return true;
    });
    return { flying: scene.assets.residency.flying, waiting: scene.assets.residency.waiting, apart };
  }

  /** Whether `held` says so of each chunk within one of the body's. */
  private near(held: (chunk: number) => boolean): boolean {
    const dims = this.app.session.world!.dims;
    const at = chunkAt(dims, this.x, this.z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = chunkCx(dims, at) + dx, cz = chunkCz(dims, at) + dz;
        if (cx >= 0 && cz >= 0 && cx < dims.chunksX && cz < dims.chunksZ && !held(cz * dims.chunksX + cx)) return false;
      }
    }
    return true;
  }

  private set(what: string, now: boolean): void {
    if (now === this.on.has(what)) return;
    if (now) this.on.add(what);
    else this.on.delete(what);
    this.mark(now ? what : `-${what}`);
  }

  private mark(what: string): void {
    this.marks.push({ at: this.seen, what, x: Math.round(this.x), z: Math.round(this.z), art: this.app.scene?.assets.residency.stats.fetched ?? 0 });
  }
}
