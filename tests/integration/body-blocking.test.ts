// Controlled movement meets only a visible, independently standing adult. Followers/AI keep ordinary movement.
import { expect, test } from "bun:test";
import { frozenPack } from "../fixtures/pack.ts";
import { SentView } from "../../shared/net/view.ts";
import { CUE_DEAD, CUE_OUT } from "../../shared/anim/pose.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { Body, BTN_SPRINT } from "../../shared/sim/character.ts";
import { F_HELD } from "../../shared/sim/entities.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { Rng } from "../../shared/rng.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function yard(rtt = 0, pve = false) {
  const pack = frozenPack();
  const h = new Harness({}, 7, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, wild: false, map: writeMap(flatMap(4)) });
  h.host.setSetting("serverPVE", String(pve));
  const s = h.join("rider", { latencyMs: rtt / 2, jitterMs: rtt ? 5 : 0 }); h.run(1600);
  const c = h.client(s)!, a = h.world.ents, owner = h.host.records.byPid.get(c.pid)!;
  const place = (e: number, x: number, z: number): void => { a.vx[e] = a.vy[e] = a.vz[e] = 0; a.setPosition(e, x, 0, z); h.world.history.discontinuity(e); };
  const creature = (name: string, x: number, z: number, team = 0): number => {
    const e = h.host.spawnCreature(`core:${name}`, x, z, 1), rec = h.host.records.byPid.get(a.pid[e]!)!;
    rec.team = team; rec.saddle = h.reg.index.get(`core:saddle_${name}`) ?? 0; a.yaw[e] = 0;
    h.host.refreshBody(rec); h.host.creatures.claimed(e); h.host.creatures.mind.stay(e, 0xffffffff); return e;
  };
  place(c.ent, 100, 100); h.run(300);
  const tick = (move: number, yaw = 0): void => { c.inputs.set(h.world.tick + 1, 0, move, yaw, 0, 0); h.server.tick(); };
  return { h, s, c, a, owner, place, creature, tick };
}
function position(h: Harness, e: number): number[] { const a = h.world.ents; return [a.x[e]!, a.y[e]!, a.z[e]!, a.vx[e]!, a.vy[e]!, a.vz[e]!]; }
function sent(h: Harness, s: ReturnType<Harness["join"]>, e: number): boolean {
  const c = h.client(s)!, view = c.views.find(c.lastSnapshot); if (!view) return false;
  for (let i = 0; i < view.count; i++) if (view.id[i] === e && view.gen[i] === h.world.ents.gen[e]) return true;
  return false;
}
function barrier(h: Harness, z = 110): void {
  const wall = h.reg.index.get("core:wall_stone")!, door = h.reg.index.get("core:doorframe_stone")!;
  h.world.structs.add(door, 100, 1.5, z, 0, 99, 10000);
  for (let k = 1; k <= 6; k++) for (const sign of [-1, 1]) h.world.structs.add(wall, 100 + sign * 3 * k, 1.5, z, 0, 99, 10000);
}

test("a visible isolated adult blocks a controlled walker or mount in either direction without displacement, and reverse works", () => {
  for (const riding of [false, true]) for (const direction of [1, -1]) {
    const { h, c, a, owner, creature, place, tick } = yard();
    try {
      const target = creature("parasaur", 100.001, 100 + direction * 8.001);
      let body = c.ent;
      if (riding) {
        body = creature("raptor", 100, 100, owner.team); a.yaw[body] = direction === 1 ? 0 : 32768;
        place(c.ent, 98, 100); h.pilots[0]!.yaw = direction === 1 ? 0 : Math.PI;
        expect(h.host.riding.mount(c, body)).toBe(RESULT_OK); h.run(450); expect(c.drive).toBe(body);
      } else h.run(450);
      const fixed = position(h, target), vitals = h.host.records.byPid.get(a.pid[target]!)!.vitals!, hp = vitals.at(V_HEALTH, h.world.tick);
      for (let i = 0; i < 150; i++) tick(127, direction === 1 ? 0 : 32768);
      const stopped = a.z[body]!; expect(direction * (stopped - 100)).toBeGreaterThan(5);
      expect(direction * (a.z[target]! - stopped)).toBeGreaterThan(1.4);
      expect(position(h, target)).toEqual(fixed); expect(vitals.at(V_HEALTH, h.world.tick)).toBe(hp);
      for (let i = 0; i < 70; i++) tick(-127, direction === 1 ? 0 : 32768);
      expect(direction * (stopped - a.z[body]!)).toBeGreaterThan(2);
    } finally { h.host.shutdown(); }
  }
});

