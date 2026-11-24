import { expect, test } from "bun:test";
import type { EntrySurvivor } from "../../client/core/entry-state.ts";
import { defaultEntrySpawn, playSurvivor, playWorld } from "../../client/core/player-flow.ts";

const origin = "https://play.example.com";
const world = (address: string, changes: Partial<{ password: boolean; online: boolean; players: number }> = {}) =>
  ({ address: new URL(address, origin).href, players: 2, max: 30, ...changes });

test("Play uses its own world or an open local world with room", () => {
  const remote = world("https://other.example.com/"), locked = world("/locked/", { password: true });
  const offline = world("/offline/", { online: false }), full = world("/full/", { players: 30 }), open = world("/open/");
  expect(playWorld([remote, locked, offline, full, open], null, origin)).toBe(open);
  expect(playWorld([locked, open], locked.address, origin)).toBe(locked);
  expect(playWorld([remote, locked, offline, full], null, origin)).toBeNull();
});

test("returning picks the named survivor or the most recently used one", () => {
  const row = (name: string, lastLogin: number): EntrySurvivor =>
    ({ name, lastLogin, id: lastLogin, level: 1, dead: false, look: null });
  const first = row("Ana", 2), recent = row("Ellis", 4);
  expect(playSurvivor([first, recent], "")).toBe(recent);
  expect(playSurvivor([first, recent], "Ana")).toBe(first);
  expect(playSurvivor([first, recent], "Unknown")).toBeUndefined();
});

test("spawn defaults follow usable places by name through changes to map order", () => {
  const bad = { name: "", x: 0, z: 0 }, shore = { name: "Shore", x: 3, z: 4 }, road = { name: "Road", x: 0, z: 10 };
  expect(defaultEntrySpawn([bad, shore, road], "Road")).toBe(2);
  expect(defaultEntrySpawn([bad, shore], "Old place")).toBe(1);
  expect(defaultEntrySpawn([bad], "Old place")).toBe(-1);
});
