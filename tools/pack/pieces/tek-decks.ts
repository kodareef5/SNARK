import { clip, tidy } from "../../../content/breaks/geometry.ts";
import { outlineBox, type FormDef } from "../../../shared/world/lattice/forms.ts";
import { Shape, inset, slabOn, type FaceMap, type Flat, type Vec } from "./kit.ts";
import { planOf } from "./lod.ts";

type Height = (q: Flat) => number;
type Finish = "alloy" | "membrane" | "lens" | "titanium" | "chamfer" | "gasket" | "socket" | "cover" | "bevel" | "copper" | "emitter";
const uv = (): Flat => [0, 0];
const coat = (face: Finish, sides = face): FaceMap => label => [label.endsWith("z") ? face : sides, uv];
const same = (height: number): Height => () => height;
const raised = (h: Height, dz: number): Height => q => h(q) + dz;
const vec = ([x, y]: Flat, z: number): Vec => [x, y, z];

function centre(plan: readonly Flat[]): Flat {
  return [plan.reduce((s, p) => s + p[0], 0) / plan.length, plan.reduce((s, p) => s + p[1], 0) / plan.length];
}

function cutCorners(plan: readonly Flat[], cut: number): Flat[] {
  return plan.flatMap((p, k) => [plan[(k + plan.length - 1) % plan.length]!, plan[(k + 1) % plan.length]!].map((q): Flat => {
    const f = Math.min(.32, cut / Math.hypot(q[0] - p[0], q[1] - p[1]));
    return [p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])];
  }));
}

type Band = readonly [outline: readonly Flat[], height: Height, finish: Finish];

function casing(p: Shape, bands: readonly Band[], bottom: Finish, top: Finish): void {
  const rings = bands.map(([plan, h]) => plan.map(q => vec(q, h(q))));
  p.loft(rings, (_side, i) => [bands[i]![2], [0, 0]], i => [i === 0 ? bottom : top, [0, 0]]);
}

function plate(p: Shape, plan: readonly Flat[], base: Height, face: Height, lip: number, top: Finish, bevel: Finish = "chamfer"): void {
  casing(p, [[plan, base, bevel], [inset(plan, lip), face, top]], bevel, top);
}

function slab(p: Shape, plan: readonly Flat[], top: Height, bottom: Height, face: Finish, rim: Finish, under: Finish = face): void {
  slabOn(p, plan, plan.map(top), plan.map(bottom), side => [side === "top" ? face : side === "under" ? under : rim, uv]);
}

/** Local points run along an edge in metres about its middle and inward from that edge. */
function onSide(plan: readonly Flat[], k: number, points: readonly Flat[]): Flat[] {
  const a = plan[k]!, b = plan[(k + 1) % plan.length]!;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  return points.map(([u, v]) => [(a[0] + b[0]) / 2 + (dx * u - dy * v) / len, (a[1] + b[1]) / 2 + (dy * u + dx * v) / len]);
}

