// The Permissions page, the Admin log and the dashboard's sign-in, served by a world that is not a development server, with
// a map password and a cluster password of its own making (planning/workstreams/permissions.md). --drive works the pages in
// Chrome signed in as a person is and fails on any fault; --shots pictures them into var/permissions/page/shots/.
//
//   bun tools/permissions/page.ts [--port 8793] [--shots] [--drive]

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildAdmin } from "../build-admin.ts";
import { startServer } from "../../server/main.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { Rules } from "../../server/settings/rules.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { findChrome } from "../chrome.ts";
import { splitPack } from "../pack/split.ts";
import { drive } from "./drive.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({ options: { port: { type: "string", default: "8793" }, shots: { type: "boolean" }, drive: { type: "boolean" } } });
const dist = join(ROOT, "var/permissions/page");
mkdirSync(join(dist, "admin"), { recursive: true });
mkdirSync(join(dist, "assets"), { recursive: true });
// A built client as far as a world needs one to start: the manifest and the files it names, without the meshes.
const { files, manifest } = splitPack(corePackBytes(), "core");
for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dist, "assets", manifest.files[f]!.name), file.bytes);
writeFileSync(join(dist, "assets/manifest.json"), JSON.stringify(manifest));
await buildAdmin(dist);
const config = new Rules();
// Nobody has cheats from the start, and no wild creature eats a survivor while the pages are worked.
for (const [key, flag, value] of [["CreativeForAll", false, "False"], ["NoDinos", true, "True"]] as const) {
  const refused = config.set(rowOf(key, flag)!, value, "command line");
  if (refused !== "") throw new Error(refused);
}
// Made here and never printed: the drive signs in with them as a person types them.
const secret = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url");
const passwords = { map: secret(), cluster: secret() };
// The save, its permissions file and Chrome's profiles are in a folder under var/ that is thrown away.
const kept = mkdtempSync(join(ROOT, "var/permissions/world-"));
const dbPath = join(kept, "world.db");
const server = startServer({ port: Number(values.port), clientDir: dist, adminPassword: passwords.map, clusterPassword: passwords.cluster, config, dbPath, noBackups: true });
const origin = `http://127.0.0.1:${server.port}`;
console.log(`the permissions page: ${origin}/admin/permissions/`);
let code = 0;
if (values.drive || values.shots) {
  try {
    const chrome = findChrome();
    if (!chrome) throw new Error("no Chrome to work the pages in");
    const shots = values.shots ? join(dist, "shots") : null;
    if (shots) mkdirSync(shots, { recursive: true });
    const faults = await drive({ chrome, origin, host: server.host, socket: `ws://127.0.0.1:${server.port}/ws`, passwords, scratch: kept, shots });
    console.log(faults.length === 0 ? "the pages did all that was asked of them" : `${faults.length} things went wrong:\n${faults.map((f) => `  ${f}`).join("\n")}`);
    code = faults.length === 0 ? 0 : 1;
  } catch (err) {
    console.log(`FAIL ${err instanceof Error ? err.stack : String(err)}`);
    code = 1;
  } finally {
    server.stop();
    rmSync(kept, { recursive: true, force: true });
  }
  process.exit(code);
}
// Served to look at, the world's save goes when it is stopped.
process.on("SIGINT", () => {
  server.stop();
  rmSync(kept, { recursive: true, force: true });
  process.exit(0);
});
