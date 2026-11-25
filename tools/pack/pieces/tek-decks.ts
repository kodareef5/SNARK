import { clip } from "../../../content/breaks/geometry.ts";
import { outlineBox, type FormDef } from "../../../shared/world/lattice/forms.ts";
import { Shape, inset, slabOn, type FaceMap, type Flat, type Vec } from "./kit.ts";
import { planOf } from "./lod.ts";

type Height = (q: Flat) => number;
type Finish = "alloy" | "titanium" | "chamfer" | "gasket" | "socket" | "cover" | "bevel" | "copper" | "emitter";
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
  casing(p, [[plan, base, bevel], [inset(plan, lip), face, top]], top, top);
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

function ribs(p: Shape, plan: readonly Flat[], low: number, high: number, lamps: boolean): void {
  const c = centre(plan);
  for (const q of inset(plan, .16)) {
    const dx = q[0] - c[0], dy = q[1] - c[1], len = Math.hypot(dx, dy);
    const rib = (a: number, b: number): Flat => [c[0] + (dx * a - dy * b) / len, c[1] + (dy * a + dx * b) / len];
    const arm = [rib(.15, -.045), rib(len * .69, -.090), rib(len, -.045), rib(len, .045), rib(len * .69, .090), rib(.15, .045)];
    plate(p, arm, same(high), same(low + .004), .018, "bevel", "titanium");
  }
  const cap = cutCorners(plan.map(([x, y]): Flat => [c[0] + (x - c[0]) * .18, c[1] + (y - c[1]) * .18]), .062);
  plate(p, cap, same(high), same(low), .035, "socket", "chamfer");
  if (lamps) {
    const glass = cutCorners(rect(c[0] - .087, c[1] - .023, c[0] + .087, c[1] + .023), .014);
    slab(p, glass, same(low + .003), same(low - .002), "emitter", "socket");
  }
}

function deck(form: FormDef, level: number): Shape {
  const p = new Shape(), plan = planOf(form), foundation = form.root !== undefined;
  const top = -form.at[1], bottom = top - form.thick;
  if (level >= 3) {
    if (level === 3 && !foundation) casing(p, [[inset(plan, .04), same(bottom), "bevel"], [plan, same(bottom + .035), "cover"],
      [plan, same(top - .026), "chamfer"], [inset(plan, .025), same(top), "alloy"]], "cover", "alloy");
    else slab(p, plan, same(top), same(bottom), "alloy", "cover");
    return p;
  }
  if (level === 2) {
    casing(p, [[plan, same(bottom), "cover"], [plan, same(top - .026), "chamfer"], [inset(plan, .13), same(top), "alloy"]], "cover", "alloy");
    return p;
  }
  const coffer = foundation ? .054 : .075;
  const bands: Band[] = [[inset(plan, .28), same(bottom + coffer), "bevel"], [inset(plan, .17), same(bottom + .009), "titanium"],
    [inset(plan, .024), same(bottom), "chamfer"], [plan, same(bottom + .030), "cover"]];
  if (foundation) bands.push([plan, same(bottom + .078), "bevel"], [inset(plan, .043), same(bottom + .112), "socket"],
    [inset(plan, .043), same(top - .087), "bevel"]);
  bands.push([plan, same(top - .067), "cover"], [plan, same(top - .030), "chamfer"], [inset(plan, .035), same(top), "titanium"],
    [inset(plan, .118), same(top), "bevel"], [inset(plan, .158), same(top - .018), "socket"]);
  casing(p, bands, "alloy", "socket");
  const lid = cutCorners(inset(plan, .166), .20);
  if (level === 0) {
    const [cx, cy] = centre(lid);
    const left: Flat = [cx - 2, cy - .54], right: Flat = [cx + 2, cy + .54];
    for (const [a, b] of [[left, right], [right, left]] as const) {
      const half = inset(clip(lid, a, b), .010);
      plate(p, half, same(top - .017), same(top - .002), .023, "alloy");
    }
  } else plate(p, lid, same(top - .017), same(top - .002), .025, "alloy");
  if (level === 0) {
    ribs(p, plan, bottom + .003, bottom + coffer + .001, !foundation);
    const width = form.size === 1 ? .24 : .42;
    for (let k = 0; k < plan.length; k++) {
      const shoe = onSide(plan, k, [[-width, .044], [width, .044], [width - .058, .126], [.15, .179], [-.15, .179], [-width + .058, .126]]);
      plate(p, shoe, same(top - .006), same(top + .002), .009, "cover");
      const lens = onSide(plan, k, rect(-.067, .139, .067, .154));
      slab(p, lens, same(top + .003), same(top - .004), "emitter", "socket");
      if (foundation) {
        const foot = onSide(plan, k, [[-.34, .009], [.34, .009], [.25, .075], [-.25, .075]]);
        plate(p, foot, same(bottom + .079), same(top - .076), .011, "bevel", "titanium");
      }
    }
  }
  return p;
}

