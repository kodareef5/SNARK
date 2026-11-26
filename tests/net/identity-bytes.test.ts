// A create splits a body's appearance in two: its identity (name, look, hair clock and wardrobe) and the rest. A re-create
// whose identity is the baseline's sends one bit for it, and the client keeps the identity it has.

import { expect, test } from "bun:test";
import { defaultLook, LOOK_BYTES } from "../../shared/anim/look.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { EntityView, SentView, ViewRing, VIEW_RING, quantX, quantY, readViewDelta, writeViewDelta } from "../../shared/net/view.ts";
import { Rng } from "../../shared/rng.ts";
import { HAIR_TICK } from "../../shared/people/hair.ts";
import { EntityStore, F_ALIVE, WORN_LENGTH } from "../../shared/sim/entities.ts";

const DIMS = { chunksX: 4, chunksZ: 4 };

/** The live bodies of `store` that `shown` lets through, as a server's view holds them. */
function viewOf(store: EntityStore, out: SentView, tick: number, shown: (e: number) => boolean = () => true): SentView {
  out.tick = tick;
  out.count = 0;
  for (let e = 0; e < store.cap; e++) {
    if ((store.flags[e]! & F_ALIVE) === 0 || !shown(e)) continue;
    out.push(e, store.gen[e]!, store.kind[e]!, quantX(store.x[e]!), quantY(store.y[e]!), quantX(store.z[e]!), store.yaw[e]! >>> 6, 0, store.anim[e]!, store.rev[e]!, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, store.identityRev[e]!);
  }
  return out;
}

/** A named survivor with a look, six gear slots and a tribe, standing somewhere in a large map. */
function survivor(store: EntityStore, name: string): number {
  const e = store.create(2, 3000.25, 40, 2500.5, 0);
  store.anim[e] = 0x12345;
  store.setLook(e, 37, null, name);
  store.setBodyLook(e, defaultLook());
  store.setGear(e, [12, 300, 301, 302, 303, 0]);
  store.setTeam(e, 123456);
  return e;
}

/** Writes `cur` against `base` with room for everything; returns the bytes and what the server keeps. */
function write(base: SentView | null, cur: SentView): { bytes: Uint8Array; next: SentView } {
  const w = new BitWriter(1 << 16);
  const next = new SentView();
  next.tick = cur.tick;
  writeViewDelta(w, base, cur, next, 1 << 19, 0, storeOf.get(cur)!);
  expect(w.overflow).toBe(false);
  return { bytes: w.bytes().slice(), next };
}
const storeOf = new WeakMap<SentView, EntityStore>();

function read(bytes: Uint8Array, base: EntityView | null): EntityView | null {
  const r = new BitReader();
  r.reset(bytes);
  const next = new EntityView();
  return readViewDelta(r, base, next) && !r.overflow ? next : null;
}

function same(a: Uint8Array | Uint16Array | null | undefined, b: Uint8Array | Uint16Array | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.length === b.length && a.every((v, k) => v === b[k]);
}

test("a survivor's create carries its identity; a gear swap keeps it in one bit", () => {
  const store = new EntityStore(DIMS, 8);
  const e = survivor(store, "Alexandria Montgomery");
  const cur = viewOf(store, new SentView(), 1);
  storeOf.set(cur, store);
  const first = write(null, cur);
  const seen = read(first.bytes, null)!;
  expect([seen.name[0], seen.look[0]?.length, [...seen.gear[0]!], seen.team[0]]).toEqual(["Alexandria Montgomery", LOOK_BYTES, [12, 300, 301, 302, 303, 0], 123456]);
  expect(first.bytes.length).toBeLessThanOrEqual(140);

  // A hotbar swap.
  store.setGear(e, [13, 300, 301, 302, 303, 0]);
  const swap = viewOf(store, new SentView(), 2);
  storeOf.set(swap, store);
  const second = write(first.next, swap);
  const after = read(second.bytes, seen)!;
  expect(after.gear[0]![0]).toBe(13);
  expect(after.name[0]).toBe("Alexandria Montgomery");
  // The look is the baseline's own array: nothing was read for it.
  expect(after.look[0]).toBe(seen.look[0]!);
  expect(second.bytes.length).toBeLessThanOrEqual(45);
  // The name and look are what the swap leaves out.
  expect(first.bytes.length - second.bytes.length).toBeGreaterThanOrEqual(LOOK_BYTES + "Alexandria Montgomery".length);
});

