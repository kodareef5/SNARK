// A suspension bridge's towers, cables and hangers, for any bridge OpenStreetMap marks bridge:structure=suspension.
// Towers come from the parts mapped in three dimensions (blocks/supports.json, from man_made=tower with
// tower:type=bridge): each part is filled with solids between its min_height and height above the water or ground, and
// the lowest parts of a tower reach down to the bed. Two cables hang from each tower's top: across the main span to the
// next tower as a parabola whose low point is just above the deck, and out over the side spans to the deck at three
// tenths of the main span, the common proportion where no anchorage is mapped. Hangers drop from the cables every 16 m.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Mason, inRing, type Point } from "./ruin-geometry.ts";
import type { RuinFinish } from "../../content/ruins.ts";
import type { Site } from "./statics.ts";
import type { DeckPoint } from "./bridges.ts";
import { worldFrame } from "./bridges.ts";
import type { Path } from "./ways.ts";

interface Part { id: number; kind: string; name: string | null; min_height_m: number; height_m: number | null; colour: string | null; ring: [number, number][]; }
interface Tower { parts: (Part & { engine: Point[]; centre: Point; area: number })[]; centre: Point; top: number; finish: RuinFinish; }

export const SUSPENDED = new Set(["suspension", "cable-stayed"]);

const finishOf = (colour: string | null): RuinFinish => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour ?? "");
  if (!m) return colour && /red|orange/i.test(colour) ? "rust" : "steel";
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => parseInt(h, 16)) as [number, number, number];
  return r > g + 40 && r > b + 40 ? "rust" : b > r + 30 ? "blue" : "steel";
};

const centroid = (ring: readonly Point[]): { centre: Point; area: number } => {
  let a = 0; let x = 0; let z = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j]!; const q = ring[i]!; const f = p[0] * q[1] - q[0] * p[1];
    a += f; x += (p[0] + q[0]) * f; z += (p[1] + q[1]) * f;
  }
  return Math.abs(a) < 1e-6 ? { centre: ring[0]!, area: 0 } : { centre: [x / (3 * a), z / (3 * a)], area: Math.abs(a / 2) };
};

function towersOf(site: Site): Tower[] {
  const file = join(site.source, "blocks/supports.json");
  if (!existsSync(file)) return [];
  const parts = (JSON.parse(readFileSync(file, "utf8")) as Part[]).filter((p) => p.kind === "bridge_tower" && p.height_m && p.ring.length >= 4)
    .map((p) => { const engine = p.ring.map(([e, n]) => site.toEngine(e, n) as Point); return { ...p, engine, ...centroid(engine) }; });
  // Parts within 40 m of each other are one tower.
  const group = parts.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i]!)));
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (Math.hypot(parts[i]!.centre[0] - parts[j]!.centre[0], parts[i]!.centre[1] - parts[j]!.centre[1]) < 40) group[root(i)] = root(j);
  }
  const towers = new Map<number, Tower["parts"]>();
  parts.forEach((p, i) => { const r = root(i); if (!towers.has(r)) towers.set(r, []); towers.get(r)!.push(p); });
  return [...towers.values()].map((ps): Tower => {
    const area = ps.reduce((s, p) => s + p.area, 0) || 1;
    return { parts: ps, centre: [ps.reduce((s, p) => s + p.centre[0] * p.area, 0) / area, ps.reduce((s, p) => s + p.centre[1] * p.area, 0) / area],
      top: Math.max(...ps.map((p) => p.height_m!)), finish: finishOf(ps.find((p) => p.colour)?.colour ?? null) };
  }).sort((a, b) => a.centre[0] - b.centre[0] || a.centre[1] - b.centre[1]);
}

