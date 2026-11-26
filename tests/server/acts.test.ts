// The admin acts: who did what and when, journalled in the save, the latest worth reading kept and printed, a page's
// command named for who asked, passwords kept out, the old journal form still read, and AdminLogging.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTS_KEPT, ACTS_OPEN_KEPT, ACTS_STAFF_KEPT, OP_ADMIN, type Actor } from "../../server/acts.ts";
import { refused as gateRefused, type AdminGate } from "../../server/admin/gate.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { Guesses } from "../../server/guesses.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { permissionsAdmin } from "../../server/permissions/routes.ts";
import { staffPasswords } from "../../server/permissions/secrets.ts";
import { idText } from "../../server/survivor-ids.ts";
import { decodeAct, type Act } from "../../shared/acts.ts";
import type { ActsAnswer } from "../../shared/admin-acts.ts";
import { PERMISSIONS_API } from "../../shared/permissions/page.ts";
import { TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { RANK_ADMIN, RANK_MAP, RANK_STAFF } from "../../shared/ranks.ts";
import { adminLines, savedActs } from "../fixtures/acts.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-acts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const W0 = Date.UTC(2026, 10, 25, 9, 0, 0);

/** A world whose acts are timed by its virtual clock from W0, and whose own output is kept in `said`. */
function world(opts: { db?: string; password?: string } = {}): { h: Harness; said: string[] } {
  const said: string[] = [];
  let h: Harness | null = null;
  h = new Harness({}, 1, 60, { ...(opts.db ? { dbPath: opts.db } : {}), ...(opts.password ? { adminPassword: opts.password } : { dev: true }), log: (line) => said.push(line), survivorLog: { wall: () => W0 + Math.round(h?.now ?? 0) } });
  return { h, said };
}

/** Creative mode for all, switched on while the world runs. */
function everyonesCheats(h: Harness): void {
  expect([h.host.setSetting("bShowCreativeMode", "True"), h.host.setSetting("CreativeForAll", "True")]).toEqual(["", ""]);
  h.run(100);
}

/** One who proved nothing, and an admin on a page. */
const OPEN_ONE: Actor = { name: "bo", id: "", pid: 2, rank: RANK_STAFF, via: "session", from: "", baseRank: 0, open: true };
const PAGE_ADA: Actor = { name: "ada", id: "", pid: 0, rank: RANK_ADMIN, via: "page", from: "", baseRank: RANK_ADMIN, open: false };

test("an admin command is kept with who ran it, their ID, rank and the time", () => {
  const db = join(dir, "kept.db");
  const { h, said } = world({ db, password: "hunter2" });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats hunter2");
  const before = W0 + h.now;
  expect(h.say(ada, "settime 6:30")).toEqual(["time is 06:30"]);
  const act = h.host.acts.recent().at(-1)!;
  const rec = h.host.survivorRecord("ada")!;
  expect([act.name, act.id, act.pid, act.rank, act.via, act.kind, act.what]).toEqual(["ada", idText(rec), rec.pid, RANK_MAP, "session", "command", "settime 6:30"]);
  expect(act.id).toMatch(/^\d{17}$/);
  expect(act.at - before).toBeGreaterThanOrEqual(0);
  expect(act.at - before).toBeLessThan(1000);
  expect(said).toContain("admin: ada (map rank) settime 6:30");
  h.host.shutdown();
  const store = new WorldStore(db, h.reg);
  const kept = savedActs(store).find((a) => a.what === "settime 6:30")!;
  store.close();
  expect(kept).toEqual(act);
});

test("a cheat under creative mode for all is journalled as open and kept apart", () => {
  const db = join(dir, "cheats.db");
  const { h, said } = world({ db });
  everyonesCheats(h);
  const bo = h.join("bo");
  h.run(500);
  expect(bo.admin).toBe(true);
  expect(h.say(bo, "settime 6:30")).toEqual(["time is 06:30"]);
  expect(h.host.acts.recent().map((a) => a.what)).not.toContain("settime 6:30");
  expect(said.filter((line) => line.includes("settime"))).toEqual([]);
  const open = h.host.acts.recentWithOpen().find((a) => a.what === "settime 6:30");
  expect([open?.name, open?.open]).toEqual(["bo", true]);
  h.host.shutdown();
  const store = new WorldStore(db, h.reg);
  expect(adminLines(store)).toEqual(["bo\tsettime 6:30"]);
  expect(savedActs(store).map((a) => a.open)).toEqual([true]);
  store.close();
});

test("a development server's own cheats are not open, so they are kept", () => {
  const { h, said } = world();
  const bo = h.join("bo");
  h.run(500);
  expect(h.say(bo, "enablecheats")).toEqual(["cheats enabled"]);
  expect(h.say(bo, "settime 6:30")).toEqual(["time is 06:30"]);
  expect(h.host.acts.recent().map((a) => [a.name, a.open, a.what])).toEqual([["bo", false, "settime 6:30"]]);
  expect(said).toContain("admin: bo (staff rank) settime 6:30");
  h.host.shutdown();
});

test("a host password's admin is never open, also under creative mode for all", () => {
  const { h, said } = world({ password: "hunter2" });
  everyonesCheats(h);
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "settime 6");
  h.say(ada, "enablecheats hunter2");
  h.say(ada, "settime 7");
  const mine = h.host.acts.recentWithOpen().filter((a) => a.name === "ada").map((a) => [a.kind, a.open, a.what]);
  expect(mine).toEqual([["command", true, "settime 6"], ["sign-in", false, "enablecheats with the map's password"], ["command", false, "settime 7"]]);
  expect(h.host.acts.recent().map((a) => a.what)).toEqual(["enablecheats with the map's password", "settime 7"]);
  expect(said).toContain("admin: ada (map rank) settime 7");
  h.host.shutdown();
});

