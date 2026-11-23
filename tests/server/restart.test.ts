// A stop for an update, said by the server (S_RESTART): every session is told, one who joins during the countdown too,
// the stop comes at its second, and only a session that was told nothing takes itself for lost.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientSession, CLOSED_BY_PEER } from "../../client/core/session.ts";
import { verdict, type Comeback } from "../../client/core/waiting.ts";
import { connect } from "../../agent/socket.ts";
import { stopAnswer } from "../../server/admin/stop.ts";
import { OP_ADMIN } from "../../server/console.ts";
import { startServer } from "../../server/main.ts";
import { stopOnSignals } from "../../server/signals.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { REJECT_KICKED, RESTART_GO } from "../../shared/net/protocol.ts";
import type { Ready } from "../../shared/ready.ts";
import { mapHeightfield, mapNodes, parseMap } from "../../shared/world/mapfile.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { Harness, testKey } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-restart-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a stop said ahead reaches every session and whoever joins meanwhile, counts down in the chat, and comes at its second", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  // A host nothing can stop refuses, and says why.
  expect(h.host.stopIn(30)).toMatch(/not started in a way that can stop itself/);
  let stops = 0;
  h.host.onStop = () => void stops++;
  expect([h.host.stopLeft, ada.restartAt]).toEqual([-1, 0]);
  const told: boolean[] = [];
  ada.onRestart = (go) => void told.push(go);

  const before = Date.now();
  expect(h.host.stopIn(30)).toBe("");
  h.run(300);
  expect(h.host.stopLeft).toBe(30);
  expect(ada.restartAt - before).toBeGreaterThan(29_000);
  expect(ada.restartAt - before).toBeLessThan(32_000);
  expect([told, ada.leaving]).toEqual([[false], false]);
  expect(ada.log.map((l) => l.text)).toContain("The server restarts in 30 s for an update. Stay on this page and you will be brought back.");
  // One who joins during the countdown is told what is left of it.
  h.run(9700);
  const bob = h.join("bob");
  h.run(500);
  // Twenty of the thirty seconds are left. The harness's ten went by in a moment of the wall's clock, which a page counts by.
  expect(Math.round((bob.restartAt - Date.now()) / 1000)).toBeGreaterThanOrEqual(19);
  expect(Math.round((bob.restartAt - Date.now()) / 1000)).toBeLessThanOrEqual(21);
  expect([h.host.stopCancel(), h.host.stopCancel()]).toEqual([true, false]);
  h.run(300);
  expect([ada.restartAt, bob.restartAt, h.host.stopLeft, stops]).toEqual([0, 0, -1, 0]);
  expect(ada.log.map((l) => l.text)).toContain("The server will not restart after all.");

  // Said again by an admin at the console, it comes at its second, once, with the last ten counted in the chat.
  h.say(ada, "enablecheats");
  expect(h.say(ada, "doexit soon")).toEqual(["usage: doexit [seconds | cancel]"]);
  expect(h.say(ada, "doexit 12", 100)).toContain("the server stops in 12 s");
  h.run(11_000);
  expect(stops).toBe(0);
  h.run(1500);
  expect([stops, h.host.stopLeft]).toEqual([1, -1]);
  for (const s of [10, 5, 1]) expect(ada.log.map((l) => l.text)).toContain(`The server restarts in ${s} s. Stay on this page and you will be brought back.`);
  expect(h.say(ada, "doexit cancel")).toEqual(["no stop was set"]);
  expect([h.host.stopIn(-1), h.host.stopIn(1e9)].every((why) => /from 0 to 86400 seconds/.test(why))).toBe(true);
  h.host.shutdown();
});

test("a page told to go is leaving, not lost; one whose line drops is lost; one that is kicked is neither", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const [ada, bob, cy] = [h.join("ada"), h.join("bob"), h.join("cy")];
  h.run(500);
  const heard: string[] = [];
  for (const [name, s] of [["ada", ada], ["bob", bob], ["cy", cy]] as const) {
    s.onRestart = (go) => void heard.push(`${name} ${go ? "go" : "told"}`);
    s.onLost = () => void heard.push(`${name} lost`);
  }
  // "Go" to one, as the server sends it to all before it stops, and then its socket closes.
  h.server.sendRestart(RESTART_GO, h.client(ada)!);
  h.run(200);
  expect([ada.leaving, ada.state]).toEqual([true, "active"]);
  h.ends[0]!.close();
  // Another's line simply drops.
  h.ends[1]!.close();
  // A third is put out by an admin.
  h.server.sessions.reject(h.client(cy)!, REJECT_KICKED);
  h.run(400);
  expect(heard).toEqual(["ada go", "bob lost"]);
  expect([ada.state, ada.lost, ada.closeReason]).toEqual(["closed", false, CLOSED_BY_PEER]);
  expect([bob.state, bob.lost, bob.closeReason]).toEqual(["closed", true, CLOSED_BY_PEER]);
  expect([cy.state, cy.lost, cy.leaving, cy.closeReason]).toEqual(["closed", false, false, REJECT_KICKED]);
  h.host.shutdown();
});

