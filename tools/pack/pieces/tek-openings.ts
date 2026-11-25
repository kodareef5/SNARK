// Upright Tek components are drawn about their form's origin. Recipe z is up and -y is the building's front.
import { outlineBox, type FormDef } from "../../../shared/world/lattice/forms.ts";
import { earcut, mirror, place, Shape, type FaceMap, type Flat, type Vec } from "./kit.ts";

type Tone = "alloy" | "gasket" | "socket" | "bevel" | "titanium" | "chamfer" | "cover" | "emitter" | "lens" | "copper";
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

function octagon([l, b, r, t]: Rect, cut: number): Flat[] {
  const c = Math.min(cut, (r - l) * .30, (t - b) * .30);
  return [[l, b + c], [l + c, b], [r - c, b], [r, b + c], [r, t - c], [r - c, t], [l + c, t], [l, t - c]];
}

/** A bevelled casting passes through the assembly so its face and shoulder work from either side. */
function casting(p: Shape, box: Rect, depth: number, shoulder: number, face: Tone, cut: number): void {
  const [l, b, r, t] = box;
  const inset = Math.min((r - l) * .13, (t - b) * .13, .033);
  const sole = octagon(box, cut), top = octagon([l + inset, b + inset, r - inset, t - inset], Math.max(inset, cut - inset * .5));
  const ring = (outline: Flat[], y: number): Vec[] => outline.map(([x, z]) => [x, y, z]);
  p.loft([ring(top, -depth), ring(sole, -shoulder), ring(sole, shoulder), ring(top, depth)],
    (_side, band) => [band === 1 ? "socket" : "chamfer", uv], () => [face, uv]);
}

/** Both windings of a distant sheet keep a gap readable from either side at twelve triangles per piece. */
function sheet(p: Shape, outline: Flat[], tone: Tone, y = 0): void {
  const points: Vec[] = outline.map(([x, z]) => [x, y, z]);
  const tris = earcut(outline), uvs = points.map(() => uv);
  p.faces.push({ points, uvs, mat: tone, tris }, { points: [...points], uvs: [...uvs], mat: tone,
    tris: tris.flatMap((_, i) => i % 3 === 0 ? [tris[i]!, tris[i + 2]!, tris[i + 1]!] : []) });
}