function rect(x0: number, y0: number, x1: number, y1: number): Flat[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

type PlanMap = (outline: readonly Flat[]) => Flat[];

/** Each row spans the available width, so a triangular deck tapers toward its nose. */
function deckMap(plan: readonly Flat[]): PlanMap {
  const ys = plan.map(q => q[1]), min = Math.min(...ys), max = Math.max(...ys);
  return poly => poly.map(([u, v]) => {
    const y = min + (1 + v) * (max - min) / 2;
    const cuts: number[] = [];
    for (let k = 0; k < plan.length; k++) {
      const a = plan[k]!, b = plan[(k + 1) % plan.length]!;
      if ((a[1] < y) === (b[1] < y)) continue;
      cuts.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
    }
    const left = Math.min(...cuts), right = Math.max(...cuts);
    return [left + (1 + u) * (right - left) / 2, y];
  });
}

function chamfered(x0: number, y0: number, x1: number, y1: number, cx: number, cy = cx): Flat[] {
  return [[x0, y0 + cy], [x0 + cx, y0], [x1 - cx, y0], [x1, y0 + cy],
    [x1, y1 - cy], [x1 - cx, y1], [x0 + cx, y1], [x0, y1 - cy]];
}

/** Two cast cheeks retain the cell, with bridge contacts at either end of each conductor. */
function powerKeel(p: Shape, map: PlanMap, z: Height, level: number): void {
  const casting = map(chamfered(-.405, -.922, .405, .922, .15, .23));
  plate(p, casting, raised(z, -.071), raised(z, -.022), .008, "bevel", "titanium");
  const throat = map(chamfered(-.331, -.821, .331, .821, .115, .16));
  plate(p, throat, raised(z, -.024), raised(z, -.019), .007, "gasket", "socket");
  const window = map(chamfered(-.218, -.655, .218, .655, .089, .12));
  plate(p, window, raised(z, -.021), raised(z, -.013), .005, "membrane", "lens");
  for (const sign of [-1, 1]) {
    const rail = (a: number, b: number, y0: number, y1: number): Flat[] =>
      map([[sign * a, y0 + .05], [sign * b, y0], [sign * b, y1 - .05], [sign * a, y1]]);
    slab(p, rail(.260, .281, -.645, .645), raised(z, -.011), raised(z, -.020), "emitter", "lens");
    if (level !== 0) continue;
    for (const end of [-1, 1]) {
      const contact = map([[sign * .250, end * .452], [sign * .358, end * .485], [sign * .358, end * .594], [sign * .250, end * .557]]);
      plate(p, contact, raised(z, -.023), raised(z, -.005), .003, "copper", "socket");
    }
    const hood = map(chamfered(-.257, sign < 0 ? -.904 : .712, .257, sign < 0 ? -.712 : .904, .08, .050));
    plate(p, hood, raised(z, -.026), raised(z, .001), .012, "cover", "chamfer");
  }
}

function treadBanks(p: Shape, map: PlanMap, z: Height, count: number, chevrons: boolean): void {
  for (const hand of [-1, 1]) for (let k = 0; k < count; k++) {
    const y0 = -.925 + k * 1.85 / count, y1 = -.925 + (k + 1) * 1.85 / count;
    const swept = (u: number, v: number): Flat => {
      const squareEnd = (k === 0 && v === y0) || (k === count - 1 && v === y1);
      return [hand * u, v + (squareEnd ? 0 : (u - .45) * .17)];
    };
    const panel = map([[.458, y0 + .027], [.520, y0], [.940, y0], [.976, y0 + .043],
      [.976, y1 - .075], [.913, y1 - .023], [.515, y1 - .023], [.458, y1 - .078]].map(([x, y]) => swept(x!, y!)));
    plate(p, panel, raised(z, -.069), raised(z, -.002), .017, "alloy", "bevel");
    if (!chevrons) continue;
    const middle = (y0 + y1) / 2;
    for (const offset of [-.057, .057]) {
      const y = middle + offset;
      const line = map([swept(.575, y - .018), swept(.876, y - .018), swept(.901, y + .016), swept(.596, y + .016)]);
      slab(p, line, raised(z, .003), raised(z, -.004), "socket", "bevel");
    }
  }
}

/** The recessed perimeter beam bears on pairs of bright, splayed cast shoes. */
function compressionFeet(p: Shape, plan: Flat[], bottom: number, top: number): void {
  for (let k = 0; k < plan.length; k++) {
    const a = plan[k]!, b = plan[(k + 1) % plan.length]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const hand of [-1, 1]) {
      const at = hand * length * .292, width = Math.min(.31, length * .104);
      const shoe = (w: number, depth: number, shift: number): Flat[] => onSide(plan, k, [
        [at + shift - w, depth + .012], [at + shift - w + .038, depth], [at + shift + w - .038, depth], [at + shift + w, depth + .012],
        [at + shift + w - .018, .116], [at + shift - w + .018, .116]]);
      casing(p, [[shoe(width, .008, 0), same(bottom + .034), "chamfer"],
        [shoe(width, .001, 0), same(bottom + .077), "titanium"], [shoe(width * .61, .033, hand * .049), same(bottom + .128), "socket"],
        [shoe(width * .61, .033, hand * .049), same(top - .135), "chamfer"], [shoe(width * .88, .011, hand * .040), same(top - .071), "cover"]], "socket", "cover");
    }
  }
}

