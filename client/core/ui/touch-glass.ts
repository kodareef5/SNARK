// The touch rims' glass, painted as the interface study drew it: steel edges, lens bands and the lit cell under a thumb.
// A painter fills a picture's `paint`; the page calls it when the picture's version changes (nodes.ts UiImage.paint).
// Every length is in CSS pixels, drawn at GLASS_RATIO device pixels to one.

import type { Ink, Pen, UiImage } from "./nodes.ts";

export const GLASS_RATIO = 2;
const TAU = Math.PI * 2;
type Stops = readonly (readonly [number, string])[];
type Point = (radius: number, angle: number) => [number, number];

export const clamp = (v: number, low: number, high: number): number => Math.max(low, Math.min(high, v));
export const wrap = (i: number, n: number): number => ((i % n) + n) % n;
/** The shortest way round a ring of `n` from `from` to `to`. */
export const turn = (from: number, to: number, n: number): number => wrap(to - from + n / 2, n) - n / 2;

function linear(c: Pen, x0: number, y0: number, x1: number, y1: number, stops: Stops): Ink {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  return g;
}
function line(c: Pen, x0: number, y0: number, x1: number, y1: number, ink: Ink, width = 1): void {
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.strokeStyle = ink; c.lineWidth = width; c.stroke();
}
function annulus(c: Pen, inner: number, outer: number, a: number, b: number, ink: Ink): void {
  c.beginPath(); c.arc(0, 0, outer, a, b); c.arc(0, 0, inner, b, a, true); c.closePath(); c.fillStyle = ink; c.fill();
}
function ring(c: Pen, r: number, a: number, b: number, ink: Ink, width = 1): void {
  c.beginPath(); c.arc(0, 0, r, a, b); c.strokeStyle = ink; c.lineWidth = width; c.stroke();
}
const polar = (r: number, a: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];

function gem(c: Pen, x: number, y: number, size: number, stops: Stops, slim: number): void {
  c.beginPath(); c.moveTo(x, y - size); c.lineTo(x + size * slim, y); c.lineTo(x, y + size); c.lineTo(x - size * slim, y); c.closePath();
  c.fillStyle = linear(c, x - size, y - size, x + size, y + size, stops); c.fill();
  line(c, x, y - size, x - size * .19, y, "rgba(240,255,255,.75)", .72);
}
const WHEEL_GEM: Stops = [[0, "#fff"], [.17, "#d3fdff"], [.35, "#39c8f3"], [.62, "#39c8f3"], [.75, "#123147"], [1, "#b6e9ff"]];
const FAN_GEM: Stops = [[0, "#f4ffff"], [.33, "#acfbff"], [.36, "#42c5ed"], [.64, "#3778b3"], [.71, "#143c62"], [1, "#89d8ff"]];
const WHEEL_STEEL: Stops = [[0, "#193848"], [.13, "#a6bbc5"], [.21, "#f8ffff"], [.28, "#48677d"], [.42, "#132a3a"], [.5, "#8caebd"], [.57, "#c6dae2"], [.69, "#42627c"], [.83, "#1c3448"], [.95, "#b4c9d6"], [1, "#436475"]];
const FAN_STEEL: Stops = [[0, "#253d52"], [.12, "#92afc0"], [.22, "#f4fdff"], [.32, "#7495aa"], [.40, "#2c4964"], [.50, "#b9d0df"], [.57, "#e7f7fc"], [.68, "#517184"], [.77, "#1f354c"], [.90, "#c7e3ed"], [1, "#668797"]];

/** A picture a painter draws, kept from frame to frame: `stamp` says what was last painted. */
export interface Glass { image: UiImage; stamp: string }
export const glass = (): Glass => ({ image: { width: 1, height: 1, data: new Uint8ClampedArray(0), version: 0, smooth: true }, stamp: "" });

/** Sizes `g` for `w` by `h` CSS pixels and has `draw` paint it, where `stamp` differs from what it shows. */
export function repaint(g: Glass, w: number, h: number, stamp: string, draw: (c: Pen) => void): void {
  if (stamp === g.stamp) return;
  g.stamp = stamp;
  g.image.width = Math.max(1, Math.ceil(w * GLASS_RATIO));
  g.image.height = Math.max(1, Math.ceil(h * GLASS_RATIO));
  g.image.version++;
  g.image.paint = (c) => { c.scale(GLASS_RATIO, GLASS_RATIO); draw(c); };
}

