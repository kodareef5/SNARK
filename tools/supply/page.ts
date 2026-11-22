// The drop book's admin page, served to look at (planning/workstreams/supply.md): builds the page alone (not the game's
// client), starts a development world, and prints where the page is. With --shots it pictures each view in Chrome
// into var/supply/page/ and stops. With --drive it works the page in Chrome as an admin would (tools/supply/drive.ts:
// a circuit switched off and one taken out, a site dragged, the simulator, an ARK paste, a revision brought back),
// judges each by the book the server then holds, and stops with a fault if any went wrong.
//
//   bun tools/supply/page.ts [--port 8790] [--shots] [--drive] [--map <file.snmap>]

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startServer } from "../../server/main.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { splitPack } from "../pack/split.ts";
import { drive } from "./drive.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({ options: { port: { type: "string", default: "8790" }, shots: { type: "boolean" }, drive: { type: "boolean" }, map: { type: "string" } } });
const dist = join(ROOT, "var/supply/page");
mkdirSync(join(dist, "admin"), { recursive: true });
mkdirSync(join(dist, "assets"), { recursive: true });
// A built client as far as a world needs one to start: the manifest and the files it names, without the meshes.
const { files, manifest } = splitPack(corePackBytes(), "core");
for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dist, "assets", manifest.files[f]!.name), file.bytes);
writeFileSync(join(dist, "assets/manifest.json"), JSON.stringify(manifest));
const built = await Bun.build({ entrypoints: [join(ROOT, "client/drops/drops.ts")], outdir: join(dist, "admin"), naming: "[name].[ext]", target: "browser", sourcemap: "linked" });
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
writeFileSync(join(dist, "admin/drops.html"), readFileSync(join(ROOT, "client/drops/drops.html"), "utf8"));
// Driven, the world has a save of its own in a folder that is thrown away, so that its book is a file with a history,
// as a real world's is, and what the page says when that history cannot be written can be seen.
const kept = values.drive ? mkdtempSync(join(tmpdir(), "snark-drops-world-")) : null;
const server = startServer({ port: Number(values.port), clientDir: dist, dev: true, ...(kept ? { dbPath: join(kept, "world.db") } : {}), ...(values.map ? { map: resolve(values.map) } : {}) });
const at = `http://127.0.0.1:${server.port}/admin/drops.html`;
console.log(`the drops page: ${at}`);
if (values.drive) {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome to drive the page in");
  const faults = await drive(chrome, at, server.host, join(kept!, "world.db.supply.json"));
  console.log(faults.length === 0 ? "the page did all that was asked of it" : `${faults.length} things went wrong:\n${faults.map((f) => `  ${f}`).join("\n")}`);
  server.stop();
  rmSync(kept!, { recursive: true, force: true });
  process.exit(faults.length === 0 ? 0 : 1);
}
if (values.shots) {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome to picture the page in");
  // A drop to see in the live views.
  server.host.console.exec({ host: server.host, client: null }, `supply call ${(server.host.world.hf.sizeX / 2).toFixed(0)} ${(server.host.world.hf.sizeZ / 2).toFixed(0)} blue arms ringed`);
  const views = (process.env.PAGE_VIEWS ?? "tables,tables/blue/voyage,tables/white/arms/edit,waiting,sim/purple/arms,tiers,map,circuits,live,ark").split(",");
  for (const view of views) {
    const out = join(dist, `${view.replace(/\//g, "-")}.png`);
    const run = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--hide-scrollbars", "--no-first-run", "--disable-extensions", "--window-size=1500,1300", "--virtual-time-budget=6000", `--screenshot=${out}`, `${at}#${view}`], { stdout: "ignore", stderr: "ignore" });
    await run.exited;
    console.log(`  ${out}`);
  }
  server.stop();
  process.exit(0);
}
