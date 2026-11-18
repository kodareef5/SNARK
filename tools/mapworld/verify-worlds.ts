// Start each staged package on its own fresh save, fetch the map as a client would, and reopen the save.
// bun tools/mapworld/verify-worlds.ts <release-directory> <new-save-directory> [built-client-directory]
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { startServer } from "../../server/main.ts";
import { partsOf, readHead } from "../../shared/world/mapfile.ts";
import type { verifyMapPackage } from "./build-set.ts";

type Package = ReturnType<typeof verifyMapPackage>;

async function verifyWorld(folder: string, saves: string, entry: Package, clientDir?: string) {
  if (entry.file !== basename(entry.file) || !entry.file.endsWith(".snmap")) throw new Error("Unexpected map filename in release");
  const map = join(folder, entry.file), dbPath = join(saves, entry.file + ".db");
  const file = readFileSync(map), head = readHead(file), parts = partsOf(file);
  if (new Bun.CryptoHasher("sha256").update(file).digest("hex") !== entry.sha256 || entry.hash !== head.hash ||
    parts.length !== entry.parts || entry.id !== head.id) throw new Error("Packed map differs from release: " + entry.file);

  let saveId = "", savedTick = 0, reopenedTick = 0;
  for (const fresh of [true, false]) {
    const server = startServer({ map, dbPath, clientDir, hostname: "127.0.0.1", port: 0, noBackups: true });
    try {
      const { persistence, world } = server.host;
      if (!persistence || persistence.store.fresh !== fresh || world.mapHash !== head.hash) throw new Error(entry.file + " has the wrong save or map identity");
      if (fresh) saveId = persistence.saveId;
      else {
        reopenedTick = world.tick;
        if (persistence.saveId !== saveId || reopenedTick !== savedTick) throw new Error(entry.file + " did not restore its save identity and tick");
      }
      const origin = "http://127.0.0.1:" + server.port;
      const link = await fetch(origin + "/map.json");
      const manifest = await link.json() as { id: string; hash: number; head: string };
      if (!link.ok || manifest.id !== entry.id || manifest.hash !== entry.hash || manifest.head !== "map/" + head.name) throw new Error("Wrong served map manifest: " + entry.file);
      // Compare every decoded HTTP part against the bytes of the packed map. Reopen checks its head again.
      for (const p of fresh ? parts : parts.slice(0, 1)) {
        const response = await fetch(origin + "/map/" + p.name, { headers: { "accept-encoding": "gzip" } });
        const decoded = Buffer.from(await response.arrayBuffer());
        if (!response.ok || !decoded.equals(p.bytes)) throw new Error("Wrong bytes from " + entry.file + " at " + p.name);
      }
      if (fresh) {
        server.host.game.tick();
        savedTick = world.tick;
      }
    } finally { server.stop(); }
  }
  return { map: entry.id, hash: head.hash, checkedParts: parts.length, saveId, savedTick, reopenedTick, dbBytes: statSync(dbPath).size };
}

if (import.meta.main) {
  const [folder, saves, clientDir] = process.argv.slice(2);
  if (!folder || !saves) throw new Error("Usage: bun tools/mapworld/verify-worlds.ts <release-directory> <new-save-directory> [built-client-directory]");
  const { maps } = JSON.parse(readFileSync(join(folder, "release.json"), "utf8")) as { maps: Package[] };
  if (!maps.length || new Set(maps.map(m => m.file)).size !== maps.length) throw new Error("Release must contain distinct map packages");
  mkdirSync(resolve(saves)); // An existing save directory is never opened as a fresh verification target.
  const results = [];
  for (const entry of maps) {
    const result = await verifyWorld(folder, saves, entry, clientDir);
    results.push(result); console.log(JSON.stringify(result));
    Bun.gc(true);
  }
  writeFileSync(join(saves, "verification.json"), JSON.stringify(results, null, 2) + "\n");
}
