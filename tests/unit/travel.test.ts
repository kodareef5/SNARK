// Where a page goes to travel to another server of its cluster, and what it reads back at the other end (client/core/travel.ts).
import { expect, test } from "bun:test";
import { loadIdentity, type IdentityStore } from "../../client/core/identity.ts";
import { arrivalAddress, arrivalOf, joinAddress, serverAddress, type ClusterList } from "../../client/core/travel.ts";
import { TICKET_BYTES } from "../../shared/net/protocol.ts";

const tampa = { world: 2, name: "Tampa", map: "Tampa", port: 8799, url: "https://tampa.example.com", players: 0, max: 70, why: "" };
const list: ClusterList = { world: 1, name: "Miami", url: "https://miami.example.com", port: 8798, servers: [tampa] };

test("a page goes by the other server's public address only when it came by this one's, and otherwise to its port on the host it came by", () => {
  expect(serverAddress(list, tampa, { origin: "https://miami.example.com", protocol: "https:", hostname: "miami.example.com" })).toBe("https://tampa.example.com");
  expect(serverAddress(list, tampa, { origin: "http://192.168.1.20:8798", protocol: "http:", hostname: "192.168.1.20" })).toBe("http://192.168.1.20:8799");
  expect(serverAddress({ ...list, url: "" }, tampa, { origin: "http://localhost:8798", protocol: "http:", hostname: "localhost" })).toBe("http://localhost:8799");
  // Without a public address of its own, the other is reached by its port even from a tunnel.
  expect(serverAddress(list, { ...tampa, url: "" }, { origin: "https://miami.example.com", protocol: "https:", hostname: "miami.example.com" })).toBe("https://miami.example.com:8799");
  expect(serverAddress(list, tampa, { origin: "http://[::1]:8798", protocol: "http:", hostname: "::1" })).toBe("http://[::1]:8799");
});

test("the ticket rides in the fragment with the name, and anything else there is not a ticket", () => {
  const ticket = Uint8Array.from({ length: TICKET_BYTES }, (_, i) => i * 7);
  const at = arrivalAddress("http://localhost:8799", "Ada Lovelace", ticket);
  expect(at.startsWith("http://localhost:8799/#travel=")).toBe(true);
  expect(arrivalOf(at.slice(at.indexOf("#")))).toEqual({ ticket, name: "Ada Lovelace" });
  expect(joinAddress("http://localhost:8798", "Ada Lovelace")).toBe("http://localhost:8798/?name=Ada%20Lovelace");
  for (const bad of ["", "#", "#travel=00", `#travel=${"zz".repeat(TICKET_BYTES)}&name=ada`, `#travel=${"00".repeat(TICKET_BYTES)}`, "#name=%E0%A4%A"]) expect(arrivalOf(bad)).toBeNull();
});

test("a page that a survivor arrives at, with no name of its own yet, keeps the survivor's name as its own", () => {
  const values = new Map<string, string>();
  const store: IdentityStore = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
  const random = (bytes: Uint8Array): void => void bytes.fill(9);
  expect(loadIdentity(store, random, "Ada", true).name).toBe("Ada");
  expect(loadIdentity(store, random).name).toBe("Ada");
  // One that has a survivor of its own keeps it.
  expect(loadIdentity(store, random, "Bea", true).name).toBe("Bea");
  expect(loadIdentity(store, random).name).toBe("Ada");
});
