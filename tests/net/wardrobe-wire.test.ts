// A survivor's wardrobe and hair clock are part of its identity on the wire: sent in a create beside its name and look,
// kept in one bit while they stand, sent again only when they change. What they cost a dressed survivor's first sight.

import { expect, test } from "bun:test";
import { LOOK_BYTES, randomLook } from "../../shared/anim/look.ts";
import { ANIM_ACTION_BITS, ANIM_LOOK_BITS, ANIM_MOTION_BITS } from "../../shared/anim/pose.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { EntityView, SentView, quantX, quantY, readViewDelta, writeViewDelta } from "../../shared/net/view.ts";
import { HAIR_TICK, hairAt, hairClock } from "../../shared/people/hair.ts";
import { Rng } from "../../shared/rng.ts";
import { EntityStore, F_ALIVE, WORN_LENGTH } from "../../shared/sim/entities.ts";
import { WARDROBE_SLOTS } from "../../shared/sim/items.ts";
import { SNAPSHOT_BYTES_MIN } from "../../server/replication.ts";
import { coreRegistry } from "../fixtures/world.ts";

const DIMS = { chunksX: 4, chunksZ: 4 };
const reg = coreRegistry();
const item = (name: string): number => reg.index.get(`core:${name}`)!;
const TEE = item("plain_tee"), TROUSERS = item("plain_trousers");
/** 24 letters, the most a name keeps. */
const NAME = "Alexandria Montgomeryson";
/** About a month into a world's life, at 30 ticks a second. */
const NOW = 30 * 86400 * 31;
const dye = (a: number, b: number, c: number): number => a | (b << 8) | (c << 16);

function viewOf(store: EntityStore, tick: number): SentView {
  const out = new SentView();
  out.tick = tick;
  for (let e = 0; e < store.cap; e++) {
    if ((store.flags[e]! & F_ALIVE) === 0) continue;
    out.push(e, store.gen[e]!, store.kind[e]!, quantX(store.x[e]!), quantY(store.y[e]!), quantX(store.z[e]!), store.yaw[e]! >>> 6, 0, store.anim[e]!, store.rev[e]!, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, store.identityRev[e]!);
  }
  return out;
}

function write(store: EntityStore, base: SentView | null, cur: SentView): { bytes: Uint8Array; next: SentView } {
  const w = new BitWriter(1 << 16);
  const next = new SentView();
  next.tick = cur.tick;
  writeViewDelta(w, base, cur, next, 1 << 19, 0, store);
  expect(w.overflow).toBe(false);
  return { bytes: w.bytes().slice(), next };
}

function read(bytes: Uint8Array, base: EntityView | null, tick: number): EntityView | null {
  const r = new BitReader();
  r.reset(bytes);
  const next = new EntityView();
  next.tick = tick;
  return readViewDelta(r, base, next) && !r.overflow ? next : null;
}

/** A survivor a month old, its hair cut a while ago, with a full look of its own, gear and a tribe. */
function survivor(store: EntityStore, worn: number[] | null): number {
  const e = store.create(2, 3000.25, 40, 2500.5, 0);
  store.anim[e] = 0x12345;
  store.setLook(e, 37, null, NAME);
  store.setBodyLook(e, randomLook(new Rng(5)));
  store.setHairClock(e, hairClock(NOW - 30 * 3600 * 20));
  store.setGear(e, [item("hatchet"), item("hide_hat"), item("hide_shirt"), item("hide_gloves"), item("hide_pants"), item("hide_boots")]);
  store.setTeam(e, 123456);
  store.setWardrobe(e, worn);
  return e;
}

/** A top and trousers, plain, and an outer layer of an edition, dyed. */
const DRESSED = [TEE, 0, 0, TROUSERS, 0, 0, TEE, 41, dye(12, 40, 3), 0, 0, 0, 0, 0, 0];

