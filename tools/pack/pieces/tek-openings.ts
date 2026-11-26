// Upright Tek components are drawn about their form's origin. Recipe z is up and -y is the building's front.
import { outlineBox, type FormDef } from "../../../shared/world/lattice/forms.ts";
import { earcut, mirror, place, Shape, type FaceMap, type Flat, type Vec } from "./kit.ts";

type Tone = "membrane" | "alloy" | "gasket" | "socket" | "bevel" | "titanium" | "chamfer" | "cover" | "emitter" | "lens" | "copper";
type Rect = readonly [left: number, bottom: number, right: number, top: number];
const uv: Flat = [0, 0];
const finish = (face: Tone, edge: Tone = face): FaceMap => (side) => [side.endsWith("y") ? face : edge, () => uv];
const rectangle = ([l, b, r, t]: Rect): Flat[] => [[l, b], [r, b], [r, t], [l, t]];
const section = (loop: readonly Flat[]): Flat[] => loop.map(([x, z]) => [z, x]);

function bounds(form: FormDef): Rect {
  const [l, b, r, t] = outlineBox(form);
  return [l - form.at[0], b - form.at[1], r - form.at[0], t - form.at[1]];
}

function profile(p: Shape, loop: readonly Flat[], depth: number, face: Tone, edge: Tone = "socket"): void {
  p.extrude(section(loop), "y", -depth, depth, finish(face, edge));
}

function bar(p: Shape, [l, b, r, t]: Rect, depth: number, face: Tone, edge: Tone = "socket"): void {
  p.box([l, -depth, b], [r, depth, t], finish(face, edge));
}

/** Both windings of a distant sheet keep a gap readable from either side at twelve triangles per piece. */
function sheet(p: Shape, outline: Flat[], tone: Tone, y = 0): void {
  const points: Vec[] = outline.map(([x, z]) => [x, y, z]);
  const tris = earcut(outline), uvs = points.map(() => uv);
  p.faces.push({ points, uvs, mat: tone, tris }, { points: [...points], uvs: [...uvs], mat: tone,
    tris: tris.flatMap((_, i) => i % 3 === 0 ? [tris[i]!, tris[i + 2]!, tris[i + 1]!] : []) });
}

function mouth(p: Shape, outer: Rect, opening: Rect, depth: number, distant: boolean): void {
  const [l, b, r, t] = outer, [il, ib, ir, it] = opening;
  if (ib <= b + 1e-6) {
    const arch: Flat[] = [[l, b], [il, b], [il, it], [ir, it], [ir, b], [r, b], [r, t], [l, t]];
    if (distant) sheet(p, arch, "titanium");
    else profile(p, arch, depth, "alloy", "bevel");
  } else if (distant) {
    // Broad sill and lintel retain their whole silhouette; the two short jambs narrow toward the opening.
    sheet(p, rectangle([l, b, r, ib]), "alloy");
    sheet(p, rectangle([l, it, r, t]), "alloy");
    sheet(p, [[l, ib], [il, (ib + it) / 2], [l, it]], "titanium");
    sheet(p, [[r, it], [ir, (ib + it) / 2], [r, ib]], "titanium");
  } else {
    p.extrude(section(rectangle(outer)), "y", -depth, depth, finish("alloy", "bevel"), [section(rectangle(opening))]);
  }
}

const bevelQuad: Flat[] = [[0, .14], [.10, 0], [.78, 0], [1, .17], [1, .85], [.88, 1], [.20, 1], [0, .76]];
const glass: Flat[] = [[0, .18], [.16, 0], [.69, 0], [1, .19], [1, .79], [.81, 1], [.28, 1], [0, .75]];
const tip: Flat[] = [[0, .21], [.17, 0], [.83, 0], [1, .23], [1, .72], [.76, 1], [.22, 1], [0, .81]];

function mapped([l, b, r, t]: Rect, path: readonly Flat[]): Flat[] {
  return path.map(([x, y]) => [l + (r - l) * x, b + (t - b) * y]);
}

