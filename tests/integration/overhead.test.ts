import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { BAR_FOOD, BAR_HEALTH, BAR_TAMING, BAR_TORPOR, OVER_RANGE, OWNER_OTHER, OWNER_TRIBE, OWNER_WILD, OverheadModel, fillOverhead, type Heads } from "../../client/core/hud.ts";
import { LOOK_RANGE } from "../../server/overhead.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { IMAGE_HEART, KEY_HEART, KEY_OVER_BAR, KEY_OVER_TITLE } from "../../client/core/ui/tame.ts";
import { CUE_MATING_SHIFT, MATING_STEPS } from "../../shared/anim/pose.ts";
import { BitReader } from "../../shared/net/codec.ts";
import { ORDER_MATE, ORDER_UNMATE, OWN_OVERHEAD, RESULT_OK, S_OWN } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { MATE_TICKS, youngScale } from "../../shared/sim/breeding.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { V_TORPOR } from "../../shared/sim/vitals.ts";
import type { EntityRecord } from "../../server/records.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const mating = (h: Harness, e: number): number => (h.world.ents.cue[e]! >>> CUE_MATING_SHIFT) & 7;

/** The mating step session `s` holds for entity `e`, or -1 if it does not have it in view. */
function seen(s: ClientSession, e: number): number {
  const r = new RemoteSample();
  s.sampleRemote(r);
  for (let i = 0; i < r.count; i++) if (r.id[i] === e) return (r.cue[i]! >>> CUE_MATING_SHIFT) & 7;
  return -1;
}

function tame(h: Harness, owner: EntityRecord, x: number, z: number, female: boolean, name = ""): { e: number; rec: EntityRecord } {
  const e = h.host.spawnCreature("core:dodo", x, z, 10);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  rec.genome!.female = female;
  h.host.taming.give(rec, owner, 1);
  // Held where it is, so that a look finds it where it was put.
  h.host.creatures.mind.stay(e, 0xffffffff);
  if (name !== "") {
    rec.name = name;
    h.host.refreshBody(rec);
  }
  return { e, rec };
}

/** Points `s` at the middle of entity `e`. */
function aim(h: Harness, s: ClientSession, e: number): void {
  const ents = h.world.ents;
  const me = h.ent(s);
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  const eye = ents.y[me]! + stanceEye(h.reg.move[ents.kind[me]!]!, 0);
  const [dx, dz] = [ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!];
  const size = ents.grown[e] !== 0 ? youngScale(h.reg.birthScale[ents.kind[e]!]!, ents.span[e]!, ents.grown[e]!, h.world.tick) : 1;
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * size * 0.5 - eye, Math.hypot(dx, dz));
}

/** Every OWN_OVERHEAD session `s` is sent from now on, as its fields come off the wire. */
function tap(h: Harness, s: ClientSession): { id: number; fields: number[]; tribe: string }[] {
  const got: { id: number; fields: number[]; tribe: string }[] = [];
  const end = h.ends[h.sessions.indexOf(s)]!;
  const inner = end.onMessage!;
  end.onMessage = (channel, data) => {
    if (data[0] === S_OWN && data[1] === OWN_OVERHEAD) {
      const r = new BitReader(data);
      r.u8();
      r.u8();
      if (r.bool()) {
        const id = r.u32();
        const fields: number[] = [];
        for (let k = 0; k < 3; k++) fields.push(r.bool() ? r.bits(10) : -1);
        const tamed = r.bool();
        fields.push(tamed ? r.bits(10) : -1, tamed ? r.bits(10) : -1);
        fields.push(r.bool() ? r.bits(10) : -1);
        got.push({ id, fields, tribe: r.bool() ? r.string(200) : "" });
      }
    }
    inner(channel, data);
  };
  return got;
}

