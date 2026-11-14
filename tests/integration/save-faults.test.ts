// What the server does when the save cannot be written. Nothing is lost, and the world runs on.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Persistence } from "../../server/persist/persistence.ts";
import { REJECT_DENIED } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-faults-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Makes every commit fail as SQLite would with `code`, or as our own code would with none, until `mend` is called. */
function breakStore(p: Persistence, code: string): { tries: () => number; mend: () => void } {
  const store = p.store;
  // The host logs these. A test that wants them sets its own after this.
  p.onFailing = null;
  p.onMoved = null;
  const real = store.transaction.bind(store);
  let broken = true;
  let tries = 0;
  store.transaction = (write) => {
    if (!broken) return real(write);
    tries++;
    throw Object.assign(new Error(code === "" ? "a bug of ours" : "database or disk is full"), code === "" ? {} : { code });
  };
  return { tries: () => tries, mend: () => (broken = false) };
}

function world(name: string) {
  const db = join(dir, `${name}.db`);
  const h = new Harness({}, 1, 60, { dbPath: db });
  const ada = h.join("ada");
  h.run(1000);
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  return { db, h, ada, rec, p: h.host.persistence!, stone: h.reg.index.get("core:stone")!, wall: h.reg.index.get("core:wall")! };
}

test("commits that fail for fifty ticks do not stop the server, and the first good one holds everything", () => {
  const { db, h, ada, rec, p, stone, wall } = world("full");
  const fault = breakStore(p, "SQLITE_FULL");
  const said: (string | null)[] = [];
  p.onFailing = (f) => said.push(f ? f.code : null);
  let durable = 0;
  p.afterCommit(() => durable++);
  h.host.items.mint(rec, stone, 40);
  const added = h.world.structs.add(wall, 250.25, 1.5, 230, 4096, 9, 777);
  expect(h.say(ada, "tribe create Night Shift")[0]).toContain("You founded Night Shift");
  const [tick, commits] = [h.world.tick, p.commits];

  h.run((50 * 1000) / 30);
  expect(h.world.tick).toBeGreaterThanOrEqual(tick + 49);
  expect([p.failing!.code, p.commits, durable]).toEqual(["SQLITE_FULL", commits, 0]);
  // Tried again after 6 ticks, then 12, 24 and 48, not every tick.
  expect(fault.tries()).toBeGreaterThanOrEqual(3);
  expect(fault.tries()).toBeLessThanOrEqual(6);
  expect(h.host.records.dirty.has(rec.pid)).toBe(true);
  expect(p.store.meta("tribes")).toBeNull();

  fault.mend();
  h.run(6000);
  expect([p.failing, durable]).toEqual([null, 1]);
  expect(said[0]).toBe("SQLITE_FULL");
  expect(said[said.length - 1]).toBeNull();
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db });
  expect(h2.host.records.byPid.get(rec.pid)!.inv!.total(stone)).toBe(40);
  expect(h2.world.structs.chunks[Math.floor(added / 65536)]!.hp[added & 0xffff]).toBe(777);
  expect([...h2.host.tribes.byId.values()].map((t) => t.name)).toEqual(["Night Shift"]);
  expect(h2.host.items.audit()).toEqual([]);
  h2.host.shutdown();
});

test("another program holding the file makes commits wait their turn, not the server stop", () => {
  const { db, h, rec, p, stone } = world("held");
  p.onFailing = null;
  const other = new Database(db);
  other.exec("BEGIN IMMEDIATE");
  h.host.items.mint(rec, stone, 3);
  const tick = h.world.tick;
  h.run(1000);
  expect(h.world.tick).toBeGreaterThan(tick + 25);
  expect(p.failing!.code).toBe("SQLITE_BUSY");
  other.exec("COMMIT");
  other.close();
  h.run(6000);
  expect(p.failing).toBeNull();
  h.host.shutdown();
  const h2 = new Harness({}, 1, 60, { dbPath: db });
  expect(h2.host.records.byPid.get(rec.pid)!.inv!.total(stone)).toBe(3);
  h2.host.shutdown();
});

