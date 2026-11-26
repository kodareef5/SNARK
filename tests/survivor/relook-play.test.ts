// A survivor's look changes once it is made, through one path: scissors, hair dye, a remake an admin offers, and what it
// wears. Each change reaches a watcher who saw the old look and one who comes later, and the owner; a hotbar swap sends
// none of it. Hair grows by a clock that the server and every client work out alike, and the clock, the look and the
// wardrobe last through a reconnect, a restart, death and a respawn, and travel to another map.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { inCreator } from "../../client/core/ui/creator.ts";
import { corpseWardrobe } from "../../server/corpses.ts";
import { DYE_SECOND, PART_BEARD, PART_HAIR, hairStart } from "../../server/people/look.ts";
import type { EntityRecord } from "../../server/records.ts";
import { LOOK_BEARD_LENGTH, LOOK_BYTES, LOOK_HAIR_COLOR, LOOK_HAIR_COLOR_2, LOOK_HAIR_LENGTH, LOOK_SEX, defaultLook, randomLook } from "../../shared/anim/look.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_GROOM, CMD_MOVE, CMD_REMAKE, CMD_RESPAWN, CMD_SELECT, CMD_USE, BOX_SELF, RESULT_DENIED, RESULT_FAR, RESULT_OK, RESULT_STALE } from "../../shared/net/protocol.ts";
import type { EntityView, ViewRing } from "../../shared/net/view.ts";
import { HAIR_STAGES, beardAt, hairAt, hairClock } from "../../shared/people/hair.ts";
import { Rng } from "../../shared/rng.ts";
import { WORN_LENGTH } from "../../shared/sim/entities.ts";
import { TestCluster, keyAt, rec as clusterRec, rise, travel } from "../fixtures/cluster.ts";
import { editionOf } from "../fixtures/editions.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-relook-"));
const cluster = new TestCluster();
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  cluster.cleanup();
});

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const dye = (a: number, b: number, c: number): number => a | (b << 8) | (c << 16);
/** The fastest growth there is: a quarter of a stage every clock step of about 34 s. */
const FAST = "1000";

/** Sends a command and runs on until the server answers it. Its result, or -1. */
function send(h: Harness, s: ClientSession, op: number, write: (w: BitWriter) => void): number {
  let code = -1;
  const was = s.onResult;
  const seq = s.command(op, write);
  s.onResult = (n, c) => void (n === seq && (code = c));
  for (let k = 0; k < 40 && code < 0; k++) h.run(25);
  s.onResult = was;
  h.run(100);
  return code;
}

function groom(h: Harness, s: ClientSession, slot: number, item: number, handle: number, what: number, stage = 0): number {
  return send(h, s, CMD_GROOM, (w) => (w.varint(slot), w.u16(item), w.u32(handle), w.u8(what), w.u8(stage)));
}

/** What watcher `s` holds of entity `e` in its newest view: the very arrays, so a kept identity is the same object. */
function held(s: ClientSession, e: number): { look: Uint8Array | null; wardrobe: Uint32Array | null; hairFrom: number } | null {
  const views = (s as unknown as { views: ViewRing<EntityView> }).views;
  const v = views.find(s.latestSnapshot);
  const n = v ? v.id.subarray(0, v.count).indexOf(e) : -1;
  return n < 0 ? null : { look: v!.look[n]!, wardrobe: v!.wardrobe[n]!, hairFrom: v!.hairFrom[n]! };
}

/** What watcher `s` draws of entity `e`: its look's bytes, its hair clock and its wardrobe. */
function seen(s: ClientSession, e: number): { look: number[] | null; hairFrom: number; wardrobe: number[] | null } {
  const sample = new RemoteSample();
  s.sampleRemote(sample);
  const n = sample.id.subarray(0, sample.count).indexOf(e);
  expect(n).toBeGreaterThanOrEqual(0);
  return {
    look: sample.hasLook[n] ? [...sample.look.subarray(n * LOOK_BYTES, (n + 1) * LOOK_BYTES)] : null,
    hairFrom: sample.hairFrom[n]!,
    wardrobe: sample.hasWardrobe[n] ? [...sample.wardrobe.subarray(n * WORN_LENGTH, (n + 1) * WORN_LENGTH)] : null,
  };
}

/** The survivor's hair and beard as the server works them out now. */
function grown(h: Harness, me: EntityRecord): number[] {
  return [hairAt(me.look!, hairStart(me), h.world.tick, h.world.hairRate), beardAt(me.look!, hairStart(me), h.world.tick, h.world.hairRate)];
}