/** Fills a part's outline with 8 m solids where they fit and 4 m ones at its edges, in layers from bottom to top. */
function fill(m: Mason, ring: readonly Point[], bottom: number, top: number, finish: RuinFinish): void {
  let yaw = 0; let longest = 0;
  for (let i = 1; i < ring.length; i++) {
    const dx = ring[i]![0] - ring[i - 1]![0]; const dz = ring[i]![1] - ring[i - 1]![1];
    if (dx * dx + dz * dz > longest) { longest = dx * dx + dz * dz; yaw = Math.atan2(-dz, dx); }
  }
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  const local = ring.map(([x, z]) => [x * c - z * s, x * s + z * c] as Point);
  const us = local.map((p) => p[0]); const vs = local.map((p) => p[1]);
  const u0 = Math.min(...us); const v0 = Math.min(...vs);
  const cols = Math.max(1, Math.round((Math.max(...us) - u0) / 4)); const rows = Math.max(1, Math.round((Math.max(...vs) - v0) / 4));
  const du = (Math.max(...us) - u0) / cols; const dv = (Math.max(...vs) - v0) / rows;
  const cell = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < cols && j < rows && inRing(u0 + (i + .5) * du, v0 + (j + .5) * dv, local);
  const at = (u: number, v: number): Point => [u * c + v * s, -u * s + v * c];
  const layers = Math.max(1, Math.round((top - bottom) / 4));
  const step = (top - bottom) / layers;
  const turn = yaw * 180 / Math.PI;
  const used = new Set<string>();
  for (let k = 0; k < layers; k++) {
    const pair = k + 1 < layers && k % 2 === 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (!cell(i, j) || used.has(`${k},${i},${j}`)) continue;
      if (pair && cell(i + 1, j) && cell(i, j + 1) && cell(i + 1, j + 1) && ![[i + 1, j], [i, j + 1], [i + 1, j + 1]].some(([a, b]) => used.has(`${k},${a},${b}`))) {
        const [x, z] = at(u0 + (i + 1) * du, v0 + (j + 1) * dv);
        m.put("zmass8", x, bottom + (k + 1) * step, z, finish, turn);
        for (const [a, b] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) { used.add(`${k},${a},${b}`); used.add(`${k + 1},${a},${b}`); }
        continue;
      }
      const [x, z] = at(u0 + (i + .5) * du, v0 + (j + .5) * dv);
      m.put("crown", x, bottom + (k + .5) * step, z, finish, turn);
      used.add(`${k},${i},${j}`);
    }
  }
}

export interface SuspensionRecord { id: number; status: string; }