test("many open acts never push a kept act out", () => {
  const { h, said } = world();
  h.host.exec("settime 6:30");
  h.host.acts.write(OPEN_ONE, "claimed their own password", "change");
  for (let i = 0; i < ACTS_KEPT + ACTS_OPEN_KEPT; i++) h.host.acts.write(OPEN_ONE, `fly ${i}`);
  expect(h.host.acts.recent().map((a) => a.what)).toEqual(["settime 6:30", "claimed their own password"]);
  const open = h.host.acts.recentWithOpen(0, Number.MAX_SAFE_INTEGER).filter((a) => a.open && a.kind === "command");
  expect(open.length).toBe(ACTS_OPEN_KEPT);
  expect([open[0]!.what, open.at(-1)!.what]).toEqual([`fly ${ACTS_KEPT}`, `fly ${ACTS_KEPT + ACTS_OPEN_KEPT - 1}`]);
  expect(said.some((line) => line.includes("fly"))).toBe(false);
  h.host.shutdown();
});

test("open commands, however many, never push an admin's act out of the save", () => {
  const db = join(dir, "pruned.db");
  // A save that keeps only its latest 20 journal entries, where a real one keeps a hundred thousand.
  const said: string[] = [];
  const open = (): Harness => new Harness({}, 1, 60, { dbPath: db, dev: true, journalKeep: 20, log: (line) => said.push(line) });
  const first = open();
  first.host.acts.write(PAGE_ADA, "settime 6:30");
  first.host.acts.write(PAGE_ADA, "Permissions.Add bo Admins", "change");
  for (let i = 0; i < 200; i++) first.host.acts.write(OPEN_ONE, `fly ${i}`);
  first.host.persistence!.commit();
  first.host.persistence!.prune();
  first.host.shutdown();

  const second = open();
  expect(second.host.acts.recent(0, Number.MAX_SAFE_INTEGER).map((a) => a.what)).toEqual(["settime 6:30", "Permissions.Add bo Admins"]);
  // The open commands are the ones that went: only the latest are left.
  const left = second.host.acts.recentWithOpen(0, Number.MAX_SAFE_INTEGER).filter((a) => a.open);
  expect([left.length, left.at(-1)?.what]).toEqual([20, "fly 199"]);
  // Admin acts are counted on their own, so they too are bounded.
  for (let i = 0; i < 30; i++) second.host.acts.write(PAGE_ADA, `kick ${i}`);
  second.host.persistence!.commit();
  second.host.persistence!.prune();
  second.host.shutdown();
  const third = open();
  const kept = third.host.acts.recent(0, Number.MAX_SAFE_INTEGER).map((a) => a.what);
  expect([kept.length, kept[0], kept.at(-1)]).toEqual([20, "kick 10", "kick 29"]);
  third.host.shutdown();
});