function pillar(form: FormDef, level: number): Shape {
  const p = new Shape(), plan = planOf(form), foot = -form.at[1], top = foot + form.thick;
  const half = (Math.max(...plan.map(q => q[0])) - Math.min(...plan.map(q => q[0]))) / 2;
  if (level === 4) { slab(p, plan, same(top), same(foot), "alloy", "cover"); return p; }
  const ring = (f: number): Flat[] => cutCorners(inset(plan, half * (1 - f)), half * .29 * f);
  if (level === 3) { slab(p, ring(.98), same(top), same(foot), "alloy", "cover"); return p; }
  const bands: Band[] = [[ring(1), same(foot), "cover"], [ring(1), same(foot + .15), "chamfer"], [ring(.73), same(foot + .27), "alloy"],
    [ring(.73), same(top - .27), "chamfer"], [ring(1), same(top - .15), "cover"], [ring(1), same(top), "titanium"]];
  casing(p, bands, "titanium", "titanium");
  if (level < 2) for (let k = 0; k < 4; k++) {
    const spine = onSide(plan, k, rect(-half*.25, half*.12, half*.25, half*.36));
    casing(p, [[inset(spine, .008), same(foot + .20), "chamfer"], [spine, same(foot + .39), "titanium"],
      [spine, same(top - .39), "chamfer"], [inset(spine, .008), same(top - .20), "cover"]], "cover", "cover");
    if (level === 0) for (const h of [foot + .53, top - .69]) {
      const port = onSide(plan, k, rect(-half*.10, half*.10, half*.10, half*.14));
      slab(p, port, same(h + .16), same(h), "socket", "emitter");
    }
  }
  return p;
}

function roof(form: FormDef, level: number): Shape {
  const p = new Shape(), plan = planOf(form), tops = form.corner!.map(h => h - form.at[1]);
  const folded = plan.length === 4 ? tops.findIndex(h => tops.filter(value => value === h).length === 1) : -1;
  const fold = Math.max(0, folded), thickness = form.thick;
  slabOn(p, plan, tops.map(z => z - (level < 2 ? .025 : 0)), tops.map(z => z - thickness),
    part => [part === "top" ? "alloy" : part === "under" ? "cover" : "bevel", uv], fold);
  if (level >= 2) return p;
  const sides = folded < 0 ? [plan.map((_, k) => k)] : [[fold, (fold + 1) % 4, (fold + 2) % 4], [fold, (fold + 2) % 4, (fold + 3) % 4]];
  for (const indices of sides) {
    const facet = indices.map(k => plan[k]!);
    const [a, b, c] = facet, [za, zb, zc] = indices.map(k => tops[k]!);
    const dx = b![0] - a![0], dy = b![1] - a![1], ex = c![0] - a![0], ey = c![1] - a![1], det = dx * ey - dy * ex;
    const gx = ((zb! - za!) * ey - (zc! - za!) * dy) / det, gy = (dx * (zc! - za!) - ex * (zb! - za!)) / det;
    const surface: Height = q => za! + (q[0] - a![0]) * gx + (q[1] - a![1]) * gy;
    const pan = cutCorners(inset(facet, .084), .13);
    plate(p, pan, raised(surface, -.026), surface, .034, "alloy", "chamfer");
    if (level === 0) for (let k = 0; k < facet.length; k++) {
      const width = Math.hypot(facet[k]![0] - facet[(k + 1) % facet.length]![0], facet[k]![1] - facet[(k + 1) % facet.length]![1]);
      const shoe = onSide(facet, k, [[-.32*width, .016], [.32*width, .016], [.29*width, .060], [.07, .096], [-.20, .096], [-.29*width, .064]]);
      plate(p, shoe, raised(surface, -.026), raised(surface, -.003), .010, "titanium");
      const under = onSide(facet, k, rect(-width*.16, .18, width*.16, .235));
      plate(p, under, raised(surface, -thickness + .001), raised(surface, -thickness - .011), .009, "bevel");
      const lamp = onSide(facet, k, rect(-.086, .197, .086, .215));
      slab(p, lamp, raised(surface, -thickness - .009), raised(surface, -thickness - .013), "emitter", "socket");
    }
  }
  return p;
}

