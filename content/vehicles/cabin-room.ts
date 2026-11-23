// The room each enclosed seat has, measured from its vehicle's mesh: bun tools/pack/cabin-room.ts writes cabin-room.json.
import type { Seat, SeatRoom } from "../../shared/sim/seats.ts";
import measured from "./cabin-room.json" with { type: "json" };

const ROOMS = measured as unknown as Readonly<Record<string, Readonly<Record<string, SeatRoom>>>>;

/** The seats of vehicle `id`, each with its measured room where it has one. */
export function withRooms<S extends Seat>(id: string, seats: readonly S[]): S[] {
  const rooms = ROOMS[id];
  return seats.map((seat) => (rooms?.[seat.id] ? { ...seat, room: rooms[seat.id] } : seat));
}