function between(a: readonly Flat[], b: readonly Flat[], amount: number): Flat[] {
  return a.map(([x, y], i) => [x + amount * (b[i]![0] - x), y + amount * (b[i]![1] - y)]);
}

function forged(p: Shape, loop: Flat[], h: number, seat: number, face: Tone, edge: Tone): void {
  const n = loop.length, x = loop.reduce((a, q) => a + q[0], 0) / n, z = loop.reduce((a, q) => a + q[1], 0) / n;
  const cap = loop.map(([u, v]): Flat => [x + (u - x) * .87, z + (v - z) * .92]);
  const ring = (points: Flat[], y: number): Vec[] => points.map(([u, v]) => [u, y, v]);
  p.loft([ring(cap, -h), ring(loop, -seat), ring(loop, seat), ring(cap, h)], (_, band) => [band === 1 ? "socket" : edge, uv], () => [face, uv]);
  for (const cap of p.faces.slice(-2)) cap.tris = earcut(cap.points.map(([x, , z]) => [x, z]));
}

/** One closed casting has two recessed optical faces with opposing leads down its inner walls. */
function optical(p: Shape, outside: Flat[], inside: Flat[], h: number, floor: number, level: number): void {
  const steps: [Flat[], number, Tone | "lead"][] = [[inside, floor, "socket"]];
  if (level < 2) steps.push([between(inside, outside, .10), floor + .16 * (h - floor), "lead"]);
  steps.push([between(inside, outside, .24), h * .88, "alloy"]);
  if (level === 0) steps.push([between(inside, outside, .36), h, "bevel"]);
  steps.push([outside, h * .62, "socket"]);
  const rings = [...steps, ...[...steps].reverse()];
  p.loft(rings.map(([loop, y], i) => loop.map(([x, z]): Vec => [x, i < steps.length ? -y : y, z])),
    (side, i) => {
      const material = steps[Math.max(0, Math.min(i, rings.length - i - 2))]![2];
      return [material === "lead" ? (side === 3 || side === inside.length - 1 ? "emitter" : "gasket") : material, uv];
    }, () => ["membrane", uv]);
}

/** The copper journal sits between separate clevis ears and shares the leaf's axis. */
function pivot(p: Shape, x: number, z: number, width: number, height: number, h: number, level: number): void {
  const journalDepth = h + Math.min(.020, h * .30);
  const lobes: Flat[] = [[-.67, -1], [.67, -1], [1, -.42], [1, .42], [.67, 1], [-.67, 1], [-1, .42], [-1, -.42]];
  const drum = (a: number, b: number, w: number, depth: number, body: Tone, cap: Tone): void => {
    p.extrude(lobes.map(([u, v]) => [x + u * w, v * depth]), "z", z + a * height, z + b * height,
      side => [side.endsWith("z") ? cap : body, () => uv]);
  };
  if (level === 0) {
    drum(-.50, -.24, width, journalDepth, "bevel", "socket");
    drum(-.24, .24, width * .80, journalDepth * .95, "copper", "gasket");
    drum(.24, .50, width, journalDepth, "bevel", "socket");
  } else drum(-.5, .5, width, journalDepth, "bevel", "socket");
}

