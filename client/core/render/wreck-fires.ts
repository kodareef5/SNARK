// The fire on a wreck that burns where it stands (StructureDef.ablaze: a hull in a marina, content/docks.ts): for the
// nearest few, two cards of flame light over its deck and a few puffs of smoke rising and leaning downwind, as detail
// cards (packet.ts DETAIL_GLOW, DETAIL_SMOKE), the cheapest fire that reads. Nothing is simulated: where each puff is
// is the scene's clock and the wreck's place. Kinds are found in the chunks the client holds, as the lit lamps are
// (street-lamps.ts), and read again only when a chunk's table changes.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE } from "../../../shared/coords.ts";
import type { ChunkTable, StructureStore } from "../../../shared/world/structures.ts";
import type { Camera } from "./camera.ts";
import { DETAIL, DETAIL_GLOW, DETAIL_SMOKE, GLOW_STEPS, SMOKE_STEPS, type FramePacket } from "./packet.ts";
import { VehicleCards } from "./vehicle-cards.ts";

/** Wrecks burning at once, nearest first, and the cards of each: its flames and its puffs. */
export const MAX_WRECK_FIRES = 8;
const FLAMES = 2, PUFFS = 5;
/** Metres out to which a fire is drawn, and from which it fades to nothing there. */
const REACH = 220, FADE_FROM = 170;
/** Metres a puff rises in its life and leans downwind by then, the seconds that takes, and the way the wind goes. */
const RISE = 16, LEAN = 6, LIFE = 9, WIND = [0.8, 0.6] as const;
const word = (r: number, g: number, b: number): number => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const FLAME = word(255, 150, 58), SOOT = word(52, 50, 48);

interface Held { table: ChunkTable; version: number; at: Float32Array }

export class WreckFires extends VehicleCards {
  /** False where no kind burns: the pass then does nothing at all. */
  readonly any: boolean;
  private readonly ablaze: Uint8Array;
  private readonly top: (kind: number) => number;
  private readonly chunks = new Map<number, Held>();
  private readonly near: number[] = [];

  constructor(reg: Registry) {
    super(MAX_WRECK_FIRES * (FLAMES + PUFFS));
    this.ablaze = reg.ablaze;
    this.any = reg.ablaze.some((b) => b === 1);
    this.top = (kind) => reg.halfY[kind]!;
  }

