// The light of the street lamps that still work (content/street.ts `lamp_lit`), as the lamps are on (surface.ts
// `lampsOn`): round each one near enough, a soft warm disc on the ground under its head, and a glow about its lens
// turned to the eye; see-through detail cards (packet.ts DETAIL_POOL), the cheapest light that reads. The lens itself
// glows on the lamp's own mesh (its material's emissive).

import type { Registry } from "../../../shared/content/registry.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import { CHUNK_SIZE } from "../../../shared/coords.ts";
import type { Camera } from "./camera.ts";
import { DETAIL, DETAIL_POOL, type FramePacket } from "./packet.ts";
import { lampsOn } from "./surface.ts";
import { VehicleCards } from "./vehicle-cards.ts";

/** Lamps lit at once, nearest first, each two cards. */
export const MAX_LIT_LAMPS = 48;
/** Metres out to which a lamp's light is drawn, and from which it fades to nothing there. */
const REACH = 140, FADE_FROM = 100;
/** Where a lamp's lens is in the lamp's own frame (its head over the road, +z), and the radius of its pool and its glow. */
const LENS = [0, 8.85, 2.9] as const;
const POOL = 7, GLOW = 1.1;
/** The light's colours (RGBA bytes, least significant first): a high-pressure sodium lamp's warm white. */
const POOL_COLOUR = 0xff6aa8ff, GLOW_COLOUR = 0xff86c4ff;
/** How much of each shows at its strongest, of 255. */
const POOL_SHOWS = 150, GLOW_SHOWS = 210;

export class StreetLamps extends VehicleCards {
  private readonly kind: number;
  /** The lit lamps of each chunk: x, y, z and yaw (radians), four numbers each, as of the chunk's version. */
  private readonly chunks = new Map<number, { version: number; lamps: Float64Array }>();
  private readonly near: number[] = [];
  /** Whether the frame draws their light (passes.ts `lamps`). */
  on = true;

  constructor(reg: Registry) {
    super(MAX_LIT_LAMPS * 2);
    this.kind = reg.index.get("core:zzstreet_lamp_lit") ?? -1;
  }

  /** The cards for this frame, the camera at `cam`: none by day, or where the content has no lit lamp. */
  build(p: FramePacket, cam: Camera, structs: StructureStore, chunksX: number, chunksZ: number): void {
    this.begin();
    const on = lampsOn(p.frame);
    if (!this.on || this.kind < 0 || on <= 0.004) return;
    const near = this.near; near.length = 0;
    const c0 = Math.max(0, Math.floor((cam.x - REACH) / CHUNK_SIZE)), c1 = Math.min(chunksX - 1, Math.floor((cam.x + REACH) / CHUNK_SIZE));
    const r0 = Math.max(0, Math.floor((cam.z - REACH) / CHUNK_SIZE)), r1 = Math.min(chunksZ - 1, Math.floor((cam.z + REACH) / CHUNK_SIZE));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const lamps = this.lampsOf(structs, r * chunksX + c);
      for (let i = 0; i < lamps.length; i += 4) {
        const d = Math.hypot(lamps[i]! - cam.x, lamps[i + 2]! - cam.z);
        if (d < REACH) near.push(d, r * chunksX + c, i);
      }
    }
    // The nearest first, as many as there is room for.
    const order = Array.from({ length: near.length / 3 }, (_, k) => k).sort((a, b) => near[a * 3]! - near[b * 3]!).slice(0, MAX_LIT_LAMPS);
    // The eye's right and up (camera.ts), for the glow turned to it.
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    const rx = -cy, rz = sy, ux = -sy * sp, uy = cp, uz = -cy * sp;
    for (const k of order) {
      const d = near[k * 3]!, lamps = this.chunks.get(near[k * 3 + 1]!)!.lamps, i = near[k * 3 + 2]!;
      const fade = on * Math.min(1, Math.max(0, (REACH - d) / (REACH - FADE_FROM)));
      const x = lamps[i]! - cam.x, y = lamps[i + 1]! - cam.y, z = lamps[i + 2]! - cam.z, yaw = lamps[i + 3]!;
      // The lens over the road: local +z is (sin yaw, cos yaw).
      const lx = x + Math.sin(yaw) * LENS[2], lz = z + Math.cos(yaw) * LENS[2], ly = y + LENS[1];
      this.card(lx, y + 0.04, lz, POOL, 0, 0, 0, 0, POOL, POOL_COLOUR, Math.round(POOL_SHOWS * fade));
      this.card(lx, ly - 0.25, lz, rx * GLOW, 0, rz * GLOW, ux * GLOW, uy * GLOW, uz * GLOW, GLOW_COLOUR, Math.round(GLOW_SHOWS * fade));
    }
  }

  /** A card at (x, y, z) from the camera with half axes across and along it; one lying flat where `along` is given as 0, 0, `az`. */
  private card(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, colour: number, shows: number): void {
    if (shows <= 0) return;
    const i = this.next(), card = this.cards;
    card[i] = x; card[i + 1] = y; card[i + 2] = z;
    card[i + DETAIL.across] = ax; card[i + DETAIL.across + 1] = ay; card[i + DETAIL.across + 2] = az;
    card[i + DETAIL.along] = bx; card[i + DETAIL.along + 1] = by; card[i + DETAIL.along + 2] = bz;
    this.words[i + DETAIL.colourA] = colour;
    this.words[i + DETAIL.colourB] = colour;
    this.words[i + DETAIL.misc] = ((255 << 24) | (Math.min(255, shows) << 16) | (DETAIL_POOL << 8)) >>> 0;
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