test("owned and PvE protected tames yield on ordinary controls and the public rule follows setting changes", () => {
  for (const own of [false, true]) {
    const { h, s, c, a, owner, creature, tick } = yard(0, !own);
    try {
      const target = creature("parasaur", 100, 108, own ? owner.team : owner.team + 10); h.run(350);
      expect(s.pve).toBe(!own); const fixed = position(h, target);
      for (let i = 0; i < 160; i++) tick(127);
      expect(a.z[c.ent]!).toBeGreaterThan(115); expect(position(h, target)).toEqual(fixed);
      h.host.setSetting("serverPVE", String(own)); h.run(350); expect(s.pve).toBe(own);
    } finally { h.host.shutdown(); }
  }
});

test("a wild dodo in a doorway and a ring of hostile bodies allow deterministic escape without crossing walls", () => {
  for (const door of [true, false]) {
    const { h, c, a, creature, tick } = yard();
    try {
      const blockers: number[] = [];
      if (door) { barrier(h, 103); blockers.push(creature("dodo", 100, 103)); }
      else for (let i = 0; i < 4; i++) blockers.push(creature("raptor", 100 + Math.sin(i * Math.PI / 2) * 1.2, 100 + Math.cos(i * Math.PI / 2) * 1.2));
      h.run(350); const fixed = blockers.map(e => position(h, e)), p = h.reg.move[a.kind[c.ent]!]!;
      for (let i = 0; i < 100; i++) { tick(127); expect(capsuleFree(h.world, a.x[c.ent]!, a.y[c.ent]!, a.z[c.ent]!, p.radius, p.height)).toBe(true); }
      expect(a.z[c.ent]!).toBeGreaterThan(110); expect(blockers.map(e => position(h, e))).toEqual(fixed);
    } finally { h.host.shutdown(); }
  }
});

test("eight following raptors get through a normal door without any AI body query", () => {
  for (const clustered of [false, true]) {
    const { h, c, a, owner, creature, tick } = yard();
    try {
      barrier(h); const rng = new Rng(109), followers: number[] = [];
      for (let i = 0; i < 8; i++) {
        const e = creature("raptor", clustered ? 97 + rng.float() * 6 : 100 + (rng.float() - .5) * .6, clustered ? 91 + rng.float() * 6 : 97 - i * 2, owner.team);
        h.host.creatures.mind.follow(e, c.ent); followers.push(e);
      }
      const contacts = h.server.bodyContacts, original = contacts.prepare.bind(contacts);
      contacts.prepare = (...args) => { expect(args[0]).toBe(c.ent); return original(...args); };
      for (let i = 0; i < 600; i++) tick(a.z[c.ent]! < 125 ? 127 : 0);
      expect(followers.every(e => a.z[e]! > 111)).toBe(true);
    } finally { h.host.shutdown(); }
  }
});

test("an owner walks out of a dead end past their following and then staying tames", () => {
  for (const stay of [false, true]) {
    const { h, c, a, owner, creature, place, tick } = yard();
    try {
      place(c.ent, 100, 96); const wall = h.reg.index.get("core:wall_stone")!;
      for (const z of [101.5, 104.5, 107.5, 110.5]) for (const x of [98.9, 101.1]) h.world.structs.add(wall, x, 1.5, z, 16384, 99, 10000);
      h.world.structs.add(wall, 100, 1.5, 112.1, 0, 99, 10000);
      const followers = [creature("raptor", 100, 93, owner.team), creature("raptor", 100.2, 90, owner.team)];
      for (const e of followers) h.host.creatures.mind.follow(e, c.ent);
      for (let i = 0; i < 450; i++) tick(a.z[c.ent]! < 111 ? 127 : 0);
      if (stay) for (const e of followers) h.host.creatures.mind.follow(e, -1);
      for (let i = 0; i < 100; i++) tick(127, 32768);
      expect(a.z[c.ent]!).toBeLessThan(100);
    } finally { h.host.shutdown(); }
  }
});