  /** The cards for this frame, the camera at `cam` and the scene's clock at `now` ms. */
  build(_p: FramePacket, cam: Camera, structs: StructureStore, chunksX: number, chunksZ: number, now: number): void {
    this.begin();
    if (!this.any) return;
    const near = this.near; near.length = 0;
    const c0 = Math.max(0, Math.floor((cam.x - REACH) / CHUNK_SIZE)), c1 = Math.min(chunksX - 1, Math.floor((cam.x + REACH) / CHUNK_SIZE));
    const r0 = Math.max(0, Math.floor((cam.z - REACH) / CHUNK_SIZE)), r1 = Math.min(chunksZ - 1, Math.floor((cam.z + REACH) / CHUNK_SIZE));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const at = this.firesOf(structs, r * chunksX + c);
      for (let i = 0; i < at.length; i += 4) {
        const d = Math.hypot(at[i]! - cam.x, at[i + 2]! - cam.z);
        if (d < REACH) near.push(d, at[i]!, at[i + 1]!, at[i + 2]!, at[i + 3]!);
      }
    }
    const count = near.length / 5;
    if (count === 0) return;
    // The nearest first, as many as there is room for.
    const order = Array.from({ length: count }, (_, k) => k).sort((a, b) => near[a * 5]! - near[b * 5]!);
    const t = now / 1000;
    for (const k of order.slice(0, MAX_WRECK_FIRES)) {
      const d = near[k * 5]!, x = near[k * 5 + 1]! - cam.x, y = near[k * 5 + 2]! - cam.y, z = near[k * 5 + 3]! - cam.z, high = near[k * 5 + 4]!;
      const fade = Math.min(1, Math.max(0, (REACH - d) / (REACH - FADE_FROM)));
      // A seed of its own from where it stands, so two fires do not flicker or puff together.
      const seed = Math.abs(Math.sin(near[k * 5 + 1]! * 12.9898 + near[k * 5 + 3]! * 78.233)) * 43758.5453 % 1;
      // Turned to the eye: across the look along the ground, and up.
      const l = Math.hypot(x, z) || 1, rx = z / l, rz = -x / l;
      for (let f = 0; f < FLAMES; f++) {
        const flick = 0.72 + 0.28 * Math.sin(t * (11 + 5 * f) + seed * 40 + f * 2.1) * Math.sin(t * 3.7 + seed * 9 + f);
        const size = (1.5 - 0.5 * f) * (0.9 + 0.2 * flick);
        this.glow(x + rx * (f - 0.5) * 0.9, y + high * (0.55 + 0.25 * f) + size * 0.6, z + rz * (f - 0.5) * 0.9, rx * size, 0, rz * size, 0, size * 1.25, 0, FLAME, fade * flick, 1.6);
      }
      for (let q = 0; q < PUFFS; q++) {
        const life = (t / LIFE + q / PUFFS + seed) % 1;
        const size = 0.9 + 3.4 * life, shows = 0.82 * fade * Math.sin(Math.PI * Math.min(1, life * 1.15)) ** 0.7;
        this.puff(x + WIND[0] * LEAN * life * life, y + high + 1 + RISE * life, z + WIND[1] * LEAN * life * life, rx * size, 0, rz * size, 0, size, 0, y, shows, Math.floor((seed + q / PUFFS) * 255), Math.round(200 * life));
      }
    }
  }

  private glow(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, colour: number, shows: number, bright: number): void {
    if (shows <= 0.004) return;
    const i = this.next(), card = this.cards;
    card[i] = x; card[i + 1] = y; card[i + 2] = z;
    card[i + DETAIL.along] = bx; card[i + DETAIL.along + 1] = by; card[i + DETAIL.along + 2] = bz;
    card[i + DETAIL.across] = ax; card[i + DETAIL.across + 1] = ay; card[i + DETAIL.across + 2] = az;
    card[i + DETAIL.floor] = 0;
    this.words[i + DETAIL.colourA] = this.words[i + DETAIL.colourB] = colour;
    this.words[i + DETAIL.misc] = ((DETAIL_GLOW << 8) | (Math.round(Math.min(1, shows) * 255) << 16) | (Math.max(1, Math.min(255, Math.round(bright * GLOW_STEPS))) << 24)) >>> 0;
  }

  private puff(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, floor: number, shows: number, seed: number, torn: number): void {
    if (shows <= 0.004) return;
    const i = this.next(), card = this.cards;
    card[i] = x; card[i + 1] = y; card[i + 2] = z;
    card[i + DETAIL.along] = bx; card[i + DETAIL.along + 1] = by; card[i + DETAIL.along + 2] = bz;
    card[i + DETAIL.across] = ax; card[i + DETAIL.across + 1] = ay; card[i + DETAIL.across + 2] = az;
    card[i + DETAIL.floor] = floor;
    this.words[i + DETAIL.colourA] = SOOT;
    this.words[i + DETAIL.colourB] = ((seed & 255) | ((torn & 255) << 8)) >>> 0;
    this.words[i + DETAIL.misc] = ((DETAIL_SMOKE << 8) | (Math.round(Math.min(1, shows) * 255) << 16) | (SMOKE_STEPS << 24)) >>> 0;
  }

  /** A chunk's burning wrecks, four numbers each: where it stands and how high its box reaches. Read again only when its table has changed. */
  private firesOf(structs: StructureStore, chunk: number): Float32Array {
    const t = structs.chunks[chunk];
    if (!t) { this.chunks.delete(chunk); return NONE; }
    const held = this.chunks.get(chunk);
    if (held && held.table === t && held.version === t.shape) return held.at;
    const at: number[] = [];
    for (let s = 0; s < t.high; s++) if (this.ablaze[t.kind[s]!] === 1) at.push(t.x[s]!, t.y[s]!, t.z[s]!, this.top(t.kind[s]!));
    const made = at.length ? Float32Array.from(at) : NONE;
    this.chunks.set(chunk, { table: t, version: t.shape, at: made });
    return made;
  }
}
const NONE = new Float32Array(0);
