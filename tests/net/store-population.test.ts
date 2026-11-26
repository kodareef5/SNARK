// An admin population on the wire: its number follows the content's populations by store id, a body drawn from one goes
// as its seed, and a client makes the same look from the manifest, or a stand-in made again in place until it has it.

import { expect, test } from "bun:test";
import { FETCH_TIMEOUT_MS, PENDING_MAX, PeopleBook } from "../../client/core/people-book.ts";
import { BEACH } from "../../content/people/defaults.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { EntityView, SentView, quantX, quantY, readViewDelta, writeViewDelta, type MakePerson } from "../../shared/net/view.ts";
import { readPopulation, storePopulation, type PopulationDoc } from "../../shared/people/doc.ts";
import { lookOfSeed, personFrom, populationsOf, storeIdOf, wireNumber, type StorePopulations } from "../../shared/people/person.ts";
import { EntityStore, F_ALIVE } from "../../shared/sim/entities.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const content = populationsOf(reg);
const DIMS = { chunksX: 4, chunksZ: 4 };
const { type: _t, id: _i, ...beachBody } = BEACH;
const night = readPopulation({ ...beachBody, label: "Night beach", face: 0.9, women: 0.2 }) as PopulationDoc;
const manifest = { editions: [], populations: [{ id: 3, rev: 2, population: night }] };

function sent(store: EntityStore): Uint8Array {
  const view = new SentView();
  view.tick = 1;
  for (let e = 0; e < store.cap; e++) {
    if ((store.flags[e]! & F_ALIVE) === 0) continue;
    view.push(e, store.gen[e]!, store.kind[e]!, quantX(store.x[e]!), quantY(store.y[e]!), quantX(store.z[e]!), 0, 0, 0, store.rev[e]!, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, store.identityRev[e]!);
  }
  const w = new BitWriter(1 << 16);
  writeViewDelta(w, null, view, new SentView(), 1 << 19, 0, store);
  return w.bytes().slice();
}

function read(bytes: Uint8Array, person: MakePerson): EntityView | null {
  const r = new BitReader();
  r.reset(bytes);
  const next = new EntityView();
  return readViewDelta(r, null, next, null, null, null, null, person) && !r.overflow ? next : null;
}

/** A body drawn from revision `rev` of admin population `id`, as a world holding `held` makes it. */
function body(store: EntityStore, held: StorePopulations, seed: number, id = 3, rev = 2): Uint8Array {
  const e = store.create(3, 1000, 40, 1000, 0);
  const look = personFrom(seed, held.population(id, rev)!).look;
  store.setBodyLook(e, look, { seed, population: wireNumber(reg, id)!, revision: rev });
  return look;
}

const world: StorePopulations = { population: (id, rev) => (id === 3 && rev === 2 ? storePopulation(3, night) : undefined) };

test("content populations keep their numbers and admin ones follow them by store id", () => {
  for (const [i, p] of content.list.entries()) expect(wireNumber(reg, p.id)).toBe(i);
  expect([wireNumber(reg, 1), wireNumber(reg, 3), storeIdOf(reg, content.list.length + 2), storeIdOf(reg, 0)]).toEqual([content.list.length, content.list.length + 2, 3, 0]);
  expect([wireNumber(reg, 0), wireNumber(reg, "core:nobody")]).toEqual([undefined, undefined]);
});

test("a client with the manifest makes the look the world made from the seed", () => {
  const store = new EntityStore(DIMS, 8), look = body(store, world, 0xabcdef);
  const book = new PeopleBook();
  book.take(manifest);
  const seen = read(sent(store), (s, p, r) => book.look(reg, s, p, r))!;
  expect([...seen.look[0]!]).toEqual([...look]);
  expect(book.waiting).toBe(0);
  // The shared reader with the same store makes it too, and without one the body is malformed, as before.
  expect([...read(sent(store), (s, p, r) => lookOfSeed(reg, s, p, r, book))!.look[0]!]).toEqual([...look]);
  expect(read(sent(store), (s, p, r) => lookOfSeed(reg, s, p, r))).toBeNull();
});

test("a client without the revision draws a stand-in, made again in place when the manifest comes", () => {
  const store = new EntityStore(DIMS, 8), look = body(store, world, 77);
  const book = new PeopleBook();
  const seen = read(sent(store), (s, p, r) => book.look(reg, s, p, r))!;
  const held = seen.look[0]!;
  expect([...held]).not.toEqual([...look]);
  expect(book.waiting).toBe(1);
  // A manifest without it changes nothing; one with it fills the very array the view holds.
  book.take({ editions: [], populations: [{ id: 3, rev: 1, population: night }] });
  expect(book.waiting).toBe(1);
  book.take(manifest);
  expect([seen.look[0] === held, [...held], book.waiting]).toEqual([true, [...look], 0]);
});