test("newborn, knocked-out, carried, occupied and dead bodies yield", () => {
  const { h, c, a, creature, owner, place } = yard();
  try {
    const target = creature("parasaur", 100, 102), rec = h.host.records.byPid.get(a.pid[target]!)!;
    h.run(350); const b = new Body(), p = h.reg.move[a.kind[c.ent]!]!, contacts = h.server.bodyContacts;
    a.loadBody(c.ent, b);
    const prepare = () => contacts.prepare(c.ent, b, p, c.views.find(c.lastSnapshot), owner.team, 0, 127, 0, c.views);
    expect(prepare()?.count).toBe(1);
    rec.grown = h.world.tick + 1000; rec.span = 1000; a.setYoung(target, rec.span, rec.grown); h.host.refreshBody(rec); h.run(250); expect(prepare()).toBeUndefined();
    rec.grown = rec.span = 0; a.setYoung(target, 0, 0); place(target, 100, 102); h.host.creatures.mind.stay(target, 0xffffffff);
    h.host.refreshBody(rec); h.run(250); expect(prepare()?.count).toBe(1);
    a.cue[target] = CUE_OUT; expect(prepare()).toBeUndefined(); a.cue[target] = 0;
    a.flags[target]! |= F_HELD; expect(prepare()).toBeUndefined(); a.flags[target]! &= ~F_HELD;
    a.cue[target] = CUE_DEAD; expect(prepare()).toBeUndefined(); a.cue[target] = 0;
    a.seat[target] = c.ent + 1; a.seatGen[target] = a.gen[c.ent]!; expect(prepare()).toBeUndefined(); a.seat[target] = 0;
    a.driven[target] = 1; expect(prepare()).toBeUndefined(); a.driven[target] = 0;
  } finally { h.host.shutdown(); }
});

test("newborns never make adult-sized walls for a delayed walking client", () => {
  const { h, s, c, a, owner, creature } = yard(150);
  try {
    const target = creature("parasaur", 100, 104, owner.team + 10), rec = h.host.records.byPid.get(a.pid[target]!)!;
    rec.grown = h.world.tick + 3000; rec.span = 3000; a.setYoung(target, rec.span, rec.grown); h.host.refreshBody(rec);
    h.run(1000); const before = position(h, target), corrections = s.stats.corrections;
    h.pilots[0]!.moveZ = 1; h.run(3000);
    expect(a.z[c.ent]!).toBeGreaterThan(112); expect(position(h, target)).toEqual(before);
    expect(s.stats.corrections - corrections).toBe(0); expect(Math.hypot(s.smoothX, s.smoothY, s.smoothZ)).toBe(0);
  } finally { h.host.shutdown(); }
});

test("a newly seen adult needs stationary history; an old sent position or generation cannot block", () => {
  const { h, c, a, creature, owner, place } = yard();
  try {
    const target = creature("parasaur", 100, 102), b = new Body(), p = h.reg.move[a.kind[c.ent]!]!;
    a.loadBody(c.ent, b);
    const prepare = (view = c.views.find(c.lastSnapshot)) => h.server.bodyContacts.prepare(c.ent, b, p, view, owner.team, 0, 127, 0, c.views);
    h.run(100); expect(prepare()).toBeUndefined(); h.run(300); expect(prepare()?.count).toBe(1);
    const previous = new SentView(), view = c.views.find(c.lastSnapshot)!;
    previous.tick = view.tick; for (let i = 0; i < view.count; i++) previous.copyFrom(view, i);
    place(target, 100, 102.2); expect(prepare(previous)).toBeUndefined();
    h.run(500); expect(prepare()?.count).toBe(1);
    const handle = a.handleOf(target); h.host.creatures.remove(target);
    expect(a.resolve(handle)).toBe(-1); expect(prepare()).toBeUndefined();
    // Real allocation can reuse the raw slot, but it has no stationary sent history under the old generation.
    creature("parasaur", 100, 102); expect(prepare()).toBeUndefined();
  } finally { h.host.shutdown(); }
});

