// The loadouts' admin page alone, served from a development world with no wild creatures (planning/workstreams/loadouts.md).
// --shots pictures it into var/loadout/page/; --drive works it in Chrome and fails on any fault (tools/loadout/drive.ts).
//
//   bun tools/loadout/page.ts [--port 8791] [--shots] [--drive]

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startServer } from "../../server/main.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { Rules } from "../../server/settings/rules.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { findChrome } from "../chrome.ts";
import { splitPack } from "../pack/split.ts";
import { drive, journalFaults, shots } from "./drive.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({ options: { port: { type: "string", default: "8791" }, shots: { type: "boolean" }, drive: { type: "boolean" } } });
const dist = join(ROOT, "var/loadout/page");
mkdirSync(join(dist, "admin"), { recursive: true });
mkdirSync(join(dist, "assets"), { recursive: true });
// A built client as far as a world needs one to start: the manifest and the files it names, without the meshes.
const { files, manifest } = splitPack(corePackBytes(), "core");
for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dist, "assets", manifest.files[f]!.name), file.bytes);
writeFileSync(join(dist, "assets/manifest.json"), JSON.stringify(manifest));
const built = await Bun.build({ entrypoints: [join(ROOT, "client/admin/loadouts.ts")], outdir: join(dist, "admin"), naming: "[name].[ext]", target: "browser", sourcemap: "linked" });
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
writeFileSync(join(dist, "admin/loadouts.html"), readFileSync(join(ROOT, "client/admin/loadouts.html"), "utf8"));
// The save is in a folder under var/ that is thrown away, so the book is a file. Chrome's profile goes there too: /tmp is small.
const kept = values.drive || values.shots ? mkdtempSync(join(ROOT, "var/loadout/world-")) : null;
// No wild creature is put in: a survivor the drive stands in the world is not to be eaten while the page is worked.
const config = new Rules();
const refused = config.set(rowOf("NoDinos", true)!, "True", "command line");
if (refused !== "") throw new Error(refused);
const dbPath = kept ? join(kept, "world.db") : null;
const server = startServer({ port: Number(values.port), clientDir: dist, dev: true, config, ...(dbPath ? { dbPath, noBackups: true } : {}) });
const at = `http://127.0.0.1:${server.port}/admin/loadouts.html`;
const socket = `ws://127.0.0.1:${server.port}/ws`;
console.log(`the loadouts page: ${at}`);
if (values.drive || values.shots) {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome to work the page in");
  let faults: string[];
  try {
    if (values.drive) {
      const drove = await drive(chrome, at, server.host, socket, `${dbPath!}.loadouts.json`, kept!);
      server.stop();
      // What the page did is in the admin journal, which is read once the world has stopped and written it.
      faults = [...drove.faults, ...journalFaults(dbPath!, server.host.world.reg, drove.journal)];
      console.log(faults.length === 0 ? "the page did all that was asked of it" : `${faults.length} things went wrong:\n${faults.map((f) => `  ${f}`).join("\n")}`);
    } else {
      faults = await shots(chrome, at, server.host, socket, dist, kept!);
      server.stop();
    }
  } finally {
    rmSync(kept!, { recursive: true, force: true });
  }
  process.exit(faults.length === 0 ? 0 : 1);
}
