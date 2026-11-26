// The survivor log on a server: sessions, places, seats and inventories as survivors play, the journal's marks at their
// wall times, a restart that carries on, no log without a save, the log switched on and off while running, and its thread.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { Rules } from "../../server/settings/rules.ts";
import { STATE_DEAD } from "../../server/survivor-log/format.ts";
import { flatGround } from "../fixtures/arena.ts";
import { savedActs } from "../fixtures/acts.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-survivor-log-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const W0 = Date.UTC(2026, 10, 18, 9, 0, 0);

/** A harness whose log's wall clock runs with its virtual time, from `start`. */
function world(opts: { db?: string; start?: number; rules?: Rules; worker?: boolean } = {}): Harness {
  let h: Harness | null = null;
  const start = opts.start ?? W0;
  h = new Harness({ lingerTicks: 0 }, 1, 60, { dev: true, ...(opts.db ? { dbPath: opts.db } : {}), ...(opts.rules ? { config: opts.rules } : {}), survivorLog: { wall: () => start + Math.round(h?.now ?? 0), ...(opts.worker ? { mode: "worker" as const } : {}) } });
  return h;
}

test("what survivors do is logged as they play, read back by wall time, and a restart carries on", async () => {
  const db = join(dir, "play.db");
  const h = world({ db });
  const log = h.host.survivorLog;
  const ana = h.join("ana");
  const ben = h.join("ben");
  h.run(1500);
  const g = flatGround(h, 60, 60);
  h.say(ana, "enablecheats");
  h.say(ben, "enablecheats");
  h.say(ana, `tp ${g.x + 10} ${g.z + 10}`);
  h.say(ben, `tp ${g.x + 30} ${g.z + 10}`, 1000);
  const anaPid = h.client(ana)!.pid;
  const benPid = h.client(ben)!.pid;
  // Three gives within a second are one entry, noted once the inventory has kept still for the debounce.
  const before = W0 + h.now;
  h.say(ana, "give stone 5");
  h.say(ana, "give stone 3");
  h.say(ana, "give spear 1 apprentice");
  h.run(7000);
  h.pilots[0]!.moveZ = 1;
  h.run(3000);
  h.pilots[0]!.moveZ = 0;
  const me = h.client(ben)!;
  const car = h.host.spawnVehicle("core:compact", g.x + 31.6, g.z + 10.1, h.host.records.byPid.get(benPid)!.team, 0);
  expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
  h.run(3000);
  const seated = W0 + h.now;
  h.say(ben, "suicide", 2000);
  h.ends[1]!.close();
  h.run(2000);
  log.flush();
  const now = W0 + h.now;

  const ch = await log.changes(anaPid, before, now);
  expect(ch.entries.length).toBe(1);
  expect(ch.gained).toEqual([
    { item: "core:spear", quality: 2, blueprint: false, count: 1 },
    { item: "core:stone", quality: 0, blueprint: false, count: 8 },
  ]);
  const holding = await log.heldAt(anaPid, now);
  expect([holding!.online, holding!.items.find((i) => i.item === "core:stone")?.count]).toEqual([true, 8]);
  expect((await log.holders("core:spear", before, now)).map((x) => [x.pid, x.quality, x.to])).toEqual([[anaPid, 2, null]]);

  const walked = (await log.track(anaPid, before, now, 1000)).tracks[0]!;
  expect(Math.max(...walked.z) - Math.min(...walked.z)).toBeGreaterThan(5);
  const at = await log.positions(seated - 500, seated - 500, 1000);
  const b = at.tracks.find((t) => t.pid === benPid)!;
  expect(at.seats[b.seat[0]!]).toBe("core:compact");
  const benTrack = (await log.track(benPid, seated, now, 500)).tracks[0]!;
  expect(benTrack.state.at(-1)).toBe(STATE_DEAD);

  const who = await log.survivors(W0, now);
  expect(who.map((s) => [s.name, s.sessions.length, s.sessions[0]!.to === null, s.sessions[0]!.why]).sort()).toEqual([
    ["ana", 1, true, ""],
    ["ben", 1, false, "left"],
  ]);
  expect(who.find((s) => s.pid === benPid)!.playMs).toBeGreaterThan(15000);

  const marks = (await log.marks(W0, now)).marks;
  expect(marks.filter((m) => m.kind === "admin" && m.name === "ana").map((m) => m.text)).toContain("give stone 3");
  const death = marks.find((m) => m.kind === "death")!;
  expect([death.pid, death.name]).toEqual([benPid, "ben"]);
  expect(Math.abs(death.wall - (seated + 150))).toBeLessThan(1000);
  expect(await log.tickAt(death.wall)).toBe(death.tick);

  expect(h.host.exec("survivorlog")).toMatch(/^survivor log on: 2026-11-18 09:00:0\d UTC \(tick \d+\) to .* in 1 segments; .* MB of 1024\.0 MB in .*play\.db\.survivor-log$/);
  const stoppedAt = h.world.tick;
  h.host.shutdown();

  // An hour later the world starts again on its save and the log goes on, a segment of its own for the run.
  const later = now + 3_600_000;
  const h2 = world({ db, start: later });
  h2.join("ana");
  h2.run(3000);
  h2.host.survivorLog.flush();
  const span = h2.host.survivorLog.span();
  expect([span.on, span.segments, span.from]).toEqual([true, 2, W0]);
  const again = (await h2.host.survivorLog.survivors(W0, later + 10_000)).find((s) => s.name === "ana")!;
  expect(again.sessions.map((s) => s.why)).toEqual(["stopped", ""]);
  // While the server was down the world stood at the tick it stopped on, and the next run began there.
  expect(await h2.host.survivorLog.tickAt(now + 1_800_000)).toBe(stoppedAt);
  expect(await h2.host.survivorLog.wallAt(stoppedAt + 30)).toBeGreaterThanOrEqual(later);
  h2.host.shutdown();
});

