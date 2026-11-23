// A pier's break set: necked to its bars in either half, broken to a stub whose head fits the shaft that fell from it,
// out of plumb, and heaped. It is written standing with its foot at y = 0.

import { RUIN_FINISHES, RUIN_SHAPES } from "../ruins.ts";
import type { ShapeBox } from "../../shared/content/kinds/shapes.ts";
import { PI, detCos, detSin } from "../../shared/math/scalar.ts";
import { Rng } from "../../shared/rng.ts";
import type { Chunk } from "./cut.ts";
import { seedOf, type Component, type Form } from "./forms.ts";
import { grid, type Corner, type Pt } from "./geometry.ts";
import { heapForm } from "./heap.ts";

const RUST = 179, CORE = 102, BAR = 0.035;
/** A bar's middle is this far in from the pier's faces. */
const COVER = 0.08;
/** The most the stub's head rises over its lowest point: no tooth over the art's 0.32 m. */
const TOOTH = 0.32;
/** The lean of a pier out of plumb: 8 degrees, as a slope on the grid. */
const LEAN = grid(detSin((8 * PI) / 180) / detCos((8 * PI) / 180));
const SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

/** A square's four corners on a plane that need not be level: `y` at its middle, `dx` and `dz` more at its +x and +z sides. */
const ring = (cx: number, cz: number, half: number, y: number, dx = 0, dz = 0): Corner[] => SIGNS.map(([sx, sz]): Corner => [cx + sx * half, y + sx * dx + sz * dz, cz + sz * half]);
const raised = (c: Corner, y: number): Corner => [c[0], y, c[2]];
const bar = (x: number, z: number, y0: number, y1: number): ShapeBox => ({ at: [x, (y0 + y1) / 2, z], half: [BAR, (y1 - y0) / 2, BAR], color: RUST });

/** The head's triangles, by the place of each point among the four corners and then the inner points. */
const ONE = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] as const;
const TWO = [[0, 1, 5], [1, 2, 5], [2, 4, 5], [2, 3, 4], [3, 0, 4], [0, 5, 4]] as const;

export type PierName = "pier4" | "pier8" | "pier16";

