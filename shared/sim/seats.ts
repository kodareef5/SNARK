// A seat on anything that carries a body: a car's, and a saddle's. A host is any entity with seats; server/occupancy.ts
// holds who sits in each, whatever the host is, and its authority (a vehicle's in server/urban.ts, a creature's in
// server/riding.ts) says what may be done and where a body goes.

/**
 * The room an enclosed seat's occupant has, measured from its host's mesh (tools/pack/cabin-room.ts). Each plane is in the
 * host's axes from the seat's anchor: its height over the anchor, then how much it rises per metre.
 */
export interface SeatRoom {
  /** The roof over the head: height, rise toward +X, rise toward +Z. */
  readonly roof: readonly [number, number, number];
  /** The footwell floor and toe board ahead of the seat: height, rise toward +Z. */
  readonly floor: readonly [number, number];
  /** The cushion's top under the anchor, a little below it. */
  readonly seat: number;
}

/** Points are in the host's frame: metres, +X its left, +Y up, +Z forward, the origin on the ground under its middle. */
export interface Seat {
  /** Saved and sent by name: `driver`, `passenger`, `rear_left`... */
  readonly id: string;
  /** The one seat whose occupant drives or steers the host. */
  readonly driver?: boolean;
  /** Interior-specific seated profile. Omitted uses the host's ordinary driver/passenger pose. */
  readonly pose?: "drive" | "passenger" | "pilot" | "cabin" | "pwc" | "skate";
  /** False stows hand weapons and disables their actions while seated in an enclosed cabin. */
  readonly weapons?: boolean;
  /** Pilot hand grips in the host's frame. Actual body proportions reach these without stretching. */
  readonly controls?: {
    readonly left: readonly [number, number, number]; readonly right: readonly [number, number, number];
    readonly style?: "helicopter" | "helm" | "handlebar";
    /** A steering-driven control rotates its grips and grasp about this authored pivot. */
    readonly turn?: { readonly pivot: readonly [number, number, number]; readonly axis: readonly [number, number, number]; readonly ratio: number };
  };
  /** A saddle's authored HUMAN palm grips, ankle positions and optional outward knee poles, named on the creature rig. */
  readonly rider?: {
    readonly hands: readonly [string, string];
    readonly feet: readonly [string, string];
    readonly knees?: readonly [string, string];
    /** Centres of finite sole platforms, parallel to the seat's +Y plane; half width/depth in metres. */
    readonly soles?: { readonly sockets: readonly [string, string]; readonly half: readonly [number, number] };
    /** Upright bars centred on hands sockets; signed lower/upper extents along the seat's Y axis, in metres. */
    readonly grips?: {
      readonly radius: number; readonly span: readonly [number, number];
      /** Maximum axial forearm alignment toward the fixed hand orientation, degrees. Omitted preserves its original roll. */
      readonly forearmAlignment?: number;
    };
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
  /** An enclosed seat's room. A seated body is fitted inside it (shared/anim/seat-fit.ts); without one it is left as posed. */
  readonly room?: SeatRoom;
}

/** At most this many seats a host (server/occupancy.ts holds the same). */
export const MAX_SEATS = 16;
/** A temporary hostile tail attachment, never a seat that occupancy can claim. */
export const IMPALE_SLOT = 255;
/** A seat's name: what occupancy accepts, so content that compiles always registers. */
export const SEAT_ID = /^[a-z][a-z0-9_]{0,47}$/;

/** Throws on the first fault: 1 to MAX_SEATS seats with names of their own, points, a door of the host's, one driver. */
export function validateSeats(seats: readonly Seat[], doors: number, what: string): void {
  const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!Array.isArray(seats) || seats.length < 1 || seats.length > MAX_SEATS) throw new Error(`a ${what} has 1 to ${MAX_SEATS} seats`);
  const pair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === "string" && x.length > 0 && x.length <= 64) && v[0] !== v[1];
  const names = new Set<string>();
  let drivers = 0;
  for (const seat of seats) {
    if (!SEAT_ID.test(seat.id) || names.has(seat.id) || !vec(seat.anchor) || !vec(seat.entry) ||
      (seat.door !== undefined && !(Number.isInteger(seat.door) && seat.door >= 0 && seat.door < doors)) ||
      (seat.socket !== undefined && !(typeof seat.socket === "string" && seat.socket.length > 0 && seat.socket.length <= 64))) throw new Error(`invalid ${what} seat`);
    if ((seat.pose !== undefined && !["drive", "passenger", "pilot", "cabin", "pwc", "skate"].includes(seat.pose)) ||
      (seat.weapons !== undefined && typeof seat.weapons !== "boolean")) throw new Error(`invalid ${what} seat profile`);
    if (seat.controls && ((seat.pose !== "pilot" && seat.pose !== "pwc") || !seat.driver || !vec(seat.controls.left) || !vec(seat.controls.right))) throw new Error(`invalid ${what} pilot controls`);
    if (seat.controls?.style !== undefined && seat.controls.style !== "helicopter" && seat.controls.style !== "helm" && seat.controls.style !== "handlebar") throw new Error(`invalid ${what} control style`);
    if (seat.rider && (what !== "saddle" || !seat.socket || !pair(seat.rider.hands) || !pair(seat.rider.feet) || (seat.rider.knees !== undefined && !pair(seat.rider.knees)))) throw new Error(`invalid ${what} rider sockets`);
    const soles = seat.rider?.soles;
    if (soles && (!pair(soles.sockets) || !Array.isArray(soles.half) || soles.half.length !== 2 || !soles.half.every((v: number) => Number.isFinite(v) && v > 0 && v <= 1))) throw new Error(`invalid ${what} sole supports`);
    const grips = seat.rider?.grips;
    if (grips && (!Number.isFinite(grips.radius) || grips.radius < .005 || grips.radius > .05 || !Array.isArray(grips.span) || grips.span.length !== 2 || !grips.span.every(Number.isFinite) || grips.span[0] < -.3 || grips.span[0] >= 0 || grips.span[1] <= 0 || grips.span[1] > .3)) throw new Error(`invalid ${what} hand grips`);
    if (grips?.forearmAlignment !== undefined && (!Number.isFinite(grips.forearmAlignment) || grips.forearmAlignment < 0 || grips.forearmAlignment > 90)) throw new Error(`invalid ${what} forearm alignment`);
    if (seat.room !== undefined && !validRoom(seat.room)) throw new Error(`invalid ${what} seat room`);
    const turn = seat.controls?.turn;
    if (turn && (!vec(turn.pivot) || !vec(turn.axis) || Math.abs(turn.axis.reduce((n: number, v: number) => n + v * v, 0) - 1) > 1e-6 || !Number.isFinite(turn.ratio) || Math.abs(turn.ratio) > 50)) throw new Error(`invalid ${what} moving controls`);
    names.add(seat.id);
    if (seat.driver) drivers++;
  }
  if (drivers !== 1) throw new Error(`a ${what} must have one driver seat`);
}

/** Planes no steeper than three in one, a roof over the anchor and a floor and cushion under it, all within four metres. */
function validRoom(room: SeatRoom): boolean {
  const plane = (p: unknown, above: boolean): boolean => Array.isArray(p) && p.length === (above ? 3 : 2) && p.every(Number.isFinite) &&
    (above ? p[0] > 0 && p[0] < 4 : p[0] < 0 && p[0] > -4) && p.every((v, i) => i === 0 || Math.abs(v) <= 3);
  return typeof room === "object" && room !== null && plane(room.roof, true) && plane(room.floor, false) &&
    Number.isFinite(room.seat) && room.seat <= 0 && room.seat > -4;
}
