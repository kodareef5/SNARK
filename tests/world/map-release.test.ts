import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { partsFolder, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { writeMapFile } from "../../tools/map/pack.ts";
import { buildMapSet, mapReleaseManifest, verifyMapPackage } from "../../tools/mapworld/build-set.ts";
import { flatMap } from "../fixtures/map.ts";

test("map releases verify the compressed parts and their levels, and refuse an existing destination", async () => {
  const root = mkdtempSync(join(tmpdir(), "snark-map-release-"));
  try {
    const file = join(root, "fixture.snmap"), bytes = writeMap(flatMap(1));
    await writeMapFile(file, bytes);
    const summary = verifyMapPackage(file), head = readHead(bytes);
    expect(mapReleaseManifest([summary], true)).toEqual({ producer: "road-deck-4", release: true, maps: [summary] });
    expect(summary.hash).toBe(head.hash); expect(summary.id).toBe(head.id);
    expect(summary.parts).toBe(head.parts.length + 1); expect(summary.bytes).toBe(bytes.length);
    const metadata = file.replace(/\.snmap$/, ".entrances.json");
    writeFileSync(metadata, JSON.stringify({ mapHash: head.hash, entrances: [] }));
    expect(verifyMapPackage(file).entrances?.count).toBe(0);
    writeFileSync(metadata, JSON.stringify({ mapHash: head.hash ^ 1, entrances: [] }));
    expect(() => verifyMapPackage(file)).toThrow("Entrance metadata belongs to another map");
    writeFileSync(metadata, JSON.stringify({ mapHash: head.hash, entrances: [] }));
    await expect(buildMapSet(root, ["fixture"])).rejects.toThrow("Refusing to replace");
    expect(readFileSync(file).equals(bytes)).toBe(true);
    expect(verifyMapPackage(file, false).hash).toBe(head.hash);
    expect(() => verifyMapPackage(file, true)).toThrow("Map copies are not at the release levels");
    expect(existsSync(join(partsFolder(file), head.parts[0]!.name))).toBe(false);
    const part = join(partsFolder(file), head.parts[0]!.name);
    writeFileSync(`${part}.gz`, new Uint8Array([1, 2, 3]));
    expect(() => verifyMapPackage(file)).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a changed map opens a fresh world but cannot reuse an existing map's save", async () => {
  const { createHost } = await import("../../server/host.ts");
  const { coreRegistry } = await import("../fixtures/world.ts");
  const { NO_CLIPS } = await import("../../shared/anim/clip.ts");
  const root = mkdtempSync(join(tmpdir(), "snark-map-save-")), db = join(root, "existing.db");
  try {
    const first = flatMap(1), original = writeMap(first), reg = coreRegistry();
    const host = createHost(reg, { dbPath: db, map: original, clips: NO_CLIPS, rigs: [] }); host.shutdown();
    first.heights[0] = first.heights[0]! + 1;
    const changed = writeMap(first);
    expect(() => createHost(reg, { dbPath: db, map: changed, clips: NO_CLIPS, rigs: [] })).toThrow("save is for other bytes");
    const fresh = createHost(reg, { dbPath: join(root, "fresh.db"), map: changed, clips: NO_CLIPS, rigs: [] });
    expect(fresh.world.mapHash).toBe(readHead(changed).hash); fresh.shutdown();
    const reopened = createHost(reg, { dbPath: db, map: original, clips: NO_CLIPS, rigs: [] }); reopened.shutdown();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