test("the admin page sets a stop and takes it back, from this server's own page alone, and it is in the admin journal", async () => {
  const dbPath = join(dir, "stop.db");
  const h = new Harness({}, 1, 60, { dev: true, dbPath });
  h.host.onStop = () => {};
  const at = "http://localhost";
  const post = async (body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; answer: { ok: boolean; why: string; left: number } }> => {
    const r = await stopAnswer(h.host, new Request(`${at}/admin/stop`, { method: "POST", headers: { "content-type": "application/json", origin: at, host: "localhost", ...headers }, body: JSON.stringify(body) }), "/admin/stop")!;
    return { status: r.status, answer: r.status === 200 || r.status === 400 ? ((await r.json()) as { ok: boolean; why: string; left: number }) : { ok: false, why: "", left: -1 } };
  };
  expect(stopAnswer(h.host, new Request(`${at}/admin/stats.json`), "/admin/stats.json")).toBeNull();
  expect((await post({ seconds: 90 }, { origin: "http://elsewhere" })).status).toBe(403);
  expect((await post({ seconds: "soon" })).answer).toMatchObject({ ok: false, left: -1 });
  expect((await post({ cancel: true })).answer).toMatchObject({ ok: false, why: "No stop was set." });
  expect(await post({ seconds: 90 })).toEqual({ status: 200, answer: { ok: true, why: "", left: 90 } });
  expect((await post({ cancel: true })).answer).toEqual({ ok: true, why: "", left: -1 });
  h.run(300);
  h.host.shutdown();
  const store = new WorldStore(dbPath, h.reg);
  const typed = store.journal().filter((j) => j.op === OP_ADMIN).map((j) => new TextDecoder().decode(j.data));
  store.close();
  expect(typed).toEqual(["(admin page)\tdoexit 90", "(admin page)\tdoexit cancel"]);
});

/** A client folder with what the server reads of it: the manifest, the boot pack and the clip file. */
function clientFolder(): string {
  const folder = mkdtempSync(join(dir, "client-"));
  mkdirSync(join(folder, "assets"));
  const { files, manifest } = splitPack(corePackBytes(), "core");
  for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(folder, "assets", manifest.files[f]!.name), file.bytes);
  writeFileSync(join(folder, "assets/manifest.json"), JSON.stringify(manifest));
  return folder;
}