function cartridge(p: Shape, x: number, z: number, w: number, h: number, depth: number): void {
  casting(p, [x - w, z - h, x + w, z + h], depth * .93, depth * .73, "socket", w * .52);
  profile(p, octagon([x - w * .53, z - h * .67, x + w * .53, z + h * .08], w * .70), depth, "copper", "cover");
  bar(p, [x - w * .34, z + h * .29, x + w * .34, z + h * .50], depth * .99, "emitter", "lens");
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

function frame(form: FormDef, level: number): Shape {
  const p = new Shape(), box = bounds(form), [l, b, r, t] = box;
  const o = form.openings![0]!, hole: Rect = [o.x0 - form.at[0], o.y0 - form.at[1], o.x1 - form.at[0], o.y1 - form.at[1]];
  const [il, ib, ir, it] = hole, h = form.thick / 2;
  mouth(p, box, hole, level >= 3 ? h : h * .67, level === 4);
  if (level >= 3) return p;
  const jamb = Math.min(.24, (il - l) * .46), low = Math.max(b, ib - jamb), high = it + jamb;
  for (const hand of [-1, 1]) {
    const inside = hand < 0 ? il : ir, outside = hand < 0 ? l : r;
    const jambBox: Rect = hand < 0 ? [inside - jamb, low, inside, high] : [inside, low, inside + jamb, high];
    if (level === 2) { bar(p, jambBox, h, "titanium"); continue; }
    casting(p, jambBox, h * .97, h * .78, "titanium", .038);
    const x = inside + hand * (jamb * .47);
    bar(p, [x - .014, low + .17, x + .014, high - .19], h * .985, "lens");
    if (level === 0) {
      const span = high - low;
      for (const s of [.28, .69]) bar(p, [x - .008, low + s * span, x + .008, low + s * span + .13], h * .998, "emitter", "lens");
      cartridge(p, (inside + outside) / 2, ib + (it - ib) * .57, Math.min(.102, (il - l) * .14), .171, h);
    }
    const margin = Math.min(.115, (il - l) * .15);
    const [a, c] = hand < 0 ? [outside + margin, inside - jamb - .045] : [inside + jamb + .045, outside - margin];
    if (c - a > .09) {
      const panels = t - b > 4 ? (level === 0 ? 3 : 2) : 1;
      for (let j = 0; j < panels; j++) {
        const z = b + .11 + j * (t - b - .22) / panels;
        profile(p, octagon([a, z, c, z + (t - b - .22) / panels - .035], .11), h * .81, "cover", "gasket");
      }
    }
  }
  bar(p, [il - jamb * .92, it, ir + jamb * .92, it + jamb * .65], h * .945, "titanium");
  if (ib > b && level < 2) casting(p, [il - .055, ib - .105, ir + .055, ib], h, h * .80, "chamfer", .025);
  if (level < 2) {
    const hz = (it + jamb + t) / 2;
    casting(p, [il + .085, hz - .075, ir - .085, hz + .075], h * .90, h * .69, "cover", .07);
    profile(p, octagon([-.126, hz - .023, .126, hz + .023], .018), h * .93, "copper");
  }
  return p;
}

function leaf(p: Shape, half: number, low: number, high: number, h: number, gate: boolean, level: number): void {
  bar(p, [-half, low, half, high], level >= 3 ? h : h * .68, "alloy", "bevel");
  if (level >= 3) return;
  const rail = gate ? .17 : .076;
  bar(p, [-half, low + .006, -half + rail, high - .009], h, "titanium");
  bar(p, [half - rail, low + .012, half, high - .016], h * .93, "gasket");
  const bays = gate ? 3 : 2, height = high - low, step = (height - 2 * rail) / bays;
  for (let i = 0; i < bays; i++) {
    const z = low + rail + i * step, bottom = z + .019, top = z + step - .018;
    const panel: Rect = [-half + rail + .035, bottom, half - rail - .033, top];
    if (level === 2) {
      if (!gate || i === 1) bar(p, [panel[0], top - .048, panel[2], top], h * .86, "bevel");
      continue;
    }
    const [a, b, c, t] = panel, cut = Math.min((c - a) * .25, .24);
    profile(p, [[a, b + cut], [a + cut, b], [c, b], [c, t - cut * .8], [c - cut * .8, t], [a, t]], h * .81, "alloy", "chamfer");
    const brace = (t - b) * .59;
    profile(p, [[a, b + brace + .08], [a + cut, b + brace - .07], [c, b + brace - .07],
      [c, b + brace - .025], [a + cut + .02, b + brace - .025], [a, b + brace + .14]], h * .90, "cover", "bevel");
    if (level === 0) {
      casting(p, [-half + rail * .12, b + .03, -half + rail + .12, b + Math.min(.38, step * .57)], h * .985, h * .81, "titanium", .08);
      bar(p, [-half + rail + .025, b + .12, -half + rail + .073, b + .19], h, "copper");
    }
  }
  if (level === 0) cartridge(p, half - rail - .12, low + height * .55, .07, gate ? .23 : .14, h);
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
  bar(p, [l, b, r, t], level >= 3 ? h : h * .68, "alloy", "bevel");
  if (level >= 3) return p;
  const count = tall ? form.span / 4 : 1, step = (t - b) / count;
  bar(p, [l, t - .115, r, t], h, "titanium");
  if (level === 2) {
    for (let i = 1; i < count; i++) bar(p, [l + .1, b + step * i - .041, r - .1, b + step * i + .041], h * .92, "bevel");
    return p;
  }
  for (let i = 0; i < count; i++) {
    const z = b + step * i;
    profile(p, octagon([l + .11, z + .055, r - .11, z + step - .105], Math.min(.24, step * .19)), h * .80, "alloy", "gasket");
    for (const hand of [-1, 1]) {
      const x = hand * (r - .27), run = Math.min(step * .42, .68);
      const shoe: Flat[] = [[x - .11, z + .062], [x + .10, z + .062], [x + .10 + hand * .09, z + run], [x - .01 + hand * .09, z + run - .03]];
      profile(p, shoe, h * .95, "titanium", "chamfer");
      if (level === 0) cartridge(p, x, z + step * .66, .062, Math.min(.13, step * .12), h);
    }
  }
  return p;
}

function gable(form: FormDef, level: number): Shape {
  const p = new Shape(), [l, b, r, t] = bounds(form), h = form.thick / 2;
  profile(p, [[l, b], [r, b], [l, t]], level >= 3 ? h : h * .66, "alloy", "socket");
  if (level < 3) {
    const slope = (x: number): number => b + (t - b) * (r - x) / (r - l);
    const a = l + .10, c = r - .22;
    profile(p, [[a, slope(a)], [c, slope(c)], [c, slope(c) - .065], [a, slope(a) - .105]], h, "titanium", "bevel");
    if (level < 2) {
      profile(p, [[a, b + .04], [c, b + .04], [c - .38, b + .16], [a, b + .16]], h * .90, "cover", "chamfer");
      profile(p, [[a + .08, b + .23], [a + .30, b + .23], [a + .94, slope(a + .94) - .13], [a + .79, slope(a + .79) - .13]], h * .83, "cover", "bevel");
      if (level === 0) cartridge(p, a + .135, b + (t - b) * .60, .075, .134, h);
    }
  }
  return form.outline.some(([x, z]) => x > form.at[0] && z > form.at[1]) ? mirror(p, 0) : p;
}

function support(form: FormDef, level: number, fence: boolean): Shape {
  const p = new Shape(), [l, b, r, t] = bounds(form), h = form.thick / 2, height = t - b;
  bar(p, [l, b, r, t], level >= 3 ? h : h * (fence ? .70 : .45), "alloy");
  if (level >= 3) return p;
  for (const top of [false, true]) {
    const low = top ? t - height * .18 : b, high = top ? t : b + height * (fence ? .28 : .18);
    bar(p, [l, low, r, high], top ? h * .98 : h, "titanium", "bevel");
  }
  if (level < 2) {
    for (const x of [-.98, 0, .98]) {
      const edge = fence ? .135 : .10;
      profile(p, [[x - edge, b + .055], [x + edge, b + .055], [x + edge + .09, t - .047], [x + .01, t - .047]], h * .91, "cover", "chamfer");
    }
    if (level === 0) cartridge(p, -.52, b + height * .5, .072, height * .145, h * .92);
  }
  return p;
}

function railing(form: FormDef, level: number): Shape {
  const p = new Shape(), [l, b, r, t] = bounds(form), h = form.thick / 2;
  if (level === 4) {
    sheet(p, rectangle([l, t - .065, r, t]), "titanium");
    for (const x of [-1.02, 1.02]) sheet(p, rectangle([x - .045, b, x + .045, t - .066]), "cover");
    return p;
  }
  bar(p, [l, t - .069, r, t], h, "titanium", "bevel");
  const xs = level >= 2 ? [-1.02, 1.02] : [-1.05, 0, 1.05];
  for (const x of xs) {
    const z = t - .044;
    profile(p, [[x - .10, b], [x + .045, b], [x + .09, z], [x + .01, z]], h * .73, "cover", "chamfer");
    if (level < 2) {
      bar(p, [x - .13, b, x + .11, b + .062], h * .96, "alloy");
      if (level === 0) cartridge(p, x + .017, t - .16, .044, .076, h);
    }
  }
  if (level < 3) bar(p, [l + .035, b + .30, r - .035, b + .336], h * .37, "alloy", "bevel");
  return p;
}

function ladder(form: FormDef, level: number): Shape {
  const p = new Shape(), [l, b, r, t] = bounds(form), depth = -(form.off ?? 0), h = form.thick / 2;
  const y = depth - h * .25;
  if (level === 4) {
    for (const x of [l, r - .04]) sheet(p, rectangle([x, b, x + .04, t]), "titanium", y);
    sheet(p, rectangle([l + .041, -.027, r - .041, .027]), "cover", y);
    return p;
  }
  for (const x of [l, r - .045]) p.box([x, y - h * .75, b], [x + .045, y + h * .78, t], finish("titanium", "bevel"));
  const n = 10, step = (t - b) / n;
  for (let i = 0; i < n; i++) {
    if ((level === 2 && i % 2 !== 0) || (level === 3 && i !== 4)) continue;
    const z = b + (i + .5) * step, wide = .024;
    p.box([l + .017, y - wide, z - wide], [r - .017, y + wide, z + wide], finish(level < 3 ? "alloy" : "cover", "titanium"));
    if (level === 0) {
      for (const hand of [-1, 1]) p.box([hand * .20 - .023, y - wide - .004, z - .011], [hand * .20 + .023, y + wide + .004, z + .011], finish("copper"));
    }
  }
  if (level < 2) for (const x of [l + .023, r - .023]) {
    for (const z of [b + .26, t - .26]) {
      p.box([x - .021, y + h * .57, z - .052], [x + .021, depth + h + .030, z + .052], finish("cover"));
      if (level === 0) p.box([x - .012, y - h * .78, z - .035], [x + .012, y - h * .72, z + .035], finish("emitter", "lens"));
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