test("a mating pair carries its heart on both creatures, rising to the last step, and loses it when the pair ends; a restart keeps no heart the pairing does not give again", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-overhead-"));
  const dbPath = join(dir, "world.db");
  let h = new Harness({}, 1, 60, { dev: true, dbPath });
  let ada = h.join("ada");
  let bob = h.join("bob");
  h.run(500);
  const g = flatGround(h, 60, 30);
  const at = { x: g.x + 20, z: g.z + 8 };
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.say(bob, `tp ${(at.x + 5).toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const f = tame(h, me, at.x - 1, at.z + 4, true);
  const m = tame(h, me, at.x + 1, at.z + 4, false);
  const breeding = h.host.breeding;
  expect(breeding.order(f.rec, ORDER_MATE)).toBe(RESULT_OK);
  expect(breeding.order(m.rec, ORDER_MATE)).toBe(RESULT_OK);
  h.run(1100);
  expect([breeding.pairCount, mating(h, f.e), mating(h, m.e)]).toEqual([1, 1, 1]);
  h.run(300);
  // Its tribe sees how far along it is, another survivor only that it has begun.
  expect([seen(ada, f.e), seen(ada, m.e), seen(bob, f.e), seen(bob, m.e)]).toEqual([1, 1, 1, 1]);

  // Told to stop, the male parts the pair, and both lose the heart at once.
  expect(breeding.order(m.rec, ORDER_UNMATE)).toBe(RESULT_OK);
  h.run(100);
  expect([breeding.pairCount, mating(h, f.e), mating(h, m.e)]).toEqual([0, 0, 0]);
  expect(breeding.order(m.rec, ORDER_MATE)).toBe(RESULT_OK);
  h.run(1100);
  expect(breeding.pairCount).toBe(1);

  // The step rises with the pair's progress, the same on both, and never falls while the pair lasts.
  const steps: number[] = [];
  for (let k = 0; k < 6; k++) {
    h.run(2000);
    expect(mating(h, m.e)).toBe(mating(h, f.e));
    expect(seen(ada, f.e)).toBe(mating(h, f.e));
    expect(seen(bob, f.e)).toBe(1);
    steps.push(mating(h, f.e));
  }
  expect(steps.every((s, k) => k === 0 || s >= steps[k - 1]!)).toBe(true);
  expect(steps[steps.length - 1]).toBeGreaterThan(steps[0]!);

  // A restart midway. The pairing is not saved, so the hearts come back with the pair it forms again, from the first step.
  const [fp, mp] = [f.rec.pid, m.rec.pid];
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  ada = h.join("ada");
  bob = h.join("bob");
  const fe = (): number => h.host.records.entOf.get(fp)!;
  const mq = (): number => h.host.records.entOf.get(mp)!;
  expect([mating(h, fe()), mating(h, mq())]).toEqual([0, 0]);
  h.run(1500);
  expect([h.host.breeding.pairCount, mating(h, fe()), mating(h, mq()), seen(ada, fe()), seen(bob, mq())]).toEqual([1, 1, 1, 1, 1]);

  // The pair finishes: an egg, and no heart on either, to anyone.
  let last = 0;
  for (let t = 0; t < MATE_TICKS / 30 + 5 && h.host.breeding.mated === 0; t++) {
    last = Math.max(last, mating(h, fe()));
    h.run(1000);
  }
  expect([h.host.breeding.mated, last]).toEqual([1, MATING_STEPS]);
  h.run(300);
  expect([mating(h, fe()), mating(h, mq()), seen(ada, fe()), seen(ada, mq()), seen(bob, fe())]).toEqual([0, 0, 0, 0, 0]);
  h.run(3000);
  expect([h.host.breeding.pairCount, mating(h, fe())]).toEqual([0, 0]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const NO_HEADS: Heads = { overhead: () => false };

/**
 * Ada and Cara of the Lagoon, Bob of the Reef, and Sam spectating, a few metres south of a row of dodos: Ada's Pip, Bob's
 * Bolt, a wild one knocked out and half tamed, and Ada's baby; behind them a pair of Ada's, mating.
 */
function gathering() {
  const h = new Harness({ spectators: "anyone" }, 1, 60, { dev: true });
  const [ada, cara, bob] = [h.join("ada"), h.join("cara"), h.join("bob")];
  h.run(500);
  const g = flatGround(h, 60, 30);
  const at = { x: g.x + 20, z: g.z + 8 };
  for (const s of [ada, cara, bob]) h.say(s, "enablecheats");
  h.say(ada, "tribe create Lagoon");
  h.say(ada, "tribe invite cara");
  h.say(cara, "tribe accept");
  h.say(bob, "tribe create Reef");
  for (const [s, dx] of [[ada, -4], [cara, 0], [bob, 4]] as const) h.say(s, `tp ${(at.x + dx).toFixed(3)} ${at.z.toFixed(3)}`);
  const recOf = (s: ClientSession): EntityRecord => h.host.records.byPid.get(h.client(s)!.pid)!;
  expect(recOf(cara).team).toBe(recOf(ada).team);
  const pip = tame(h, recOf(ada), at.x - 6, at.z + 5, false, "Pip");
  const bolt = tame(h, recOf(bob), at.x - 2, at.z + 5, true, "Bolt");
  const wildE = h.host.spawnCreature("core:dodo", at.x + 2, at.z + 5, 20);
  const wild = h.host.records.byPid.get(h.world.ents.pid[wildE]!)!;
  h.host.creatures.mind.stay(wildE, 0xffffffff);
  h.host.survival.add(wild, V_TORPOR, wild.vitals!.max[V_TORPOR]! / 1e6 + 1);
  const baby = tame(h, recOf(ada), at.x + 6, at.z + 5, true);
  baby.rec.span = 100000;
  baby.rec.grown = h.world.tick + 95000;
  h.world.ents.setYoung(baby.e, baby.rec.span, baby.rec.grown);
  h.host.refreshBody(baby.rec);
  const f = tame(h, recOf(ada), at.x - 1, at.z + 12, true);
  const m = tame(h, recOf(ada), at.x + 1, at.z + 12, false);
  f.rec.mating = m.rec.mating = true;
  const sam = h.join("sam", {}, { spectate: true });
  h.run(1500);
  h.say(sam, "enablecheats");
  h.say(sam, `tp ${at.x.toFixed(3)} ${(h.world.hf.heightAt(at.x, at.z - 3) + 1).toFixed(3)} ${(at.z - 3).toFixed(3)}`);
  h.run(1500);
  expect([wild.out, wild.tame !== null, h.host.breeding.pairCount]).toEqual([true, true, 1]);
  // Half the affinity a level 20 dodo needs.
  wild.tame!.affinity = (450 + 22.5 * 20) / 2;
  return { h, ada, cara, bob, sam, pip, bolt, wild: { e: wildE, rec: wild }, baby, f, m };
}

/** What `s` draws over creatures, its camera at its eye along its aim. */
function marks(h: Harness, s: ClientSession, alive = true): OverheadModel {
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  const eye = stanceEye(h.reg.move[h.reg.index.get("core:survivor")!]!, 0);
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [s.own.x, s.own.y + eye, s.own.z, pilot.yaw, pilot.pitch];
  cam.update();
  const r = new RemoteSample();
  s.sampleRemote(r);
  const m = new OverheadModel();
  fillOverhead(m, s, r, cam, NO_HEADS, alive ? eye : -1, pilot.yaw, pilot.pitch);
  return m;
}

const bars = (m: OverheadModel): number[] => m.bars.slice(0, m.barCount).map((b) => b.kind);

test("each mark shows to the viewer ARK shows it to: a tame's health and food to its tribe, its name and tribe to another, an unconscious wild one's torpor and taming to anyone, a heart's progress to the pair's tribe alone, and nothing looked at to a spectator", () => {
  const { h, ada, cara, bob, sam, pip, bolt, wild, baby, f, m } = gathering();
  // The client draws a look as far as the server tells of one.
  expect(OVER_RANGE).toBe(LOOK_RANGE);
  const look = (s: ClientSession, e: number): OverheadModel => {
    aim(h, s, e);
    h.run(600);
    expect(h.host.overhead.lookedAt(h.client(s)!)).toBe(e);
    return marks(h, s);
  };

  // Pip to Ada and to Cara, of its tribe: its name, its level, its health and its food.
  for (const s of [ada, cara]) {
    const o = look(s, pip.e);
    expect([o.look, o.owner, o.title, o.line, o.tribe, bars(o)]).toEqual([true, OWNER_TRIBE, "Pip", `dodo  level ${pip.rec.genome!.level}`, "", [BAR_HEALTH, BAR_FOOD]]);
    expect([s.looked!.health, s.looked!.food]).toEqual([1, 1]);
  }
  // Pip to Bob: its name, its level, and whose it is. Nothing of how it is.
  let o = look(bob, pip.e);
  expect([o.owner, o.title, o.tribe, bars(o), o.note]).toEqual([OWNER_OTHER, "Pip", "of Lagoon", [], ""]);
  expect(bob.looked).toEqual({ id: pip.e, health: -1, food: -1, torpor: -1, taming: -1, te: -1, mating: -1, tribe: "Lagoon" });
  // Bolt is Bob's tribe's to him, and the Reef's to Ada.
  o = look(bob, bolt.e);
  expect([o.owner, o.title, bars(o)]).toEqual([OWNER_TRIBE, "Bolt", [BAR_HEALTH, BAR_FOOD]]);
  o = look(ada, bolt.e);
  expect([o.owner, o.tribe, bars(o)]).toEqual([OWNER_OTHER, "of Reef", []]);

  // The wild one, knocked out and half tamed, shows its torpor and its taming to whoever looks: anyone may feed it.
  for (const s of [ada, bob]) {
    o = look(s, wild.e);
    expect([o.owner, o.title, bars(o), o.note]).toEqual([OWNER_WILD, "Dodo", [BAR_TORPOR, BAR_TAMING], "100% effective"]);
    expect(o.bars[1]!.fraction).toBeCloseTo(0.5, 2);
  }

  // Ada's baby tells her how far it has grown and how fed it is. Bob is told only what it is.
  o = look(ada, baby.e);
  expect([o.line, bars(o)]).toEqual([`level ${baby.rec.genome!.level}  baby 5%`, [BAR_HEALTH, BAR_FOOD]]);
  o = look(bob, baby.e);
  expect([o.line, bars(o)]).toEqual([`level ${baby.rec.genome!.level}`, []]);

  // The pair behind: a heart over each, filled as far as the mating has gone for the Lagoon, and a plain heart for the rest.
  expect(mating(h, f.e)).toBeGreaterThanOrEqual(1);
  for (const s of [ada, cara, bob]) aim(h, s, f.e);
  h.run(300);
  for (const s of [ada, cara]) {
    o = marks(h, s);
    expect(o.hearts.slice(0, o.heartCount).map((k) => k.step).sort()).toEqual([mating(h, f.e), mating(h, m.e)].sort());
    expect(s.looked!.mating).toBeGreaterThan(0);
  }
  o = marks(h, bob);
  expect([o.heartCount, o.hearts[0]!.step, o.hearts[1]!.step, bob.looked!.mating, bob.looked!.tribe]).toEqual([2, 0, 0, -1, "Lagoon"]);

  // The spectator sees the hearts as Bob does, looks at nothing, and is told of nothing it looks at.
  const pilot = h.pilots[h.sessions.indexOf(sam)]!;
  [pilot.yaw, pilot.pitch] = [Math.atan2(h.world.ents.x[f.e]! - sam.own.x, h.world.ents.z[f.e]! - sam.own.z), -0.1];
  h.run(300);
  o = marks(h, sam, false);
  expect([o.look, o.heartCount, o.hearts[0]!.step, o.hearts[1]!.step, sam.looked]).toEqual([false, 2, 0, 0, null]);
});

test("a whole client draws the mark over the dodo it looks at from the overhead socket of the pose it is drawn in, lower as it lies knocked out, and a heart over each of a pair", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", { latencyMs: 20 }, { manual: true }), h.reg, parsePack(corePackBytes()));
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(500);
  app.session.text("enablecheats");
  run(300);
  const g = flatGround(h, 60, 30);
  const at = { x: g.x + 20, z: g.z + 8 };
  app.session.text(`tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  run(300);
  const me = h.host.records.byPid.get(h.client(app.session)!.pid)!;
  const pip = tame(h, me, at.x, at.z + 3, false, "Pip");
  const ents = h.world.ents;
  const eye = stanceEye(h.reg.move[ents.kind[h.ent(app.session)]!]!, 0);
  app.controls.yaw = Math.atan2(ents.x[pip.e]! - at.x, ents.z[pip.e]! - at.z);
  app.controls.pitch = Math.atan2(ents.y[pip.e]! + 0.3 - (ents.y[h.ent(app.session)]! + eye), Math.hypot(ents.x[pip.e]! - at.x, ents.z[pip.e]! - at.z));
  run(800);
  const f = app.ui.frame;
  const head = [0, 0, 0];
  expect(app.scene!.characters.overhead(pip.e, head)).toBe(true);
  // The socket sits a little above the crown: over the dodo's middle, at about its height.
  expect(Math.hypot(head[0]! - ents.x[pip.e]!, head[2]! - ents.z[pip.e]!)).toBeLessThan(0.3);
  const standing = head[1]! - ents.y[pip.e]!;
  expect(standing).toBeGreaterThan(0.6);
  expect(standing).toBeLessThan(1.0);
  const title = f.find(KEY_OVER_TITLE)!;
  expect([title.text, f.find(KEY_OVER_BAR)!.text, f.find(KEY_OVER_BAR + 2)!.text]).toEqual(["Pip", "health", "food"]);
  // Centred over the socket as the camera sees it, and above it.
  const s = [0, 0, 0];
  expect(app.cam.project(head[0]!, head[1]!, head[2]!, s)).toBe(true);
  expect(Math.abs(title.x + title.w / 2 - s[0]! * f.width)).toBeLessThan(2);
  expect(title.y + title.h).toBeLessThan(s[1]! * f.height);

  // Knocked out, it lies, and its mark comes down with its head. Its tribe sees its torpor too.
  h.host.survival.add(pip.rec, V_TORPOR, pip.rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  run(4000);
  expect(app.scene!.characters.overhead(pip.e, head)).toBe(true);
  expect(head[1]! - ents.y[pip.e]!).toBeLessThan(standing - 0.15);
  expect(f.find(KEY_OVER_BAR + 4)!.text).toBe("torpor");

  // A pair beside it: a heart over each, filled to the pair's step.
  const a = tame(h, me, at.x - 1.2, at.z + 4, true);
  const b = tame(h, me, at.x + 1.2, at.z + 4, false);
  a.rec.mating = b.rec.mating = true;
  run(1500);
  const hearts: number[] = [];
  for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= KEY_HEART && f.nodes[i]!.key < KEY_HEART + 32) hearts.push(f.nodes[i]!.image);
  expect(hearts).toEqual([IMAGE_HEART + mating(h, a.e), IMAGE_HEART + mating(h, b.e)]);
  expect(app.hud.overhead.heartCount).toBe(2);
});