/** A staff member signed in with their own password: below an admin's rank, and no open actor. */
const STAFF_SAM: Actor = { name: "sam", id: "", pid: 3, rank: RANK_STAFF, via: "session", from: "", baseRank: 0, open: false };

test("a staff member's acts, however many, never push an admin's out of the log or the save", () => {
  const db = join(dir, "tiers.db");
  const open = (): Harness => new Harness({}, 1, 60, { dbPath: db, dev: true, journalKeep: 50, log: () => {} });
  const first = open();
  first.host.acts.write(PAGE_ADA, "Permissions.AddGroup Evidence", "change");
  first.host.acts.write(PAGE_ADA, "kick bo");
  // A moderator's commands, their sign-ins and their claims: all an admin should read, none an admin's own.
  for (let i = 0; i < ACTS_KEPT + ACTS_STAFF_KEPT; i++) first.host.acts.write(STAFF_SAM, `kick ${i}`, i % 3 === 0 ? "sign-in" : i % 3 === 1 ? "change" : "command");
  const all = first.host.acts.recent(0, Number.MAX_SAFE_INTEGER);
  expect(all.slice(0, 2).map((a) => a.what)).toEqual(["Permissions.AddGroup Evidence", "kick bo"]);
  expect([all.length, all.at(-1)!.what]).toEqual([2 + ACTS_STAFF_KEPT, `kick ${ACTS_KEPT + ACTS_STAFF_KEPT - 1}`]);
  // In order of their sequence numbers, the two lists read as one.
  expect(all.every((a, i) => i === 0 || a.seq > all[i - 1]!.seq)).toBe(true);
  first.host.persistence!.commit();
  first.host.persistence!.prune();
  first.host.shutdown();

  const second = open();
  const back = second.host.acts.recent(0, Number.MAX_SAFE_INTEGER);
  expect(back.slice(0, 2).map((a) => a.what)).toEqual(["Permissions.AddGroup Evidence", "kick bo"]);
  // The save kept the staff's latest fifty, counted on their own.
  expect([back.length, back.at(-1)!.what]).toEqual([52, `kick ${ACTS_KEPT + ACTS_STAFF_KEPT - 1}`]);
  second.host.shutdown();
});

test("both lists come back from the save, and paging the two misses nothing", () => {
  const db = join(dir, "rings.db");
  const first = world({ db });
  for (let i = 0; i < 40; i++) first.h.host.acts.write(i % 3 === 0 ? PAGE_ADA : OPEN_ONE, `act ${i}`);
  const was = first.h.host.acts.recentWithOpen(0, Number.MAX_SAFE_INTEGER);
  const kept = first.h.host.acts.recent(0, Number.MAX_SAFE_INTEGER);
  first.h.host.shutdown();

  const second = world({ db });
  expect(second.h.host.acts.recentWithOpen(0, Number.MAX_SAFE_INTEGER)).toEqual(was);
  expect(second.h.host.acts.recent(0, Number.MAX_SAFE_INTEGER)).toEqual(kept);
  expect(was.map((a) => a.what)).toEqual(Array.from({ length: 40 }, (_, i) => `act ${i}`));
  const paged: Act[] = [];
  for (let after = 0; ; ) {
    const got = second.h.host.acts.recentWithOpen(after, 7);
    paged.push(...got);
    if (got.length < 7) break;
    after = got.at(-1)!.seq;
  }
  expect(paged).toEqual(was);
  second.h.host.shutdown();
});

test("the acts answer adds the open acts only when asked, and pages them", async () => {
  const { h } = world({ password: "hunter2" });
  for (let i = 0; i < 12; i++) h.host.acts.write(i % 4 === 0 ? PAGE_ADA : OPEN_ONE, `act ${i}`);
  const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start: { tick: 0, wall: 0 } });
  const gate: AdminGate = { dev: false, password: "hunter2", guesses: new Guesses(), tick: () => 0 };
  const read = async (query: string): Promise<Act[]> => {
    const req = new Request(`http://localhost/admin/acts.json?${query}`, { headers: { authorization: `Basic ${btoa("kody:hunter2")}` } });
    return ((await (await pages.answer(req, "1.2.3.4", gate, "/admin/acts.json"))!.json()) as ActsAnswer).acts;
  };
  expect((await read("after=0")).map((a) => a.what)).toEqual(["act 0", "act 4", "act 8"]);
  const all = await read("after=0&open=1");
  expect(all.map((a) => a.what)).toEqual(Array.from({ length: 12 }, (_, i) => `act ${i}`));
  expect(all.filter((a) => a.open).length).toBe(9);
  expect((await read(`after=${all[5]!.seq}&open=1`)).map((a) => a.what)).toEqual(all.slice(6).map((a) => a.what));
  h.host.shutdown();
});