function soffit(p: Shape, plan: Flat[], map: PlanMap, bottom: number, level: number): void {
  const seat = map(chamfered(-.48, -.70, .48, .70, .20, .15));
  plate(p, seat, same(bottom + .094), same(bottom + .018), .026, "socket", "titanium");
  const lens = map(chamfered(-.266, -.587, .266, .587, .102, .10));
  plate(p, lens, same(bottom + .020), same(bottom + .011), .005, "membrane", "lens");
  for (const side of [-1, 1]) {
    const c = centre(plan), outer = inset(plan, .12);
    for (const q of outer.filter(q => side * (q[0] - c[0]) > .01)) {
      const target: Flat = [c[0] + (q[0] - c[0]) * .30, c[1] + (q[1] - c[1]) * .36];
      const dx = q[0] - target[0], dy = q[1] - target[1], len = Math.hypot(dx, dy);
      const pos = (t: number, across: number): Flat => [target[0] + dx * t - dy / len * across, target[1] + dy * t + dx / len * across];
      const arm = [pos(0, -.071), pos(.67, -.136), pos(1, -.077), pos(1, .077), pos(.67, .136), pos(0, .071)];
      plate(p, arm, same(bottom + .10), same(bottom + .003), .022, "cover", "bevel");
    }
    if (level === 0) {
      const lamp = map(rect(side * .314 - .013, -.446, side * .314 + .013, .446));
      slab(p, lamp, same(bottom + .021), same(bottom + .009), "socket", "lens", "emitter");
      for (const y of [-.456, .456]) {
        const clip = map(rect(side * .333 - .035, y - .036, side * .333 + .035, y + .036));
        plate(p, clip, same(bottom + .021), same(bottom + .005), .005, "copper", "cover");
      }
    }
  }
}

function deck(form: FormDef, level: number): Shape {
  const p = new Shape(), plan = planOf(form), foundation = form.root !== undefined;
  const top = -form.at[1], bottom = top - form.thick;
  if (level >= 3) {
    if (level === 3 && !foundation) casing(p, [[inset(plan, .06), same(bottom), "bevel"], [plan, same(bottom + .039), "socket"],
      [plan, same(top - .033), "titanium"], [inset(plan, .044), same(top), "alloy"]], "cover", "alloy");
    else slab(p, plan, same(top), same(bottom), "alloy", "cover");
    return p;
  }
  const map = deckMap(inset(plan, .105));
  if (level === 2) {
    casing(p, [[plan, same(bottom), "socket"], [plan, same(top - .033), "bevel"], [inset(plan, .065), same(top), "cover"]], "cover", "alloy");
    const stripe = map(chamfered(-.29, -.80, .29, .80, .10, .13));
    if (foundation) slab(p, stripe, same(top + .002), same(top - .003), "membrane", "socket");
    else slab(p, stripe, same(bottom + .003), same(bottom - .002), "socket", "socket", "membrane");
    return p;
  }
  const bands: Band[] = foundation
 ? [[inset(plan, .052), same(bottom), "bevel"], [plan, same(bottom + .030), "cover"], [plan, same(bottom + .082), "titanium"],
      [inset(plan, .090), same(bottom + .117), "gasket"], [inset(plan, .090), same(top - .105), "socket"],
      [plan, same(top - .068), "bevel"]]
    : [[inset(plan, .32), same(bottom + .093), "gasket"], [inset(plan, .20), same(bottom + .027), "bevel"],
      [inset(plan, .065), same(bottom), "titanium"], [plan, same(bottom + .034), "socket"], [plan, same(top - .064), "bevel"]];
  bands.push([plan, same(top - .032), "titanium"], [inset(plan, .044), same(top), "cover"],
    [inset(plan, .092), same(top), "bevel"], [inset(plan, .115), same(top - .067), "gasket"]);
  casing(p, bands, "cover", "gasket");
  if (foundation) {
    treadBanks(p, map, same(top), level === 0 ? 4 : 2, level === 0);
    powerKeel(p, map, same(top), level);
    if (level === 0) compressionFeet(p, plan, bottom, top);
  } else {
    for (const hand of [-1, 1]) {
      const bank = map([[hand * .059, -.868], [hand * .697, -.938], [hand * .967, -.77], [hand * .967, .750],
        [hand * .710, .94], [hand * .090, .810], [hand * .018, .58], [hand * .018, -.57]]);
      plate(p, bank, same(top - .069), same(top - .004), .032, "alloy", "bevel");
      if (level === 0) {
        const splice = map([[hand * .14, -.48], [hand * .82, -.39], [hand * .89, -.31], [hand * .21, -.396]]);
        plate(p, splice, same(top - .007), same(top + .001), .012, "cover", "titanium");
      }
    }
    soffit(p, plan, map, bottom, level);
  }
  return p;
}

function edgeInsert(p: Shape, plan: Flat[], k: number, profile: Flat[], back: number, front: number,
  lip: number, face: Finish, edge: Finish): void {
  const ring = (section: Flat[], depth: number): Vec[] => section.map(([u, z]) => vec(onSide(plan, k, [[u, depth]])[0]!, z));
  p.loft([ring(profile, back), ring(inset(profile, lip), front)], () => [edge, [0, 0]], i => [i ? face : "socket", [0, 0]]);
}

