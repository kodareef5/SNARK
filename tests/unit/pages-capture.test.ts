import { expect, test } from "bun:test";
import { capturePublicServer, type PublicCaptureSource } from "../../server/pages/capture.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { Rules } from "../../server/settings/rules.ts";

test("running-host capture exposes admitted character names and effective public rules only", () => {
  const rules = new Rules();
  rules.put(rowOf("TamingSpeedMultiplier")!, 3, "console");
  rules.put(rowOf("SessionName")!, "The coast", "file");
  rules.put(rowOf("ServerPassword")!, "PASSWORD_CANARY", "file");
  const records = new Map([
    [1, { name: "Reef", key: "ACCOUNT_CANARY", inventory: "INVENTORY_CANARY", position: [1, 2, 3] }],
    [2, { name: "Reef", key: "SECOND_ACCOUNT", inventory: "PRIVATE", position: [4, 5, 6] }],
    [3, { name: "Closed character", key: "PRIVATE", inventory: "PRIVATE", position: [0, 0, 0] }],
  ]);
  const source: PublicCaptureSource = {
    world: { mapId: "core:miami" },
    game: { opts: { maxClients: 42 }, clients: [null, { pid: 1, active: true, closed: false }, { pid: 2, active: true, closed: false }, { pid: 3, active: true, closed: true }, { pid: 4, active: false, closed: false }, { pid: 5, active: true, closed: false }] },
    records: { byPid: records }, rules,
  };
  const captured = capturePublicServer(source, { id: "coast", sampledAt: "2026-11-16T12:00:00Z" });
  expect(captured.players).toEqual(["Reef", "Reef"]);
  expect(captured.capacity).toBe(42);
  expect(captured.label).toBe("The coast");
  expect(captured.settings.TamingSpeedMultiplier).toBe(3);
  expect(captured.stats).toEqual({});
  expect(JSON.stringify(captured)).not.toMatch(/CANARY|inventory|position|Closed character|pid|key/);
  records.get(1)!.name = "Renamed later";
  expect(captured.players).toEqual(["Reef", "Reef"]);
});

test("public capture does not enumerate the saved survivor directory", () => {
  const rules = new Rules();
  const accessed: number[] = [];
  const source: PublicCaptureSource = {
    world: { mapId: "core:tampa" },
    game: { opts: { maxClients: 70 }, clients: [{ pid: 7, active: true, closed: false }] },
    records: { byPid: { get(pid) { accessed.push(pid); return { name: "Present" }; } } }, rules,
  };
  expect(capturePublicServer(source, { id: "bay", label: "Bay", sampledAt: "2026-11-16T12:00:00.000Z" }).players).toEqual(["Present"]);
  expect(accessed).toEqual([7]);
});
