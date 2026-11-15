// A seat on anything that carries a body: a car's, and a saddle's when creatures are ridden on the same seats. A host
// is any entity with seats; server/occupancy.ts holds who sits in each, whatever the host is, and its authority (a
// vehicle's in server/urban.ts) says what may be done and where a body goes.

/** Points are in the host's frame: metres, +X its left, +Y up, +Z forward, the origin on the ground under its middle. */
export interface Seat {
  /** Saved and sent by name: `driver`, `passenger`, `rear_left`... */
  readonly id: string;
  /** The one seat whose occupant drives or steers the host. */
  readonly driver?: boolean;
  /** Where the occupant's pelvis sits: the server pins it there and every client draws it there. */
  readonly anchor: readonly [number, number, number];
  /** Where a body stands to take or leave the seat. Its side (the sign of x) is the side it gets out on. */
  readonly entry: readonly [number, number, number];
  /** The door (an index into the host's doors) that opens while someone takes or leaves this seat, or none. */
  readonly door?: number;
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
      (seat.door !== undefined && !(Number.isInteger(seat.door) && seat.door >= 0 && seat.door < doors))) throw new Error(`invalid ${what} seat`);
    names.add(seat.id);
    if (seat.driver) drivers++;
  }
  if (drivers !== 1) throw new Error(`a ${what} must have one driver seat`);
}