function pillar(name: string, form: FormDef, level: number): Shape {
  const p = new Shape(), plan = planOf(form), foot = -form.at[1], top = foot + form.thick;
  const half = (Math.max(...plan.map(q => q[0])) - Math.min(...plan.map(q => q[0]))) / 2;
  if (level === 4) {
    slab(p, plan, same(top), same(foot), "alloy", "cover");
    return p;
  }
  const ring = (f: number): Flat[] => cutCorners(inset(plan, half * (1 - f)), half * .37 * f);
  if (level === 3) {
    slab(p, ring(.98), same(top), same(foot), "alloy", "bevel");
    return p;
  }
  casing(p, [[ring(1), same(foot), "cover"], [ring(1), same(foot + .15), "titanium"], [ring(.66), same(foot + .32), "socket"],
    [ring(.66), same(top - .30), "titanium"], [ring(1), same(top - .14), "bevel"], [ring(1), same(top), "cover"]], "cover", "cover");
  if (level >= 2) return p;
  const faces = name === "thin_pillar" ? [0, 2] : name === "corner_pillar" ? [0, 1] : [0, 1, 2, 3];
  for (const k of faces) {
    const spine = (w: number, near: number): Flat[] => onSide(plan, k, [
      [-half * w, half * .47], [-half * w, near + .026], [-half * w + .028, near], [half * w - .028, near], [half * w, near + .026], [half * w, half * .47]]);
    casing(p, [[spine(.61, .018), same(foot + .17), "chamfer"], [spine(.81, .001), same(foot + .29), "cover"],
      [spine(.48, .035), same(foot + .55), "alloy"], [spine(.48, .035), same(top - .55), "cover"],
      [spine(.81, .001), same(top - .29), "chamfer"], [spine(.61, .018), same(top - .17), "cover"]], "socket", "socket");
    if (level === 0) {
      const seat = chamfered(-half * .335, foot + .61, half * .335, top - .61, half * .12, .15);
      edgeInsert(p, plan, k, seat, .045, .022, .004, "gasket", "bevel");
    }
    const cell = chamfered(-half * .198, foot + .69, half * .198, top - .69, half * .105, .10);
    edgeInsert(p, plan, k, cell, .025, .020, .002, "membrane", "lens");
    if (level !== 0) continue;
    for (const h of [foot + .56, top - .62]) {
      const clasp = chamfered(-half * .53, h, half * .53, h + .067, half * .11, .024);
      edgeInsert(p, plan, k, clasp, .055, .011, .004, "copper", "cover");
    }
    const status = chamfered(-half * .075, foot + .91, half * .075, foot + 1.14, half * .025, .035);
    edgeInsert(p, plan, k, status, .021, .016, .001, "emitter", "lens");
  }
  if (name === "corner_pillar") {
    const flange = cutCorners(onSide(plan, 2, rect(-half * .55, .025, half * .55, .15)), .025);
    plate(p, flange, same(foot + .19), same(top - .19), .012, "cover", "alloy");
  }
  return p;
}

const along = (q: Flat, axis: Flat): number => q[0] * axis[0] + q[1] * axis[1];

function strip(plan: readonly Flat[], axis: Flat, low: number, high: number): Flat[] {
  const cut = (poly: readonly Flat[], at: number, hand: number): Flat[] => {
    const a: Flat = [at * axis[0], at * axis[1]];
    return clip(poly, a, [a[0] + axis[1] * hand, a[1] - axis[0] * hand]);
  };
  return tidy(cut(cut(plan, low, 1), high, -1));
}