function frame(form: FormDef, level: number): Shape {
  const p = new Shape(), box = bounds(form), [l, b, , t] = box;
  const o = form.openings![0]!, hole: Rect = [o.x0 - form.at[0], o.y0 - form.at[1], o.x1 - form.at[0], o.y1 - form.at[1]];
  const [il, ib, ir, it] = hole, h = form.thick / 2, gate = t - b > 4, window = ib > b;
  mouth(p, box, hole, level >= 3 ? h : h * .37, level === 4);
  if (level >= 3) return p;
  const cheek = Math.min(.21, (il - l) * .31), top = it + Math.min((t - it) * .55, .25);
  for (const hand of [-1, 1]) {
    const j = hand < 0 ? il : ir, available = il - l, z0 = window ? ib - .26 : b;
    const fromJamb = (points: Flat[]) => points.map(([u, z]): Flat => [j + hand * u, z]);
    const cheekShape = fromJamb([[0, z0], [cheek, z0], [cheek * .76, z0 + .22], [cheek * .76, it - .20],
      [cheek * 1.36, it + .025], [cheek * 1.36, top], [0, top]]);
    if (level === 2) {
      profile(p, cheekShape, h * .93, "bevel", "socket");
      continue;
    }
    if (level === 0) forged(p, cheekShape, h, h * .57, "bevel", "chamfer");
    else profile(p, cheekShape, h * .94, "bevel", "socket");
    const shoulder = Math.min(available - .06, gate ? .44 : .74);
    const left = j + hand * shoulder, right = j + hand * cheek * .9;
    const box: Rect = [Math.min(left, right), b + .08, Math.max(left, right), top - .07];
    const [x0, z1, x1, z2] = box, span = x1 - x0;
    optical(p, mapped(box, bevelQuad), mapped([x0 + span * .21, z1 + .26, x1 - span * .20, z2 - .23], glass), h * .77, h * .42, level);
    if (level === 0) {
      const mid = ib + (it - ib) * .50, u = cheek * .57;
      if (!window && (hand < 0 || gate || form.takes === "double")) {
        for (const at of [.22, .77]) pivot(p, j + hand * u, ib + (it - ib) * at, cheek * .39, gate ? .39 : .25, h * 1.02, 0);
      } else {
        const plate = fromJamb([[.015, mid - .17], [cheek * .86, mid - .21], [cheek * 1.2, mid - .10], [cheek, mid + .16], [.015, mid + .17]]);
        forged(p, plate, h * 1.04, h * .78, "socket", "bevel");
        for (const dz of [-.07, .065]) profile(p, fromJamb([[.018, mid + dz], [u * 1.40, mid + dz], [u, mid + dz + .036], [.018, mid + dz + .036]]), h * 1.06, "copper", "gasket");
      }
    }
  }
  const head: Flat[] = [[il - cheek, it], [ir + cheek, it], [ir + cheek, top], [ir - cheek, top],
    [ir - cheek - .10, top - .055], [il + cheek + .10, top - .055], [il + cheek, top], [il - cheek, top]];
  if (level >= 1) profile(p, head, h * .91, "alloy", "bevel");
  else {
    forged(p, head, h * .98, h * .53, "alloy", "bevel");
    const s = Math.min((ir - il) * .31, .75), z = top + (t - top) * .40;
    const crest = mapped([-s, z - .065, s, z + .075], bevelQuad);
    forged(p, crest, h * .68, h * .42, "socket", "chamfer");
    profile(p, mapped([-s * .66, z - .009, s * .66, z + .020], tip), h * .70, "emitter", "lens");
    if (window) forged(p, mapped([il - .14, ib - .20, ir + .14, ib - .006], bevelQuad), h * .96, h * .50, "alloy", "bevel");
  }
  return p;
}