test("a changed name or look is sent again in full, a new body always", () => {
  const store = new EntityStore(DIMS, 1);
  const e = survivor(store, "Ada");
  let cur = viewOf(store, new SentView(), 1);
  storeOf.set(cur, store);
  let sent = write(null, cur);
  let seen = read(sent.bytes, null)!;
  const look = defaultLook();
  look[3] ^= 0x55;
  store.setBodyLook(e, look);
  cur = viewOf(store, new SentView(), 2);
  storeOf.set(cur, store);
  sent = write(sent.next, cur);
  seen = read(sent.bytes, seen)!;
  expect(same(seen.look[0], look)).toBe(true);
  store.setLook(e, 37, null, "Grace");
  cur = viewOf(store, new SentView(), 3);
  storeOf.set(cur, store);
  sent = write(sent.next, cur);
  seen = read(sent.bytes, seen)!;
  expect([seen.name[0], same(seen.look[0], look)]).toEqual(["Grace", true]);
  // The slot is used again by someone else: a new generation, so its identity is sent though both revisions might match.
  const before = store.identityRev[e]!;
  store.destroy(e);
  const f = survivor(store, "Lin");
  expect(f).toBe(e);
  expect(store.identityRev[f]).not.toBe(before);
  cur = viewOf(store, new SentView(), 4);
  storeOf.set(cur, store);
  sent = write(sent.next, cur);
  seen = read(sent.bytes, seen)!;
  expect([seen.name[0], seen.gen[0]]).toEqual(["Lin", store.gen[f]!]);
});

test("setters bump a revision only on a real change, each its own", () => {
  const store = new EntityStore(DIMS, 8);
  const e = survivor(store, "Ada");
  const id = store.identityRev[e]!, rev = store.rev[e]!;
  const look = store.looks.get(e)!;
  store.setBodyLook(e, defaultLook());
  store.setLook(e, 37, null, "Ada");
  store.setGear(e, [12, 300, 301, 302, 303, 0]);
  store.setTeam(e, 123456);
  expect([store.identityRev[e], store.rev[e], store.looks.get(e)]).toEqual([id, rev, look]);
  store.setLook(e, 38, null, "Ada");
  expect([store.identityRev[e], store.rev[e]]).toEqual([id, rev + 1]);
  const changed = defaultLook();
  changed[0] ^= 1;
  store.setBodyLook(e, changed);
  // A new array is installed, a copy, so the caller changing its own later is not taken for the store's.
  expect([store.identityRev[e], store.rev[e], store.looks.get(e) === changed, store.looks.get(e) === look]).toEqual([id + 1, rev + 1, false, false]);
  changed[1] ^= 1;
  expect(store.looks.get(e)![1]).toBe(defaultLook()[1]!);
});

test("seventeen gear swaps inside one acknowledgement do not alias", () => {
  const store = new EntityStore(DIMS, 8);
  const e = survivor(store, "Ada");
  const cur = viewOf(store, new SentView(), 1);
  storeOf.set(cur, store);
  const acked = write(null, cur);
  const base = read(acked.bytes, null)!;
  for (let k = 1; k <= 17; k++) {
    store.setGear(e, [20 + k, 300, 301, 302, 303, 0]);
    const now = viewOf(store, new SentView(), 1 + k);
    storeOf.set(now, store);
    // Every snapshot is written against the one baseline the client acknowledged.
    const seen = read(write(acked.next, now).bytes, base)!;
    expect(seen.gear[0]![0]).toBe(20 + k);
  }
  // At 16 a four-bit revision read as no change at all.
  expect(store.rev[e]! - acked.next.rev[0]!).toBe(17);
});