test("eviction from the latest sent view releases a previously visible blocker even while its old ACK view remains", () => {
  const { h, s, c, a, creature, tick } = yard(150);
  try {
    const target = creature("parasaur", 100, 104); h.run(1000); expect(sent(h, s, target)).toBe(true);
    const old = c.views.find(c.lastSnapshot)!, filtered = new SentView(), before = position(h, target);
    // Use the public visibility hook: the next real packets remove this body. The live world still contains it.
    h.server.viewFor = (_client, view) => {
      filtered.count = 0; filtered.tick = view.tick;
      for (let i = 0; i < view.count; i++) if (view.id[i] !== target) filtered.copyFrom(view, i);
      return filtered;
    };
    h.run(100); expect(sent(h, s, target)).toBe(false);
    expect(old.id.subarray(0, old.count)).toContain(target);
    const acked = c.views.find(c.ackTick)!; expect(acked.id.subarray(0, acked.count)).toContain(target);
    for (let i = 0; i < 140; i++) tick(127);
    expect(a.z[c.ent]!).toBeGreaterThan(115); expect(position(h, target)).toEqual(before);
  } finally { h.host.shutdown(); }
});

test("a body omitted by the actual sent view cannot form an invisible wall at a low view cap", () => {
  const { h, s, c, a, creature, tick } = yard(150);
  try {
    s.view(256, 1100); h.run(1200); const rng = new Rng(10);
    for (let i = 0; i < 600; i++) {
      const angle = rng.float() * Math.PI * 2, r = 25 + rng.float() * 20;
      const e = creature("dodo", 100 + Math.sin(angle) * r, 100 + Math.cos(angle) * r);
      h.host.creatures.mind.stay(e, 0);
    }
    const target = creature("parasaur", 100, 103); h.run(2500);
    let visible = 0;
    for (let i = 0; i < 100; i++) { if (sent(h, s, target)) visible++; tick(127); }
    expect(visible).toBe(0); expect(a.z[c.ent]!).toBeGreaterThan(110);
  } finally { h.host.shutdown(); }
});

test("150 ms standing off-grid blocker predicts exactly, while a moving crowd does not pull the controller", () => {
  for (const moving of [false, true]) {
    const { h, s, c, a, creature } = yard(150);
    try {
      if (moving) {
        for (let i = 0; i < 20; i++) { const e = creature("dodo", 95 + i % 5 * 2.5, 105 + Math.floor(i / 5) * 2.5); h.host.creatures.mind.stay(e, 0); }
      } else creature("parasaur", 100.001, 108.001);
      h.run(1500); const corrections = s.stats.corrections;
      let maxPull = 0; h.pilots[0]!.moveZ = 1; h.pilots[0]!.buttons = moving ? BTN_SPRINT : 0;
      for (let i = 0; i < 240; i++) {
        h.run(1000 / 60); maxPull = Math.max(maxPull, Math.hypot(s.smoothX, s.smoothY, s.smoothZ));
      }
      expect(s.stats.corrections - corrections).toBe(0); expect(maxPull).toBe(0);
      if (moving) expect(a.z[c.ent]!).toBeGreaterThan(120); else expect(a.z[c.ent]!).toBeLessThan(107);
    } finally { h.host.shutdown(); }
  }
});

