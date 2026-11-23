// The debug bar's route on real sockets (server/debug.ts), through the front as the owner's tunnel brings it: anyone is
// given the protocol's names; an admin's session is given the server's log lines after its cursor, the lines of the
// server's start among them, and the server's state; a session that is not an admin's and a token the server does not
// know are refused.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { ClientSession } from "../../client/core/session.ts";
import { PARTS } from "../../server/admin/parts.ts";
import { frontPasses, startFront } from "../../server/front.ts";
import { startServer } from "../../server/main.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { LEVEL_INFO, LEVEL_WARN, codeNames, type DebugAnswer } from "../../shared/debug.ts";
import * as P from "../../shared/net/protocol.ts";
import type { Connection } from "../../shared/net/transport.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { testKey } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

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

const hex = (b: Uint8Array): string => Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");

test("__debug names the codes for anyone and gives only an admin the log and state", async () => {
  const saves = mkdtempSync(join(tmpdir(), "snark-debug-"));
  const dir = join(saves, "client");
  mkdirSync(join(dir, "assets"), { recursive: true });
  const { files, manifest } = splitPack(corePackBytes(), "core");
  for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
  writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
  // A client built from other source, which the server says as it starts.
  writeFileSync(join(dir, "build.json"), JSON.stringify({ wire: 1 }));
  const [log, warn] = [console.log, console.warn];
  console.log = console.warn = () => {};
  const config = loadConfig({}, ["-clusterid=debug", `-ClusterDirOverride=${saves}`, "?SessionName=Miami?CreativeForAll=False"]).rules;
  const world = startServer({ port: 0, clientDir: dir, dev: true, publicUrl: "/miami", dbPath: join(saves, "miami.db"), noBackups: true, config });
  const front = startFront(join(saves, "debug"), 0, "127.0.0.1");
  const tunnel = { host: "ensure-please.trycloudflare.com", "x-forwarded-for": "203.0.113.7" };
  const at = `http://127.0.0.1:${front.port}/miami/__debug`;
  let session: ClientSession | null = null;
  try {
    expect([frontPasses("POST", "/miami/__debug"), frontPasses("PUT", "/miami/__debug")]).toEqual([true, false]);
    for (let k = 0; k < 200 && (await fetch(at, { headers: tunnel })).status === 503; k++) await Bun.sleep(50);
    const names = await fetch(at, { headers: tunnel });
    expect([names.status, await names.json()]).toEqual([200, { names: codeNames(P) }]);
    expect((await fetch(`http://127.0.0.1:${world.port}/miami/__debug`, { method: "PUT" })).status).toBe(405);

    const map = parseMap(world.host.mapFile!), hf = mapHeightfield(map);
    session = new ClientSession(socket(`ws://127.0.0.1:${world.port}/miami/ws`), {
      name: "ada", key: testKey("ada"), registry: compileContent(CORE_CONTENT).registry!, clipHash: world.host.world.anim.set.hash, look: defaultLook(),
      resolveMap: (id, hash) => (id === map.id && hash === map.hash ? hf : null),
    });
    const s = session;
    const settle = async (done: () => boolean): Promise<void> => {
      for (let k = 0; k < 300 && !done(); k++) {
        s.update(performance.now(), 0, 0, 0, 0, 0);
        await Bun.sleep(10);
      }
    };
    await settle(() => s.state === "active" && s.voice.version !== 0);
    const token = `${s.voice.slot}:${hex(s.voice.token)}`;
    const ask = async (fields: Record<string, string>, form = true): Promise<[number, string]> => {
      const body = form ? new FormData() : new URLSearchParams();
      for (const [k, v] of Object.entries(fields)) body.set(k, v);
      const r = await fetch(at, { method: "POST", headers: tunnel, body });
      return [r.status, await r.text()];
    };
    expect(await ask({ token, since: "0" })).toEqual([403, "the server's log is an admin's: enablecheats first"]);
    expect((await ask({ token: `${s.voice.slot}:${"00".repeat(8)}`, since: "0" }))[0]).toBe(403);
    expect((await ask({ token: "ada" }))[0]).toBe(403);

    s.text("enablecheats");
    await settle(() => s.admin);
    expect(s.admin).toBe(true);
    // The line of the start was kept from before there was a world.
    const all = JSON.parse((await ask({ token }))[1]) as DebugAnswer;
    expect(all.lines.find((l) => l.text.includes("was built from other source"))).toMatchObject({ tick: 0, level: LEVEL_INFO });

    const cursor = world.log.last;
    console.log("a line after the cursor");
    console.warn("and a warning");
    const [status, text] = await ask({ token, since: String(cursor) });
    expect(status).toBe(200);
    const answer = JSON.parse(text) as DebugAnswer;
    const mine = answer.lines.filter((l) => l.text === "a line after the cursor" || l.text === "and a warning");
    expect(mine.map((l) => l.level)).toEqual([LEVEL_INFO, LEVEL_WARN]);
    expect(answer.lines.every((l) => l.seq > cursor && l.tick > 0)).toBe(true);
    expect(answer.next).toBe(answer.lines.at(-1)!.seq);
    const server = answer.server;
    expect([server.world.name, server.world.map, server.world.dev, server.survivor !== null, server.connection.sent > 0, server.bodies.count > 0, server.memory.rss > 0]).toEqual(["Miami", world.host.world.mapId, true, true, true, true, true]);
    expect([server.ticks.ran > 0, Array.isArray(server.ticks.seconds.p50), Array.isArray(server.long)]).toEqual([true, true, true]);
    expect([server.parts.names, server.parts.all.length, server.parts.ticks > 0, server.parts.limit]).toEqual([[...PARTS], PARTS.length, true, 1000 / TICK_RATE]);

    // Asked again from where it left off: nothing old, and the parts counted since.
    await Bun.sleep(100);
    const again = JSON.parse((await ask({ token, since: String(answer.next) }, false))[1]) as DebugAnswer;
    expect(again.lines.some((l) => l.seq <= answer.next)).toBe(false);
    expect(again.server.parts.ticks).toBeGreaterThan(server.parts.ticks);
    // A cursor past the last line is from an earlier run of the server, which is given the whole log.
    const restarted = JSON.parse((await ask({ token, since: "999999" }))[1]) as DebugAnswer;
    expect(restarted.lines[0]!.seq).toBe(1);
    expect((await ask({ token, since: "x" }))[0]).toBe(400);
    expect((await ask({ token, since: "0", pad: "x".repeat(5000) }))[0]).toBe(413);
  } finally {
    [console.log, console.warn] = [log, warn];
    if (session?.state !== "closed") session?.close();
    front.stop();
    world.stop();
    rmSync(saves, { recursive: true, force: true });
  }
});
