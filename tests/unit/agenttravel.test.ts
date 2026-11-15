import { expect, test } from "bun:test";
import { serverNamed, socketOf } from "../../agent/travel.ts";
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