test("a ridden raptor crosses a native wandering crowd with at most one bounded stop/start pull at 150 ms", () => {
  const { h, s, c, a, owner, creature, place } = yard(150);
  try {
    const flock: number[] = [];
    for (let i = 0; i < 20; i++) { const e = creature("dodo", 95 + i % 5 * 2.5, 110 + Math.floor(i / 5) * 2.5); h.host.creatures.mind.stay(e, 0); flock.push(e); }
    const mount = creature("raptor", 100, 100, owner.team); place(c.ent, 98.5, 100);
    expect(h.host.riding.mount(c, mount)).toBe(RESULT_OK); h.run(1200); expect(s.driving).toBe(mount);
    const corrections = s.stats.corrections; let pull = 0, minZ = Infinity, maxZ = -Infinity, moving = 0;
    for (let frame = 0; frame < 1200; frame++) {
      const seconds = frame / 60, pilot = h.pilots[0]!; pilot.moveZ = 1;
      pilot.yaw = (Math.floor(seconds / 5) % 2 === 0 ? 0 : Math.PI) + .35 * Math.sin(seconds * 2.1);
      h.run(1000 / 60); pull = Math.max(pull, Math.hypot(s.smoothX, s.smoothY, s.smoothZ));
      minZ = Math.min(minZ, a.z[mount]!); maxZ = Math.max(maxZ, a.z[mount]!);
      if (flock.some(e => a.vx[e] !== 0 || a.vz[e] !== 0)) moving++;
    }
    expect(maxZ - minZ).toBeGreaterThan(14); expect(moving).toBeGreaterThan(1000);
    // A genuinely stopped neighbour can start between snapshots. Keep that measured limit visible, not an exact-prediction claim.
    expect(c.drive).toBe(mount); expect(s.stats.corrections - corrections).toBeLessThanOrEqual(1); expect(pull).toBeLessThan(.16);
  } finally { h.host.shutdown(); }
});

test("a hunting raptor's attack pauses do not become blockers while a delayed survivor fights and retreats", () => {
  const { h, s, c, a, creature } = yard(250);
  try {
    const enemy = creature("raptor", 100, 114); h.host.survival.gods.add(c.pid);
    h.host.creatures.mind.provoke(enemy, 100, 100, c.ent); h.run(200);
    const hurt = h.host.survival.hurt.bind(h.host.survival); let bites = 0, pull = 0;
    h.host.survival.hurt = (...args) => { if (args[0].pid === c.pid) bites++; return hurt(...args); };
    const corrections = s.stats.corrections;
    for (let frame = 0; frame < 1200; frame++) {
      const t = frame / 60, pilot = h.pilots[0]!;
      pilot.yaw = Math.atan2(a.x[enemy]! - a.x[c.ent]!, a.z[enemy]! - a.z[c.ent]!); pilot.buttons = 0;
      if (t < 2) { pilot.moveX = 0; pilot.moveZ = 0; }
      else if (t < 5) { pilot.moveX = 1; pilot.moveZ = 0; }
      else if (t < 8) { pilot.moveX = -1; pilot.moveZ = 0; }
      else if (t < 11) { pilot.moveX = 0; pilot.moveZ = -1; }
      else if (t < 14) { pilot.moveX = 0; pilot.moveZ = 1; pilot.buttons = BTN_SPRINT; }
      else if (t < 18) { pilot.moveX = 0; pilot.moveZ = 1; pilot.yaw += Math.PI; pilot.buttons = BTN_SPRINT; }
      else { pilot.moveX = .5; pilot.moveZ = .5; }
      h.host.creatures.mind.provoke(enemy, a.x[c.ent]!, a.z[c.ent]!, c.ent); h.run(1000 / 60);
      pull = Math.max(pull, Math.hypot(s.smoothX, s.smoothY, s.smoothZ));
    }
    expect(bites).toBeGreaterThan(5); expect(s.stats.corrections - corrections).toBe(0); expect(pull).toBe(0);
  } finally { h.host.shutdown(); }
});

test("a delayed survivor can walk through a stationary survivor or occupied mount without a prediction pull", () => {
  for (const riding of [false, true]) {
    const { h, s, c, a, creature, place } = yard(150);
    try {
      const other = h.join("other"); h.run(1000);
      const otherClient = h.client(other)!;
      let target = otherClient.ent;
      if (riding) {
        target = creature("parasaur", 100, 106, a.team[otherClient.ent]!);
        place(otherClient.ent, 98, 106);
        expect(h.host.riding.mount(otherClient, target)).toBe(RESULT_OK);
      } else place(target, 100, 106);
      h.run(1200);
      expect(sent(h, s, target)).toBe(true);
      const fixed = position(h, target), corrections = s.stats.corrections;
      h.pilots[0]!.moveZ = 1; h.run(5500);
      expect(a.z[c.ent]!).toBeGreaterThan(112);
      expect(position(h, target)).toEqual(fixed);
      expect(s.stats.corrections).toBe(corrections);
    } finally { h.host.shutdown(); }
  }
});