test("a population the client lacks is still malformed", () => {
  const book = new PeopleBook();
  expect(book.look(reg, 1, content.list.length, 0)).toBeNull();
  expect(book.waiting).toBe(0);
});

test("a manifest entry not of a population's shape is left out", () => {
  const book = new PeopleBook();
  book.take({ populations: [{ id: 3, rev: 2, population: { ...night, women: 7 } }, { id: 0, rev: 1, population: night }, "x"] });
  expect([book.population(3, 2), book.population(0, 1)]).toEqual([undefined, undefined]);
});

test("past the cap, stand-ins no view holds are let go and one still held is remade", async () => {
  const book = new PeopleBook();
  const held = book.look(reg, 0, content.list.length, 1)!;
  for (let k = 1; k < PENDING_MAX; k++) book.look(reg, k, content.list.length, 1);
  expect(book.waiting).toBe(PENDING_MAX);
  await Bun.sleep(0);
  Bun.gc(true);
  book.look(reg, PENDING_MAX, content.list.length, 1);
  expect(book.waiting).toBeLessThan(PENDING_MAX);
  book.take({ editions: [], populations: [{ id: 1, rev: 1, population: night }] });
  expect([book.waiting, [...held]]).toEqual([0, [...personFrom(0, storePopulation(1, night)).look]]);
});

/** A book on a clock the test moves, whose fetches answer as `answer` says, each counted. */
function fetching(answer: () => Promise<unknown>): { book: PeopleBook; clock: { ms: number }; asked: () => number } {
  const book = new PeopleBook(), clock = { ms: 1_000_000 };
  let asked = 0;
  book.now = () => clock.ms;
  book.fetcher = () => (asked++, answer());
  return { book, clock, asked: () => asked };
}

test("a failed manifest is fetched again after 1, 2, 4, 8 and 16 s, then given up", async () => {
  const { book, clock, asked } = fetching(() => Promise.reject(new Error("offline")));
  book.want("0123456789abcdef");
  await book.settled();
  const at: number[] = [];
  for (let s = 0; s < 100; s++) {
    clock.ms += 500;
    const before = asked();
    book.poll();
    await book.settled();
    if (asked() > before) at.push((clock.ms - 1_000_000) / 1000);
  }
  expect([asked(), at]).toEqual([6, [1, 3, 7, 15, 31]]);
  // A new manifest named starts afresh, and one that comes is fetched no more.
  const ok = fetching(() => Promise.resolve(manifest));
  ok.book.want("fedcba9876543210");
  await ok.book.settled();
  ok.book.want("fedcba9876543210");
  ok.book.poll();
  expect([ok.asked(), ok.book.population(3, 2)?.label]).toEqual([1, "Night beach"]);
});

test("a fetch that never answers counts as failed after its timeout, and a late answer still counts", async () => {
  let answer: (json: unknown) => void = () => {};
  const { book, clock, asked } = fetching(() => new Promise((done) => (answer = done)));
  book.want("0123456789abcdef");
  const late = answer;
  clock.ms += FETCH_TIMEOUT_MS - 1;
  book.poll();
  expect(asked()).toBe(1);
  clock.ms += 1;
  book.poll();
  // Timed out: the next try waits its second.
  expect(asked()).toBe(1);
  clock.ms += 1000;
  book.poll();
  expect(asked()).toBe(2);
  late(manifest);
  await Bun.sleep(0);
  expect(book.population(3, 2)?.label).toBe("Night beach");
  book.poll();
  expect(asked()).toBe(2);
});

test("the book keeps each manifest's editions, and gives their colours to the renderer", () => {
  const book = new PeopleBook();
  const tee = { id: 4, garment: "core:tee", colours: [12, 0, 200] as const, print: null, name: "Navy tee" };
  book.take({ editions: [tee], populations: [] });
  book.take({ editions: [], populations: [] });
  expect(book.edition(4)?.name).toBe("Navy tee");
  const out = new Uint8Array(3);
  expect(book.editionColours(4, out)).toBe(true);
  expect([...out]).toEqual([12, 0, 200]);
  expect(book.editionColours(5, out)).toBe(false);
});