/** Hair and beard as a client works them out from what it holds, at the server's tick. */
function grownFor(h: Harness, look: ArrayLike<number>, from: number, rate: number): number[] {
  const bytes = Uint8Array.from(look as number[]);
  return [hairAt(bytes, from, h.world.tick, rate), beardAt(bytes, from, h.world.tick, rate)];
}

/** A woman with a short beard and no growth past her style, so every stage is there to grow into. */
function face(): Uint8Array {
  const look = randomLook(new Rng(21));
  look[LOOK_SEX] = 1;
  look[LOOK_HAIR_LENGTH] = 0;
  look[LOOK_BEARD_LENGTH] = 10;
  look[LOOK_HAIR_COLOR] = 3;
  look[LOOK_HAIR_COLOR_2] = 0;
  return look;
}

function setup(dbPath?: string) {
  const h = new Harness({}, 1, 60, { dev: true, ...(dbPath ? { dbPath } : {}) });
  const ada = h.join("ada", {}, { look: face() });
  const bo = h.join("bo");
  h.run(600);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  return { h, ada, bo, me, e: h.ent(ada) };
}

test("cuts, dyes and a remake reach the owner and a watcher who saw the old look", () => {
  const { h, ada, bo, me, e } = setup();
  try {
    const items = h.host.items, inv = items.inv(me);
    expect(seen(bo, e).look).toEqual([...me.look!]);
    // The clock started as she was made, and both clients have it.
    const born = hairStart(me);
    expect(born).toBe(hairClock(born));
    expect([held(bo, e)!.hairFrom, ada.ownHairFrom]).toEqual([born, born]);
    expect(h.host.setSetting("HairGrowthSpeedMultiplier", FAST)).toBe("");
    h.run(200);
    expect([ada.hairRate, bo.hairRate]).toEqual([h.world.hairRate, h.world.hairRate]);
    // Grown out past the first stage, which all three work out alike.
    h.run(120_000);
    const long = grown(h, me);
    expect(long[0]).toBeGreaterThanOrEqual(HAIR_STAGES[1]!);
    expect(grownFor(h, seen(bo, e).look!, seen(bo, e).hairFrom, bo.hairRate)).toEqual(long);
    expect(grownFor(h, ada.ownLook!, ada.ownHairFrom, ada.hairRate)).toEqual(long);

    // A hotbar swap sends the watcher nothing of who she is.
    expect(items.mintAt(me, inv.hotbar, id("hatchet"), 1)).toBe(1);
    expect(items.mintAt(me, inv.hotbar + 1, id("pick"), 1)).toBe(1);
    h.run(200);
    const rev = h.world.ents.identityRev[e]!, before = held(bo, e)!;
    expect(send(h, ada, CMD_SELECT, (w) => w.u8(0))).toBe(RESULT_OK);
    expect(send(h, ada, CMD_SELECT, (w) => w.u8(1))).toBe(RESULT_OK);
    expect(h.world.ents.gears.get(e)![0]).toBe(id("pick"));
    expect(h.world.ents.identityRev[e]).toBe(rev);
    expect([held(bo, e)!.look === before.look, held(bo, e)!.wardrobe === before.wardrobe]).toEqual([true, true]);

    // Scissors to the hair: cut to the style, the beard kept as grown, the clock started again.
    expect(items.mint(me, id("scissors"), 1)).toBe(1);
    h.run(100);
    const scissors = inv.item.indexOf(id("scissors"));
    expect(groom(h, ada, scissors, id("hatchet"), 0, PART_HAIR, 0)).toBe(RESULT_STALE);
    const beard = grown(h, me)[1]!;
    expect(groom(h, ada, scissors, id("scissors"), 0, PART_HAIR, 0)).toBe(RESULT_OK);
    const cut = hairStart(me);
    expect([me.look![LOOK_HAIR_LENGTH], me.look![LOOK_BEARD_LENGTH], cut <= h.world.tick, cut > born]).toEqual([0, beard, true, true]);
    expect(h.world.ents.identityRev[e]).not.toBe(rev);
    expect(seen(bo, e)).toEqual({ look: [...me.look!], hairFrom: cut, wardrobe: null });
    expect([[...ada.ownLook!], ada.ownHairFrom]).toEqual([[...me.look!], cut]);
    // Kept, and no longer than it was.
    expect(inv.item[scissors]).toBe(id("scissors"));
    expect(groom(h, ada, scissors, id("scissors"), 0, PART_BEARD, HAIR_STAGES.length - 1)).toBe(RESULT_DENIED);
    expect(ada.log.at(-1)?.text).toMatch(/shorter than that/);

    // A dye from the bag colours her hair and is used up; the same again is refused and kept.
    expect(items.mint(me, id("hair_dye_red"), 3)).toBe(3);
    h.run(100);
    const red = inv.item.indexOf(id("hair_dye_red"));
    const used = send(h, ada, CMD_USE, (w) => (w.varint(red), w.u16(id("hair_dye_red"))));
    expect(used).toBe(RESULT_OK);
    expect([me.look![LOOK_HAIR_COLOR], inv.count[red], hairStart(me)]).toEqual([9, 2, cut]);
    expect(send(h, ada, CMD_USE, (w) => (w.varint(red), w.u16(id("hair_dye_red"))))).toBe(RESULT_DENIED);
    expect(inv.count[red]).toBe(2);
    expect(groom(h, ada, red, id("hair_dye_red"), 0, DYE_SECOND)).toBe(RESULT_OK);
    expect([me.look![LOOK_HAIR_COLOR_2], inv.count[red]]).toEqual([10, 1]);
    expect(seen(bo, e).look).toEqual([...me.look!]);
    expect([...ada.ownLook!]).toEqual([...me.look!]);

    // A remake needs an admin's offer, opens her creator on her own look, and takes everything she chooses.
    expect(send(h, ada, CMD_REMAKE, (w) => w.bool(false))).toBe(RESULT_DENIED);
    expect(h.say(bo, "enablecheats")[0]).toMatch(/cheats/);
    expect(h.say(bo, "remake ada")).toEqual(["ada may make itself again in the creator."]);
    h.run(200);
    expect([ada.remaking, inCreator(ada), inCreator(bo)]).toEqual([true, true, false]);
    const made = defaultLook();
    made[LOOK_HAIR_LENGTH] = 40;
    expect(send(h, ada, CMD_REMAKE, (w) => (w.bool(true), [...made].forEach((b) => w.u8(b))))).toBe(RESULT_OK);
    expect([[...me.look!], h.host.relook.offered(me), ada.remaking]).toEqual([[...made], false, false]);
    expect(seen(bo, e).look).toEqual([...made]);
    expect([...ada.ownLook!]).toEqual([...made]);
    // Once made, it is not offered again.
    expect(send(h, ada, CMD_REMAKE, (w) => (w.bool(true), [...made].forEach((b) => w.u8(b))))).toBe(RESULT_DENIED);

    // One who comes later sees her as she is now.
    const cy = h.join("cy");
    h.run(600);
    expect(seen(cy, e)).toEqual({ look: [...made], hairFrom: hairStart(me), wardrobe: null });
    expect(grownFor(h, seen(cy, e).look!, seen(cy, e).hairFrom, cy.hairRate)).toEqual(grown(h, me));

    // Grown again and then dead: the body keeps the hair as it was when she fell, and it grows no more.
    h.run(70_000);
    const fell = grown(h, me);
    expect(fell[0]).toBeGreaterThan(40);
    expect(h.say(ada, "suicide")).toEqual(["You were killed."]);
    h.run(300);
    const body = [...h.host.corpses.bodies.values()].find((b) => b.kind === me.kind)!;
    expect([body.rec.look![LOOK_HAIR_LENGTH], body.rec.look![LOOK_BEARD_LENGTH]]).toEqual(fell);
    h.run(70_000);
    expect(seen(bo, body.e)).toEqual({ look: [...body.rec.look!], hairFrom: -1, wardrobe: null });
    expect(grown(h, me)[0]).toBeGreaterThan(fell[0]!);
  } finally {
    h.host.shutdown();
  }
});

