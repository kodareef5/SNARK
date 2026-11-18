// A seat on anything that carries a body: a car's, and a saddle's. A host is any entity with seats; server/occupancy.ts
// holds who sits in each, whatever the host is, and its authority (a vehicle's in server/urban.ts, a creature's in
// server/riding.ts) says what may be done and where a body goes.

/** Points are in the host's frame: metres, +X its left, +Y up, +Z forward, the origin on the ground under its middle. */
export interface Seat {
  /** Saved and sent by name: `driver`, `passenger`, `rear_left`... */
  readonly id: string;
  /** The one seat whose occupant drives or steers the host. */
  readonly driver?: boolean;
  /** Interior-specific seated profile. Omitted uses the host's ordinary driver/passenger pose. */
  readonly pose?: "drive" | "passenger" | "pilot" | "cabin" | "pwc";
  /** False stows hand weapons and disables their actions while seated in an enclosed cabin. */
  readonly weapons?: boolean;
  /** Pilot hand grips in the host's frame. Actual body proportions reach these without stretching. */
  readonly controls?: {
    readonly left: readonly [number, number, number]; readonly right: readonly [number, number, number];
    readonly style?: "helicopter" | "helm" | "handlebar";
    /** A steering-driven control rotates its grips and grasp about this authored pivot. */
    readonly turn?: { readonly pivot: readonly [number, number, number]; readonly axis: readonly [number, number, number]; readonly ratio: number };
  };
  /**
   * Where the occupant sits: a car's occupant's pelvis, a saddle's top under the rider (shared/anim/seat.ts hangs the
   * rider's origin SEAT_DROP below it). The server pins it there and every client draws it there.
   */
  readonly anchor: readonly [number, number, number];
  /** Where a body stands to take or leave the seat. Its side (the sign of x) is the side it gets out on. */
  readonly entry: readonly [number, number, number];
  /** The door (an index into the host's doors) that opens while someone takes or leaves this seat, or none. */
  readonly door?: number;
  /**
   * The rig socket a seat on a body that bends (a saddle) moves with, in its whole frame; its anchor is that socket at
   * rest, and stands in for it where the rig is not loaded.
   */
  readonly socket?: string;
}

/** At most this many seats a host (server/occupancy.ts holds the same). */
export const MAX_SEATS = 16;
/** A seat's name: what occupancy accepts, so content that compiles always registers. */
export const SEAT_ID = /^[a-z][a-z0-9_]{0,47}$/;

/** Throws on the first fault: 1 to MAX_SEATS seats with names of their own, points, a door of the host's, one driver. */
export function validateSeats(seats: readonly Seat[], doors: number, what: string): void {
  const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!Array.isArray(seats) || seats.length < 1 || seats.length > MAX_SEATS) throw new Error(`a ${what} has 1 to ${MAX_SEATS} seats`);
  const names = new Set<string>();
  let drivers = 0;
  for (const seat of seats) {
    if (!SEAT_ID.test(seat.id) || names.has(seat.id) || !vec(seat.anchor) || !vec(seat.entry) ||
      (seat.door !== undefined && !(Number.isInteger(seat.door) && seat.door >= 0 && seat.door < doors)) ||
      (seat.socket !== undefined && !(typeof seat.socket === "string" && seat.socket.length > 0 && seat.socket.length <= 64))) throw new Error(`invalid ${what} seat`);
    if ((seat.pose !== undefined && !["drive", "passenger", "pilot", "cabin", "pwc"].includes(seat.pose)) ||
      (seat.weapons !== undefined && typeof seat.weapons !== "boolean")) throw new Error(`invalid ${what} seat profile`);
    if (seat.controls && ((seat.pose !== "pilot" && seat.pose !== "pwc") || !seat.driver || !vec(seat.controls.left) || !vec(seat.controls.right))) throw new Error(`invalid ${what} pilot controls`);
    if (seat.controls?.style !== undefined && seat.controls.style !== "helicopter" && seat.controls.style !== "helm" && seat.controls.style !== "handlebar") throw new Error(`invalid ${what} control style`);
    const turn = seat.controls?.turn;
    if (turn && (!vec(turn.pivot) || !vec(turn.axis) || Math.abs(turn.axis.reduce((n: number, v: number) => n + v * v, 0) - 1) > 1e-6 || !Number.isFinite(turn.ratio) || Math.abs(turn.ratio) > 50)) throw new Error(`invalid ${what} moving controls`);
    names.add(seat.id);
    if (seat.driver) drivers++;
  }
  if (drivers !== 1) throw new Error(`a ${what} must have one driver seat`);
}
