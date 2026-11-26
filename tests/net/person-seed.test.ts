// A generated person goes on the wire as its seed, its population and the population's revision; the reader makes the
// look again. A survivor's own look still goes whole.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { defaultLook, LOOK_BYTES } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { EntityView, SentView, quantX, quantY, readViewDelta, writeViewDelta, type MakePerson } from "../../shared/net/view.ts";
import { lookOfSeed, personFrom, populationsOf } from "../../shared/people/person.ts";
import { EntityStore, F_ALIVE } from "../../shared/sim/entities.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const people = populationsOf(reg);
const make: MakePerson = (seed, population, revision) => lookOfSeed(reg, seed, population, revision);
const DIMS = { chunksX: 4, chunksZ: 4 };

function viewOf(store: EntityStore, tick: number): SentView {
  const out = new SentView();
  out.tick = tick;
  for (let e = 0; e < store.cap; e++) {
    if ((store.flags[e]! & F_ALIVE) === 0) continue;
    out.push(e, store.gen[e]!, store.kind[e]!, quantX(store.x[e]!), quantY(store.y[e]!), quantX(store.z[e]!), 0, 0, 0, store.rev[e]!, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, store.identityRev[e]!);
  }
  return out;
}

function write(store: EntityStore, base: SentView | null, cur: SentView): { bytes: Uint8Array; next: SentView } {
  const w = new BitWriter(1 << 16), next = new SentView();
  next.tick = cur.tick;
  writeViewDelta(w, base, cur, next, 1 << 19, 0, store);
  expect(w.overflow).toBe(false);
  return { bytes: w.bytes().slice(), next };
}

function read(bytes: Uint8Array, base: EntityView | null, person: MakePerson | null = make): EntityView | null {
  const r = new BitReader();
  r.reset(bytes);
  const next = new EntityView();
  return readViewDelta(r, base, next, null, null, null, null, person) && !r.overflow ? next : null;
}

/** A civilian of the city population, its look made from `seed`. */
function civilian(store: EntityStore, seed: number, population = "core:people_city"): number {
  const e = store.create(3, 1000 + seed % 50, 40, 1000, 0);
  const n = people.number.get(population)!, p = people.list[n]!;
  store.setLook(e, 1, null, "Rosa");
  store.setBodyLook(e, personFrom(seed, p).look, { seed, population: n, revision: 0 });
  store.setGear(e, [0, 300, 301, 0, 302, 0]);
  return e;
}

test("a generated person is sent as its seed and read back as the same look", () => {
  const store = new EntityStore(DIMS, 8);
  const e = civilian(store, 0xdeadbeef);
  const sent = write(store, null, viewOf(store, 1));
  const seen = read(sent.bytes, null)!;
  expect([...seen.look[0]!]).toEqual([...store.looks.get(e)!]);
  // The same body with its look sent whole costs the look's bytes less the seed's.
  store.born.delete(e);
  const whole = write(store, null, viewOf(store, 1));
  expect([...read(whole.bytes, null)!.look[0]!]).toEqual([...store.looks.get(e)!]);
  expect(whole.bytes.length - sent.bytes.length).toBeGreaterThanOrEqual(LOOK_BYTES - 6);
  console.log(`one create: ${sent.bytes.length} bytes with the seed, ${whole.bytes.length} with the look`);
});

test("a seed form the reader cannot make is malformed", () => {
  const store = new EntityStore(DIMS, 8);
  const e = civilian(store, 7);
  const bytes = write(store, null, viewOf(store, 1)).bytes;
  expect(read(bytes, null, null)).toBeNull();
  // A population it lacks.
  store.setBodyLook(e, store.looks.get(e)!, { seed: 7, population: people.list.length, revision: 1 });
  expect(read(write(store, null, viewOf(store, 1)).bytes, null)).toBeNull();
});

test("a generated body's gear swap keeps its look in the one kept bit", () => {
  const store = new EntityStore(DIMS, 8);
  const e = civilian(store, 99);
  const first = write(store, null, viewOf(store, 1));
  const seen = read(first.bytes, null)!;
  store.setGear(e, [0, 300, 0, 0, 302, 0]);
  const second = write(store, first.next, viewOf(store, 2));
  const after = read(second.bytes, seen)!;
  expect(after.look[0]).toBe(seen.look[0]!);
  expect(second.bytes.length).toBeLessThan(first.bytes.length);
});

test("a look set without a seed drops the seed and is sent whole; a new body has none", () => {
  const store = new EntityStore(DIMS, 1);
  const e = civilian(store, 5);
  const rev = store.identityRev[e]!;
  // The same look and seed again is no change.
  store.setBodyLook(e, store.looks.get(e)!, { ...store.born.get(e)! });
  expect(store.identityRev[e]).toBe(rev);
  // The same look now without its seed is a change: it goes whole from now on.
  store.setBodyLook(e, store.looks.get(e)!.slice());
  expect(store.identityRev[e]).not.toBe(rev);
  expect(store.born.has(e)).toBe(false);
  const look = defaultLook();
  store.setBodyLook(e, look);
  expect([...read(write(store, null, viewOf(store, 1)).bytes, null)!.look[0]!]).toEqual([...look]);
  store.destroy(e);
  const f = civilian(store, 6);
  expect([f, store.born.get(f)?.seed]).toEqual([e, 6]);
  store.destroy(f);
  expect(store.create(3, 1, 40, 1, 0)).toBe(e);
  expect(store.born.has(e)).toBe(false);
});