test("the reader refuses a kept identity for a body its baseline lacks", () => {
  const store = new EntityStore(DIMS, 8);
  const e = survivor(store, "Ada");
  const cur = viewOf(store, new SentView(), 1);
  storeOf.set(cur, store);
  const first = write(null, cur);
  const seen = read(first.bytes, null)!;
  store.setGear(e, [14, 0, 0, 0, 0, 0]);
  const swap = viewOf(store, new SentView(), 2);
  storeOf.set(swap, store);
  const kept = write(first.next, swap).bytes;
  expect(read(kept, seen)).not.toBeNull();
  // No baseline, an empty one, and one where the slot holds another generation.
  expect(read(kept, null)).toBeNull();
  expect(read(kept, new EntityView())).toBeNull();
  const other = new EntityView();
  other.copyFrom(seen, 0);
  other.gen[0] = (seen.gen[0]! + 1) & 0xfff;
  expect(read(kept, other)).toBeNull();
});

/** A snapshot on its way to a client, or an acknowledgement on its way back. */
interface Flying {
  at: number;
  tick: number;
  base: number;
  bytes: Uint8Array;
}

interface Observer {
  ring: ViewRing<SentView>;
  views: ViewRing<EntityView>;
  drawn: ViewRing<EntityView>;
  rotate: number;
  acked: number;
  latest: number;
  down: Flying[];
  up: { at: number; tick: number }[];
  loss: number;
  /** Acknowledgements are held back until this tick. */
  stall: number;
}

/** What a body's identity and the rest of its appearance were at each revision, so a view's entry says what its client must hold. */
interface Shown {
  name: string;
  look: Uint8Array | null;
  hair: number;
  wardrobe: Uint32Array | null;
}
interface Rest {
  gear: Uint16Array | null;
  on: number;
  level: number;
  colors: number[];
  team: number;
  seat: number;
  span: number;
  grown: number;
}

