// The record of play on real sockets: a development world takes its page's reports as the owner's tunnel and the front
// bring them, from a host and an address that are not this machine's, and writes each beside its own view.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { ClientSession } from "../../client/core/session.ts";
import { startFront } from "../../server/front.ts";
import { startServer } from "../../server/main.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import type { Connection } from "../../shared/net/transport.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { testKey } from "../fixtures/net.ts";

/** A WebSocket as a Connection, a channel byte before each message, as the page's own (client/shell/socket.ts). */
function socket(url: string): Connection {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const early: Uint8Array[] = [];
  const conn: Connection & { open: boolean } = {
    open: true,
    onMessage: null,
    onClose: null,
    send(channel, data) {
      const frame = new Uint8Array(data.length + 1);
      frame[0] = channel;
      frame.set(data, 1);
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      else early.push(frame);
    },
    close: () => ws.close(),
  };
  ws.onopen = () => early.splice(0).forEach((f) => ws.send(f));
  ws.onmessage = (e) => {
    const bytes = new Uint8Array(e.data as ArrayBuffer);
    if (bytes.length > 0) conn.onMessage?.(bytes[0]!, bytes.subarray(1));
  };
  ws.onclose = () => ((conn.open = false), conn.onClose?.());
  return conn;
}

test("a development world takes its page's record of play through the front from a tunnel's host and address and writes it; a world not for development keeps none", async () => {
  const saves = mkdtempSync(join(tmpdir(), "snark-play-"));
  const dir = join(saves, "client"), record = join(saves, "record");
  mkdirSync(join(dir, "assets"), { recursive: true });
  const { files, manifest } = splitPack(corePackBytes(), "core");
  for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
  writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
  const log = console.log;
  console.log = () => {};
  const config = loadConfig({}, ["-clusterid=play", `-ClusterDirOverride=${saves}`, "?SessionName=Miami"]).rules;
  const world = startServer({ port: 0, clientDir: dir, dev: true, play: record, publicUrl: "/miami", dbPath: join(saves, "miami.db"), noBackups: true, config });
  const plain = startServer({ port: 0, clientDir: dir, play: record });
  const front = startFront(join(saves, "play"), 0, "127.0.0.1");
  // As the tunnel's connector on this machine passes a page's request on to the front.
  const tunnel = { host: "ensure-please.trycloudflare.com", "x-forwarded-for": "203.0.113.7" };
  const at = `http://127.0.0.1:${front.port}/miami/__play`;
  let session: ClientSession | null = null;
  try {
    expect((await fetch(at, { headers: tunnel })).status).toBe(204);
    expect((await fetch(`http://127.0.0.1:${plain.port}/__play`)).status).toBe(404);
    expect((await fetch(at, { method: "POST", headers: tunnel, body: "not a report" })).status).toBe(422);

    const map = parseMap(world.host.mapFile!), hf = mapHeightfield(map);
    session = new ClientSession(socket(`ws://127.0.0.1:${world.port}/miami/ws`), {
      name: "ada", key: testKey("ada"), registry: compileContent(CORE_CONTENT).registry!, clipHash: world.host.world.anim.set.hash, look: defaultLook(),
      resolveMap: (id, hash) => (id === map.id && hash === map.hash ? hf : null),
    });
    const posted: Promise<number>[] = [];
    session.prediction.start((report) => void posted.push(fetch(at, { method: "POST", headers: tunnel, body: report }).then((r) => r.status)));
    for (let k = 0; k < 300 && session.state !== "active"; k++) await Bun.sleep(10);
    for (let k = 0; k < 60; k++) {
      session.update(performance.now(), 0, 1, 0, 0, 0);
      await Bun.sleep(16);
    }
    // Its last report goes as it leaves, and is written though the session is gone by the time it comes.
    session.close();
    expect(posted.length).toBe(1);
    expect(await posted[0]).toBe(204);
    const written = (): string[] => (existsSync(record) ? readdirSync(record).flatMap((f) => readFileSync(join(record, f), "utf8").split("\n").filter(Boolean)) : []);
    for (let k = 0; k < 200 && written().length === 0; k++) await Bun.sleep(10);
    const lines = written().map((l) => JSON.parse(l) as { page: { name: string; ticks: number }; server: { ticks: number; snapshots: number } });
    expect(lines.length).toBe(1);
    expect([lines[0]!.page.name, lines[0]!.page.ticks > 0, lines[0]!.server.ticks > 0, lines[0]!.server.snapshots > 0]).toEqual(["ada", true, true, true]);
  } finally {
    console.log = log;
    if (session?.state !== "closed") session?.close();
    front.stop();
    world.stop();
    plain.stop();
    rmSync(saves, { recursive: true, force: true });
  }
});