function firstSight(worn: number[] | null): { bytes: number; seen: EntityView; store: EntityStore; e: number; sent: SentView } {
  const store = new EntityStore(DIMS, 8);
  const e = survivor(store, worn);
  const cur = viewOf(store, NOW);
  const first = write(store, null, cur);
  return { bytes: first.bytes.length, seen: read(first.bytes, null, NOW)!, store, e, sent: first.next };
}

test("a dressed survivor's first sight costs what its garments carry and no more", () => {
  const bare = firstSight(null);
  const plain = firstSight([TEE, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const dressed = firstSight(DRESSED);
  console.log(`first sight: undressed ${bare.bytes} B, one plain garment ${plain.bytes} B, dressed (two plain, one styled) ${dressed.bytes} B`);
  expect(bare.seen.wardrobe[0]).toBeNull();
  expect([...dressed.seen.wardrobe[0]!]).toEqual(DRESSED);
  expect([dressed.seen.name[0], dressed.seen.look[0]?.length]).toEqual([NAME, LOOK_BYTES]);
  // The clock arrives as the tick it started on.
  expect(dressed.seen.hairFrom[0]).toBe(hairClock(NOW - 30 * 3600 * 20));
  expect(plain.bytes - bare.bytes).toBeLessThanOrEqual(4);
  // Two plain and one styled.
  expect(dressed.bytes - bare.bytes).toBeLessThanOrEqual(4 * 2 + 10);
  // A quarter of the smallest snapshot budget holds it (server/replication.ts SNAPSHOT_BYTES_MIN).
  expect(dressed.bytes * 4).toBeLessThanOrEqual(SNAPSHOT_BYTES_MIN);
});

test("a survivor dressed in five styled garments fits a quarter of the least budget", () => {
  const full: number[] = [];
  for (let k = 0; k < WARDROBE_SLOTS; k++) full.push(TEE, 16383 - k, dye(200 + k, 201, 202));
  const store = new EntityStore(DIMS, 8);
  const e = survivor(store, full);
  // Its clock a year old.
  store.setHairClock(e, 0);
  const tick = 30 * 86400 * 365;
  const bytes = write(store, null, viewOf(store, tick)).bytes.length;
  console.log(`first sight in five styled garments, a year's clock: ${bytes} B`);
  expect(bytes * 4).toBeLessThanOrEqual(SNAPSHOT_BYTES_MIN);
});

test("a hotbar swap's re-create of a dressed survivor is no larger than of a bare one", () => {
  const sizes = [null, DRESSED].map((worn) => {
    const { store, e, seen, sent } = firstSight(worn);
    store.setGear(e, [item("pick"), ...store.gears.get(e)!.slice(1)]);
    const swap = write(store, sent, viewOf(store, NOW + 1));
    const after = read(swap.bytes, seen, NOW + 1)!;
    // Kept: the very arrays the client had.
    expect([after.look[0] === seen.look[0], after.wardrobe[0] === seen.wardrobe[0], after.hairFrom[0], after.gear[0]![0]]).toEqual([true, true, seen.hairFrom[0], item("pick")]);
    return swap.bytes.length;
  });
  console.log(`hotbar swap re-create: undressed ${sizes[0]} B, dressed ${sizes[1]} B`);
  expect(sizes[1]).toBe(sizes[0]!);
  expect(sizes[1]).toBeLessThanOrEqual(40);
});

test("a change of what is worn sends the identity again; setting the same wardrobe changes nothing", () => {
  const { store, e, seen, sent } = firstSight(DRESSED);
  const rev = store.identityRev[e]!;
  // The same garments, and a slot left empty with stray numbers in it, are the same wardrobe.
  store.setWardrobe(e, [...DRESSED.slice(0, 9), 0, 5, 6, 0, 0, 0]);
  expect(store.identityRev[e]).toBe(rev);
  const dyed = DRESSED.slice();
  dyed[5] = dye(1, 2, 3);
  store.setWardrobe(e, dyed);
  expect(store.identityRev[e]).toBe(rev + 1);
  const change = write(store, sent, viewOf(store, NOW + 1));
  const after = read(change.bytes, seen, NOW + 1)!;
  expect([...after.wardrobe[0]!]).toEqual(dyed);
  console.log(`wardrobe change re-create: ${change.bytes.length} B`);
  // Undressed, the wardrobe goes, in one bit.
  store.setWardrobe(e, null);
  const bare = read(write(store, change.next, viewOf(store, NOW + 2)).bytes, after, NOW + 2)!;
  expect(bare.wardrobe[0]).toBeNull();
  expect(store.wardrobes.has(e)).toBe(false);
});

test("a client works out the hair's length at any tick as the server does", () => {
  const { store, e, seen } = firstSight(DRESSED);
  const look = store.looks.get(e)!, start = store.hairs.get(e)!;
  for (const rate of [0, 250, 1000, 7000, 1_000_000]) {
    for (let t = NOW; t < NOW + 30 * 86400 * 10; t += 30 * 3571) {
      expect(hairAt(seen.look[0]!, seen.hairFrom[0]!, t, rate)).toBe(hairAt(look, start, t, rate));
    }
  }
  // Read at another tick, the clock is still the same tick.
  const later = write(store, null, viewOf(store, NOW + 5 * HAIR_TICK + 17));
  expect(read(later.bytes, null, NOW + 5 * HAIR_TICK + 17)!.hairFrom[0]).toBe(start);
});

test("the reader refuses a wardrobe written in a form the writer never uses", () => {
  const { bytes } = write(...((): [EntityStore, null, SentView] => {
    const store = new EntityStore(DIMS, 8);
    survivor(store, DRESSED);
    return [store, null, viewOf(store, NOW)];
  })());
  expect(read(bytes, null, NOW)).not.toBeNull();
  // A clock that would have started before the world's first tick.
  expect(read(bytes, null, 0)).toBeNull();
  // Each malformed wardrobe after a valid head: nothing worn, a style of nothing, an edition of 0, a dye of 0.
  const head = (w: BitWriter): void => void w.bool(true);
  const forms: ((w: BitWriter) => void)[] = [
    (w) => { head(w); for (let k = 0; k < WARDROBE_SLOTS; k++) w.bool(false); },
    (w) => { head(w); w.bool(true); w.varint(TEE); w.bool(true); w.bool(false); w.bool(false); },
    (w) => { head(w); w.bool(true); w.varint(TEE); w.bool(true); w.bool(true); w.varint(0); w.bool(false); },
    (w) => { head(w); w.bool(true); w.varint(TEE); w.bool(true); w.bool(false); w.bool(true); w.bits(0, 24); },
    (w) => { head(w); w.bool(true); w.varint(0); w.bool(false); },
  ];
  for (const form of forms) expect(readWardrobeAlone(form)).toBe(false);
  expect(readWardrobeAlone((w) => { head(w); w.bool(true); w.varint(TEE); w.bool(false); for (let k = 1; k < WARDROBE_SLOTS; k++) w.bool(false); })).toBe(true);
  expect(WORN_LENGTH).toBe(WARDROBE_SLOTS * 3);
});

/** Whether a create of a bare entity with the wardrobe `form` writes (from its bit on) reads. */
function readWardrobeAlone(form: (w: BitWriter) => void): boolean {
  const w = new BitWriter(256);
  w.varint(1);
  w.varint(1);
  w.bits(1, 2);
  w.varint(2);
  w.bits(1, 12);
  w.bits(0, 22);
  w.bits(0, 20);
  w.bits(0, 22);
  w.bits(0, 10);
  w.bits(0, 4);
  w.bits(0, ANIM_MOTION_BITS + ANIM_LOOK_BITS + ANIM_ACTION_BITS);
  // No cue, emote, stride, reaction or vehicle.
  for (let k = 0; k < 5; k++) w.bool(false);
  // Not kept, level 1, no colours, no name, no look, no clock.
  w.bool(false);
  w.varint(1);
  w.bool(false);
  w.bool(false);
  w.bool(false);
  w.bool(false);
  form(w);
  // No gear, team, seat or growth.
  for (let k = 0; k < 4; k++) w.bool(false);
  return read(w.bytes().slice(), null, NOW) !== null;
}