test("a command's mark carries its admin's survivor and its own time", async () => {
  const h = world({ db: join(dir, "marks.db") });
  const ana = h.join("ana");
  h.run(1500);
  h.say(ana, "enablecheats");
  const said = W0 + h.now;
  h.say(ana, "settime 6:30");
  h.host.exec("settime 7");
  h.run(1000);
  h.host.survivorLog.flush();
  const marks = (await h.host.survivorLog.marks(W0, W0 + h.now)).marks.filter((m) => m.kind === "admin");
  expect(marks.map((m) => [m.name, m.pid, m.text, m.act])).toEqual([["ana", h.client(ana)!.pid, "settime 6:30", "command"], ["(operator)", 0, "settime 7", "command"]]);
  expect(marks[0]!.wall - said).toBeGreaterThanOrEqual(0);
  expect(marks[0]!.wall - said).toBeLessThan(400);
  h.host.shutdown();
  // The time is the act's own, as the journal keeps it.
  const store = new WorldStore(join(dir, "marks.db"), h.reg);
  expect(savedActs(store).find((a) => a.what === "settime 6:30")!.at).toBe(marks[0]!.wall);
  store.close();
});

test("a world with no save keeps no log, and nothing fails", async () => {
  const h = world();
  h.join("ana");
  h.run(6000);
  const span = h.host.survivorLog.span();
  expect([span.on, span.folder, span.why]).toEqual([false, null, "this world is not saved to disk, so it keeps no survivor log"]);
  expect(await h.host.survivorLog.survivors(0, Date.now())).toEqual([]);
  expect(await h.host.survivorLog.heldAt(1, Date.now())).toBeNull();
  expect(await h.host.survivorLog.json("survivors", 0, Date.now())).toBe("[]");
  expect(h.host.exec("survivorlog")).toBe("survivor log off: this world is not saved to disk, so it keeps no survivor log; it holds nothing yet");
  h.host.shutdown();
});

test("SurvivorLogMegabytes at 0 keeps no folder; switched on while running it begins with whoever is online, and off again it stops", async () => {
  const db = join(dir, "switched.db");
  const rules = new Rules();
  expect(rules.assign("SurvivorLogMegabytes", "0", "console")).toBe("");
  const h = world({ db, rules });
  const ana = h.join("ana");
  h.run(3000);
  expect(existsSync(`${db}.survivor-log`)).toBe(false);
  expect(h.host.survivorLog.span().why).toBe("SurvivorLogMegabytes is 0");
  const pid = h.client(ana)!.pid;
  const on = W0 + h.now;
  expect(h.host.setSetting("SurvivorLogMegabytes", "16")).toBe("");
  h.run(6000);
  expect(existsSync(`${db}.survivor-log`)).toBe(true);
  expect(h.host.setSetting("SurvivorLogPositionSeconds", "0.5")).toBe("");
  expect(h.host.setSetting("SurvivorLogInventorySeconds", "1")).toBe("");
  h.say(ana, "enablecheats");
  const given = W0 + h.now;
  h.say(ana, "give stone 2", 4000);
  expect(h.host.setSetting("SurvivorLogMegabytes", "0")).toBe("");
  h.run(1000);
  const off = W0 + h.now;
  const s = (await h.host.survivorLog.survivors(on - 1000, off))[0]!;
  expect([s.pid, s.sessions[0]!.why]).toEqual([pid, "log off"]);
  expect(Math.abs(s.sessions[0]!.from - on)).toBeLessThan(100);
  const track = (await h.host.survivorLog.track(pid, on, off, 100)).tracks[0]!;
  // Samples a second apart, then half a second once the setting changed, give or take the harness's frames, which the wall clock follows.
  const gaps = track.wall.slice(1).map((w, i) => w - track.wall[i]!);
  expect(gaps[0]).toBeGreaterThanOrEqual(950);
  expect(gaps.at(-2)).toBeLessThanOrEqual(550);
  // Seen at the next half-second sample and noted a second later.
  const noted = (await h.host.survivorLog.changes(pid, given, off)).entries;
  expect(noted.length).toBe(1);
  expect(noted[0]!.wall - given).toBeLessThan(2500);
  expect(h.host.survivorLog.span().on).toBe(false);
  h.host.shutdown();
});

test("on its own thread the log writes and answers in turn, and closes with the server", async () => {
  const db = join(dir, "thread.db");
  const h = world({ db, worker: true });
  const ana = h.join("ana");
  h.run(3000);
  h.say(ana, "enablecheats");
  h.say(ana, "give stone 4", 6500);
  const log = h.host.survivorLog;
  log.flush();
  const pid = h.client(ana)!.pid;
  const holding = await log.heldAt(pid, W0 + h.now);
  expect(holding!.items.find((i) => i.item === "core:stone")!.count).toBe(4);
  // The same answer as text made on the log's thread, for a route to send as it is.
  expect(JSON.parse(await log.json("heldAt", pid, W0 + h.now))).toEqual(holding);
  expect(JSON.parse(await log.json("marks", W0, W0 + h.now)).marks.some((m: { text: string }) => m.text === "give stone 4")).toBe(true);
  // The span came back before the answer did.
  expect(log.span().segments).toBe(1);
  expect((await log.positions(W0 + h.now - 2000, W0 + h.now, 1000)).tracks[0]!.pid).toBe(pid);
  // A window that is no window answers empty. Awaited plainly: bun's expect().resolves waits without taking the thread's reply.
  expect((await log.track(pid, Number.NaN, 0, 1000)).tracks).toEqual([]);
  h.host.shutdown();
  expect(log.span().on).toBe(false);
});