function churn(seed: number): { kept: number; identity: number; checked: number } {
  const rng = new Rng(seed);
  const N = 48;
  const store = new EntityStore(DIMS, N);
  const names = ["Ada", "Grace", "Lin", "Alexandria Montgomery", "", "Kwame", "Zoë"];
  for (let k = 0; k < N; k++) {
    if (k % 3 === 0) {
      const e = store.create(7, rng.range(0, 500), 30, rng.range(0, 500), 0);
      store.setLook(e, 1 + rng.int(40), [1, 2, 3, 4, 5, 6], "");
    } else survivor(store, names[k % names.length]!);
  }
  const identities = new Map<string, Shown>();
  const rests = new Map<string, Rest>();
  const remember = (): void => {
    for (let e = 0; e < store.cap; e++) {
      if ((store.flags[e]! & F_ALIVE) === 0) continue;
      const g = store.gen[e]!;
      const ik = `${e}:${g}:${store.identityRev[e]}`;
      const known = identities.get(ik);
      const look = store.looks.get(e) ?? null;
      const name = store.names.get(e) ?? "";
      const hair = store.hairs.get(e) ?? -1;
      const wardrobe = store.wardrobes.get(e) ?? null;
      if (known) expect([known.name, same(known.look, look), known.hair, same(known.wardrobe, wardrobe)]).toEqual([name, true, hair, true]);
      else identities.set(ik, { name, look: look && look.slice(), hair, wardrobe: wardrobe && wardrobe.slice() });
      const rk = `${e}:${g}:${store.rev[e]}`;
      const rest: Rest = { gear: store.gears.get(e)?.slice() ?? null, on: store.on[e]!, level: store.level[e]!, colors: [...store.colors.subarray(e * 6, e * 6 + 6)], team: store.team[e]!, seat: store.seat[e]!, span: store.span[e]!, grown: store.grown[e]! };
      const was = rests.get(rk);
      if (was) expect(was).toEqual(rest);
      else rests.set(rk, rest);
    }
  };
  const observers: Observer[] = [0.05, 0.2, 0.4].map((loss) => ({ ring: new ViewRing(() => new SentView()), views: new ViewRing(() => new EntityView()), drawn: new ViewRing(() => new EntityView()), rotate: 0, acked: 0, latest: 0, down: [], up: [], loss, stall: 0 }));
  /** Each tick's server views for each observer, kept past the ring so late snapshots can be checked. */
  const sentViews = observers.map(() => new Map<number, SentView>());
  const hidden = new Set<number>();
  const w = new BitWriter(1 << 15);
  const r = new BitReader();
  let kept = 0, identity = 0, checked = 0, wardrobes = 0;
  const TICKS = 700;
  for (let tick = 1; tick <= TICKS; tick++) {
    const quiet = tick > TICKS - 60;
    if (!quiet) {
      for (let m = 0; m < 6; m++) {
        const e = rng.int(N);
        if ((store.flags[e]! & F_ALIVE) === 0) continue;
        const what = rng.int(100);
        if (what < 40) {
          const g = store.gears.get(e);
          if (g) store.setGear(e, [rng.int(4), g[1]!, g[2]!, g[3]!, g[4]!, g[5]!]);
        } else if (what < 48) store.setOn(e, rng.int(2) === 0);
        else if (what < 54) store.setTeam(e, rng.int(3));
        else if (what < 60) store.setSeat(e, rng.int(3) === 0 ? -1 : rng.int(N), rng.int(2));
        else if (what < 64) store.setYoung(e, rng.int(2) * 1000, rng.int(2) * 5000);
        else if (what < 70) store.setLook(e, 1 + rng.int(60), null, store.names.get(e) ?? "");
        else if (what < 76) store.setLook(e, store.level[e]!, null, names[rng.int(names.length)]!);
        else if (what < 82) {
          const look = defaultLook();
          look[rng.int(LOOK_BYTES)] = rng.int(256);
          store.setBodyLook(e, rng.int(8) === 0 ? null : look);
        } else if (what < 88) {
          // Gone, and its slot taken at once by someone new.
          store.destroy(e);
          if (rng.int(2) === 0) survivor(store, names[rng.int(names.length)]!);
          else store.create(7, rng.range(0, 500), 30, rng.range(0, 500), 0);
        } else if (what < 96) {
          if (hidden.has(e)) hidden.delete(e);
          else hidden.add(e);
        } else store.x[e] = Math.min(4000, Math.max(0, store.x[e]! + rng.range(-3, 3)));
        // What it wears and its hair clock, now and then, and often set to what they already are.
        const extra = rng.int(100);
        if ((store.flags[e]! & F_ALIVE) === 0 || extra >= 24) continue;
        if (extra < 14) {
          const worn = new Uint32Array(WORN_LENGTH);
          for (let k = 0; k < WORN_LENGTH; k += 3) if (rng.int(3) === 0) [worn[k], worn[k + 1], worn[k + 2]] = [1 + rng.int(3), rng.int(3) === 0 ? 1 + rng.int(40000) : 0, rng.int(2) * rng.int(0x1000000)];
          store.setWardrobe(e, rng.int(4) === 0 ? null : worn);
        } else store.setHairClock(e, rng.int(4) === 0 ? -1 : rng.int(3) * HAIR_TICK * 7);
      }
    } else hidden.clear();
    remember();

    for (let o = 0; o < observers.length; o++) {
      const ob = observers[o]!;
      // Acknowledgements that arrive now.
      ob.up = ob.up.filter((a) => {
        if (a.at > tick) return true;
        if (a.tick > ob.acked) ob.acked = a.tick;
        return false;
      });
      if (!quiet && rng.int(80) === 0) ob.stall = tick + 10 + rng.int(30);
      const cur = viewOf(store, new SentView(), tick, (e) => !hidden.has(e) || (o === 0 && e % 2 === 0));
      const base = ob.acked > 0 && tick - ob.acked < VIEW_RING ? ob.ring.find(ob.acked) : null;
      const next = ob.ring.alloc(tick);
      w.reset();
      const budget = quiet ? 1 << 18 : [160, 800, 4000, 1 << 18][rng.int(4)]!;
      ob.rotate = writeViewDelta(w, base, cur, next, budget, ob.rotate, store, -1, null, 2048, ob.ring);
      if (w.overflow) {
        next.tick = 0;
        continue;
      }
      const copy = new SentView();
      copy.tick = tick;
      for (let k = 0; k < next.count; k++) copy.copyFrom(next, k);
      sentViews[o]!.set(tick, copy);
      if (quiet || rng.float() >= ob.loss) ob.down.push({ at: tick + 1 + (quiet ? 0 : rng.int(5)), tick, base: base ? base.tick : 0, bytes: w.bytes().slice() });
    }

    for (let o = 0; o < observers.length; o++) {
      const ob = observers[o]!;
      ob.down = ob.down.filter((f) => {
        if (f.at > tick) return true;
        if (f.tick <= ob.latest) return false;
        const base = f.base > 0 ? ob.views.find(f.base) : null;
        expect(f.base === 0 || base !== null).toBe(true);
        const next = ob.views.alloc(f.tick);
        const drawn = ob.drawn.alloc(f.tick);
        r.reset(f.bytes);
        expect(readViewDelta(r, base, next, ob.drawn.find(ob.latest), drawn) && !r.overflow).toBe(true);
        ob.latest = f.tick;
        // Every entry is what the server holds the client to have, at the revisions its view gives.
        const want = sentViews[o]!.get(f.tick)!;
        expect(next.count).toBe(want.count);
        for (let k = 0; k < next.count; k++) {
          const id = want.id[k]!, g = want.gen[k]!;
          expect([next.id[k], next.gen[k], next.qx[k]]).toEqual([id, g, want.qx[k]!]);
          const who = identities.get(`${id}:${g}:${want.identityRev[k]}`)!;
          const rest = rests.get(`${id}:${g}:${want.rev[k]}`)!;
          expect([next.name[k], same(next.look[k], who.look), next.hairFrom[k], same(next.wardrobe[k], who.wardrobe)]).toEqual([who.name, true, who.hair, true]);
          expect([same(next.gear[k], rest.gear), next.on[k], next.level[k], [...next.colors.subarray(k * 6, k * 6 + 6)], next.team[k], next.seat[k], next.span[k], next.grown[k]]).toEqual([true, rest.gear ? rest.on : 0, rest.level, rest.colors, rest.team, rest.seat, rest.span, rest.grown]);
          checked++;
          if (base) {
            const j = base.id.subarray(0, base.count).indexOf(id);
            if (j >= 0 && base.gen[j] === g && next.look[k] !== null) {
              if (next.look[k] === base.look[j] && next.gear[k] !== base.gear[j]) kept++;
              else if (!same(next.look[k], base.look[j])) identity++;
            }
            // The identity is read again exactly when its revision moved: else the client's own arrays stand.
            const was = sentViews[o]!.get(f.base)!;
            const b = was.id.subarray(0, was.count).indexOf(id);
            if (j >= 0 && b >= 0 && base.gen[j] === g && was.gen[b] === g) {
              const moved = was.identityRev[b] !== want.identityRev[k];
              if (next.look[k] !== null) expect(next.look[k] !== base.look[j]).toBe(moved);
              if (next.wardrobe[k] !== null) expect(next.wardrobe[k] !== base.wardrobe[j]).toBe(moved);
              if (!moved) expect([next.name[k], next.hairFrom[k]]).toEqual([base.name[j]!, base.hairFrom[j]!]);
              if (moved && next.wardrobe[k] !== null) wardrobes++;
            }
          }
        }
        if (tick < ob.stall || rng.float() < ob.loss) return false;
        ob.up.push({ at: tick + 1 + (quiet ? 0 : rng.int(4)), tick: f.tick });
        return false;
      });
    }
  }
  // Quiet at the end, with room and no loss: every observer holds exactly what the store has.
  for (const ob of observers) {
    const last = ob.views.find(ob.latest)!;
    const live = viewOf(store, new SentView(), 0);
    expect(last.count).toBe(live.count);
    for (let k = 0; k < last.count; k++) {
      const e = last.id[k]!;
      expect([e, last.gen[k], last.name[k], same(last.look[k], store.looks.get(e) ?? null), same(last.gear[k], store.gears.get(e) ?? null), last.team[k], last.seat[k], last.hairFrom[k], same(last.wardrobe[k], store.wardrobes.get(e) ?? null)]).toEqual([live.id[k]!, live.gen[k]!, store.names.get(e) ?? "", true, true, store.team[e]!, store.seat[e]!, store.hairs.get(e) ?? -1, true]);
    }
  }
  return { kept, identity, checked, wardrobes };
}

test("random identity, wardrobe, hair and gear changes leave observers right", () => {
  let kept = 0, identity = 0, checked = 0, wardrobes = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const run = churn(seed);
    kept += run.kept;
    identity += run.identity;
    checked += run.checked;
    wardrobes += run.wardrobes;
  }
  expect(wardrobes).toBeGreaterThan(100);
  // Both kinds of re-create happened, often.
  expect(kept).toBeGreaterThan(500);
  expect(identity).toBeGreaterThan(100);
  expect(checked).toBeGreaterThan(100_000);
});
