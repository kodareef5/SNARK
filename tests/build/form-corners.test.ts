// Every form content places, in every slot its key can name: at each of the twelve directions its class allows, in a
// base at several yaws. Its collider lies where its row says in the slot's own frame, a piece that fills its slot has
// the slot's lattice corners for its own, and a roof's corners are as high as its turn says.

import { expect, test } from "bun:test";
import { LIVE_FORMS } from "../../content/building/forms.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { formBounds } from "../../shared/world/lattice/forms.ts";
import { keyAt, riseAt, type LatticeKey } from "../../shared/world/lattice/frames.ts";
import { CLS_SQUARE, CLS_TRIANGLE, elementCorners, keyAnchor, keyCls, keyDir } from "../../shared/world/lattice/module.ts";
import { worldOf } from "../../shared/world/lattice/basis.ts";
import { Plot, colliderCorners, cornerFault, step } from "../fixtures/pieces.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const U = STRUCT_UNITS;
const names = Object.keys(LIVE_FORMS) as (keyof typeof LIVE_FORMS)[];

test("every form in every turn of every slot, at five yaws: its collider is where its row says, on the lattice's own corners", () => {
  const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
  const m = new Int32Array(16);
  const at = new Int32Array(2);
  let placed = 0;
  const turned = new Set<string>();
  for (const yaw of [0, 5003, 16384 + 257, 40961, 65535]) {
    const w = flatWorld(4);
    const p = new Plot(w);
    p.start(128, 128, yaw);
    key.fr = p.fr;
    for (const name of names) {
      const kind = w.kind(`core:${name}_wood`);
      const f = reg.forms.def[kind]!;
      const bounds = formBounds(f);
      for (let own = 0; own < 12; own++) {
        // A slot well clear of the first foundation, on whole sides from the base's first corner.
        const ref = [20 + 2 * (own % 3), 4, 2, 10];
        m.set(ref);
        if (!keyAt(reg.forms, kind, m, 0, 8, own, key)) continue;
        const piece = w.structs.place(kind, p.fr, key.k0, key.k1, 7, 1);
        expect(piece, `${name} along ${own}`).toBeGreaterThanOrEqual(0);
        placed++;
        turned.add(`${name} ${own % 3}`);
        // The slot's own frame: its reference point, and unit vectors along its +X and +Z.
        const [ox, oz] = p.metres(ref);
        const [ax, az] = p.metres(step(ref, own, 2));
        const [bx, bz] = p.metres(step(ref, own + 3, 2));
        const [ul, vl] = [Math.hypot(ax - ox, az - oz), Math.hypot(bx - ox, bz - oz)];
        const [ux, uz, vx, vz] = [(ax - ox) / ul, (az - oz) / ul, (bx - ox) / vl, (bz - oz) / vl];
        const got = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const c of colliderCorners(w, piece)) {
          const local = [(c[0] / U - ox) * ux + (c[2] / U - oz) * uz, c[1] / U - p.height(8), (c[0] / U - ox) * vx + (c[2] / U - oz) * vz];
          for (let a = 0; a < 3; a++) {
            got[a] = Math.min(got[a]!, local[a]!);
            got[a + 3] = Math.max(got[a + 3]!, local[a]!);
          }
        }
        // A piece over two edges keeps its edges when it is turned about: its origin is then as far the other way along its own +X.
        const shift = f.cls === "edge" && keyDir(key.k1) !== own ? -2 * f.at[0] : 0;
        // To 6 mm: a base's axes are whole lattice units long, a part in 768 off true at most.
        for (let a = 0; a < 6; a++) expect(Math.abs(got[a]! - bounds[a]! - (a % 3 === 0 ? shift : 0)), `${name} along ${own} at yaw ${yaw}: its box ${got.map((v) => v.toFixed(3))} for ${bounds.map((v) => v.toFixed(3))}`).toBeLessThan(0.006);
        // What fills its slot shares the slot's corners, to a thousandth of a lattice unit.
        if (f.layer !== "leaf") expect(cornerFault(w, piece), `${name} along ${own} at yaw ${yaw}`).toBe("");
        // A roof: over each corner of its face its top is its level, what it rises there, and its slab.
        const rise = riseAt(reg.forms, kind, key.k0, key.k1);
        if (rise !== 0) {
          const cls = keyCls(key.k0);
          keyAnchor(key.k0, key.k1, m, 0);
          const n = elementCorners(cls, m, 0, keyDir(key.k1), m, 0);
          expect(cls === CLS_SQUARE || cls === CLS_TRIANGLE).toBe(true);
          for (let c = 0; c < n; c++) {
            worldOf(p.f.basis, p.f.ox, p.f.oz, m, 4 * c, at, 0);
            const tops = colliderCorners(w, piece).filter((q) => Math.abs(q[0] - at[0]!) < 1e-3 && Math.abs(q[2] - at[1]!) < 1e-3).map((q) => q[1] / U);
            expect(Math.max(...tops), `${name} along ${own}, corner ${c}`).toBeCloseTo(p.height(8 + ((rise >> (3 * c)) & 7)) + f.thick, 6);
          }
        }
        w.structs.remove(piece);
      }
    }
  }
  // Every form was set down in each turn class its slots have: a post in one, an edge's or a face's piece in all three.
  for (const name of names) expect([name, [0, 1, 2].filter((tw) => turned.has(`${name} ${tw}`)).length]).toEqual([name, LIVE_FORMS[name].cls === "vertex" ? 1 : 3]);
  expect(placed).toBeGreaterThan(names.length * 5 * 6);
});