export function makeSuspension(site: Site, planned: readonly { p: Path; deck: DeckPoint[] }[], accept: (m: Mason) => boolean): SuspensionRecord[] {
  const size = (site.ground.n - 1) * 2;
  const towers = towersOf(site);
  const decks = planned.filter(({ p }) => SUSPENDED.has(p.way.structure ?? ""));
  const out: SuspensionRecord[] = [];
  if (!towers.length || !decks.length) return out;
  const points = decks.flatMap(({ p, deck }) => deck.filter((d) => !d.gap).map((d) => ({ d, width: p.width })));
  const deckNear = (x: number, z: number): { y: number; distance: number; yaw: number } => {
    let best = { y: 0, distance: Infinity, yaw: 0 };
    for (const { d } of points) { const k = Math.hypot(d.x - x, d.z - z); if (k < best.distance) best = { y: d.y, distance: k, yaw: d.yaw }; }
    return best;
  };
  const standing = towers.filter((t) => deckNear(...t.centre).distance < 40);
  for (const t of standing) {
    const m = new Mason(worldFrame(size), 0);
    const water = Math.max(0, site.groundAt(...t.centre));
    const lowest = Math.min(...t.parts.map((p) => p.min_height_m));
    for (const p of t.parts) {
      const bed = Math.min(...p.engine.map(([x, z]) => site.groundAt(x, z)), site.groundAt(...p.centre));
      const bottom = p.min_height_m === lowest ? Math.max(-60, bed) : water + p.min_height_m;
      fill(m, p.engine, bottom, water + p.height_m!, t.finish);
    }
    out.push({ id: t.parts[0]!.id, status: `suspension tower of ${t.parts.length} mapped parts, ${m.pieces.length} blocks, top ${(water + t.top).toFixed(0)} m: ${accept(m) ? "built" : "budget rejected"}` });
  }
  // Towers along one deck line, in order: the main spans are between neighbours, the side spans beyond the ends.
  if (standing.length < 2) return out;
  const [a0, b0] = [standing[0]!.centre, standing.at(-1)!.centre];
  const length = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const ax = (b0[0] - a0[0]) / length; const az = (b0[1] - a0[1]) / length;
  const order = [...standing].sort((a, b) => (a.centre[0] - a0[0]) * ax + (a.centre[1] - a0[1]) * az - ((b.centre[0] - a0[0]) * ax + (b.centre[1] - a0[1]) * az));
  // The cables run over the outermost columns of the towers, either side of the deck.
  const offsets = order[0]!.parts.filter((p) => p.min_height_m === Math.min(...order[0]!.parts.map((q) => q.min_height_m)))
    .map((p) => (p.centre[0] - order[0]!.centre[0]) * -az + (p.centre[1] - order[0]!.centre[1]) * ax);
  const sides = offsets.length >= 2 ? [Math.min(...offsets), Math.max(...offsets)] : [0];
  const along = points.map(({ d }) => (d.x - a0[0]) * ax + (d.z - a0[1]) * az);
  const [first, last] = [Math.min(...along), Math.max(...along)];
  const yaw = Math.atan2(-az, ax) * 180 / Math.PI;
  const lanes = points.map(({ d, width }) => ({ s: (d.x - a0[0]) * ax + (d.z - a0[1]) * az, o: (d.x - a0[0]) * -az + (d.z - a0[1]) * ax, half: width / 2 }));
  const spans: { from: number; to: number; y: (s: number) => number; name: string }[] = [];
  const pos = order.map((t) => (t.centre[0] - a0[0]) * ax + (t.centre[1] - a0[1]) * az);
  const top = (t: Tower): number => Math.max(0, site.groundAt(...t.centre)) + t.top - 2;
  const deckAt = (s: number): number => deckNear(a0[0] + ax * s, a0[1] + az * s).y;
  for (let k = 0; k + 1 < order.length; k++) {
    const [sa, sb] = [pos[k]!, pos[k + 1]!]; const [ya, yb] = [top(order[k]!), top(order[k + 1]!)];
    const low = deckAt((sa + sb) / 2) + 3;
    spans.push({ from: sa, to: sb, name: "main", y: (s) => { const t = (s - sa) / (sb - sa); return ya + (yb - ya) * t - 4 * t * (1 - t) * ((ya + yb) / 2 - low); } });
  }
  const main = Math.max(...pos.slice(1).map((p, k) => p - pos[k]!));
  for (const [end, dir] of [[0, -1], [order.length - 1, 1]] as const) {
    const s0 = pos[end]!; const reach = Math.min(main * .3, dir < 0 ? s0 - first : last - s0);
    if (reach < 16) continue;
    const s1 = s0 + dir * reach; const y0 = top(order[end]!); const y1 = deckAt(s1) + 2;
    spans.push({ from: Math.min(s0, s1), to: Math.max(s0, s1), name: "side", y: (s) => { const t = Math.abs(s - s0) / reach; return y0 + (y1 - y0) * t - .05 * reach * 4 * t * (1 - t); } });
  }
  for (const span of spans) for (const side of sides) {
    const m = new Mason(worldFrame(size), 0);
    const point = (s: number): Point => [a0[0] + ax * s - az * side, a0[1] + az * s + ax * side];
    for (let s = span.from + 2; s < span.to; s += 4) {
      const [x, z] = point(s);
      if (x < 8 || z < 8 || x > size - 8 || z > size - 8) continue;
      m.put("trim4", x, span.y(s), z, order[0]!.finish, yaw);
    }
    for (let s = span.from + 16; s < span.to - 8; s += 16) {
      const [x, z] = point(s);
      if (x < 8 || z < 8 || x > size - 8 || z > size - 8) continue;
      // A hanger standing on a walked deck starts above head height.
      const onDeck = lanes.some((l) => Math.abs(l.s - s) < 3 && Math.abs(l.o - side) < l.half + .8);
      let y = deckAt(s) + (onDeck ? 2.6 : .3); const cable = span.y(s) - .3;
      while (cable - y >= 4) {
        const h = cable - y >= 16 ? 16 : cable - y >= 8 ? 8 : 4;
        m.put(h === 16 ? "fin16" : h === 8 ? "fin8" : "fin4", x, y + h / 2, z, order[0]!.finish, yaw);
        y += h;
      }
    }
    out.push({ id: order[0]!.parts[0]!.id, status: `suspension ${span.name} span cable, ${(span.to - span.from).toFixed(0)} m, offset ${side.toFixed(1)} m, ${m.pieces.length} blocks: ${m.pieces.length && accept(m) ? "built" : "budget rejected"}` });
  }
  return out;
}
