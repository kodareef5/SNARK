// A collapse seen from afar (EVENT_COLLAPSE): a column of dust over where much of a building came down at once, and a
// low cloud at its foot. Each is one puff card, as the clouds' puffs and a thruster's gas are drawn, lit and hazed with
// the frame, upright and turned about the vertical to face the camera. It rises and widens for a few seconds, stands, and
// thins away; and it thins to nothing near the eye, where a collapse is seen by its pieces and not by a card.
import type { PackDetails } from "../../../shared/pack/details.ts";
import type { Camera } from "./camera.ts";
import { DETAIL, DETAIL_LIT, DETAIL_PUFF } from "./packet.ts";
import { VehicleCards } from "./vehicle-cards.ts";

/** Cards a frame draws at most, in one draw, and the collapses kept. */
export const MAX_DUST_CARDS = 8;
/** Metres from the eye inside which a column is not drawn, and by which it is drawn whole. */
export const DUST_FROM = 100;
export const DUST_WHOLE = 150;
/** Milliseconds a column takes to rise, stands whole, and lasts in all. */
const RISE_MS = 6000;
const STAND_MS = 15000;
export const DUST_MS = 40000;
/** Metres a second its top drifts up once it stands. */
const DRIFT = 1.2;
// RGBA bytes in a packet word, least significant first: concrete dust in the light, and in its own shade.
const DUST = 0xff8c9ca8, DUST_SHADE = 0xff626e78;

/** A collapse as it was told, and the scene's clock when it was. */
interface Column {
  x: number;
  z: number;
  foot: number;
  across: number;
  tall: number;
  born: number;
}

const ease = (t: number): number => t * t * (3 - 2 * t);

export class DustColumns extends VehicleCards {
  private readonly held: Column[] = [];
  private cell = 0;
  private flat = 1;
  private grey = 255;

  constructor() { super(MAX_DUST_CARDS); }

  /** The details' first dust picture, as the clouds take theirs (clouds.ts); the plain puff where the pack has none. */
  pictures(details: PackDetails | undefined): void {
    const p = details?.pictures.find((q) => /\/dust_\d+$/.test(q.id));
    if (p) { this.cell = p.cell; this.flat = p.flat; this.grey = Math.max(1, Math.min(255, Math.round(p.grey * 255))); }
  }

  /** A collapse told at `now`, the scene's clock in milliseconds: the oldest kept goes when there are MAX_DUST_CARDS. */
  add(fell: { readonly x: number; readonly z: number; readonly foot: number; readonly across: number; readonly tall: number }, now: number): void {
    if (this.held.length >= MAX_DUST_CARDS) this.held.shift();
    this.held.push({ x: fell.x, z: fell.z, foot: fell.foot, across: fell.across, tall: fell.tall, born: now });
  }

  /** This frame's cards: a column for each collapse still standing, the newest first, then their feet while there is room. */
  build(cam: Camera, now: number): void {
    this.begin();
    const held = this.held;
    while (held.length > 0 && now - held[0]!.born >= DUST_MS) held.shift();
    for (let k = held.length - 1; k >= 0; k--) this.card(cam, held[k]!, now, false);
    for (let k = held.length - 1; k >= 0 && this.count < MAX_DUST_CARDS; k--) this.card(cam, held[k]!, now, true);
  }

  private card(cam: Camera, c: Column, now: number, foot: boolean): void {
    const age = now - c.born;
    const grown = ease(Math.min(1, age / RISE_MS));
    const wide = Math.max(8, c.across) * (foot ? 0.9 + 1.1 * grown : 0.45 + 0.5 * grown);
    const high = foot ? wide * 0.45 : (c.tall * 0.6 + wide) * (0.25 + 0.75 * grown) + (Math.max(0, age - RISE_MS) / 1000) * DRIFT;
    const x = c.x - cam.x, y = c.foot - cam.y + high * (foot ? 0.6 : 0.95), z = c.z - cam.z;
    const flat = Math.hypot(x, z);
    // It comes in a moment, thins away after it has stood, and is not drawn near the eye.
    const shows = Math.min(1, age / 400) * (1 - ease(Math.min(1, Math.max(0, (age - STAND_MS) / (DUST_MS - STAND_MS))))) * Math.min(1, Math.max(0, (flat - DUST_FROM) / (DUST_WHOLE - DUST_FROM))) * (foot ? 0.8 : 1);
    if (shows <= 0.02 || flat < 1e-3) return;
    // Upright, and turned about the vertical to face the camera.
    const rx = -z / flat, rz = x / flat;
    const i = this.next(), card = this.cards;
    card[i] = x; card[i + 1] = y; card[i + 2] = z;
    card[i + DETAIL.along] = 0; card[i + DETAIL.along + 1] = high; card[i + DETAIL.along + 2] = 0;
    card[i + DETAIL.across] = rx * wide; card[i + DETAIL.across + 1] = 0; card[i + DETAIL.across + 2] = rz * wide;
    card[i + DETAIL.floor] = c.foot - cam.y - 0.5;
    this.words[i + DETAIL.colourA] = DUST;
    this.words[i + DETAIL.colourB] = DUST_SHADE;
    this.words[i + DETAIL.misc] = (this.cell | ((this.flat | DETAIL_LIT | DETAIL_PUFF) << 8) | (Math.round(shows * 255) << 16) | (this.grey << 24)) >>> 0;
  }
}
