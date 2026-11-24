// The half a tribe's survivors near an earner get of what it earns (server/experience.ts).

import { expect, test } from "bun:test";
import { XP_CRAFT, XP_GIVEN, XP_HARVEST, XP_KILL, XP_TIME } from "../../server/progression.ts";
import { Experience, SHARE_RANGE } from "../../server/experience.ts";
import { camp, put, record, ride, survivor, tame, type CampOptions } from "../kit/kit.ts";

/** Ada and bob of one tribe and cy of none, 3 m apart, with no drip to blur what each earns. */
function crew(rules: CampOptions["rules"] = {}) {
  const { h, ada, me, at } = camp({ tribe: "Crew", rules: { GenericXPMultiplier: 0, ...rules } });
  const bob = survivor(h, "bob", { tribe: "Crew", at: { x: at.x + 3, z: at.z } });
  const cy = survivor(h, "cy", { at: { x: at.x, z: at.z + 3 } });
  const recs = [me, record(h, bob), record(h, cy)];
  /** What each gained since the last asking. */
  let was = recs.map((r) => r.xp);
  const gained = (): number[] => {
    const now = recs.map((r) => r.xp);
    const d = now.map((v, i) => v - was[i]!);
    was = now;
    return d;
  };
  return { h, ada, bob, cy, at, me, him: recs[1]!, prog: h.host.progression, gained };
}

test("a tribe's survivor nearby gets half of a kill, a harvest and a craft; the earner keeps all", () => {
  const { me, prog, gained } = crew();
  gained();
  for (const source of [XP_KILL, XP_HARVEST, XP_CRAFT]) {
    expect(prog.addXp(me, 10, source)).toBe(10);
    // Bob's part is not shared back to ada, and cy is of no tribe of theirs.
    expect([source, ...gained()]).toEqual([source, 10, 5, 0]);
  }
});

test("experience given by an admin or by time is not shared", () => {
  const { me, prog, gained } = crew({ GenericXPMultiplier: 1 });
  gained();
  prog.addXp(me, 10, XP_GIVEN);
  prog.addXp(me, 10, XP_TIME);
  expect(gained()).toEqual([20, 0, 0]);
});

test("the share reaches 100 m and no farther", () => {
  const { h, bob, at, me, prog, gained } = crew();
  put(h, bob, { x: at.x + SHARE_RANGE - 5, z: at.z });
  gained();
  prog.addXp(me, 10, XP_HARVEST);
  expect(gained()).toEqual([10, 5, 0]);
  put(h, bob, { x: at.x + SHARE_RANGE + 5, z: at.z });
  prog.addXp(me, 10, XP_HARVEST);
  expect(gained()).toEqual([10, 0, 0]);
});

test("the share is multiplied once, as the earner's own is", () => {
  const { me, prog, gained } = crew({ XPMultiplier: 2, HarvestXPMultiplier: 3 });
  gained();
  prog.addXp(me, 10, XP_HARVEST);
  expect(gained()).toEqual([60, 30, 0]);
});

test("an earner at the cap still earns for its tribe; a dead survivor gets no share", () => {
  const { h, bob, me, him, prog, gained } = crew();
  me.xp = prog.most(me);
  gained();
  expect(prog.addXp(me, 10, XP_KILL)).toBe(0);
  expect(gained()).toEqual([0, 5, 0]);
  h.say(bob, "suicide");
  expect(him.dead).toBe(true);
  me.xp = 0;
  gained();
  prog.addXp(me, 10, XP_KILL);
  expect(gained()).toEqual([10, 0, 0]);
});

test("a ridden tame shares as its rider does; a loose tame gets nothing", () => {
  const { h, ada, at, me, him, prog, gained } = crew();
  const loose = tame(h, ada, "dodo", { at: { x: at.x - 5, z: at.z - 5 } });
  const mount = tame(h, ada, "raptor", { saddled: true });
  ride(h, ada, mount.e);
  const tames = (): number[] => [mount.rec.xp, loose.rec.xp];
  gained();
  let was = tames();
  // Bob earns: ada has half, and so has what she sits on.
  prog.addXp(him, 10, XP_HARVEST);
  expect([...gained(), ...tames().map((v, i) => v - was[i]!)]).toEqual([5, 10, 0, 5, 0]);
  // Ada earns from the saddle: her mount has half.
  was = tames();
  prog.addXp(me, 10, XP_CRAFT);
  expect([...gained(), ...tames().map((v, i) => v - was[i]!)]).toEqual([10, 5, 0, 5, 0]);
  // The mount earns, by a kill or from a corpse: its rider has one half, not two, and bob has his.
  for (const source of [XP_KILL, XP_HARVEST]) {
    was = tames();
    prog.addXp(mount.rec, 10, source);
    expect([source, ...gained(), ...tames().map((v, i) => v - was[i]!)]).toEqual([source, 5, 5, 0, 10, 0]);
  }
});

test("a rider of no tribe has half of what its mount earns; a tame two sit on has one part", () => {
  const { h, ada, bob, cy, me, him, prog, gained } = crew();
  const mount = tame(h, ada, "raptor", { saddled: true }).rec;
  const yours = record(h, cy);
  const ctx = { world: h.host.world, records: h.host.records, game: h.server, progression: prog, awake: (): [number[], number] => [[], 0] };
  // Cy steers a creature of a tribe that is not cy's, as a carrier holds a wild one.
  new Experience({ ...ctx, mountOf: () => null, riderOf: (rec) => (rec === mount ? yours : null) });
  gained();
  prog.addXp(mount, 10, XP_KILL);
  expect([...gained(), mount.xp]).toEqual([5, 5, 5, 10]);
  // Ada and bob both sit on it, and cy earns nothing of theirs. Ada earns: bob has half, and the tame half once.
  new Experience({ ...ctx, mountOf: (rec) => (rec === me || rec === him ? mount : null), riderOf: () => null });
  void [ada, bob];
  prog.addXp(me, 10, XP_CRAFT);
  expect([...gained(), mount.xp]).toEqual([10, 5, 0, 15]);
});