test("sessions are told after ten seconds without a save, and nobody new joins after a minute", () => {
  const { h, ada, p } = world("told");
  breakStore(p, "SQLITE_FULL");
  const told = (): number => ada.log.filter((l) => l.text.includes("has not been able to save")).length;
  h.run(9000);
  expect(told()).toBe(0);
  h.run(2000);
  expect(told()).toBe(1);
  const bob = h.join("bob");
  h.run(500);
  expect(bob.state).toBe("active");
  h.run(51000);
  const cy = h.join("cy");
  h.run(500);
  expect([cy.state, cy.closeReason]).toEqual(["closed", REJECT_DENIED]);
  expect(told()).toBe(2);
});

test("an error of our own in a commit is not swallowed", () => {
  const { h, p } = world("bug");
  breakStore(p, "");
  expect(() => h.run(500)).toThrow("a bug of ours");
});

test("the decay clocks are written inside a commit, a minute apart at most, and always at shutdown", () => {
  const { db, h, p } = world("decay");
  h.run(61000);
  const decay = h.host.build.decay;
  decay.dirty = true;
  h.run(1000);
  // Written by the next commit, and the flag is cleared only then.
  expect(decay.dirty).toBe(false);
  const at = p.commits;
  decay.dirty = true;
  h.run(5000);
  expect(p.commits).toBeGreaterThan(at);
  expect(decay.dirty).toBe(true);
  h.host.shutdown();
  expect(decay.dirty).toBe(false);
  new Harness({}, 1, 60, { dbPath: db }).host.shutdown();
});

test("saveas writes the whole world to a new file and carries on there", () => {
  const { db, h, ada, rec, p, stone } = world("move");
  h.host.items.mint(rec, stone, 12);
  h.run(500);
  const other = join(dir, "moved.db");
  expect(h.say(ada, `saveas ${other}`)[0]).toContain("denied");
  expect(h.host.exec(`saveas ${other}`)).toBe(`the world is now saved in ${other}`);
  expect(h.host.exec(`saveas ${other}`)).toContain("already saved in");
  expect(h.host.exec(`saveas ${db}`)).toContain("already holds a save");
  expect(p.store.path).toBe(other);
  h.host.items.mint(rec, stone, 5);
  h.run(500);
  const tick = h.world.tick;
  h.host.shutdown();

  const moved = new Harness({}, 1, 60, { dbPath: other });
  expect(moved.host.loaded).toEqual({ fresh: false, tick, structures: h.world.structs.count, records: h.host.records.byPid.size });
  expect(moved.host.records.byPid.get(rec.pid)!.inv!.total(stone)).toBe(17);
  expect(moved.host.items.audit()).toEqual([]);
  expect(moved.join("ada").state).not.toBe("closed");
  moved.host.shutdown();
  // The first file was left as it was at the move.
  const first = new Harness({}, 1, 60, { dbPath: db });
  expect(first.host.records.byPid.get(rec.pid)!.inv!.total(stone)).toBe(12);
  first.host.shutdown();
});

test("a save file that is broken is left, and the world is saved beside it", () => {
  const { db, h, rec, p, stone } = world("corrupt");
  h.host.items.mint(rec, stone, 9);
  breakStore(p, "SQLITE_CORRUPT");
  const moved: string[] = [];
  p.onMoved = (path) => void moved.push(path);
  h.run(500);
  expect(moved.length).toBe(1);
  expect(moved[0]!.startsWith(`${db}.rescue-t`)).toBe(true);
  expect([p.failing, p.store.path]).toEqual([null, moved[0]!]);
  h.run(500);
  h.host.shutdown();
  expect(statSync(moved[0]!).size).toBeGreaterThan(0);
  const h2 = new Harness({}, 1, 60, { dbPath: moved[0]! });
  expect(h2.host.records.byPid.get(rec.pid)!.inv!.total(stone)).toBe(9);
  expect(h2.host.items.audit()).toEqual([]);
  h2.host.shutdown();
});

test("nothing writes to the save outside a commit", () => {
  const root = join(import.meta.dir, "../../server");
  const outside: string[] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) {
        if (name !== "persist") walk(path);
      } else if (name.endsWith(".ts") && /\.setMeta\(|\.saveChunk\(|\.saveEntity\(|\.saveBlob\(|\.appendJournal\(|\.db\.(exec|query|prepare|run)\(/.test(readFileSync(path, "utf8"))) outside.push(path.slice(root.length + 1));
    }
  };
  walk(root);
  expect(outside).toEqual([]);
});
