// A frame's triangles are shared in an order, what matters most to a player in a fight first. Everything is drawn at
// the levels its distance asks for and counted, but crowns near take only what the tier's number leaves once all above
// them is drawn, nearest last. They give it up by one dial, the squeeze: first their leaves thin, the sprays least seen
// first (tools/pack/sprays.ts), from the band inward; then their levels are chosen as if they stood farther off, each
// whole step of the squeeze twice as far. Trunks, stones and bushes keep the level their distance asks until the crowns
// have given two whole steps, and then give a step for each of theirs. The squeeze follows the last frame's count: it
// rises while the frame is over, and falls only once the frame has been well under for a second, never back to where it
// was over in the last twenty seconds; and a crown's level and share keep a margin before they move. So nothing goes back
// and forth while the count hovers at the limit.

import type { Tier } from "../assets/tiers.ts";

/**
 * The order, most protected first: the viewer's own body and what it holds; other players and creatures; what a fight
 * shows (shots, hurt layers, and the small details made from cues, client/core/details, which keep their own pool and
 * drop order); what is built, far bases too; the ground; trunks, stones and bushes; crowns near; far trees and the far
 * city; ambient details. Above crowns near only cover gives to the budget, and only once crowns have given much: a body
 * is what a player aims at, what a fight shows says who is hit, walls, trunks, stones and bushes are cover, and the
 * ground is what everything stands on. Far trees and the far city are below crowns near but do not give to the squeeze:
 * a reach that grows makes every far tile again, which no frame can do at no cost. Far trees give by the governor's
 * second step, which takes their reach in; the far city keeps its levels, as changing them lets go of every tile made
 * (farcity.ts). Ambient details come last, and take what the frame leaves.
 */
export const ORDER = ["own", "bodies", "fight", "built", "ground", "cover", "crowns", "far", "ambient"] as const;
export type Share = (typeof ORDER)[number];

/** The share of a crown's leaves left at the squeeze's first whole step. */
export const LEAVES_LEFT = 0.2;
/** The squeeze's most: crowns drawn as if eight times as far, every leaf thinned, and trunks, stones and bushes as if four times. */
export const SQUEEZE_MOST = 4;
/** The squeeze from which trunks, stones and bushes give too, a whole step for each of the crowns'. */
const COVER_FROM = 2;
/** Metres over which the thinning's edge goes from none to all, as it sweeps in from the band. */
const RAMP = 16;
/** Steps of a thinning a crown is drawn at, and how far past a step the thinning must go before it is taken. */
export const STEPS = 16;
const MARGIN = 0.3;
/** The squeeze's change in a frame: up while over, down once under. */
const UP = 0.04;
const DOWN = 0.01;
/** Under while crowns take less than this share of what they may, for this many frames together, before the squeeze falls. */
const LOW = 0.85;
const WAIT = 60;
/**
 * A squeeze found too little is not gone back under for this long, twice as long each time a fall from it was over at
 * once, up to the most; until the squeeze is back to none.
 */
const FORGET_MS = 20000;
const FORGET_MOST = 320000;
/** A frame over within this long of the squeeze falling was over because it fell. */
const FELL_MS = 2000;

/** How many times as far as they stand crowns, and trunks, stones and bushes, are drawn at a squeeze. */
export const crownScale = (squeeze: number): number => (squeeze > 1 ? 2 ** (squeeze - 1) : 1);
export const coverScale = (squeeze: number): number => (squeeze > COVER_FROM ? 2 ** (squeeze - COVER_FROM) : 1);

/**
 * The thinning of a crown `metres` off at a squeeze, from 0 for none to STEPS for all of LEAVES_LEFT: it sweeps in from
 * `sweep` metres as the squeeze goes to 1. It stays at `was` (255 for none yet) until it is a margin past a step.
 */
export function thinning(squeeze: number, metres: number, sweep: number, was: number): number {
  const edge = sweep * (1 - Math.min(1, squeeze));
  const t = Math.min(1, Math.max(0, (metres - edge) / RAMP)) * STEPS;
  return was <= STEPS && Math.abs(t - was) <= 0.5 + MARGIN ? was : Math.round(t);
}

/** The share of a crown's leaves drawn at a thinning. */
export const leavesAt = (thin: number): number => 1 - ((1 - LEAVES_LEFT) * thin) / STEPS;

export class FrameBudget {
  /** Off, crowns are drawn as their distance asks: for pictures of the whole and the device page's windows. */
  on = true;
  /** Held, the squeeze stays where it is set, for pictures drawn at a squeeze found elsewhere. */
  held = false;
  /** The squeeze the frame being built draws crowns at. */
  squeeze = 0;
  /** What the tier allows a frame, as the governor leaves it. */
  triangles = 0;
  draws = 0;
  /** What the frame being built has drawn of crowns near and of ambient details (none yet). */
  crowns = 0;
  ambient = 0;
  /** The last frame's: everything, crowns near, ambient details, draws, and what crowns near might have taken. */
  readonly last = { triangles: 0, crowns: 0, ambient: 0, draws: 0, room: 0 };
  private under = 0;
  /** The squeeze not gone back under, until when, for how long the next time, and when it last fell. */
  private floor = 0;
  private floorUntil = 0;
  private forget = FORGET_MS;
  private fellAt = -Infinity;

  /** Starts again from no squeeze, as a new scene does. */
  reset(): void {
    this.squeeze = this.floor = this.under = this.floorUntil = 0;
    this.forget = FORGET_MS;
    this.fellAt = -Infinity;
  }

  begin(tier: Tier): void {
    this.triangles = tier.budget.triangles;
    this.draws = tier.budget.draws;
    this.crowns = this.ambient = 0;
    if (!this.on) this.squeeze = 0;
  }

  /** What ambient details may spend this frame: what the last frame left under the tier's number once all above them was drawn. */
  get forAmbient(): number {
    return Math.max(0, this.triangles - (this.last.triangles - this.last.ambient));
  }

  /** Ends a frame of `triangles` and `draws` at `now` ms, and moves the squeeze for the next. */
  end(now: number, triangles: number, draws: number): void {
    const above = triangles - this.crowns - this.ambient;
    const room = Math.max(0, this.triangles - above);
    Object.assign(this.last, { triangles, crowns: this.crowns, ambient: this.ambient, draws, room });
    if (!this.on || this.held) return;
    if (now >= this.floorUntil) this.floor = 0;
    if (this.crowns > room) {
      this.under = 0;
      if (now - this.fellAt < FELL_MS) this.forget = Math.min(this.forget * 2, FORGET_MOST);
      this.squeeze = Math.min(SQUEEZE_MOST, this.squeeze + UP);
      this.floor = Math.max(this.floor, this.squeeze);
      this.floorUntil = now + this.forget;
    } else if (this.crowns < room * LOW) {
      if (++this.under < WAIT || this.squeeze <= this.floor) return;
      this.squeeze = Math.max(0, this.floor, this.squeeze - DOWN);
      this.fellAt = now;
      if (this.squeeze === 0) this.forget = FORGET_MS;
    } else this.under = 0;
  }
}