function roof(form: FormDef, level: number): Shape {
  const p = new Shape(), plan = planOf(form), tops = form.corner!.map(h => h - form.at[1]);
  const folded = plan.length === 4 ? tops.findIndex(h => tops.filter(value => value === h).length === 1) : -1;
  const fold = Math.max(0, folded), thick = form.thick;
  slabOn(p, plan, tops.map(z => z - (level < 2 ? .048 : 0)), tops.map(z => z - thick + (level < 2 ? .062 : 0)),
    part => [part === "top" ? level < 2 ? "gasket" : "alloy" : part === "under" ? "socket" : "cover", uv], fold);
  if (level >= 2) return p;
  const sides = folded < 0 ? [plan.map((_, k) => k)] : [[fold, (fold + 1) % 4, (fold + 2) % 4], [fold, (fold + 2) % 4, (fold + 3) % 4]];
  for (const indices of sides) {
    const facet = indices.map(k => plan[k]!);
    const [a, b, c] = facet, [za, zb, zc] = indices.map(k => tops[k]!);
    const dx = b![0] - a![0], dy = b![1] - a![1], ex = c![0] - a![0], ey = c![1] - a![1], det = dx * ey - dy * ex;
    const gx = ((zb! - za!) * ey - (zc! - za!) * dy) / det, gy = (dx * (zc! - za!) - ex * (zb! - za!)) / det;
    const surface: Height = q => za! + (q[0] - a![0]) * gx + (q[1] - a![1]) * gy;
    const pitch: Flat = [gx / Math.hypot(gx, gy), gy / Math.hypot(gx, gy)], cross: Flat = [-pitch[1], pitch[0]];
    const pan = inset(facet, .048), heights = pan.map(q => along(q, pitch));
    const low = Math.min(...heights), high = Math.max(...heights), count = level === 0 ? 3 : 2;
    const across = along(centre(facet), cross), mid = along(centre(facet), pitch);
    for (let k = 0; k < count; k++) {
      const lo = low + (high - low) * k / count, hi = low + (high - low) * (k + 1) / count;
      const section = strip(pan, pitch, lo - (k ? .016 : .001), hi + .001);
      const face: Height = q => surface(q) - .002 - .027 * (along(q, pitch) - lo) / (hi - lo);
      const profile = cutCorners(section, .035);
      plate(p, profile, raised(surface, -.050), face, .011, "alloy", "chamfer");
      if (level === 0 && k) {
        const returnLip = strip(pan, pitch, lo + .010, lo + .038);
        slab(p, returnLip, raised(face, .003), raised(face, -.005), "titanium", "bevel");
      }
    }
    const channel = strip(strip(pan, pitch, low + (high - low) * .28, low + (high - low) * .76), cross, across - .165, across + .165);
    const housing = cutCorners(channel, .057);
    plate(p, housing, raised(surface, -.038), raised(surface, .003), .015, "socket", "bevel");
    plate(p, cutCorners(inset(channel, .040), .040), raised(surface, .002), raised(surface, .006), .004, "membrane", "lens");
    if (level === 0) {
      const feed = strip(channel, pitch, mid - .023, mid + .023);
      plate(p, feed, raised(surface, .004), raised(surface, .012), .003, "copper", "titanium");
      const signal = strip(inset(channel, .033), cross, across + .089, across + .107);
      slab(p, signal, raised(surface, .008), raised(surface, .003), "emitter", "lens");
    }
    const spar = strip(inset(facet, .10), pitch, mid - .101, mid + .101);
    plate(p, spar, raised(surface, -thick + .064), raised(surface, -thick + .003), .030, "cover", "titanium");
    if (level === 0) for (let k = 0; k < facet.length; k++) {
      const a = facet[k]!, b = facet[(k + 1) % facet.length]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const lip = onSide(facet, k, [[-length * .40, .014], [length * .40, .014], [length * .33, .130], [-length * .33, .130]]);
      plate(p, lip, raised(surface, -thick + .063), raised(surface, -thick + .001), .012, "bevel", "cover");
    }
  }
  return p;
}

function flightStructure(p: Shape, x0: number, x1: number, back: number, front: number, base: number, rise: number, detail: boolean): void {
  const grade = (y: number): number => base + rise * (front - y) / (front - back);
  const prow = front - .23, heel = back + .015;
  const web: Flat[] = [[prow, base], [heel, grade(heel) - .138], [heel, base]];
  p.extrude(web, "x", x0 + .46, x1 - .46, coat("socket", "gasket"));
  for (const sign of [-1, 1]) {
    const x = sign === -1 ? x0 + .092 : x1 - .092;
    const flange: Flat[] = [[front - .045, base + .016], [heel, grade(heel) - .018], [heel, grade(heel) - .308], [front - .34, base + .011]];
    const foot: Flat[] = [[back + .025, base], [back + .25, base], [back + .25, grade(back + .25) - .12], [back + .025, grade(back + .025) - .10]];
    p.extrude(flange, "x", x - sign * .117, x + sign * .051, coat("cover", "titanium"));
    p.extrude(foot, "x", x - sign * .111, x + sign * .022, coat("bevel", "cover"));
    if (!detail) continue;
    const skin = (outline: Flat[], out: number, lip: number, mat: Finish): void => {
      const ring = (qs: Flat[], depth: number): Vec[] => qs.map(([y, z]) => [x + sign * depth, y, z]);
      p.loft([ring(outline, out - .012), ring(inset(outline, lip), out)], () => ["bevel", [0, 0]], i => [i ? mat : "socket", [0, 0]]);
    };
    const chase = (a: number, b: number, low: number, high: number): Flat[] => [
      [a, grade(a) - high - .027], [a + .037, grade(a + .037) - high], [b, grade(b) - high],
      [b, grade(b) - low + .032], [b - .046, grade(b - .046) - low], [a, grade(a) - low]];
    skin(chase(back + .28, front - .57, .074, .241), .069, .012, "gasket");
    skin(chase(back + .40, front - .72, .108, .205), .073, .006, "membrane");
    for (const y of [back + .54, front - .84]) {
      skin(chase(y, y + .105, .064, .253), .082, .007, "copper");
    }
    const brace: Flat[] = [[back + .25, base + .092], [back + .42, base + .066],
      [front - .789, grade(front - .789) - .188], [front - .923, grade(front - .923) - .202]];
    p.extrude(brace, "x", x - sign * .098, x + sign * .023, coat("cover", "alloy"));
    const shoe = chamfered(x - .087, back + .009, x + .087, back + .338, .035, .047);
    plate(p, shoe, same(base + .002), same(base + .11), .023, "bevel", "titanium");
  }
}