test("the real server on a real socket: a gentle stop says go before it closes, and the same survivor is back after a start on the same save", async () => {
  const clientDir = clientFolder(), dbPath = join(dir, "world.db");
  const log = console.log;
  console.log = () => {};
  const ready = async (port: number): Promise<Ready | null> => fetch(`http://localhost:${port}/ready.json`).then((r) => r.json() as Promise<Ready>, () => null);
  /** A session over a real socket, its frames run on a timer until `done` says so. */
  const play = async (port: number, map: ReturnType<typeof parseMap>, intent: "create" | "resume", done: (s: ClientSession) => boolean): Promise<ClientSession> => {
    const hf = mapHeightfield(map);
    const s = new ClientSession(connect(`ws://localhost:${port}/ws`), {
      name: "ada", key: testKey("ada"), intent, spectate: false, registry: coreRegistry(), clipHash: first.host.world.anim.set.hash, look: defaultLook(),
      resolveMap: (id, hash) => (id === map.id && hash === map.hash ? hf : null), nodes: (h, reg) => mapNodes(map, h, reg), statics: map.statics,
    });
    await new Promise<void>((go) => {
      const began = performance.now();
      const frame = setInterval(() => {
        s.update(performance.now(), 0, 0, 0, 0, 0);
        if (done(s) || performance.now() - began > 8000) (clearInterval(frame), go());
      }, 1000 / 60);
    });
    return s;
  };
  let first = startServer({ port: 0, clientDir, dbPath, noBackups: true });
  try {
    const map = parseMap(first.host.mapFile!);
    const was = (await ready(first.port))!;
    expect(was).toMatchObject({ page: null, map: first.host.world.mapId });
    expect(typeof was.started === "number" && typeof was.wire === "number").toBe(true);
    const ada = await play(first.port, map, "create", (s) => s.state === "active" && s.ownHandle !== 0);
    expect(ada.state).toBe("active");
    const pid = first.host.game.clients.find((c) => c?.name === "ada")!.pid;
    const here = { x: ada.own.x, z: ada.own.z };
    const heard: string[] = [];
    ada.onRestart = (go) => void heard.push(go ? "go" : "told");
    ada.onLost = () => void heard.push("lost");
    const left: Comeback = { name: "ada", password: "", spectate: false, started: was.started, map: was.map, why: "restart", at: Date.now(), tries: 0 };
    // The stop waits for its pages to leave. This one never does, so it stops when the grace is over.
    const began = performance.now();
    const stopping = first.stopGently(400);
    await new Promise((r) => setTimeout(r, 150));
    // "Go" has come, the socket is still open, and the server still answers: the waiting page can be fetched.
    expect([heard, ada.leaving, ada.state, verdict(left, await ready(first.port))]).toEqual([["go"], true, "active", "wait"]);
    await stopping;
    expect(performance.now() - began).toBeGreaterThan(390);
    await new Promise((r) => setTimeout(r, 100));
    expect([ada.state, ada.lost, heard, await ready(first.port)]).toEqual(["closed", false, ["go"], null]);
    expect(verdict(left, null)).toBe("wait");

    // Started again on the same save: another start, so the page may come back, and the survivor is where it stood.
    first = startServer({ port: 0, clientDir, dbPath, noBackups: true });
    const now = (await ready(first.port))!;
    expect(now.started).toBeGreaterThan(was.started);
    expect(verdict(left, now)).toBe("enter");
    const back = await play(first.port, map, "resume", (s) => s.state !== "connecting" && (s.state === "closed" || s.ownHandle !== 0));
    expect(back.state).toBe("active");
    expect(first.host.game.clients.find((c) => c?.name === "ada")!.pid).toBe(pid);
    expect(Math.hypot(back.own.x - here.x, back.own.z - here.z)).toBeLessThan(1);
    // A client on disk of another version than the server speaks is one still being built: the page waits on.
    writeFileSync(join(clientDir, "build.json"), JSON.stringify({ wire: now.wire + 1 }));
    expect(verdict(left, await ready(first.port))).toBe("unbuilt");
    writeFileSync(join(clientDir, "build.json"), JSON.stringify({ wire: now.wire }));
    expect(verdict(left, await ready(first.port))).toBe("enter");
    back.close();
    // With nobody connected a gentle stop does not wait.
    await new Promise((r) => setTimeout(r, 200));
    const quick = performance.now();
    await first.stopGently(5000);
    expect(performance.now() - quick).toBeLessThan(1500);
  } finally {
    console.log = log;
    first.stop();
  }
});

test("a stop signal waits for a stop that takes a moment, and a second signal hurries it", async () => {
  const heard = new Map<string, () => void>();
  const exits: number[] = [];
  const asked: boolean[] = [];
  let done = (): void => {};
  const proc = { on: (signal: string, fn: () => void) => void heard.set(signal, fn), exit: (code: number) => void exits.push(code) };
  stopOnSignals((hurry) => {
    asked.push(hurry);
    if (!hurry) return new Promise<void>((go) => (done = go));
  }, proc);
  heard.get("SIGTERM")!();
  await Promise.resolve();
  // The first is letting its pages leave: nothing has exited.
  expect([asked, exits]).toEqual([[false], []]);
  // A second, as a process manager sends when it will not wait, stops at once.
  heard.get("SIGTERM")!();
  expect([asked, exits]).toEqual([[false, true], [0]]);
  done();
  await new Promise((r) => setTimeout(r, 0));
  expect(exits).toEqual([0, 0]);
  // One that fails while it waits exits with 1.
  const said = console.error;
  console.error = () => {};
  const failing = new Map<string, () => void>();
  const codes: number[] = [];
  stopOnSignals(() => Promise.reject(new Error("disk full")), { on: (signal, fn) => void failing.set(signal, fn), exit: (code) => void codes.push(code) });
  failing.get("SIGINT")!();
  await new Promise((r) => setTimeout(r, 0));
  console.error = said;
  expect(codes).toEqual([1]);
});
