// Bug reports on real sockets (server/reports.ts): a world that keeps notes takes one from an admin's session, through
// the front as the owner's tunnel brings it, finds the session by its voice token, names every file itself and writes the
// report's folder; it refuses one from a session that is not an admin's, a token it does not know, a picture that is not
// a JPEG, and a world that keeps none says so.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { ClientSession } from "../../client/core/session.ts";
import { frontPasses, startFront } from "../../server/front.ts";
import { startServer } from "../../server/main.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import type { Connection } from "../../shared/net/transport.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { jpegHead } from "../fixtures/jpeg.ts";
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

const hex = (b: Uint8Array): string => Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");

test("a world that keeps notes takes one from an admin's session through the front, and names, checks and writes every file itself", async () => {
  const saves = mkdtempSync(join(tmpdir(), "snark-report-"));
  const dir = join(saves, "client"), reports = join(saves, "reports");
  mkdirSync(join(dir, "assets"), { recursive: true });
  const { files, manifest } = splitPack(corePackBytes(), "core");
  for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
  writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "build.json"), JSON.stringify({ commit: "c0ffee", clean: true, at: "2026-11-22T00:00:00Z" }));
  writeFileSync(join(dir, "first-frame.json"), JSON.stringify({ total: 1080 }));
  const log = console.log;
  console.log = () => {};
  const config = loadConfig({}, ["-clusterid=notes", `-ClusterDirOverride=${saves}`, "?SessionName=Miami?CreativeForAll=False"]).rules;
  const world = startServer({ port: 0, clientDir: dir, dev: true, reports, publicUrl: "/miami", dbPath: join(saves, "miami.db"), noBackups: true, config });
  const plain = startServer({ port: 0, clientDir: dir });
  const front = startFront(join(saves, "notes"), 0, "127.0.0.1");
  const tunnel = { host: "ensure-please.trycloudflare.com", "x-forwarded-for": "203.0.113.7" };
  const at = `http://127.0.0.1:${front.port}/miami/__report`;
  let session: ClientSession | null = null;
  try {
    expect(frontPasses("POST", "/miami/__report")).toBe(true);
    for (let k = 0; k < 200 && (await fetch(at, { headers: tunnel })).status === 503; k++) await Bun.sleep(50);
    expect((await fetch(at, { headers: tunnel })).status).toBe(204);
    // The build's weighing of the first frame is the admin pages' to show (server/admin/routes.ts).
    expect(await (await fetch(`http://127.0.0.1:${world.port}/miami/admin/first-frame.json`)).json()).toEqual({ total: 1080 });
    const none = await fetch(`http://127.0.0.1:${plain.port}/__report`);
    expect([none.status, (await none.text()).includes("--reports")]).toEqual([404, true]);

    const map = parseMap(world.host.mapFile!), hf = mapHeightfield(map);
    session = new ClientSession(socket(`ws://127.0.0.1:${world.port}/miami/ws`), {
      name: "ada", key: testKey("ada"), registry: compileContent(CORE_CONTENT).registry!, clipHash: world.host.world.anim.set.hash, look: defaultLook(),
      resolveMap: (id, hash) => (id === map.id && hash === map.hash ? hf : null),
    });
    for (let k = 0; k < 300 && (session.state !== "active" || session.voice.version === 0); k++) {
      session.update(performance.now(), 0, 0, 0, 0, 0);
      await Bun.sleep(10);
    }
    const token = `${session.voice.slot}:${hex(session.voice.token)}`;
    const report = { version: 1, kind: "note", ms: 3200, place: { x: 100, y: 2, z: 200 }, shots: [{ at: 0, w: 1, h: 1 }, { at: 3000 }], text: [{ at: 1000, line: "the kerb floats here" }], extra: "not kept" };
    const form = (over: { token?: string; shots?: Uint8Array[] } = {}): FormData => {
      const f = new FormData();
      f.set("token", over.token ?? token);
      f.set("report", JSON.stringify(report));
      for (const s of over.shots ?? [jpegHead(1920, 1080), jpegHead(1920, 1080)]) f.append("shot", new Blob([s], { type: "image/jpeg" }), "x.jpg");
      f.set("thumb", new Blob([jpegHead(320, 180)], { type: "image/jpeg" }), "t.jpg");
      f.set("perf", JSON.stringify({ version: 1, fields: ["at", "interval"], frames: [[0, 16.6]], summary: { frames: 1, middle: 16.6 } }));
      return f;
    };
    const post = async (body: FormData): Promise<[number, string]> => {
      const r = await fetch(at, { method: "POST", headers: tunnel, body });
      return [r.status, await r.text()];
    };
    expect(await post(form())).toEqual([403, "notes are an admin's: enablecheats first"]);
    expect((await post(form({ token: `${session.voice.slot}:${"00".repeat(8)}` })))[0]).toBe(403);
    session.text("enablecheats");
    for (let k = 0; k < 300 && !session.admin; k++) {
      session.update(performance.now(), 0, 0, 0, 0, 0);
      await Bun.sleep(10);
    }
    expect(session.admin).toBe(true);
    expect(await post(form({ shots: [jpegHead(1920, 1080), new TextEncoder().encode("<b>not a picture</b>")] }))).toEqual([422, "picture 2 is not a JPEG"]);
    expect((await post(form({ shots: [jpegHead(4000, 2000), jpegHead(1920, 1080)] })))[0]).toBe(422);
    // Refused ones take no id.
    expect(existsSync(reports) ? readdirSync(reports) : []).toEqual([]);
    const [status, answer] = await post(form());
    expect([status, JSON.parse(answer)]).toEqual([200, { id: 1, folder: "0001", pictures: 2 }]);
    const folder = join(reports, "0001");
    expect(readdirSync(folder).sort()).toEqual(["perf.json", "report.json", "report.md", "server.json", "shot-01.jpg", "shot-02.jpg", "state.json", "thumb.jpg"]);
    const kept = JSON.parse(readFileSync(join(folder, "report.json"), "utf8"));
    expect([kept.id, kept.who, kept.kind, kept.extra, kept.shots[0].w, kept.shots[1].h, kept.client.served.commit]).toEqual([1, "ada", "note", undefined, 1920, 1080, "c0ffee"]);
    expect(kept.voice).toEqual({ file: null, text: null, segments: [] });
    expect(kept.go.run).toEqual(["enablecheats", "tp 100.00 2.00 200.00"]);
    const server = JSON.parse(readFileSync(join(folder, "server.json"), "utf8"));
    expect([server.world.map, typeof server.ticks.seconds.p50.length, server.bodies.count > 0, typeof server.memory.rss, server.survivor !== null]).toEqual([world.host.world.mapId, "number", true, "number", true]);
    expect(JSON.parse(readFileSync(join(folder, "state.json"), "utf8")).status).toBe("open");
    expect(readFileSync(join(folder, "report.md"), "utf8")).toContain('typed "the kerb floats here"');
    // The next takes the next id.
    expect(JSON.parse((await post(form()))[1]).id).toBe(2);
  } finally {
    console.log = log;
    if (session?.state !== "closed") session?.close();
    front.stop();
    world.stop();
    plain.stop();
    rmSync(saves, { recursive: true, force: true });
  }
});