function leaf(p: Shape, half: number, low: number, high: number, h: number, gate: boolean, level: number): void {
  if (level >= 3) { bar(p, [-half, low, half, high], h, "alloy", "bevel"); return; }
  const width = 2 * half, height = high - low;
  const box: Rect = [-half, low, half, high];
  const cell = (a: number, b: number, c: number, d: number): Rect => [-half + a * width, low + b * height, -half + c * width, low + d * height];
  const perimeter: Flat[] = [[0, .16], [0, 0], [.77, 0], [1, 0], [1, .84], [1, 1], [.21, 1], [0, 1]];
  if (level === 2) {
    const rim = rectangle(box), inside = mapped(cell(.16, .14, .88, .86), [[0, 0], [1, .10], [1, 1], [0, .89]]);
    optical(p, rim, inside, h, h * .41, 2);
    return;
  }
  optical(p, mapped(box, perimeter), mapped(cell(.135, gate ? .13 : .18, .91, .90), glass), h * .96, h * .35, level);
  const rail: Flat[] = [[0, 0], [.11, 0], [.18, .12], [.13, .37], [.13, .69], [.16, .89], [.10, 1], [0, 1]];
  const spine = mapped(box, rail);
  if (level === 0) forged(p, spine, h * .99, h * .63, "alloy", "bevel");
  else profile(p, spine, h * .96, "alloy", "bevel");
  for (const at of [.205, .79]) pivot(p, -half + width * .046, low + at * height, Math.min(width * .041, .082), height * .095, h, level);
  if (gate) {
    const bridge = mapped(box, [[.072, .43], [.24, .44], [.66, .55], [1, .55], [1, .62], [.66, .62], [.22, .51], [.072, .51]]);
    if (level === 0) forged(p, bridge, h * .98, h * .59, "alloy", "chamfer");
    else profile(p, bridge, h * .94, "alloy", "bevel");
  }
  if (level === 0) {
    const toe = mapped(box, [[.05, .0], [.83, .0], [.96, .045], [.93, .10], [.61, .11], [.36, .16], [.15, .15], [.05, .09]]);
    forged(p, toe, h, h * .64, "alloy", "chamfer");
    const lock = mapped(cell(.79, .38, .985, .58), [[0, .26], [.22, 0], [1, .16], [1, .87], [.58, 1], [0, .80]]);
    forged(p, lock, h * 1.02, h * .64, "socket", "bevel");
    for (const at of [.44, .48]) {
      const bolt = mapped(cell(.85, at, .987, at + .020), [[0, 0], [1, .12], [1, 1], [.18, 1]]);
      profile(p, bolt, h * 1.02 + .006, "copper", "gasket");
    }
    profile(p, mapped(cell(.819, .410, .831, .53), bevelQuad), h * 1.04, "emitter", "lens");
  }
}

function doors(form: FormDef, level: number, paired: boolean, gate: boolean): Shape {
  const [u0, v0, u1, v1] = outlineBox(form), open = form.plane === "across";
  const wide = (u1 - u0) / (paired && !open ? 2 : 1), low = v0 - form.at[1], high = v1 - form.at[1];
  const h = form.thick / 2;
  if (paired && !open && level === 4) {
    const p = new Shape();
    bar(p, [-wide, low, wide, high], h, "alloy");
    return p;
  }
  const make = (): Shape => {
    const p = new Shape();
    if (paired && level === 4) sheet(p, rectangle([-wide / 2, low, wide / 2, high]), "alloy");
    else {
      const clear = paired ? .002 : 0;
      leaf(p, wide / 2 - clear, low, high, h, gate, level);
      if (clear) place(p, ([x, y, z]) => [x - clear, y, z]);
    }
    if (open) {
      const hinge = (form.off ?? 0) - form.at[0];
      place(p, ([x, y, z]) => [hinge + y, -x - wide / 2, z]);
    } else if (paired) place(p, ([x, y, z]) => [x - wide / 2, y, z]);
    return p;
  };
  const p = make();
  if (paired) p.faces.push(...mirror(make(), 0).faces);
  return p;
}

function armour(form: FormDef, level: number, tall: boolean): Shape {
  const p = new Shape(), [l, b, r, t] = bounds(form), h = form.thick / 2;
  bar(p, [l, b, r, t], level >= 3 ? h : h * .27, "alloy", "socket");
  if (level >= 3) return p;
  const count = tall ? form.span / 4 : 1, step = (t - b) / count;
  for (let i = 0; i < count; i++) {
    const base = b + i * step, box: Rect = [l + .035, base + .028, r - .035, base + step - .029];
    const inside: Rect = [l + .28, base + Math.min(.18, step * .16), r - .22, base + step - Math.min(.21, step * .18)];
    if (level === 2 && tall) {
      bar(p, [l + .22, base + .13, r - .22, base + step - .13], h * .48, "membrane", "bevel");
      continue;
    }
    const compact = level === 2 || (tall && level === 1);
    optical(p, compact ? rectangle(box) : mapped(box, bevelQuad),
      compact ? rectangle(inside) : mapped(inside, glass), h * .93, h * .36, level);
    if (level !== 0) continue;
    for (const side of [-1, 1]) {
      const axis = side * (r - .10), length = Math.min(.49, step * .56);
      const plate = [[0, 0], [.21, 0], [.54, .41], [.45, .65], [.26, .60], [.03, .27]] as const;
      const hand = (loop: readonly Flat[]): Flat[] => loop.map(([x, z]) => [axis - side * x, base + .05 + z * length]);
      forged(p, hand(plate), h, h * .57, "alloy", "bevel");
      profile(p, hand([[.20, .12], [.27, .19], [.42, .42], [.36, .43]]), h * 1.015, "copper", "gasket");
    }
  }
  return p;
}

