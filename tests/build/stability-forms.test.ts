// Stability with every form content places: bases rambled together from roofs, triangles, fences, low walls, hatches,
// ladders and the wide pieces as a builder is offered them. The numbers are the same in any order of building, each
// link is read alike from both its ends, and one pass over a base gives each piece the number it has asked alone.

import { expect, test } from "bun:test";
import { FORMS } from "../../content/building/forms.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { rotsOf, type LatticeKey } from "../../shared/world/lattice/frames.ts";
import { candidates, makeCandidates, makeVerdict, startBase, validate } from "../../shared/world/lattice/place.ts";
import { Found } from "../../shared/world/structures.ts";
import { Support } from "../../shared/world/support.ts";
import { siteOf } from "../fixtures/pieces.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const TEAM = 3;

function refsOf(w: TestWorld): number[] {
  const out: number[] = [];
  w.structs.chunks.forEach((t, chunk) => {
    for (let slot = 0; t && slot < t.high; slot++) if (t.kind[slot] !== 0) out.push(chunk * 65536 + slot);
  });
  return out;
}

/**
 * Builds at random as a builder would: a look straight down at a piece already built, a form at random, one of the
 * slots that look offers it and a turn at random, and the piece set down where the server would allow it.
 */
function ramble(w: TestWorld, rng: Rng, tries: number): void {
  const site = siteOf(w);
  const names = Object.keys(FORMS).filter((name) => !name.endsWith("_open"));
  const kinds = names.map((name) => w.kind(`core:${name}_wood`));
  const offered = makeCandidates();
  const verdict = makeVerdict();
  const built = [startBase(w.structs, w.kind("core:foundation_wood"), { x: 128 * 512, y: 96, z: 128 * 512, yaw: rng.int(65536) }, TEAM, 100)];
  for (let i = 0; i < tries; i++) {
    const target = built[rng.int(built.length)]!;
    const t = w.structs.chunks[Math.floor(target / 65536)]!;
    const slot = target & 0xffff;
    const kind = kinds[rng.int(kinds.length)]!;
    const high = t.y[slot]! + w.reg.halfY[t.kind[slot]!]!;
    // From over its top down onto it, or from beside its foot.
    const n = candidates(site, kind, TEAM, t.x[slot]! + rng.range(-1.4, 1.4), high + 2, t.z[slot]! + rng.range(-1.4, 1.4), 0, -1, 0, rng.int(2) === 0 ? 2 : 2 + 2 * w.reg.halfY[t.kind[slot]!]!, offered);
    if (n === 0) continue;
    const c = rng.int(Math.min(n, 6));
    const k1 = (offered.k1[c]! | (rng.int(rotsOf(w.reg.forms, kind)) << 26)) >>> 0;
    if (validate(site, kind, TEAM, offered.fr[c]!, offered.k0[c]!, k1, NaN, NaN, NaN, verdict) !== RESULT_OK) continue;
    const ref = w.structs.place(kind, offered.fr[c]!, offered.k0[c]!, k1, TEAM, 100);
    if (ref >= 0) built.push(ref);
  }
}

function keyed(w: TestWorld): { pieces: [number, number, number, number][]; frames: [number, number, number, number, number, number][] } {
  const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
  const pieces: [number, number, number, number][] = [];
  for (const ref of refsOf(w)) if (w.structs.keyAt(ref, key)) pieces.push([w.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!, key.fr, key.k0, key.k1]);
  return { pieces, frames: [...w.structs.frames.all()].map((f) => [f.gid, f.ox, f.oy, f.oz, f.yaw, f.team]) };
}