function stringer(p: Shape, x: number, sign: number, back: number, front: number, foot: number, rise: number): void {
  const top = (y: number): number => foot + rise * (front - y) / (front - back);
  const side: Flat[] = [[back + .105, foot + .14], [front - .36, foot + .14], [front - .47, top(front - .47) - .13],
    [back + .37, top(back + .37) - .13], [back + .105, top(back + .105) - .32]];
  const band = (outline: readonly Flat[], out: number): Vec[] => outline.map(([y, z]) => [x + sign * out, y, z]);
  p.loft([band(side, -.002), band(inset(side, .042), .009)], () => ["chamfer", [0, 0]], () => ["alloy", [0, 0]]);
  const clip: Flat[] = [[back + .17, foot + .17], [back + .53, foot + .17], [back + .47, foot + .23], [back + .21, foot + .26]];
  p.extrude(clip, "x", x + sign * .006, x + sign * .013, coat("copper", "copper"));
}

function ramp(form: FormDef, level: number): Shape {
  const p = new Shape(), plan = planOf(form), base = -form.at[1];
  const [u0, v0, u1, v1] = outlineBox(form), x0 = u0 - form.at[0], x1 = u1 - form.at[0], y0 = form.at[2] - v1, y1 = form.at[2] - v0;
  const surface: Height = q => base + (y1 - q[1]) * form.thick / (y1 - y0);
  slab(p, plan, surface, same(base), "alloy", "cover", "gasket");
  if (level >= 2) return p;
  for (const x of [x0 + .12, x1 - .12]) {
    const sill = cutCorners(rect(x - .064, y0 + .05, x + .064, y1 - .12), .055);
    plate(p, sill, raised(surface, -.001), raised(surface, .014), .013, "titanium");
  }
  if (level === 0) {
    stringer(p, x0, -1, y0, y1, base, form.thick);
    stringer(p, x1, 1, y0, y1, base, form.thick);
  }
  const count = level === 0 ? 9 : 4;
  for (let k = 1; k <= count; k++) {
    const y = y0 + k * (y1 - y0)/(count + 1);
    const cleat = cutCorners(rect(x0 + .258, y - .040, x1 - .258, y + .04), .032);
    plate(p, cleat, raised(surface, -.001), raised(surface, .009), .009, "bevel");
    if (level === 0 && k % 3 === 1) {
      const port = rect(x1 - .51, y - .010, x1 - .31, y + .010);
      slab(p, port, raised(surface, .011), raised(surface, .007), "emitter", "socket");
    }
  }
  return p;
}

