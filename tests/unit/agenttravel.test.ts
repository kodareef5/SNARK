import { expect, test } from "bun:test";
import { nearestTerminal, riseAt, serverNamed, socketOf } from "../../agent/travel.ts";
import { TRAVEL_TERMINAL } from "../../shared/world/obelisks.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry } from "../fixtures/world.ts";
import type { ClusterList } from "../../client/core/travel.ts";

const tampa = { world: 2, name: "Tampa Bay", map: "Tampa", port: 8799, url: "", players: 0, max: 70, why: "" };
const list: ClusterList = { world: 1, name: "Miami", url: "", port: 8798, servers: [tampa] };

test("the agent finds a server by its name, its map or its world's number, whatever the case", () => {
  for (const to of ["tampa bay", " TAMPA ", "2"]) expect(serverNamed(list, to)).toBe(tampa);
  for (const to of ["", "Miami", "3", "Tam"]) expect(serverNamed(list, to)).toBeUndefined();
});

test("the agent goes to the other server's port on the host it came by, or by its public address if it came by this one's", () => {
  expect(socketOf("ws://localhost:8798/ws", list, tampa)).toBe("ws://localhost:8799/ws");
  expect(socketOf("ws://192.168.1.20:8798/ws", list, tampa)).toBe("ws://192.168.1.20:8799/ws");
  const open: ClusterList = { ...list, url: "https://miami.example", servers: [{ ...tampa, url: "https://tampa.example" }] };
  expect(socketOf("wss://miami.example/ws", open, open.servers[0]!)).toBe("wss://tampa.example/ws");
  // Reached some other way, the public addresses are not this agent's way in.
  expect(socketOf("ws://localhost:8798/ws", open, open.servers[0]!)).toBe("ws://localhost:8799/ws");
});

test("the agent finds the nearest obelisk terminal it has been sent, and stands a step in front of it", () => {
  const reg = coreRegistry();
  const store = (): StructureStore => new StructureStore({ chunksX: 4, chunksZ: 4 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const structs = store();
  const kind = reg.index.get(TRAVEL_TERMINAL)!;
  const near = structs.add(kind, 100, 0.6, 100, 0, 0, 1);
  structs.add(kind, 40, 0.6, 40, 0, 0, 1);
  structs.add(reg.index.get("core:wall")!, 98, 1.5, 98, 0, 0, 1);
  const found = nearestTerminal(structs, reg, 95, 95)!;
  expect([found.ref, found.x, Math.round(found.z * 1000) / 1000]).toEqual([near, 100, 101.5]);
  expect(nearestTerminal(store(), reg, 95, 95)).toBeNull();
});

test("an arrival rises at the place it names, else at its tribe's first bed that is ready, else at the first spawn point", () => {
  const places = [{ name: "Plaza", wait: 0 }, { name: "Slopes", wait: 0 }, { name: "Bed", wait: 12 }, { name: "Shack", wait: 0 }];
  expect([riseAt(places, 2), riseAt(places, 2, " slopes "), riseAt(places, 2, "nowhere"), riseAt(places.slice(0, 3), 2)]).toEqual([3, 1, -1, 0]);
});