/** One of the kit's piers and its forms. */
export function pier(name: PierName = "pier8"): Component {
  const [WIDE, TALL] = RUIN_SHAPES[name];
  const H = WIDE / 2;
  /** The stub's lowest head point, and the leaning pier's solid top. A short pier's are lower. */
  const STUB = Math.min(2.44, grid(TALL * 0.45)), LEANT = grid(TALL * 0.9);
  /** A neck's length, which a short pier has less of. */
  const NECK = Math.min(1, TALL / 8);
  const BOX: ShapeBox = { at: [0, TALL / 2, 0], half: [H, TALL / 2, H] };

  const whole = (): Form => ({ name: "whole", note: "", look: { boxes: [BOX], chunks: [] }, walked: { boxes: [BOX], hulls: [] }, fragments: [], panes: [], bears: true });

  /**
   * A neck about `mid` up: the cover gone over 1.6 m, a core half the section wide left, and the bars through it. Each
   * transition's two ends lie on one slope, so its four sides are flat and the cover that left fits it.
   */
  function necked(form: "breach A" | "breach B", mid: number, variant: number): Form {
    const rng = new Rng(seedOf(name, form, variant));
    const tilt = (): number => grid(rng.range(0.05, 0.11) * (rng.float() < 0.5 ? -1 : 1));
    const at = mid + grid(NECK * rng.range(-0.25, 0.25)), long = grid(NECK * rng.range(1.5, 1.7));
    const a = at - long / 2, e = at + long / 2, b = a + grid(NECK * rng.range(0.24, 0.36)), d = e - grid(NECK * rng.range(0.24, 0.36));
    const dx0 = tilt(), dz0 = tilt(), dx1 = tilt(), dz1 = tilt();
    const ox = grid(rng.range(-0.07, 0.07)), oz = grid(rng.range(-0.07, 0.07));
    const low = ring(0, 0, H, a, dx0, dz0), in0 = ring(ox, oz, H / 2, b, dx0 / 2, dz0 / 2), in1 = ring(ox, oz, H / 2, d, dx1 / 2, dz1 / 2), high = ring(0, 0, H, e, dx1, dz1);
    const chunks: Chunk[] = [
      { corners: [...ring(0, 0, H, 0), ...low] }, { corners: [...low, ...in0], bare: true }, { corners: [...in0, ...in1], bare: true },
      { corners: [...in1, ...high], bare: true }, { corners: [...high, ...ring(0, 0, H, TALL)] },
    ];
    // The cover, a side at a time. One or two sides broke across as they left, on a line that is not level.
    const fragments: Chunk[][] = [];
    const first = rng.int(4), split = rng.int(3);
    for (let k = 0; k < 4; k++) {
      const j = (k + 1) % 4;
      const foot = [low[k]!, low[j]!, in0[k]!, in0[j]!], head = [in1[k]!, in1[j]!, high[k]!, high[j]!];
      if ((k + first) % 4 >= split) { fragments.push([{ corners: [...foot, ...head], bare: true }]); continue; }
      const yo = at + grid(NECK * rng.range(-0.2, 0.2)), yi = yo + grid(rng.range(0.04, 0.1) * (rng.float() < 0.5 ? -1 : 1));
      const across = [raised(low[k]!, yo), raised(low[j]!, yo), raised(in0[k]!, yi), raised(in0[j]!, yi)];
      fragments.push([{ corners: [...foot, ...across], bare: true }], [{ corners: [...across, ...head], bare: true }]);
    }
    // Four bars at the old corners. One has bowed out of the neck.
    const bowed = rng.int(4), bow = grid(rng.range(0.1, 0.16)), knee = at + grid(NECK * rng.range(-0.3, 0.3));
    const boxes: ShapeBox[] = [];
    SIGNS.forEach(([sx, sz], k) => {
      const x = sx * (H - COVER), z = sz * (H - COVER), y0 = low[k]![1], y1 = high[k]![1];
      if (k !== bowed) { boxes.push(bar(x, z, y0, y1)); return; }
      const out = ring(x + sx * bow, z + sz * bow, BAR, knee);
      chunks.push({ corners: [...ring(x, z, BAR, y0), ...out], color: RUST }, { corners: [...out, ...ring(x, z, BAR, y1)], color: RUST });
    });
    return { name: form, note: "necked to its bars", look: { boxes, chunks }, walked: { boxes: [BOX], hulls: [] }, fragments, panes: [], bears: true };
  }

  /**
   * A stub and the shaft that fell from it. The break is one surface of triangles over five or six points; the stub is a
   * prism down from each triangle and the shaft a prism up from it, so the two fit.
   */
  function opened(variant: number): Form {
    const rng = new Rng(seedOf(name, "open", variant));
    const jot = (): number => grid(rng.range(-0.05, 0.05));
    const inner: Pt[] = rng.float() < 0.5 ? [[-0.13 + jot(), 0.08 + jot()], [0.13 + jot(), -0.08 + jot()]] : [[2 * jot(), 2 * jot()]];
    const flat: Pt[] = [...SIGNS.map(([sx, sz]): Pt => [sx * H, sz * H]), ...inner];
    // The inner points are the head's peak and its pit, so it is never one slope.
    const up = rng.float() < 0.5;
    const raw = flat.map((_, i) => (i < 4 ? rng.float() : (i === 4) === up ? 1 : 0));
    const least = Math.min(...raw), most = Math.max(...raw), band = rng.range(0.27, TOOTH);
    const head = flat.map(([x, z], i): Corner => [x, grid(STUB + ((raw[i]! - least) / (most - least)) * band), z]);
    const prisms = (y: number): Chunk[] => (inner.length === 2 ? TWO : ONE).map((t): Chunk => ({ corners: [...t.map((i) => raised(head[i]!, y)), ...t.map((i) => head[i]!)], bare: true }));
    // Two chips off the head's corners. They are of the shaft's own volume, and leave as it does.
    const chip = (k: number): Chunk => {
      const [sx, sz] = SIGNS[k]!, y = head[k]![1];
      const wide = rng.range(0.16, 0.28), deep = rng.range(0.16, 0.28), tall = rng.range(0.14, 0.24);
      const foot: Corner[] = [[sx * H, y, sz * H], [sx * (H - wide), y + 0.03, sz * H], [sx * H, y + 0.05, sz * (H - deep)]];
      return { corners: [...foot, ...foot.map((c, i): Corner => [c[0], y + tall * [1, 0.6, 0.75][i]!, c[2]])], bare: true };
    };
    const from = rng.int(4);
    // Two or three bars stand out of the stub, the first bent over.
    const boxes: ShapeBox[] = [];
    [0, 2, 1].slice(0, 2 + rng.int(2)).forEach((step, n) => {
      const k = (from + 1 + step) % 4, [sx, sz] = SIGNS[k]!;
      const x = sx * (H - COVER), z = sz * (H - COVER), top = head[k]![1] + rng.range(0.4, 0.95);
      boxes.push(bar(x, z, head[k]![1] - 0.2, top));
      if (n === 0) { const reach = rng.range(0.3, 0.45); boxes.push({ at: [x - (sx * reach) / 2, top - BAR, z], half: [reach / 2, BAR, BAR], color: RUST }); }
    });
    const stub: ShapeBox = { at: [0, STUB / 2, 0], half: [H, STUB / 2, H] };
    return { name: "open", note: "a stub, its head the shaft's foot", look: { boxes, chunks: prisms(0) }, walked: { boxes: [stub], hulls: [] }, fragments: [prisms(TALL), [chip(from)], [chip((from + 2) % 4)]], panes: [], bears: false };
  }

  /** The pier out of plumb toward +z, its foot where it was and its head broken on a slant. The piece off its head leaves. */
  function leant(variant: number): Form {
    const rng = new Rng(seedOf(name, "hung", variant));
    const signed = (lo: number, hi: number): number => grid(rng.range(lo, hi) * (rng.float() < 0.5 ? -1 : 1));
    const dx = signed(0.08, 0.16), dz = signed(0.03, 0.09), crown = 0.05;
    const cut = LEANT + Math.abs(dx) + Math.abs(dz) + crown + grid(rng.range(0, 0.12));
    const lean = (c: Corner): Corner => [c[0], c[1], c[2] + c[1] * LEAN];
    const under = ring(0, 0, H, cut - crown, dx, dz), over = ring(0, 0, H, cut, dx, dz);
    // The broken face is a thin crown in the core's colour: a leaning face is not on the whole pier's skin.
    const chunks: Chunk[] = [{ corners: [...ring(0, 0, H, 0), ...under].map(lean) }, { corners: [...under, ...over].map(lean), color: CORE }];
    const from = rng.int(4);
    const boxes = [from, (from + 2) % 4].map((k, n): ShapeBox => {
      const [sx, sz] = SIGNS[k]!, y = over[k]![1];
      return bar(sx * (H - COVER), sz * (H - COVER) + y * LEAN, y - 0.1, y + rng.range(0.3, 0.6) - n * 0.1);
    });
    const solid = [...ring(0, 0, H, 0), ...ring(0, 0, H, LEANT)].map(lean);
    return { name: "hung", note: "out of plumb 8 degrees", look: { boxes, chunks }, walked: { boxes: [], hulls: [{ corners: solid }] }, fragments: [[{ corners: [...over, ...ring(0, 0, H, TALL)], bare: true }]], panes: [], bears: false };
  }

  return {
    name, family: "pier", material: "concrete", finish: [RUIN_FINISHES.concrete.color, RUIN_FINISHES.concrete.under], skin: [BOX], origin: [0, TALL / 2, 0], apart: [1.5, 1, 0.6],
    forms: (variant) => [
      whole(), necked("breach A", TALL / 4, variant), necked("breach B", (3 * TALL) / 4, variant), opened(variant), leant(variant),
      heapForm({ name, variant, kind: "pier", footprint: [-H, H, -H, H], floor: 0, volume: WIDE * WIDE * TALL }),
    ],
  };
}