function stairs(form: FormDef, level: number): Shape {
  const p = new Shape(), [u0, v0, u1, v1] = outlineBox(form);
  const x0 = u0 - form.at[0], x1 = u1 - form.at[0], y0 = form.at[2] - v1, y1 = form.at[2] - v0;
  const foot = -form.at[1], high = foot + form.thick, n = form.steps!;
  const rise = form.thick / n, run = (y1 - y0) / n;
  if (level >= 3) return p.extrude([[y1, foot], [y0, high], [y0, foot]], "x", x0, x1, coat("alloy", "cover"));
  const line: Flat[] = [[y0, foot], [y1, foot]];
  for (let k = 0; k < n; k++) {
    const y = y1 - k * run, z = foot + (k + 1) * rise;
    line.push([y, z], [y - run, z]);
  }
  p.extrude(line, "x", x0, x1, coat("alloy", "cover"));
  if (level === 2) return p;
  if (level === 0) {
    stringer(p, x0, -1, y0, y1, foot, form.thick);
    stringer(p, x1, 1, y0, y1, foot, form.thick);
  }
  for (let k = 0; k < n; k++) {
    const y = y1 - k * run, z = foot + (k + 1)*rise;
    const nose = cutCorners(rect(x0 + .075, y - .109, x1 - .075, y - .012), .038);
    plate(p, nose, same(z - .002), same(z + .006), .013, "titanium");
    if (level === 0) {
      const tread = cutCorners(rect(x0 + .126, y - run + .025, x1 - .126, y - .117), .056);
      plate(p, tread, same(z - .001), same(z + .004), .014, "alloy", "bevel");
      const lens = rect(x0 + .22, y - .073, x0 + .43, y - .052);
      slab(p, lens, same(z + .008), same(z + .004), "emitter", "socket");
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
  p.extrude(plan, "z", bottom, top - (level < 2 ? .018 : 0), coat("cover", "bevel"), [hole]);
  if (level >= 2) return p;
  for (let k = 0; k < plan.length; k++) {
    const j = (k + 1) % plan.length, strip = [plan[k]!, plan[j]!, hole[j]!, hole[k]!];
    const panel = cutCorners(inset(strip, .065), .085);
    plate(p, panel, same(top - .019), same(top), .026, "alloy");
    if (level === 0) {
      const sill = onSide(hole, k, rect(-.43, -.056, .43, -.009));
      plate(p, sill, same(top - .019), same(top - .002), .010, "titanium");
      const lamp = onSide(hole, k, rect(-.086, -.041, .086, -.023));
      slab(p, lamp, same(top), same(top - .004), "emitter", "socket");
    }
  }
  return p;
}

function hatch(form: FormDef, level: number): Shape {
  const p = new Shape(), [u0, v0, u1, v1] = outlineBox(form);
  const open = v1 - v0 < form.thick, thick = open ? v1 - v0 : form.thick;
  const far = open ? v0 + form.thick : v1;
  const x0 = u0 - form.at[0] + .004, x1 = u1 - form.at[0] - .004, y0 = form.at[2] - far + .004, y1 = form.at[2] - v0 - .004;
  const top = thick / 2, bottom = -top, plan = rect(x0, y0, x1, y1);
  slab(p, plan, same(top - (level < 2 ? .027 : .003)), same(bottom + .004), "alloy", "bevel");
  if (level < 2) {
    plate(p, cutCorners(inset(plan, .05), .16), same(top - .028), same(top - .012), .024, "alloy");
    for (const x of [x0 + .26, x1 - .26]) {
      const hinge = cutCorners(rect(x - .075, y1 - .30, x + .075, y1 - .009), .052);
      plate(p, hinge, same(top - .014), same(top - .002), .012, "cover");
    }
    if (level === 0) {
      const latch = cutCorners(rect(-.23, y0 + .040, .23, y0 + .196), .065);
      plate(p, latch, same(top - .014), same(top - .002), .019, "bevel");
      slab(p, rect(-.073, y0 + .110, .073, y0 + .135), same(top), same(top - .005), "emitter", "socket");
    }
  }
  const hinge = form.at[2] - v0 - thick / 2;
  return open ? p.move(([x, y, z]) => [x, hinge - z, y - hinge]) : p;
}

export function tekDeck(_name: string, form: FormDef, level: number): Shape | null {
  if (form.plane !== "flat" || level > 4) return null;
  if (form.layer === "fill") {
    if (form.steps) return level <= 3 ? stairs(form, level) : null;
    return level <= 2 ? ramp(form, level) : null;
  }
  if (form.layer === "post") return pillar(form, level);
  if (form.layer === "leaf") return level > 2 ? null : hatch(form, level);
  if (form.takes === "hatch") return hatchFrame(form, level);
  if (form.corner) return level <= 3 ? roof(form, level) : null;
  if (form.layer === "slab") return form.root && level === 4 ? null : deck(form, level);
  return null;
}