test("an entry from before the flag, or before ranks, shows in the latest acts", () => {
  const db = join(dir, "older.db");
  const first = world({ db });
  const older = { at: W0, name: "pip", id: "", pid: 3, rank: RANK_STAFF, via: "session", from: "", kind: "command", what: "kick carl" };
  first.h.host.persistence!.journal(OP_ADMIN, new TextEncoder().encode(JSON.stringify(older)));
  first.h.host.persistence!.journal(OP_ADMIN, new TextEncoder().encode("ada\tsettime 6:30"));
  first.h.host.shutdown();
  const second = world({ db });
  expect(second.h.host.acts.recent().map((a) => [a.name, a.rank, a.open, a.what])).toEqual([["pip", RANK_STAFF, false, "kick carl"], ["ada", -1, false, "settime 6:30"]]);
  second.h.host.shutdown();
});

test("rubbish sent to the permissions page is logged in short clean words", async () => {
  const said: string[] = [];
  const h = new Harness({}, 1, 60, { adminPassword: "hunter2", log: (line) => said.push(line) });
  const gate = { dev: false, password: "hunter2", cluster: null, guesses: h.host.game.sessions.cheatGuesses, tick: () => h.world.tick, staff: staffPasswords(h.host) };
  const send = async (op: unknown): Promise<number> => {
    const init = { method: "POST", headers: { authorization: `Basic ${btoa("kody:hunter2")}`, "content-type": "application/json" }, body: JSON.stringify({ do: "op", op }) };
    const req = new Request(`http://localhost${PERMISSIONS_API}`, init);
    return (gateRefused(req, "1.2.3.4", gate) ?? (await permissionsAdmin(req, PERMISSIONS_API, h.host))!).status;
  };
  const HUGE = "Q".repeat(200_000);
  const HASH = "7".repeat(64);
  const CHAT = "SECRET-CHAT-".repeat(2000);
  const statuses = [
    await send({ op: "grant", group: { toString: 1 }, permission: [1, 2] }),
    await send({ op: "addGroup", group: HUGE, rank: "cluster" }),
    await send({ op: "revoke", group: "Ad\u0000mins\u001b[31m\n", permission: "Cheat.\u202efly\r\nadmin: x" }),
    await send({ op: "clearSecret", id: "1", hash: HASH }),
    await send({ op: "setSecret", id: "1", password: "swordfish" }),
    await send({ op: "setChat", group: "Admins", chat: CHAT }),
    await send({ op: "addMember", kind: "survivor", key: HUGE, group: "Admins", hours: "x", world: {} }),
    await send({ op: "nonsense", group: HUGE }),
  ];
  expect(statuses.every((s) => s === 403)).toBe(true);
  const refused = h.host.acts.recent().filter((a) => a.kind === "refused");
  expect(refused.length).toBe(statuses.length);
  for (const act of refused) {
    expect([act.name, act.rank, act.via, act.open]).toEqual(["(kody)", RANK_MAP, "page", false]);
    expect(act.what.length).toBeLessThan(400);
    expect(act.what).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    for (const secret of ["QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ", HASH, "swordfish", "SECRET-CHAT"]) expect(act.what).not.toContain(secret);
  }
  expect(refused.map((a) => a.what.split(": ")[0])).toEqual([
    "Permissions.Grant ? ?",
    expect.stringMatching(/^Permissions\.AddGroup Q+…; Permissions\.Rank Q+… \?$/),
    "Permissions.Revoke Ad mins [31m Cheat.fly admin",
    "set a password",
    "set a password",
    "set the chat format of Admins",
    expect.stringMatching(/^Permissions\.AddTimed Q+… Admins \? 0$/),
    "a change of no known kind",
  ]);
  expect(refused[5]!.what).toBe("set the chat format of Admins: A chat block is text of at most 16384 letters.");
  const lines = said.filter((line) => line.includes("refused: "));
  expect(lines.length).toBe(statuses.length);
  expect(lines.join("\n")).not.toContain(HASH);
  h.host.shutdown();
});

