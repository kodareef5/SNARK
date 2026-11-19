// A worker that runs the real server on a port of its own, its loop on the real clock, and makes the ticks it is told
// take as long as it is told by waiting busily, as a tick that runs long does: the socket is not read meanwhile. It keeps,
// for each tick, how far behind its clock the loop was, whether the one client's input for it was there, and the margin
// its snapshot told.
//
// Posted { stalls: [tick, ms][] } it starts and posts { port, map, clip }. Posted "report" it posts { rows } and stops.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "../../server/main.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { corePackBytes } from "./pack.ts";

declare const self: Worker;

/** A tick, how many more were due as it began, 1 if the client's input for it was there, and the margin told against the tick due. */
export type StallRow = [tick: number, behind: number, had: number, margin: number];

let server: RunningServer | null = null;
let dir = "";
const rows: StallRow[] = [];

self.onmessage = (e: MessageEvent) => {
  if (e.data === "report") {
    server?.stop();
    rmSync(dir, { recursive: true, force: true });
    self.postMessage({ rows });
    return;
  }
  const stalls = new Map<number, number>(e.data.stalls);
  dir = mkdtempSync(join(tmpdir(), "snark-stall-"));
  mkdirSync(join(dir, "assets"));
  const { files, manifest } = splitPack(corePackBytes(), "core");
  for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
  writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
  console.log = () => {};
  server = startServer({ port: 0, hostname: "127.0.0.1", clientDir: dir });
  const game = server.host.game;
  const tick = game.tick.bind(game);
  game.tick = () => {
    const T = game.world.tick + 1;
    const c = game.clients.find((x) => x?.active);
    const had = c ? c.inputs.has(T) : true;
    tick();
    if (c && c.newestInput > 0) rows.push([T, game.behind, had ? 1 : 0, c.newestInput - T - game.behind]);
    const ms = stalls.get(T);
    if (ms) for (const end = performance.now() + ms; performance.now() < end; );
  };
  self.postMessage({ port: server.port, map: server.host.mapFile, clip: game.world.anim.set.hash });
};
