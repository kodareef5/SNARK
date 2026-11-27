// The Decide settings copied to a cluster (server/decide/shared.ts): the worlds share only the folder, each reads the copy
// off the tick's thread every five seconds and takes one newer than the last it took, which its save keeps.

import { afterAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DecideAdmin } from "../../server/admin/decide.ts";
import { COPY_FILE, copyOf, readCopy } from "../../server/decide/shared.ts";
import { TestCluster, type Server } from "../fixtures/cluster.ts";
import { Harness } from "../fixtures/net.ts";

const t = new TestCluster();
afterAll(() => t.cleanup());
const clock = { ms: Date.now() };

/** Five seconds of ticks on each world, the reads they started let finish, then the tick that takes what was read. */
async function beat(...servers: Server[]): Promise<void> {
  for (const s of servers) s.h.run(5000);
  for (const s of servers) await copyOf(s.h.host.decide)!.idle();
  for (const s of servers) s.h.server.tick();
}

const policy = (s: Server): string => s.h.host.rules.text("DecidePolicy");
const copied = (s: Server): number => copyOf(s.h.host.decide)!.rev;
const fileOf = (s: Server): string => join(s.h.host.cluster!.folder.root, COPY_FILE);
const write = (s: Server, rev: number, DecidePolicy: string, from = 9): void =>
  writeFileSync(fileOf(s), JSON.stringify({ rev, from, at: clock.ms, settings: { DecidePolicy, DecideSample: "256", DecideLogMegabytes: "64" } }));

test("a copy from one world reaches every world, its writer too, kept and logged", async () => {
  const a = t.server("Island", "reach", clock), b = t.server("Miami", "reach", clock);
  expect(a.h.host.pageSetting("DecidePolicy", "*=watch").why).toBe("");
  expect(a.h.host.pageSetting("DecideSample", "32").why).toBe("");
  expect(await new DecideAdmin(a.h.host).act({ op: "clone" })).toBe("");
  expect(readCopy(await Bun.file(fileOf(a)).text())).toMatchObject({ rev: 1, from: a.world, settings: { DecidePolicy: "*=watch", DecideSample: "32", DecideLogMegabytes: "64" } });
  expect(a.h.host.acts.recent().at(-1)!.what).toBe("copied the Decide settings to every world of the cluster (copy 1)");
  // Nothing is taken before a tick has read it and a later tick has taken it.
  expect(policy(b)).toBe("");
  await beat(a, b);
  expect([policy(a), policy(b), b.h.host.rules.num("DecideSample"), copied(a), copied(b)]).toEqual(["*=watch", "*=watch", 32, 1, 1]);
  expect(b.h.host.kept.words.get("DecidePolicy")).toBe("*=watch");
  expect(b.h.host.acts.recent().filter((x) => x.name === `(world ${a.world}'s copy)`).map((x) => x.what)).toEqual(["setting DecidePolicy *=watch", "setting DecideSample 32"]);
  // The writer had them already, so it wrote no act of taking them.
  expect(a.h.host.acts.recent().some((x) => x.name.endsWith("'s copy)"))).toBe(false);
  // The next copy counts on from the newest in the folder, whoever wrote it.
  expect(b.h.host.pageSetting("DecidePolicy", "*=rule").why).toBe("");
  expect(await new DecideAdmin(b.h.host).act({ op: "clone" })).toBe("");
  await beat(a, b);
  expect([policy(a), copied(a), copied(b)]).toEqual(["*=rule", 2, 2]);
  a.h.host.shutdown();
  b.h.host.shutdown();
});

test("a copy no newer than the last taken is left", async () => {
  const a = t.server("Island", "older", clock);
  write(a, 3, "*=rule");
  await beat(a);
  expect([policy(a), copied(a)]).toEqual(["*=rule", 3]);
  write(a, 2, "*=watch");
  await beat(a);
  write(a, 3, "*=model");
  await beat(a);
  expect([policy(a), copied(a)]).toEqual(["*=rule", 3]);
  a.h.host.shutdown();
});

test("a world started again does not take a copy it took before", async () => {
  const a = t.server("Island", "restart", clock);
  write(a, 1, "*=watch");
  await beat(a);
  expect(policy(a)).toBe("*=watch");
  // Set by hand since: a restart keeps that over the copy it took.
  expect(a.h.host.pageSetting("DecidePolicy", "nav.ring=rule").why).toBe("");
  a.h.host.shutdown();
  const again = t.server("Island", "restart", clock);
  expect([policy(again), copied(again)]).toEqual(["nav.ring=rule", 1]);
  await beat(again);
  expect(policy(again)).toBe("nav.ring=rule");
  again.h.host.shutdown();
});

test("a copy taken just before a crash is not taken again after it", async () => {
  const a = t.server("Island", "crash", clock);
  write(a, 4, "*=watch");
  await beat(a);
  expect(a.h.host.pageSetting("DecidePolicy", "*=off").why).toBe("");
  // A crash loses what the save had not committed; the note of the copy taken was written when it was taken.
  a.h.host.persistence!.close();
  a.h.host.cluster!.stop();
  const again = t.server("Island", "crash", clock);
  await beat(again);
  expect([policy(again), copied(again)]).toEqual(["*=off", 4]);
  again.h.host.shutdown();
});

test("a broken or half-written copy is left and read again", async () => {
  const a = t.server("Island", "broken", clock);
  writeFileSync(fileOf(a), '{"rev":5,"from":2,"settings":{"DecidePolicy":"*=rule"');
  await beat(a);
  writeFileSync(fileOf(a), JSON.stringify({ rev: 5, from: 2, settings: { DecidePolicy: "*=rule" } }));
  await beat(a);
  expect([policy(a), copied(a)]).toEqual(["", 0]);
  write(a, 5, "*=rule");
  await beat(a);
  expect([policy(a), copied(a)]).toEqual(["*=rule", 5]);
  a.h.host.shutdown();
});

test("a world alone has no copy to take part in and refuses to make one", async () => {
  const h = new Harness({}, 1, 30, { dev: true, wild: false });
  expect(copyOf(h.host.decide)).toBeNull();
  expect(await new DecideAdmin(h.host).act({ op: "clone" })).toBe("this world is in no cluster, so there is no other world to copy to");
});