function ramp(form: FormDef, level: number): Shape {
  const p = new Shape(), plan = planOf(form), base = -form.at[1];
  const [u0, v0, u1, v1] = outlineBox(form), x0 = u0 - form.at[0], x1 = u1 - form.at[0], y0 = form.at[2] - v1, y1 = form.at[2] - v0;
  const surface: Height = q => base + (y1 - q[1]) * form.thick / (y1 - y0);
  if (level === 2) {
    slab(p, plan, surface, same(base), "alloy", "cover");
    return p;
  }
  flightStructure(p, x0, x1, y0, y1, base, form.thick, level === 0);
  slab(p, plan, q => Math.max(base, surface(q) - .045), q => Math.max(base, surface(q) - .147), "gasket", "bevel", "cover");
  const pan = deckMap(inset(plan, .035)), count = level === 0 ? 5 : 3;
  for (let i = 0; i < count; i++) {
    const low = -.974 + 1.948 * i / count, high = -.974 + 1.948 * (i + 1) / count;
    const tile = pan(chamfered(-.968, low, .676, high - .014, .075, .037));
    plate(p, tile, raised(surface, -.048), raised(surface, -.001), .020, "alloy", "bevel");
    if (level === 0) for (const lane of [-.765, .120]) {
      const tread = pan([[lane, low + .112], [lane + .040, low + .089], [lane + .341, low + .144], [lane + .301, low + .171]]);
      plate(p, tread, raised(surface, -.003), raised(surface, .006), .005, "socket", "titanium");
    }
  }
  const curb = pan(chamfered(.714, -.950, .964, .936, .047, .087));
  plate(p, curb, raised(surface, -.049), raised(surface, -.003), .022, "bevel", "titanium");
  for (let i = 0; i < 3; i++) {
    const low = -.875 + i * .585;
    const glass = pan(chamfered(.767, low, .904, low + .473, .023, .059));
    plate(p, glass, raised(surface, -.005), raised(surface, .003), .005, "membrane", "socket");
    if (level === 0) {
      const lamp = pan(rect(.913, low + .078, .928, low + .40));
      slab(p, lamp, raised(surface, .004), raised(surface, -.006), "emitter", "lens");
      const bus = pan(chamfered(.744, low + .493, .943, low + .548, .035, .014));
      plate(p, bus, raised(surface, -.006), raised(surface, .010), .004, "copper", "socket");
    }
  }
  return p;
}