test("a client that reads everything it is sent learns nothing ARK would not show it: of another tribe's creatures their names, their tribe and that a pair has begun, and nothing of one it does not look at", () => {
  const { h, ada, bob, sam, pip, bolt, wild, baby, f, m } = gathering();
  const lagoon = h.host.records.byPid.get(h.client(ada)!.pid)!.team;
  const toBob = tap(h, bob);
  const toSam = tap(h, sam);
  // The highest mating step each session holds for each of the Lagoon's creatures, read every frame.
  const most = new Map<ClientSession, Map<number, number>>([[ada, new Map()], [bob, new Map()], [sam, new Map()]]);
  const r = new RemoteSample();
  const watch = (): void => {
    for (const [s, seenBy] of most) {
      s.sampleRemote(r);
      for (let i = 0; i < r.count; i++) if (r.team[i] === lagoon) seenBy.set(r.id[i]!, Math.max(seenBy.get(r.id[i]!) ?? 0, (r.cue[i]! >>> CUE_MATING_SHIFT) & 7));
    }
  };
  // Pip knocked out as well: its torpor is still the Lagoon's business.
  h.host.survival.add(pip.rec, V_TORPOR, pip.rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  const looked = [pip.e, baby.e, f.e, m.e, bolt.e, wild.e];
  for (const e of looked) {
    aim(h, bob, e);
    h.run(1500, watch);
  }
  // Bob turns away, and the pair runs its course.
  h.pilots[h.sessions.indexOf(bob)]!.pitch = 1;
  for (let t = 0; t < MATE_TICKS / 30 + 5 && h.host.breeding.mated === 0; t++) h.run(1000, watch);
  expect(h.host.breeding.mated).toBe(1);

  expect([most.get(ada)!.get(f.e), most.get(ada)!.get(m.e)]).toEqual([MATING_STEPS, MATING_STEPS]);
  for (const s of [bob, sam]) {
    expect([most.get(s)!.get(f.e), most.get(s)!.get(m.e)]).toEqual([1, 1]);
    expect([...most.get(s)!.values()].every((v) => v <= 1)).toBe(true);
  }
  expect(toSam).toEqual([]);
  // Bob was told only of what he looked at, and of the Lagoon's only its name.
  expect(new Set(toBob.map((t) => t.id))).toEqual(new Set(looked));
  for (const t of toBob) {
    if (t.id === wild.e) expect([t.fields[2]! >= 0, t.fields[3]! >= 0, t.fields[4]! >= 0, t.tribe]).toEqual([true, true, true, ""]);
    else if (t.id === bolt.e) expect([t.fields[0]! >= 0, t.fields[1]! >= 0, t.tribe]).toEqual([true, true, ""]);
    else expect([t.fields, t.tribe]).toEqual([[-1, -1, -1, -1, -1, -1], "Lagoon"]);
  }

  // A wall between Bob and the wild one: aimed at it, he is told nothing of it.
  const ents = h.world.ents;
  const me = h.ent(bob);
  if (wild.rec.out === false) h.host.survival.add(wild.rec, V_TORPOR, wild.rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.world.structs.add(h.reg.index.get("core:wall")!, (ents.x[me]! + ents.x[wild.e]!) / 2, ents.y[me]! + 1.5, (ents.z[me]! + ents.z[wild.e]!) / 2, 0, 0, 1);
  const before = toBob.length;
  aim(h, bob, wild.e);
  h.run(1000);
  expect([h.host.overhead.lookedAt(h.client(bob)!), bob.looked, toBob.length]).toEqual([-1, null, before]);
});
