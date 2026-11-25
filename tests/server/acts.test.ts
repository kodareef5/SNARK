// The admin acts: who did what and when, journalled in the save, the latest worth reading kept and printed, a page's
// command named for who asked, passwords kept out, the old journal form still read, and AdminLogging.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OP_ADMIN, type Actor } from "../../server/acts.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { idText } from "../../server/survivor-ids.ts";
import { decodeAct } from "../../shared/acts.ts";
import { TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { RANK_ADMIN, RANK_MAP } from "../../shared/ranks.ts";
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

test("a cheat by a session with cheats only is journalled and not in the latest acts", () => {
  const db = join(dir, "cheats.db");
  const { h, said } = world({ db });
  const bo = h.join("bo");
  h.run(500);
  expect(h.say(bo, "enablecheats")).toEqual(["cheats enabled"]);
  expect(h.say(bo, "settime 6:30")).toEqual(["time is 06:30"]);
  expect(h.host.acts.recent().map((a) => a.what)).not.toContain("settime 6:30");
  expect(said.filter((line) => line.startsWith("admin:"))).toEqual([]);
  h.host.shutdown();
  const store = new WorldStore(db, h.reg);
  expect(adminLines(store)).toEqual(["bo\tsettime 6:30"]);
  store.close();
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
  const by: Actor = { name: "ada", id: "", pid: 0, rank: RANK_ADMIN, via: "page", from: "203.0.113.9" };
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
  expect(h.host.acts.recent().map((a) => a.what)).toEqual(["setting ServerAdminPassword ****"]);
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
  expect(old("ada\tsettime 6:30")).toEqual({ seq: 7, at: 0, tick: 90, name: "ada", id: "", pid: 0, rank: -1, via: "session", from: "", kind: "command", what: "settime 6:30" });
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