function stairs(form: FormDef, level: number): Shape {
  const p = new Shape(), [u0, v0, u1, v1] = outlineBox(form);
  const x0 = u0 - form.at[0], x1 = u1 - form.at[0], y0 = form.at[2] - v1, y1 = form.at[2] - v0;
  const foot = -form.at[1], high = foot + form.thick, n = form.steps!, rise = form.thick / n, run = (y1 - y0) / n;
  if (level === 3) return p.extrude([[y1, foot], [y0, high], [y0, foot]], "x", x0, x1, coat("alloy", "cover"));
  if (level === 2) {
    const line: Flat[] = [[y0, foot], [y1, foot]];
    for (let k = 0; k < n; k++) {
      const y = y1 - k * run, z = foot + (k + 1) * rise;
      line.push([y, z], [y - run, z]);
    }
    return p.extrude(line, "x", x0, x1, coat("alloy", "cover"));
  }
  flightStructure(p, x0, x1, y0, y1, foot, form.thick, level === 0);
  for (let k = 0; k < n; k++) {
    const y = y1 - k * run, z = foot + (k + 1) * rise;
    const outline = chamfered(x0 + .004, y - run + .002, x1 - .004, y - .002, .073, .048);
    if (level === 1) {
      slab(p, outline, same(z), same(z - .105), "alloy", "bevel", "gasket");
      continue;
    }
    casing(p, [[inset(outline, .033), same(z - .112), "socket"], [outline, same(z - .079), "cover"],
      [outline, same(z - .022), "chamfer"], [inset(outline, .024), same(z), "alloy"]], "gasket", "alloy");
    const riser = rect(x0 + .33, y - run + .027, x1 - .33, y - .125);
    slab(p, riser, same(z - .106), same(z - rise + .006), "cover", "gasket");
    for (const hand of [-1, 1]) {
      const inboard = hand * .21, outboard = hand * 1.17;
      const tread: Flat[] = [[inboard, y - .069], [outboard, y - .069], [outboard, y - .100], [hand * .253, y - .124]];
      plate(p, tread, same(z - .003), same(z + .004), .006, "socket", "cover");
    }
    if (k % 3 === 0) {
      const optic = chamfered(x0 + .088, y - run + .046, x0 + .368, y - .133, .037, .022);
      plate(p, optic, same(z - .002), same(z + .002), .007, "membrane", "socket");
      slab(p, rect(x0 + .11, y - .164, x0 + .232, y - .149), same(z + .005), same(z + .001), "emitter", "lens");
    }
  }
  return p;
}

function hatchFrame(form: FormDef, level: number): Shape {
  const p = new Shape(), plan = planOf(form), o = form.openings![0]!;
  const top = -form.at[1], bottom = top - form.thick;
  const hole = rect(o.x0 - form.at[0], form.at[2] - o.y1, o.x1 - form.at[0], form.at[2] - o.y0);
  if (level === 4) {
    // Six double-sided triangles keep the sky visible through the hatch at the last distance.
    const face = (corners: Flat[]): void => {
      const points = corners.map(q => vec(q, top));
      for (const winding of [points, [...points].reverse()]) p.faces.push({ points: winding, uvs: winding.map(uv), mat: "alloy" });
    };
    for (let k = 0; k < 4; k++) {
      const j = (k + 1) % 4;
      if (k % 2 === 0) {
        face([plan[k]!, plan[j]!, hole[j]!]);
        face([plan[k]!, hole[j]!, hole[k]!]);
      } else face([plan[k]!, plan[j]!, centre([hole[k]!, hole[j]!])]);
    }
    return p;
  }
  if (level >= 2) return p.extrude(plan, "z", bottom, top, coat("cover", "bevel"), [hole]);
  p.extrude(plan, "z", bottom + .063, top - .052, coat("socket", "bevel"), [hole]);
  for (let k = 0; k < 4; k++) {
    const j = (k + 1) % 4, strip = [plan[k]!, plan[j]!, hole[j]!, hole[k]!];
    const fascia = cutCorners(inset(strip, .034), .085);
    plate(p, fascia, same(top - .053), same(top - .004), .021, "alloy", "chamfer");
    if (level === 0) {
      const footing = onSide(hole, k, [[-.70, -.276], [.70, -.276], [.66, -.087], [.56, -.014], [-.56, -.014], [-.66, -.087]]);
      plate(p, footing, same(bottom + .065), same(bottom + .002), .022, "cover", "titanium");
      const bolt = onSide(hole, k, chamfered(-.51, -.183, .51, -.065, .065, .032));
      plate(p, bolt, same(bottom + .006), same(bottom - .004), .012, "socket", "bevel");
    }
    if (k % 2 === 0) {
      const seat = onSide(hole, k, chamfered(-.586, -.34, .586, -.083, .133, .074));
      plate(p, seat, same(top - .006), same(top + .001), .011, "gasket", "bevel");
      const slot = onSide(hole, k, chamfered(-.496, -.275, .496, -.147, .085, .041));
      plate(p, slot, same(top), same(top + .005), .006, "membrane", "lens");
      if (level === 0) {
        const lamp = onSide(hole, k, rect(-.269, -.124, .269, -.109));
        slab(p, lamp, same(top + .004), same(top - .003), "emitter", "lens");
        for (const x of [-.42, .42]) {
          const contact = onSide(hole, k, rect(x - .033, -.291, x + .033, -.135));
          plate(p, contact, same(top + .003), same(top + .011), .006, "copper", "cover");
        }
      }
    } else if (level === 0) {
      for (const u of [-.36, .36]) {
        const jaw = onSide(hole, k, [[u - .173, -.368], [u + .123, -.368], [u + .202, -.282], [u + .102, -.056], [u - .119, -.056], [u - .183, -.186]]);
        plate(p, jaw, same(top - .009), same(top + .005), .024, "cover", "chamfer");
      }
    }
  }
  return p;
}

