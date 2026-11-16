import { expect, test } from "bun:test";
import { validatePublicSnapshot } from "../../shared/pages/validate.ts";
import { buildServers } from "../../tools/pages/catalogue.ts";

const sample = () => ({ version: 1, servers: [{ id: "coast", label: "Coast", mapId: "core:miami", sampledAt: "2026-11-16T12:00:00.000Z", players: ["Alex", "Alex"], capacity: 30, settings: { TamingSpeedMultiplier: 2, ServerPVE: true }, stats: { tickMilliseconds: 0 } }] });

test("snapshot retains duplicate character names and distinguishes missing measurements from zero", () => {
  const data = sample();
  const checked = validatePublicSnapshot(data);
  expect(checked.servers[0]!.players).toEqual(["Alex", "Alex"]);
  expect(checked.servers[0]!.stats).toEqual({ tickMilliseconds: 0 });
  data.servers[0]!.players.push("Later join");
  expect(checked.servers[0]!.players).toHaveLength(2);
  const built = buildServers(checked)[0]!;
  expect(built.settings.find((s) => s.key === "TamingSpeedMultiplier")?.value).toBe("2");
  expect(built.facts).toContainEqual({ label: "Tick duration at capture", value: "0", unit: "ms" });
  expect(built.facts.some((f) => f.label.includes("Save duration"))).toBe(false);
  expect(built.settings).toHaveLength(2);
});

test("unknown and private fields are rejected at every public boundary", () => {
  const s = sample().servers[0]!;
  for (const value of [
    { ...sample(), accountId: "private-canary" },
    { version: 1, servers: [{ ...s, savePath: "/private/save.sqlite" }] },
    { version: 1, servers: [{ ...s, players: [{ name: "Alex", pid: "private" }] }] },
    { version: 1, servers: [{ ...s, settings: { ServerPassword: "private-canary" } }] },
    { version: 1, servers: [{ ...s, stats: { tribeCount: 2, characters: ["private-canary"] } }] },
    JSON.parse('{"version":1,"servers":[],"__proto__":{"canary":true}}'),
  ]) expect(() => validatePublicSnapshot(value)).toThrow();
});

test("snapshot rejects unsafe identifiers, invalid times and unbounded or non-finite data", () => {
  const s = sample().servers[0]!;
  for (const change of [
    { id: "../save" }, { id: "UPPER" }, { mapId: "core:../../save" },
    { sampledAt: "2026-02-30T00:00:00Z" }, { sampledAt: "yesterday" },
    { capacity: 1 }, { capacity: Infinity }, { players: ["x".repeat(81)] },
    { stats: { uptimeSeconds: NaN } }, { stats: { tickMilliseconds: -1 } },
    { settings: { TamingSpeedMultiplier: Infinity } }, { settings: { ServerPVE: "True" } },
  ]) expect(() => validatePublicSnapshot({ version: 1, servers: [{ ...s, ...change }] })).toThrow();
  expect(() => validatePublicSnapshot({ version: 2, servers: [] })).toThrow("version");
  expect(() => validatePublicSnapshot({ version: 1, servers: [s, s] })).toThrow("unique");
  expect(() => buildServers({ version: 1, servers: [{ ...s, mapId: "other:unknown" }] })).toThrow("content revision");
});

test("names are plain public text and do not become paths, markup or structured identities", () => {
  const value = sample();
  value.servers[0]!.players = ["<img src=x onerror=alert(1)>", "A & B"];
  const s = validatePublicSnapshot(value).servers[0]!;
  expect(s.players).toEqual(value.servers[0]!.players);
  expect(Object.keys(s)).toEqual(["id", "label", "mapId", "sampledAt", "players", "capacity", "settings", "stats"]);
});
