// The events page alone, served from a development world with the game's own modules (planning/workstreams/map-events.md).
// --shots pictures each view into var/mapevent/page/; --drive works it in Chrome and fails on any fault (drive.ts).
//
//   bun tools/mapevent/page.ts [--port 8792] [--shots] [--drive]

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildAdmin } from "../build-admin.ts";
import { loadModules, startServer } from "../../server/main.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { Rules } from "../../server/settings/rules.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { findChrome } from "../chrome.ts";
import { splitPack } from "../pack/split.ts";
import { drive, shots } from "./drive.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({ options: { port: { type: "string", default: "8792" }, shots: { type: "boolean" }, drive: { type: "boolean" } } });
const dist = join(ROOT, "var/mapevent/page");
mkdirSync(join(dist, "admin"), { recursive: true });
mkdirSync(join(dist, "assets"), { recursive: true });
// A built client as far as a world needs one to start: the manifest and the files it names, without the meshes.
const { files, manifest } = splitPack(corePackBytes(), "core");
for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dist, "assets", manifest.files[f]!.name), file.bytes);
writeFileSync(join(dist, "assets/manifest.json"), JSON.stringify(manifest));
await buildAdmin(dist);
// The save is in a folder under var/ that is thrown away, so the book is a file. Chrome's profile goes there too.
const kept = values.drive || values.shots ? mkdtempSync(join(ROOT, "var/mapevent/world-")) : null;
const config = new Rules();
const refused = config.set(rowOf("NoDinos", true)!, "True", "command line");
if (refused !== "") throw new Error(refused);
const dbPath = kept ? join(kept, "world.db") : null;
const modules = await loadModules([], "");
const server = startServer({ port: Number(values.port), clientDir: dist, dev: true, config, modules, ...(dbPath ? { dbPath, noBackups: true } : {}) });
const at = `http://127.0.0.1:${server.port}/admin/worlds/local/events/`;
console.log(`the events page: ${at}`);
if (values.drive || values.shots) {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome to work the page in");
  let faults: string[];
  try {
    faults = values.drive ? await drive(chrome, at, server.host, kept!) : await shots(chrome, at, server.host, dist, kept!);
  } finally {
    server.stop();
    rmSync(kept!, { recursive: true, force: true });
  }
  console.log(faults.length === 0 ? "the page did all that was asked of it" : `${faults.length} things went wrong:\n${faults.map((f) => `  ${f}`).join("\n")}`);
  process.exit(faults.length === 0 ? 0 : 1);
}