function hatch(form: FormDef, level: number): Shape {
  const p = new Shape(), [u0, v0, u1, v1] = outlineBox(form);
  const open = v1 - v0 < form.thick, thick = open ? v1 - v0 : form.thick, far = open ? v0 + form.thick : v1;
  const x0 = u0 - form.at[0] + .004, x1 = u1 - form.at[0] - .004, y0 = form.at[2] - far + .004, y1 = form.at[2] - v0 - .004;
  const top = thick / 2, bottom = -top, plan = rect(x0, y0, x1, y1);
  if (level === 2) slab(p, plan, same(top - .003), same(bottom + .004), "alloy", "bevel");
  else {
    casing(p, [[inset(plan, .013), same(bottom + .013), "bevel"], [plan, same(bottom + .021), "socket"],
      [plan, same(top - .021), "bevel"], [inset(plan, .018), same(top - .013), "socket"]], "gasket", "gasket");
    const armor = chamfered(x0 + .026, y0 + .037, x0 + .752, y1 - .036, .11, .16);
    plate(p, armor, same(top - .014), same(top - .001), .026, "alloy", "chamfer");
    const seat = chamfered(x0 + .766, y0 + .060, x1 - .042, y1 - .076, .15, .19);
    plate(p, seat, same(top - .014), same(top - .002), .021, "cover", "chamfer");
    const port = chamfered(x0 + .853, y0 + .171, x1 - .139, y1 - .215, .094, .14);
    plate(p, port, same(top - .0025), same(top + .001), .012, "membrane", "lens");
    const underside = chamfered(x0 + .115, y0 + .114, x1 - .12, y1 - .123, .168, .168);
    plate(p, underside, same(bottom + .015), same(bottom + .008), .023, "alloy", "cover");
    for (const x of [x0 + .306, x1 - .300]) {
      const hinge = chamfered(x - .14, y1 - .25, x + .14, y1 - .009, .040, .045);
      plate(p, hinge, same(top - .014), same(top + .004), .016, "cover", "chamfer");
      if (level === 0) {
        const pin = chamfered(x - .181, y1 - .132, x + .180, y1 - .071, .027, .015);
        plate(p, pin, same(top + .002), same(top + .010), .008, "copper", "socket");
      }
    }
    if (level === 0) {
      const insetPort = chamfered(x0 + .868, y0 + .21, x1 - .176, y1 - .24, .074, .117);
      plate(p, insetPort, same(bottom + .009), same(bottom + .004), .008, "membrane", "socket");
      const handle = chamfered(x0 + .129, y0 + .22, x0 + .664, y0 + .431, .046, .065);
      plate(p, handle, same(top - .002), same(top + .001), .014, "gasket", "socket");
      for (const x of [x0 + .216, x0 + .585]) {
        const lug = chamfered(x - .053, y0 + .236, x + .053, y0 + .400, .018, .024);
        plate(p, lug, same(top), same(top + .013), .010, "titanium", "bevel");
      }
      const grip = rect(x0 + .206, y0 + .292, x0 + .602, y0 + .356);
      plate(p, grip, same(top + .007), same(top + .014), .006, "copper", "socket");
      slab(p, rect(x1 - .122, y0 + .435, x1 - .106, y1 - .406), same(top + .003), same(top - .006), "emitter", "lens");
      for (const y of [y0 + .29, y1 - .29]) {
        const bar = chamfered(x0 + .091, y - .054, x0 + .79, y + .054, .059, .034);
        plate(p, bar, same(bottom + .009), same(bottom - .002), .016, "cover", "chamfer");
      }
    }
  }
  const hinge = form.at[2] - v0 - thick / 2;
  return open ? p.move(([x, y, z]) => [x, hinge - z, y - hinge]) : p;
}

export function tekDeck(name: string, form: FormDef, level: number): Shape | null {
  if (form.plane !== "flat" || level > 4) return null;
  if (form.layer === "fill") {
    if (form.steps) return level <= 3 ? stairs(form, level) : null;
    return level <= 2 ? ramp(form, level) : null;
  }
  if (form.layer === "post") return pillar(name, form, level);
  if (form.layer === "leaf") return level > 2 ? null : hatch(form, level);
  if (form.takes === "hatch") return hatchFrame(form, level);
  if (form.corner) return level <= 3 ? roof(form, level) : null;
  if (form.layer === "slab") return form.root && level === 4 ? null : deck(form, level);
  return null;
}