function byKey(w: TestWorld): [string, number][] {
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
  const out: [string, number][] = [];
  for (const ref of refsOf(w)) if (w.structs.keyAt(ref, key)) out.push([`${key.fr} ${key.k0} ${key.k1}`, support.stability(ref)]);
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

test("with every form: the numbers are the same in any order of building, with pieces missing or taken away, and in one pass", () => {
  const seen = new Map<string, number>();
  let pieces = 0;
  let failing = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const built = flatWorld(4);
    ramble(built, new Rng(seed * 101), 6000);
    const { pieces: list, frames } = keyed(built);
    pieces += list.length;
    for (const [kind] of list) seen.set(built.reg.ids[kind]!.slice(5, -5), (seen.get(built.reg.ids[kind]!.slice(5, -5)) ?? 0) + 1);
    const gone = new Set<number>();
    const pick = new Rng(seed * 31);
    for (let k = 1; k < list.length; k++) if (pick.int(6) === 0) gone.add(k);
    const lay = (order: number[], skip: Set<number> | null): TestWorld => {
      const w = flatWorld(4);
      for (const [gid, ox, oy, oz, yaw, team] of frames) w.structs.frames.make(ox, oy, oz, yaw, team, gid);
      for (const k of order) {
        if (skip?.has(k)) continue;
        const [kind, fr, k0, k1] = list[k]!;
        expect(w.structs.place(kind, fr, k0, k1, TEAM, 100)).toBeGreaterThanOrEqual(0);
      }
      return w;
    };
    const inOrder = list.map((_, k) => k);
    const whole = byKey(lay(inOrder, null));
    expect(whole).toEqual(byKey(built));
    // Everything a builder was allowed stands.
    expect(whole.filter(([, n]) => n < 0)).toEqual([]);
    const holed = byKey(lay(inOrder, gone));
    failing += holed.filter((p) => p[1] < 0).length;
    const rng = new Rng(seed * 7919);
    for (let round = 0; round < 2; round++) {
      const order = [...inOrder];
      for (let k = order.length - 1; k > 0; k--) {
        const j = rng.int(k + 1);
        [order[k], order[j]] = [order[j]!, order[k]!];
      }
      expect(byKey(lay(order, null))).toEqual(whole);
      const w = lay(order, gone);
      expect(byKey(w)).toEqual(holed);
      // Taken away after being built, the same pieces leave the same numbers as never having been built.
      const full = lay(order, null);
      const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
      const at = new Map(list.map((p, k) => [`${p[1]} ${p[2]} ${p[3]}`, k]));
      for (const ref of refsOf(full)) if (full.structs.keyAt(ref, key) && gone.has(at.get(`${key.fr} ${key.k0} ${key.k1}`)!)) full.structs.remove(ref);
      expect(byKey(full)).toEqual(holed);
      // One pass over the frame gives every piece the number it has asked alone.
      const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
      const rows = new Found();
      const out = new Int8Array(8192);
      const one = new Map(holed);
      for (const [gid] of frames) {
        const n = support.stabilities(gid, rows, out);
        for (let i = 0; i < n; i++) {
          w.structs.keyAt(rows.refs[i]!, key);
          expect([rows.refs[i], out[i]]).toEqual([rows.refs[i], one.get(`${key.fr} ${key.k0} ${key.k1}`)!]);
        }
      }
    }
  }
  expect(pieces).toBeGreaterThan(600);
  expect(failing).toBeGreaterThan(30);
  // The rambles between them built every kind of piece but the leaves stood open.
  const missing = Object.keys(FORMS).filter((name) => !name.endsWith("_open") && !seen.has(name));
  expect(missing).toEqual([]);
});

test("with every form: what a piece holds and what holds it agree from both ends", () => {
  let held = 0;
  let links = 0;
  for (const seed of [5, 6]) {
    const w = flatWorld(4);
    ramble(w, new Rng(seed * 977), 6000);
    const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
    for (const ref of refsOf(w)) {
      const n = support.node(ref)!;
      const said = (r: number): string => {
        const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
        w.structs.keyAt(r, key);
        return `${w.reg.ids[w.structs.chunks[Math.floor(r / 65536)]!.kind[r & 0xffff]!]} level ${((key.k1 >>> 10) & 511) - 256} cls ${key.k0 >>> 30} dir ${(key.k1 >>> 19) & 15} rot ${(key.k1 >>> 26) & 3}`;
      };
      for (const by of n.sup) expect(support.node(by)!.links.includes(ref) ? "" : `${said(ref)} is held by ${said(by)} at ${n.cost[n.sup.indexOf(by)]}, which does not say it holds it`).toBe("");
      for (const on of n.over) {
        const o = support.node(on)!;
        if (!o.root) expect([on, o.cost[o.sup.indexOf(ref)]]).toEqual([on, 0]);
        held++;
      }
      for (const other of n.links) {
        expect(support.node(other)!.links.includes(ref) ? "" : `${said(ref)} is joined to ${said(other)}, which does not say so`).toBe("");
        links++;
      }
    }
  }
  expect(held).toBeGreaterThan(100);
  expect(links).toBeGreaterThan(1000);
});