function gable(form: FormDef, level: number): Shape {
  const p = new Shape(), box = bounds(form), [l, b, r, t] = box, h = form.thick / 2;
  const triangle: Flat[] = [[l, b], [r, b], [l, t]];
  profile(p, triangle, level >= 3 ? h : h * .26, "alloy", "socket");
  if (level < 3) {
    const outside = mapped(box, [[.02, .11], [.06, .025], [.83, .025], [.88, .08], [.05, .91], [.02, .87]]);
    const inside = mapped(box, [[.10, .16], [.15, .095], [.64, .095], [.67, .143], [.15, .68], [.10, .62]]);
    optical(p, outside, inside, h * .93, h * .38, level);
    if (level === 0) {
      const anchor = mapped(box, [[.035, .04], [.14, .04], [.25, .18], [.20, .26], [.115, .255], [.035, .14]]);
      forged(p, anchor, h * .99, h * .62, "alloy", "chamfer");
      profile(p, mapped(box, [[.088, .091], [.113, .091], [.188, .194], [.161, .190]]), h * 1.01, "copper", "gasket");
    }
  }
  return form.outline.some(([x, z]) => x > form.at[0] && z > form.at[1]) ? mirror(p, 0) : p;
}

function support(form: FormDef, level: number, fence: boolean): Shape {
  const p = new Shape(), [l, b, r, t] = bounds(form), h = form.thick / 2, height = t - b;
  bar(p, [l, b, r, t], level >= 3 ? h : h * .32, "alloy", "socket");
  if (level >= 3) return p;
  const flange = height * (fence ? .24 : .16);
  bar(p, [l, t - flange * .8, r, t], h * .98, "bevel", "socket");
  bar(p, [l, b, r, b + flange], h, "alloy", "bevel");
  if (level === 2) return p;
  for (const hand of [-1, 1]) {
    const foot: Flat[] = [[.01, .06], [.39, .06], [.55, .18], [1.11, .76], [1.40, .83], [1.40, .93], [.98, .92], [.21, .28], [.01, .24]];
    const at = (loop: Flat[]): Flat[] => loop.map(([x, z]) => [hand * x, b + z * height]);
    if (level === 0) forged(p, at(foot), h * .90, h * .46, "alloy", "bevel");
    else profile(p, at(foot), h * .85, "alloy", "bevel");
    if (level === 0) {
      const clamp = mapped([.9, .59, 1.18, .91], bevelQuad);
      forged(p, at(clamp), h * .99, h * .69, "socket", "bevel");
      profile(p, at([[1, .63], [1.05, .64], [1.13, .82], [1.08, .82]]), h, "copper", "gasket");
    }
  }
  profile(p, mapped([-.22, t - flange * .95, .22, t - flange * .43], bevelQuad), h, "emitter", "lens");
  return p;
}