test("another's hair is cut only by its tribe, within reach", () => {
  const { h, ada, bo } = setup();
  try {
    const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
    const them = h.host.records.byPid.get(h.client(bo)!.pid)!;
    expect(h.host.items.mint(me, id("scissors"), 1)).toBe(1);
    them.look![LOOK_HAIR_LENGTH] = 200;
    h.run(100);
    const inv = h.host.items.inv(me), slot = inv.item.indexOf(id("scissors"));
    const handle = bo.ownHandle, theirs = h.ent(bo);
    h.world.ents.setPosition(theirs, h.world.ents.x[h.ent(ada)]! + 1.5, h.world.ents.y[h.ent(ada)]!, h.world.ents.z[h.ent(ada)]!);
    h.run(100);
    expect(groom(h, ada, slot, id("scissors"), handle, PART_HAIR, 1)).toBe(RESULT_DENIED);
    expect(ada.log.at(-1)?.text).toMatch(/tribe/);
    expect(h.say(ada, "tribe create Barbers")[0]).toMatch(/Barbers/);
    h.say(ada, "tribe invite bo");
    h.say(bo, "tribe accept");
    expect(them.team).toBe(me.team);
    h.world.ents.setPosition(theirs, h.world.ents.x[h.ent(ada)]! + 8, h.world.ents.y[h.ent(ada)]!, h.world.ents.z[h.ent(ada)]!);
    h.run(100);
    expect(groom(h, ada, slot, id("scissors"), handle, PART_HAIR, 1)).toBe(RESULT_FAR);
    h.world.ents.setPosition(theirs, h.world.ents.x[h.ent(ada)]! + 1.5, h.world.ents.y[h.ent(ada)]!, h.world.ents.z[h.ent(ada)]!);
    h.run(100);
    expect(groom(h, ada, slot, id("scissors"), handle, PART_HAIR, 1)).toBe(RESULT_OK);
    expect(them.look![LOOK_HAIR_LENGTH]).toBe(HAIR_STAGES[1]);
    expect(seen(ada, theirs).look).toEqual([...them.look!]);
    expect([...bo.ownLook!]).toEqual([...them.look!]);
    // The console cuts one's own, one stage shorter.
    them.look![LOOK_BEARD_LENGTH] = 130;
    expect(h.host.items.mint(them, id("scissors"), 1)).toBe(1);
    h.run(100);
    expect(h.say(bo, "cut beard")).toEqual(["Cut."]);
    expect(them.look![LOOK_BEARD_LENGTH]).toBe(HAIR_STAGES[1]);
  } finally {
    h.host.shutdown();
  }
});