test("a world with no save still lists its latest acts", () => {
  const { h } = world();
  expect(h.host.persistence).toBeNull();
  h.host.exec("settime 6:30");
  h.host.exec("settime 7");
  const acts = h.host.acts.recent();
  expect(acts.map((a) => [a.name, a.via, a.what])).toEqual([["(operator)", "operator", "settime 6:30"], ["(operator)", "operator", "settime 7"]]);
  expect(h.host.acts.recent(acts[0]!.seq).map((a) => a.what)).toEqual(["settime 7"]);
  expect(h.host.acts.recent(0, 1).map((a) => a.what)).toEqual(["settime 6:30"]);
  h.host.shutdown();
});

test("the latest acts are read back from the save after a restart", () => {
  const db = join(dir, "restart.db");
  const first = world({ db });
  first.h.host.exec("settime 6:30");
  first.h.run(200);
  const was = first.h.host.acts.recent();
  first.h.host.shutdown();

  const second = world({ db });
  expect(second.h.host.acts.recent()).toEqual(was);
  second.h.host.exec("settime 7");
  const now = second.h.host.acts.recent();
  expect(now.map((a) => a.what)).toEqual(["settime 6:30", "settime 7"]);
  expect(now[1]!.seq).toBeGreaterThan(now[0]!.seq);
  second.h.host.shutdown();
});

test("a page's command is named for who asked and runs with the operator's rights", () => {
  const { h, said } = world();
  const by: Actor = { name: "ada", id: "", pid: 0, rank: RANK_ADMIN, via: "page", from: "203.0.113.9", baseRank: RANK_ADMIN, open: false };
  expect(h.host.console.exec({ host: h.host, client: null, actor: by }, "settime 6:30")).toBe("time is 06:30");
  const act = h.host.acts.recent().at(-1)!;
  expect([act.name, act.rank, act.via, act.from, act.what]).toEqual(["ada", RANK_ADMIN, "page", "203.0.113.9", "settime 6:30"]);
  // The server's output is read by every session with cheats, so it never holds the address.
  expect(said).toContain("admin: ada (admin rank) settime 6:30");
  expect(said.join("\n")).not.toContain("203.0.113.9");
  h.host.shutdown();
});

test("a password never reaches an act", () => {
  const db = join(dir, "secret.db");
  const { h, said } = world({ db, password: "hunter2" });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats hunter2");
  h.say(ada, "setting ServerAdminPassword swordfish");
  h.run(200);
  expect(h.host.acts.recent().map((a) => a.what)).toEqual(["enablecheats with the map's password", "setting ServerAdminPassword ****"]);
  h.host.shutdown();
  const store = new WorldStore(db, h.reg);
  const bytes = store.journal().filter((j) => j.op === OP_ADMIN).map((j) => new TextDecoder().decode(j.data)).join("\n");
  store.close();
  for (const secret of ["hunter2", "swordfish"]) {
    expect(bytes).not.toContain(secret);
    expect(said.join("\n")).not.toContain(secret);
  }
});

test("an old name tab line entry still reads", () => {
  const old = (line: string) => decodeAct(new TextEncoder().encode(line), 7, 90);
  expect(old("ada\tsettime 6:30")).toEqual({ seq: 7, at: 0, tick: 90, name: "ada", id: "", pid: 0, rank: -1, via: "session", from: "", kind: "command", what: "settime 6:30", open: false });
  expect([old("(operator)\tsettime 12").via, old("(admin page)\tdoexit 90").via]).toEqual(["operator", "page"]);
  expect([old("no tab").name, old("no tab").what]).toEqual(["", "no tab"]);
});

test("AdminLogging shows each command to everyone", () => {
  const { h } = world();
  const ada = h.join("ada");
  const bo = h.join("bo");
  h.run(500);
  h.say(ada, "enablecheats");
  const notices = (): string[] => bo.log.filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text);
  h.say(ada, "settime 6:30");
  expect(notices()).toEqual([]);
  expect(h.host.setSetting("AdminLogging", "True")).toBe("");
  h.say(ada, "settime 7");
  h.host.exec("settime 8");
  h.run(300);
  expect(notices()).toEqual(["ada: settime 7", "(operator): settime 8"]);
  h.host.shutdown();
});