/** The menu wheel, `r` to its rim: `count` cells turned to `phase`, the cell at three o'clock lit, shown by `reveal`. */
export function paintWheel(c: Pen, r: number, count: number, phase: number, reveal: number): void {
  const openness = clamp(reveal, 0, 1), step = TAU / count;
  c.translate(r, r);
  c.globalAlpha = .36 + .64 * openness;
  const steel = linear(c, -r, -r, r, r, WHEEL_STEEL);
  const outer = r - 3, inner = r * .57, hub = r * .224;
  annulus(c, inner - 1, outer, 0, TAU, "rgba(3,15,31,.21)");
  annulus(c, outer - 2.4, outer, 0, TAU, steel);
  annulus(c, outer - 6.1, outer - 3.2, 0, TAU, "rgba(2,19,34,.62)");
  ring(c, outer - 6.6, 0, TAU, "rgba(153,215,237,.58)", .75);
  ring(c, inner - 1, 0, TAU, steel, 1.2);
  const lens = linear(c, -r, -r * .7, r, r * .8, [[0, "rgba(165,227,253,.19)"], [.22, "rgba(76,153,218,.20)"], [.49, "rgba(25,83,144,.27)"], [.72, "rgba(6,37,73,.5)"], [1, "rgba(40,106,159,.31)"]]);
  annulus(c, inner, outer - 7, 0, TAU, lens);
  const selected = wrap(Math.round(phase), count);
  for (let i = 0; i < count; i++) {
    const bearing = (i - phase) * step, low = bearing - step * .5 + .012, high = bearing + step * .5 - .012;
    const lit = i === selected;
    const face = lit ? linear(c, -r, -r, r, r, [[0, "rgba(188,239,255,.63)"], [.4, "rgba(65,150,208,.58)"], [.7, "rgba(14,78,141,.82)"], [1, "rgba(108,200,229,.61)"]]) : lens;
    annulus(c, inner + 1, outer - 8.5, low, high, face);
    ring(c, inner + 1.6, low, high, lit ? "rgba(188,249,255,.93)" : "rgba(106,185,225,.33)", lit ? 1.6 : .7);
    ring(c, outer - 9, low, high, lit ? "#c3f2ff" : "rgba(134,192,222,.3)", lit ? 1.6 : .8);
    line(c, ...polar(inner + 2, low), ...polar(outer - 9, low), lit ? "rgba(221,251,255,.77)" : "rgba(153,209,232,.62)", .8);
    line(c, ...polar(inner + 4, high), ...polar(outer - 9, high), "rgba(6,22,39,.84)", 1.25);
  }
  // Each cell's fine ticks turn with it.
  for (let i = 0; i < count * 5; i++) {
    const a = (i / 5 - phase) * step, long = i % 5 === 0 ? 4.6 : i % 5 === 2 ? 2.7 : 1.6;
    line(c, ...polar(outer - 1 - long, a), ...polar(outer - 2, a), "rgba(177,219,238,.78)", .7);
  }
  const well = c.createRadialGradient(-r * .14, -r * .15, r * .05, 0, 0, inner);
  well.addColorStop(0, "rgba(49,106,155,.16)"); well.addColorStop(.82, "rgba(7,39,69,.15)"); well.addColorStop(1, "rgba(4,27,51,.36)");
  annulus(c, hub + 1, inner - 2, 0, TAU, well);
  annulus(c, 0, hub, 0, TAU, linear(c, -hub, -hub, hub, hub, [[0, "rgba(116,186,227,.8)"], [.4, "rgba(21,57,91,.88)"], [.63, "rgba(4,20,40,.91)"], [1, "rgba(48,102,145,.85)"]]));
  ring(c, hub, 0, TAU, steel, 1.65);
  ring(c, hub - 3, -2.68, -.32, "rgba(218,247,255,.53)", .75);
  for (const a of [Math.PI * .39, Math.PI * .95, Math.PI * 1.54]) {
    ring(c, hub + 4, a - .12, a + .13, steel, 1.55);
    ring(c, inner - 5.6, a - .23, a + .22, "rgba(156,210,233,.45)", .8);
  }
  c.globalAlpha = .67 + .33 * openness;
  c.save(); c.translate(outer - 3.8, 0); c.rotate(Math.PI * .5);
  gem(c, 0, 0, 5.4, WHEEL_GEM, .62);
  c.restore();
  c.globalAlpha = 1;
}

/** What the action fan shows: sizes in CSS pixels, phases in cells, and how far it is open and nested (0 to 1 each). */
export interface FanView {
  width: number; height: number;
  /** The family ring's radius, shut. */
  rootR: number;
  openness: number; level: number;
  families: number; rootPhase: number;
  leaves: number; leafPhase: number;
  /** -1 shut, 0 the families, 1 a family's leaves. */
  depth: number;
  /** The family whose leaves are out. */
  group: number;
}