// The first edition a fresh people store gives.
const TEE = [id("plain_tee"), 1, dye(12, 40, 3)];
const TROUSERS = [id("plain_trousers"), 0, 0];
const EMPTY = [0, 0, 0];

test("what is worn reaches watchers, lasts a reconnect and a restart, and on a body", () => {
  const db = join(dir, "worn.db");
  const { h, ada, bo, me, e } = setup(db);
  const pid = me.pid;
  const items = h.host.items, inv = items.inv(me);
  expect(items.mintAt(me, inv.wardrobe, TEE[0]!, 1)).toBe(1);
  expect(editionOf(h.host, "core:plain_tee")).toBe(TEE[1]!);
  expect(items.restyle(me, inv.wardrobe, TEE[1]!, TEE[2]!)).toBe(true);
  expect(items.mintAt(me, inv.wardrobe + 1, TROUSERS[0]!, 1)).toBe(1);
  h.run(300);
  const WORN = [...TEE, ...TROUSERS, ...EMPTY, ...EMPTY, ...EMPTY];
  expect(seen(bo, e).wardrobe).toEqual(WORN);
  // The tee off into the bag: gone from what the watcher draws. Back on, it is the same edition and dye.
  const free = inv.free();
  expect(send(h, ada, CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(inv.wardrobe), w.bits(BOX_SELF, 1), w.varint(free), w.u16(0), w.u16(TEE[0]!)))).toBe(RESULT_OK);
  expect(seen(bo, e).wardrobe).toEqual([...EMPTY, ...TROUSERS, ...EMPTY, ...EMPTY, ...EMPTY]);
  expect(send(h, ada, CMD_USE, (w) => (w.varint(free), w.u16(TEE[0]!)))).toBe(RESULT_OK);
  expect(seen(bo, e).wardrobe).toEqual(WORN);
  const look = [...me.look!], start = hairStart(me);

  // She goes and comes back: the watcher and she have her as she was.
  ada.close();
  h.run(400);
  const back = h.join("ada");
  h.run(600);
  const e2 = h.ent(back);
  expect(seen(bo, e2)).toEqual({ look, hairFrom: start, wardrobe: WORN });
  expect([[...back.ownLook!], back.ownHairFrom]).toEqual([look, start]);
  back.close();
  bo.close();
  h.run(300);
  h.host.shutdown();

  // After a restart, the save gives her look, her clock and what she wears.
  const h2 = new Harness({}, 1, 60, { dev: true, dbPath: db });
  try {
    const ada2 = h2.join("ada"), bo2 = h2.join("bo");
    h2.run(600);
    const me2 = h2.host.records.byPid.get(pid)!;
    expect([[...me2.look!], hairStart(me2)]).toEqual([look, start]);
    const at = h2.ent(ada2);
    expect(seen(bo2, at)).toEqual({ look, hairFrom: start, wardrobe: WORN });
    expect([[...ada2.ownLook!], ada2.ownHairFrom]).toEqual([look, start]);

    // She dies: her body shows what she wore and her hair as it had grown, to the watcher, then and after a restart.
    expect(h2.say(ada2, "enablecheats")[0]).toMatch(/cheats/);
    expect(h2.say(ada2, "suicide")).toEqual(["You were killed."]);
    h2.run(300);
    const body = [...h2.host.corpses.bodies.values()].find((b) => b.kind === me2.kind)!;
    expect([...corpseWardrobe(body.rec)!]).toEqual(WORN);
    const lying = seen(bo2, body.e);
    expect(lying).toEqual({ look, hairFrom: -1, wardrobe: WORN });
    // The same survivor rises with the clock she had.
    expect(send(h2, ada2, CMD_RESPAWN, (w) => (w.u8(0), w.u8(ada2.placesList)))).toBe(RESULT_OK);
    h2.run(300);
    expect(hairStart(me2)).toBe(start);
    expect(seen(bo2, h2.ent(ada2)).hairFrom).toBe(start);
    // One made new a while later starts its own clock then.
    h2.run(40_000);
    const dee = h2.join("dee");
    h2.run(600);
    const her = h2.host.records.byPid.get(h2.client(dee)!.pid)!;
    expect(h2.world.tick - hairStart(her)).toBeLessThan(1024 + 60);
    expect(hairStart(her)).toBeGreaterThan(start);
  } finally {
    h2.host.shutdown();
  }
  const h3 = new Harness({}, 1, 60, { dev: true, dbPath: db });
  try {
    const bo3 = h3.join("bo");
    h3.run(600);
    const body = [...h3.host.corpses.bodies.values()].find((b) => b.rec.look !== null)!;
    expect(seen(bo3, body.e)).toEqual({ look, hairFrom: -1, wardrobe: WORN });
  } finally {
    h3.host.shutdown();
  }
});