function railing(form: FormDef, level: number): Shape {
  const p = new Shape(), [l, b, r, t] = bounds(form), h = form.thick / 2;
  if (level === 4) {
    sheet(p, rectangle([l, t - .065, r, t]), "titanium");
    for (const x of [-1.02, 1.02]) sheet(p, rectangle([x - .045, b, x + .045, t - .066]), "alloy");
    return p;
  }
  bar(p, [l, t - .069, r, t], h, "bevel", "socket");
  for (const hand of [-1, 1]) {
    const x = hand * 1.03, hp = t - b;
    const leg = (loop: Flat[]): Flat[] => loop.map(([u, z]) => [x + hand * u, b + hp * z]);
    const stem = leg([[-.10, 0], [.10, 0], [.14, .14], [.012, .59], [-.14, .95], [-.23, .96], [-.075, .50], [-.05, .16]]);
    if (level < 2) {
      forged(p, stem, h * .96, h * .57, "alloy", "bevel");
      const fork = leg([[-.08, .20], [0, .15], [.17, .69], [.27, .90], [.23, .94], [.13, .91]]);
      profile(p, fork, h * .54, "bevel", "socket");
      if (level === 0) {
        forged(p, leg([[-.17, 0], [.19, 0], [.19, .07], [.10, .14], [-.11, .12], [-.17, .08]]), h * 1.01, h * .73, "alloy", "bevel");
        profile(p, leg([[-.023, .29], [.028, .31], [.062, .40], [.01, .38]]), h, "copper", "socket");
      }
    } else bar(p, [x - .050, b, x + .050, t - .062], h * .74, "alloy", "socket");
  }
  if (level < 3) bar(p, [l + .045, b + .34, r - .045, b + .364], h * .32, "lens", "socket");
  if (level === 0) {
    for (const x of [-1.2, 1.2]) profile(p, mapped([x - .17, t - .052, x + .17, t - .029], tip), h * 1.01, "emitter", "lens");
  }
  return p;
}

function ladder(form: FormDef, level: number): Shape {
  const p = new Shape(), [l, b, r, t] = bounds(form), depth = -(form.off ?? 0), h = form.thick / 2;
  const y = depth - h * .25;
  if (level === 4) {
    for (const x of [l, r - .04]) sheet(p, rectangle([x, b, x + .04, t]), "bevel", y);
    sheet(p, rectangle([l + .041, -.027, r - .041, .027]), "alloy", y);
    return p;
  }
  const post = .052, step = (t - b) / 10;
  for (const x of [l, r - post]) p.box([x, y - h * .75, b], [x + post, y + h * .78, t], finish("alloy", "bevel"));
  for (let i = 0; i < 10; i++) {
    if ((level === 2 && i % 2 !== 0) || (level === 3 && i !== 4)) continue;
    const z = b + (i + .5) * step;
    if (level > 1) p.box([l + .018, y - .028, z - .023], [r - .018, y + .028, z + .023], finish("bevel", "alloy"));
    else {
      const tread: Flat[] = [[y - .041, z - .012], [y - .031, z - .024], [y + .025, z - .024], [y + .043, z + .012], [y + .032, z + .021], [y - .040, z + .021]];
      p.extrude(tread, "x", l + .012, r - .012, side => [side === "+z" ? "bevel" : "alloy", () => uv]);
    }
  }
  if (level < 2) for (const hand of [-1, 1]) {
    const x = hand * (r - post * .5);
    for (const z of [b + .20, t - .20]) {
      const claw: Flat[] = [[y - .035, z - .072], [y - .035, z + .062], [depth + h - .013, z + .09],
        [depth + h + .028, z + .15], [depth + h + .028, z + .055], [y + .037, z - .050]];
      p.extrude(claw, "x", x - .035, x + .035, side => [side.endsWith("x") ? "bevel" : "socket", () => uv]);
      if (level === 0) {
        p.box([x - .031, y - .045, z - .032], [x + .031, y - .030, z - .009], finish("copper"));
        p.box([x - .014, y - .045, z + .009], [x + .014, y - .030, z + .041], finish("emitter", "lens"));
      }
    }
  }
  return p;
}

export function tekOpening(name: string, form: FormDef, level: number): Shape | null {
  if (level > 4) return null;
  switch (name) {
    case "doorframe": case "windowframe": case "double_doorway": case "gateway": return frame(form, level);
    case "door": case "door_open": return level < 4 ? doors(form, level, false, false) : null;
    case "double_door": case "double_door_open": return doors(form, level, true, false);
    case "gate": case "gate_open": return doors(form, level, true, true);
    case "half_wall": case "quarter_wall": case "large_wall": return level < 4 ? armour(form, level, name === "large_wall") : null;
    case "sloped_wall_left": case "sloped_wall_right": return level < 4 ? gable(form, level) : null;
    case "beam": case "fence_foundation": return level < 4 ? support(form, level, name === "fence_foundation") : null;
    case "railing": return railing(form, level);
    case "ladder": return ladder(form, level);
    default: return null;
  }
}