/** The fan's own measures, which its painter and its layout share. */
export function fanShape(v: FanView) {
  const ease = clamp(v.openness, 0, 1), level = clamp(v.level, 0, 1);
  const root = v.rootR * (1 - .31 * level), outer = v.rootR * 1.45;
  const half = clamp(v.rootR * .26, 23, 31), childHalf = clamp(v.rootR * .245, 22, 30);
  const cx = v.width + v.rootR * .80 * (1 - ease) - 26 * ease, cy = v.height * .51;
  return { ease, level, root, outer, half, childHalf, cx, cy, rootWidth: half * (1 - .18 * level), leafRadius: outer - (1 - level) * v.rootR * .34 };
}
/** The angle between neighbours on a fan's track. */
export const FAN_SPREAD = .86;

function band(c: Pen, at: Point, inner: number, outer: number, a: number, b: number, ink: Ink): void {
  const n = Math.ceil(Math.abs(b - a) * 24);
  c.beginPath();
  for (let i = 0; i <= n; i++) { const [x, y] = at(outer, a + (b - a) * i / n); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
  for (let i = n; i >= 0; i--) { const [x, y] = at(inner, a + (b - a) * i / n); c.lineTo(x, y); }
  c.closePath(); c.fillStyle = ink; c.fill();
}
function curve(c: Pen, at: Point, r: number, a: number, b: number, ink: Ink, width = 1): void {
  const n = Math.ceil(Math.abs(b - a) * 34);
  c.beginPath();
  for (let i = 0; i <= n; i++) { const [x, y] = at(r, a + (b - a) * i / n); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
  c.strokeStyle = ink; c.lineWidth = width; c.stroke();
}
function disk(c: Pen, x: number, y: number, r: number, steel: Ink): void {
  c.beginPath(); c.arc(x, y, r, 0, TAU);
  c.fillStyle = linear(c, x - r, y - r, x + r, y + r, [[0, "#749bb8c9"], [.38, "#123958bf"], [.68, "#09253fba"], [1, "#527c99ac"]]); c.fill();
  c.strokeStyle = steel; c.lineWidth = 1.5; c.stroke();
  c.beginPath(); c.arc(x, y, r - 2.8, -2.51, -.77); c.strokeStyle = "#ddfaff95"; c.lineWidth = .83; c.stroke();
  c.beginPath(); c.arc(x, y, r - 2.8, .15, 2.08); c.strokeStyle = "#76dcffb0"; c.stroke();
}

/** The action fan: the families' crescent about a hub at the edge, and a family's leaves on a wider one. */
export function paintFan(c: Pen, v: FanView): void {
  const s = fanShape(v), { ease, level, root, outer, half, childHalf, cx, cy } = s;
  const steel = linear(c, 0, 0, v.width, v.height, FAN_STEEL);
  const at: Point = (r, a) => [cx - Math.cos(a) * r, cy + Math.sin(a) * r];
  const lens = linear(c, cx - outer, cy - outer, cx + half, cy + outer, [[0, "#76bed76d"], [.28, "#113d66a8"], [.54, "#255577a1"], [.74, "#153e5f9e"], [1, "#6babc37b"]]);
  const track = (radius: number, width: number, strength: number, station: number, count: number, child: boolean): void => {
    if (strength < .005) return;
    c.globalAlpha = strength;
    const end = 1.43;
    // The glass thins into two polished tips beyond the last cells.
    const ribbon: Point = (r, a) => {
      const t = clamp((Math.abs(a) - 1.08) / .35, 0, 1), taper = 1 - .91 * t * t * (3 - 2 * t);
      return at(radius + (r - radius) * taper, a);
    };
    band(c, ribbon, radius - width, radius + width, -end, end, lens);
    curve(c, ribbon, radius + width + 2.3, -end, end, steel, 2.1);
    curve(c, ribbon, radius + width - 1.1, -end, end, "#c3e9f69c", .7);
    curve(c, ribbon, radius - width, -end, end, steel, 1.1);
    curve(c, ribbon, radius - width + 2.1, -end, end, "#99d5e96e", .7);
    for (let j = -15; j <= 15; j++) {
      const t = j * .09, long = Math.abs(j) % 3 === 0 ? 4.4 : 2.1;
      line(c, ...ribbon(radius + width - 1.2, t), ...ribbon(radius + width - 1.2 - long, t), "#a7cede9a", .68);
    }
    for (const sign of [-1, 1]) {
      const [tx, ty] = ribbon(radius, sign * end);
      curve(c, ribbon, radius + width + 2.5, sign * 1.10, sign * end, "#d3f2fdcf", 1);
      c.beginPath(); c.arc(tx, ty, 1.55, 0, TAU); c.fillStyle = steel; c.fill();
    }
    if (child ? v.depth !== 1 : v.depth < 0) { c.globalAlpha = 1; return; }
    const cell = width - 2.7, reach = .375;
    for (let i = 0; i < count; i++) {
      const rel = turn(station, i, count), angle = rel * FAN_SPREAD, [x, y] = at(radius, angle);
      const lit = Math.abs(rel) < .49, fade = clamp((1.50 - Math.abs(rel)) / .35, 0, 1);
      c.globalAlpha = strength * fade;
      if (lit) {
        band(c, at, radius - cell, radius + cell, angle - reach, angle + reach, linear(c, x - 22, y - 30, x + 22, y + 20, [[0, "#8ed9f693"], [.39, "#4f9cc276"], [.73, "#173e688c"], [1, "#5e9db6b2"]]));
        curve(c, at, radius + cell, angle - reach, angle + reach, "#c4f5ff", 1.2);
        if (child) {
          const [gx, gy] = at(radius + cell - 4, angle);
          c.save(); c.translate(gx, gy); c.rotate(-angle + Math.PI / 2); gem(c, 0, 0, 5.4, FAN_GEM, .65); c.restore();
        }
      }
      line(c, ...at(radius - width + 2, angle - reach), ...at(radius + width - 3, angle - reach), lit ? "#b0e5f8ac" : "#9bc9df83", .9);
      if (!child && v.depth === 1 && i === v.group) gem(c, ...at(radius + width - 5, angle), 3.3, FAN_GEM, .65);
    }
    c.globalAlpha = 1;
  };
  if (ease > .06) {
    c.globalAlpha = ease * .72;
    const [ax, ay] = at(21, 0), [bx, by] = at(root - half, 0);
    line(c, ax, ay - 2, bx, by - 1.5, steel, 1.35); line(c, ax, ay + 2, bx, by + 1.5, "#749bb6a8", .8);
  }
  if (level > .001) {
    c.globalAlpha = level * .86;
    const [x, y] = at(root + half, 0), [X, Y] = at(outer - childHalf, 0);
    line(c, x, y - 2, X, Y - 3, steel, 1.5); line(c, x, y + 2, X, Y + 3, "#4186a9", 1);
  }
  c.globalAlpha = 1;
  track(root, s.rootWidth, .57 + .43 * ease, v.rootPhase, v.families, false);
  if (level > .001) track(s.leafRadius, childHalf, level * ease, v.leafPhase, v.leaves, true);
  c.globalAlpha = ease;
  disk(c, cx, cy, clamp(v.rootR * .47, 40, 51) * .41, steel);
  c.globalAlpha = .72 + .28 * ease;
  gem(c, ...at((level > .6 ? outer + childHalf : root + half) + 2, 0), 4.7, FAN_GEM, .65);
  c.globalAlpha = 1;
}

/** The equipment shelf: a strip of glass that fades out at both ends. */
export function paintShelf(c: Pen, w: number, h: number): void {
  c.fillStyle = linear(c, 0, 0, 0, h, [[0, "rgba(136,186,207,.38)"], [.31, "rgba(25,66,94,.58)"], [.78, "rgba(10,32,54,.65)"], [1, "rgba(103,150,166,.46)"]]);
  c.beginPath(); rect(c, 0, 0, w, h); c.fill();
  c.fillStyle = "#d3e8f4a3"; c.beginPath(); rect(c, 0, 0, w, 1); c.fill();
  c.fillStyle = "#80b7cf8f"; c.beginPath(); rect(c, 0, h - 1, w, 1); c.fill();
  // Keep the glass only where this mask is solid.
  c.globalCompositeOperation = "destination-in";
  c.fillStyle = linear(c, 0, 0, w, 0, [[0, "rgba(0,0,0,0)"], [.05, "#000"], [.95, "#000"], [1, "rgba(0,0,0,0)"]]);
  c.beginPath(); rect(c, 0, 0, w, h); c.fill();
  c.globalCompositeOperation = "source-over";
}
function rect(c: Pen, x: number, y: number, w: number, h: number): void {
  c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath();
}

/** A name's backing, dark in the middle and clear at both ends: `soft` is the share each end fades over. */
export function paintPlate(c: Pen, w: number, h: number, soft: number, low: number): void {
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, `rgba(5,23,43,${low})`); g.addColorStop(soft, "rgba(5,28,52,.88)");
  g.addColorStop(1 - soft, "rgba(5,28,52,.88)"); g.addColorStop(1, `rgba(5,23,43,${low})`);
  c.fillStyle = g; c.beginPath(); rect(c, 0, 0, w, h); c.fill();
}
