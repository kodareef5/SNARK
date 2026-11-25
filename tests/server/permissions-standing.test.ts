// Standing that follows the cluster's one permissions store: a change from another map that this map reads in the middle
// of its own change is worked out at once, whoever acts is judged by the store as it is then, and modules hear it all.
import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { OPERATOR } from "../../server/acts.ts";
import { idText } from "../../server/survivor-ids.ts";
import { RANK_ADMIN, RANK_OPEN } from "../../shared/ranks.ts";
import { TestCluster, rec, type Clock, type Server } from "../fixtures/cluster.ts";
import { listener } from "../fixtures/module.ts";

const quiet = { log: () => {} };
const REFUSED = "Permissions are managed from an admin's rank.";

/** Two maps of one cluster on one wall clock, a module on map b that hears permission changes. */
function maps(run: (a: Server, b: Server, clock: Clock, cluster: TestCluster, heard: string[]) => void): void {
  const cluster = new TestCluster();
  try {
    const clock = { ms: 1_000_000_000 };
    const ears = listener("ears", ["perm.changed"]);
    const a = cluster.server("a", "f", clock, { host: { survivorLog: { wall: () => clock.ms }, ...quiet } });
    const b = cluster.server("b", "f", clock, { host: { survivorLog: { wall: () => clock.ms }, modules: [ears.def], ...quiet } });
    run(a, b, clock, cluster, ears.heard.lines);
  } finally {
    cluster.cleanup();
  }
}

/** The operator's line on a map, which must be done. */
function must(s: Server, line: string): void {
  const out = s.h.host.exec(line);
  if (/^(There|That|denied)/.test(out)) throw new Error(`${line}: ${out}`);
}

/** Puts a survivor of map `s` in Admins there and signs them in with their own password. */
function admin(s: Server, session: ClientSession): string {
  const id = idText(rec(s, session.name)!);
  must(s, `Permissions.Add ${id} Admins`);
  const { why, password } = s.h.host.issuePassword(OPERATOR, id);
  if (why !== "") throw new Error(why);
  expect(s.h.say(session, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
  expect(s.h.client(session)!.rank).toBe(RANK_ADMIN);
  return id;
}

/** Lets map `s` read the store again, as it does every 5 s. */
function poll(s: Server, clock: Clock): void {
  clock.ms += 5000;
  s.h.run(200);
}

test("an admin taken out on another map is refused here before the next poll", () => {
  maps((a, b, _clock, cluster) => {
    const { session: ada } = cluster.survivor(b, "ada");
    const id = admin(b, ada);
    must(a, `Permissions.Remove ${id} Admins`);
    const c = b.h.client(ada)!;
    expect(b.h.say(ada, "Permissions.AddGroup Vip")).toEqual([REFUSED]);
    expect([c.rank, c.admin, b.h.host.permissions.group("Vip")]).toEqual([RANK_OPEN, false, undefined]);
  });
});

test("an admin whose password was cleared on another map makes no more changes", () => {
  maps((a, b, _clock, cluster) => {
    const { session: ada } = cluster.survivor(b, "ada");
    const id = admin(b, ada);
    expect(a.h.host.clearPassword(OPERATOR, id)).toBe("");
    const c = b.h.client(ada)!;
    expect(b.h.say(ada, "Permissions.AddGroup Vip")).toEqual([REFUSED]);
    expect([c.signed, c.rank, c.admin, b.h.host.permissions.group("Vip")]).toEqual([false, RANK_OPEN, false, undefined]);
  });
});

test("a tag choice here after another map's change works sessions out again", () => {
  maps((a, b, clock, cluster) => {
    const { session: bob } = cluster.survivor(b, "bob");
    const id = idText(rec(b, "bob")!);
    a.h.host.changePermissions(OPERATOR, { op: "setDocument", name: "chat", text: JSON.stringify({ ChatTags: { Vip: { Text: "[VIP]" } } }) });
    must(a, "Permissions.AddGroup Vip");
    must(a, "Permissions.AddGroup Gods");
    must(a, "Permissions.Grant Gods *");
    must(a, `Permissions.Add ${id} Vip`);
    must(a, `Permissions.Add ${id} Gods`);
    poll(b, clock);
    const c = b.h.client(bob)!;
    expect(c.admin).toBe(true);
    must(a, `Permissions.Remove ${id} Gods`);
    expect(b.h.say(bob, "disabletag Vip")).toEqual(["Your lines no longer show the tag Vip."]);
    expect(c.admin).toBe(false);
    poll(b, clock);
    expect(c.admin).toBe(false);
  });
});

test("a module hears a membership made on another map, and a timed one start and end", () => {
  maps((a, b, clock, cluster, heard) => {
    cluster.survivor(b, "bob");
    const id = idText(rec(b, "bob")!);
    const told = (): string[] => {
      b.h.run(100);
      return heard.splice(0).map((l) => l.replace("perm.changed: ", ""));
    };
    must(a, "Permissions.AddGroup Vip");
    must(a, `Permissions.Add ${id} Vip`);
    poll(b, clock);
    expect(told()).toEqual(['{"account":"","group":"Vip"}', `{"account":"${id}","group":"Vip"}`]);
    must(a, "Permissions.AddGroup Night");
    must(a, `Permissions.AddTimed ${id} Night 1 0.5`);
    poll(b, clock);
    expect(told()).toEqual(['{"account":"","group":"Night"}', `{"account":"${id}","group":"Night"}`]);
    clock.ms += 30 * 60_000;
    b.h.run(200);
    expect(told()).toEqual([`{"account":"${id}","group":"Night"}`]);
    clock.ms += 60 * 60_000;
    b.h.run(200);
    expect(told()).toEqual([`{"account":"${id}","group":"Night"}`]);
    // The other map drops the row that ran out as it makes its next change, which is heard once.
    must(a, "Permissions.AddGroup Day");
    poll(b, clock);
    expect(told()).toEqual(['{"account":"","group":"Day"}']);
  });
});

test("a refused change raises no event and writes no act", () => {
  maps((a, b, _clock, cluster, heard) => {
    const { session: ada } = cluster.survivor(b, "ada");
    const id = admin(b, ada);
    b.h.run(100);
    heard.length = 0;
    const acts = b.h.host.acts.recent(0, Number.MAX_SAFE_INTEGER).length;
    must(a, `Permissions.Remove ${id} Admins`);
    expect(b.h.say(ada, "Permissions.AddGroup Vip")).toEqual([REFUSED]);
    b.h.run(100);
    expect(b.h.host.acts.recent(0, Number.MAX_SAFE_INTEGER).length).toBe(acts);
    expect(heard).toEqual([`perm.changed: {"account":"${id}","group":"Admins"}`]);
  });
});