test("the hair clock moves to another map's ticks, the hair as long there, no offer", () => {
  const clock = { ms: Date.now() };
  const a = cluster.server("Island", "hair", clock);
  const b = cluster.server("Miami", "hair", clock);
  try {
    for (const s of [a, b]) expect(s.h.host.setSetting("HairGrowthSpeedMultiplier", FAST)).toBe("");
    // The other world has run longer, so its ticks are not these.
    b.h.run(240_000);
    const ada = a.h.join("ada", {}, { key: keyAt("ada", 1), look: face() });
    a.h.run(120_000);
    const me = clusterRec(a, "ada")!;
    const here = grown(a.h, me);
    expect(here[0]).toBeGreaterThan(HAIR_STAGES[1]!);
    // An admin here offered her a remake; it stays with this map.
    a.h.host.relook.offer(me, true);
    a.h.run(200);
    expect(ada.remaking).toBe(true);
    const ticket = travel(a, ada, b.world);
    expect(ticket).toBeInstanceOf(Uint8Array);
    const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket: ticket as Uint8Array });
    b.h.run(400);
    rise(b, there);
    const arrived = clusterRec(b, "ada")!;
    expect([b.h.host.relook.offered(arrived), there.remaking]).toEqual([false, false]);
    expect(hairStart(arrived)).not.toBe(hairStart(me));
    expect(hairStart(arrived)).toBeLessThanOrEqual(b.h.world.tick);
    // The travel took a few seconds, and moving the clock to a step costs at most one more: a quarter of a stage.
    const now = grown(b.h, arrived);
    expect(now[0]! - here[0]!).toBeGreaterThanOrEqual(0);
    expect(now[0]! - here[0]!).toBeLessThanOrEqual(2 * 25);
    expect(grownFor(b.h, there.ownLook!, there.ownHairFrom, there.hairRate)).toEqual(now);
  } finally {
    a.h.host.shutdown();
    b.h.host.shutdown();
  }
});
