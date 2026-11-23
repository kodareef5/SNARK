import { expect, test } from "bun:test";
import measured from "../../content/vehicles/cabin-room.json" with { type: "json" };
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import { validateSeats, type Seat } from "../../shared/sim/seats.ts";
import { enclosedVehicles, measureRooms } from "../../tools/pack/cabin-room.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";

artTest("cabin-room.json matches each enclosed seat's mesh as built (bun tools/pack/cabin-room.ts)", () => {
  const lods = new Map(unpackMeshes(corePack()).map((m) => [m.id, m.lods[0]!]));
  expect(measureRooms(lods)).toEqual(measured);
});

test("every enclosed road vehicle's seats carry their measured rooms, roof over and floor under the anchor", () => {
  const enclosed = enclosedVehicles();
  expect(enclosed.map((v) => v.id)).toContain("core:zephyr");
  expect(enclosed.map((v) => v.id)).toContain("core:veloce");
  expect(enclosed.map((v) => v.id)).not.toContain("core:skateboard");
  for (const vehicle of enclosed) for (const seat of vehicle.seats as readonly Seat[]) {
    expect(seat.room, `${vehicle.id} ${seat.id}`).toBeDefined();
    expect(seat.room!.roof[0]).toBeGreaterThan(.5);
    expect(seat.room!.floor[0]).toBeLessThan(0);
  }
  // Open seats are left as they are posed.
  expect(ROAD_FLEET.flatMap((s) => s.vehicle?.seats ?? []).filter((s) => s.pose === "skate").every((s) => !s.room)).toBe(true);
});

test("a seat's room is refused when a plane is missing, steep, or on the wrong side of the anchor", () => {
  const seat = (room: unknown): Seat[] => [{ id: "driver", driver: true, anchor: [0, 1, 0], entry: [1, 0, 0], room } as Seat];
  expect(() => validateSeats(seat({ roof: [.8, 0, .1], floor: [-.3, 0], seat: -.02 }), 0, "vehicle")).not.toThrow();
  for (const room of [{ roof: [-.1, 0, 0], floor: [-.3, 0], seat: 0 }, { roof: [.8, 0, 0], floor: [.3, 0], seat: 0 }, { roof: [.8, 5, 0], floor: [-.3, 0], seat: 0 },
    { roof: [.8, 0], floor: [-.3, 0], seat: 0 }, { roof: [.8, 0, 0], floor: [-.3, 0], seat: .1 }, { roof: [.8, 0, NaN], floor: [-.3, 0], seat: 0 }]) {
    expect(() => validateSeats(seat(room), 0, "vehicle"), JSON.stringify(room)).toThrow("invalid vehicle seat room");
  }
});
