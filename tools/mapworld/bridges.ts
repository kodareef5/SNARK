import { RUIN_SHAPES, type RuinShape } from "../../content/ruins.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Mason, type Frame, type Point } from "./ruin-geometry.ts";
import type { Site } from "./statics.ts";
import { pathsOf, readWays, type Path } from "./ways.ts";
import { makeSuspension, SUSPENDED } from "./suspension.ts";

export interface DeckPoint { x: number; y: number; z: number; yaw: number; gap: boolean; }
export interface BridgeRecord {
  id: number; name: string | null; kind: string; class: string | null; layer: number | null; width: number;
  length: number; blocks: number; status: string; heightRule: string; low: number; high: number;
  deck: DeckPoint[]; swim: { x: number; z: number; dx: number; dz: number; distance: number }[];
  access: { name: string; points: DeckPoint[] }[];
  approaches: number;
}
export interface Corridor { a: Point; b: Point; width: number; low: number; high: number; }
export const worldFrame = (size: number): Frame => ({ x: 0, z: 0, yaw: 0, c: 1, s: 0, width: size, depth: size, rings: [] });
const key = (p: Point, kind: string): string => `${kind === "rail_bridge" ? "rail" : "road"}:${Math.round(p[0] * 5)},${Math.round(p[1] * 5)}`;
export function makeBridges(site: Site, accept: (m: Mason) => boolean): { records: BridgeRecord[]; corridors: Corridor[]; outlines: { id: number; status: string }[] } {
  const size = (site.ground.n - 1) * 2;
  const { paths, outlines } = pathsOf(readWays(site.source), size / 2);
  const at = (x: number, z: number): number => Math.max(0, Math.min(site.ground.n - 1, Math.round((size - z) / 2))) * site.ground.n + Math.max(0, Math.min(site.ground.n - 1, Math.round((size - x) / 2)));
  const wet = (p: Point): boolean => site.ground.water[at(p[0], p[1])] === 1;
  const nodes = new Map<string, { height: number; degree: number; p: Point; terminal: boolean }>();
  const edges: { a: string; b: string; length: number; grade: number }[] = [];
  const nominal = (p: Path, point: Point): number => {
    const ground = site.groundAt(...point);
    if (p.way.kind === "breakwater") return Math.max(1.2, ground + .2);
    if (p.way.kind === "pier") return Math.max(2, ground + .2);
    const rail = p.way.kind === "rail_bridge";
    const level = Math.max(1, Math.min(4, p.way.layer ?? 1));
    const base = rail ? p.way.class === "monorail" ? 12 : 16 : /motorway|trunk/.test(p.way.class ?? "") ? 8 : 5;
    return Math.max(base + (level - 1) * 5, ground + (rail ? 7 : 5));
  };
  for (const p of paths) for (let i = 0; i < p.points.length; i++) {
    const point = p.points[i]!; const k = key(point, p.way.kind); const node = nodes.get(k);
    const degree = i === 0 || i === p.points.length - 1 ? 1 : 2;
    if (node) { node.height = Math.max(node.height, nominal(p, point)); node.degree += degree; }
    else nodes.set(k, { height: nominal(p, point), degree, p: point, terminal: p.way.kind !== "rail_bridge" && p.way.kind !== "breakwater" });
    // A deck hung from cables keeps the height it left the land at; others may fall at a tenth toward their class.
    if (i > 0) edges.push({ a: key(p.points[i - 1]!, p.way.kind), b: k, length: Math.hypot(point[0] - p.points[i - 1]![0], point[1] - p.points[i - 1]![1]), grade: SUSPENDED.has(p.way.structure ?? "") ? .005 : .10 });
  }
  for (const n of nodes.values()) if (n.degree === 1 && n.terminal && !wet(n.p)) n.height = Math.max(.25, site.groundAt(...n.p) + .1);
  // A shared graph gives adjoining ways the same deck elevation. Raise low nodes only enough to keep steps walkable.
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (const edge of edges) {
      const a = nodes.get(edge.a)!; const b = nodes.get(edge.b)!; const delta = edge.length * edge.grade;
      if (a.height < b.height - delta) { a.height = b.height - delta; changed = true; }
      if (b.height < a.height - delta) { b.height = a.height - delta; changed = true; }
    }
    if (!changed) break;
  }
  const records: BridgeRecord[] = []; const corridors: Corridor[] = [];
  const planned: { p: Path; deck: DeckPoint[]; length: number }[] = [];
  for (const p of paths.sort((a, b) => Number(b.way.kind === "rail_bridge") - Number(a.way.kind === "rail_bridge") || a.way.id - b.way.id)) {
    const deck: DeckPoint[] = []; let length = 0;
    for (let k = 1; k < p.points.length; k++) {
      const a = p.points[k - 1]!; const b = p.points[k]!; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < .01) continue;
      const y0 = nodes.get(key(a, p.way.kind))!.height; const y1 = nodes.get(key(b, p.way.kind))!.height;
      const dx = (b[0] - a[0]) / len; const dz = (b[1] - a[1]) / len;
      const steps = Math.max(1, Math.ceil(len / 3.5), Math.ceil(Math.abs(y1 - y0) / .25));
      for (let j = 0; j <= steps; j++) {
        if (k > 1 && j === 0) continue;
        const t = j / steps; const x = a[0] + dx * len * t; const z = a[1] + dz * len * t;
        const y = Math.round(Math.max(y0 + (y1 - y0) * t, site.groundAt(x, z) + .1) * 16) / 16;
        const gap = [-4, 0, 4].some((s) => site.ground.gaps[at(x + dx * s, z + dz * s)] === 1);
        deck.push({ x, y, z, yaw: Math.atan2(-dz, dx) * 180 / Math.PI, gap });
      }
      length += len;
    }
    planned.push({ p, deck, length });
  }
  // Nearby decks less than one body-height apart are a junction, not two usable levels.
  const deckBins = new Map<string, { d: DeckPoint; width: number; path: Path }[]>();
  for (const { p, deck } of planned) for (const d of deck) {
    const k = `${Math.floor(d.x / 16)},${Math.floor(d.z / 16)}`;
    if (!deckBins.has(k)) deckBins.set(k, []); deckBins.get(k)!.push({ d, width: p.width, path: p });
  }
  for (let pass = 0; pass < 16; pass++) {
    for (const { p, deck } of planned) for (const d of deck) {
      const bx = Math.floor(d.x / 16); const bz = Math.floor(d.z / 16);
      for (let x = bx - 2; x <= bx + 2; x++) for (let z = bz - 2; z <= bz + 2; z++) for (const other of deckBins.get(`${x},${z}`) ?? []) {
        if (other.path === p) continue;
        if (Math.abs(other.d.y - d.y) < 3.2 && Math.hypot(other.d.x - d.x, other.d.z - d.z) < (p.width + other.width) / 2 + 2) d.y = other.d.y = Math.max(d.y, other.d.y);
      }
    }
    for (const { deck } of planned) for (const direction of [1, -1]) {
      for (let i = direction > 0 ? 1 : deck.length - 2; i >= 0 && i < deck.length; i += direction) {
        const a = deck[i - direction]!; const b = deck[i]!;
        b.y = Math.max(b.y, a.y - Math.min(.25, Math.hypot(a.x - b.x, a.z - b.z) * .1));
      }
    }
  }
  for (const { deck } of planned) for (const d of deck) d.y = Math.round(d.y * 16) / 16;
  const approaches = new Map<Path, number>();
  for (const { p, deck } of planned.filter(({ p }) => p.way.kind === "road_bridge")) {
    for (const end of [0, 1]) {
      const d = (end ? deck.at(-1) : deck[0])!; const next = (end ? deck.at(-2) : deck[1])!;
      const length = Math.hypot(d.x - next.x, d.z - next.z); if (length < .01 || d.gap) continue;
      const dx = (d.x - next.x) / length; const dz = (d.z - next.z) / length;
      const ground = site.groundAt(d.x, d.z); if (ground < .1 || d.y - ground < .4) continue;
      const bx = Math.floor(d.x / 16); const bz = Math.floor(d.z / 16);
      let joined = false;
      for (let x = bx - 2; x <= bx + 2; x++) for (let z = bz - 2; z <= bz + 2; z++) for (const other of deckBins.get(`${x},${z}`) ?? []) {
        if (other.path === p || Math.abs(other.d.y - d.y) > .75) continue;
        const ox = other.d.x - d.x; const oz = other.d.z - d.z; const along = ox * dx + oz * dz;
        if (along > 2 && along < 12 && Math.abs(ox * dz - oz * dx) < p.width / 2 + 1) joined = true;
      }
      if (joined) continue;
      for (let reach = 12; reach <= 120; reach += 4) {
        const x = d.x + dx * reach; const z = d.z + dz * reach; const y = Math.ceil((site.groundAt(x, z) + .1) * 16) / 16;
        if (y < .5 || y > d.y || (d.y - y) / reach > .1) continue;
        const count = Math.max(Math.ceil(reach / 3), Math.ceil((d.y - y) / .25)); const ramp: DeckPoint[] = [];
        for (let i = 1; i <= count; i++) {
          const t = i / count; const px = d.x + dx * reach * t; const pz = d.z + dz * reach * t; const top = Math.round((d.y + (y - d.y) * t) * 16) / 16;
          if (px < p.width || pz < p.width || px > size - p.width || pz > size - p.width || site.groundAt(px, pz) > top + .1 || [-p.width / 2 - 3, 0, p.width / 2 + 3].some((s) => site.ground.heaps.owner[at(px - dz * s, pz + dx * s)]! >= 0 || site.ground.water[at(px - dz * s, pz + dx * s)])) break;
          let crosses = false;
          for (let bx = Math.floor(px / 16) - 2; bx <= Math.floor(px / 16) + 2; bx++) for (let bz = Math.floor(pz / 16) - 2; bz <= Math.floor(pz / 16) + 2; bz++) for (const other of deckBins.get(`${bx},${bz}`) ?? []) {
            const difference = Math.abs(other.d.y - top);
            if (other.path !== p && difference > .3 && difference < 3 && Math.hypot(other.d.x - px, other.d.z - pz) < (p.width + other.width) / 2 + 3) crosses = true;
          }
          if (crosses) break;
          ramp.push({ x: px, y: top, z: pz, yaw: d.yaw, gap: false });
        }
        if (ramp.length !== count) continue;
        if (end) deck.push(...ramp); else deck.unshift(...ramp.reverse());
        for (const d of ramp) {
          const k = `${Math.floor(d.x / 16)},${Math.floor(d.z / 16)}`;
          if (!deckBins.has(k)) deckBins.set(k, []); deckBins.get(k)!.push({ d, width: p.width, path: p });
        }
        approaches.set(p, (approaches.get(p) ?? 0) + 1); break;
      }
    }
  }
  const access = new Map<Path, BridgeRecord["access"]>();
  const stations = JSON.parse(readFileSync(join(site.source, "blocks/places.json"), "utf8")) as { kind: string; name: string; e: number; n: number }[];
  const rail = planned.filter(({ p }) => p.way.kind === "rail_bridge");
  const accessFeet: Point[] = [];
  for (const station of stations.filter((s) => s.kind === "station").sort((a, b) => a.name.localeCompare(b.name))) {
    const [sx, sz] = site.toEngine(station.e, station.n);
    const candidates = rail.flatMap(({ p, deck }) => deck.filter((d, i) => i % 3 === 0 && !d.gap && Math.hypot(d.x - sx, d.z - sz) < 100).map((d) => ({ p, d })));
    candidates.sort((a, b) => Math.hypot(a.d.x - sx, a.d.z - sz) - Math.hypot(b.d.x - sx, b.d.z - sz));
    let found = false;
    for (const { p, d } of candidates) {
      if (found) break;
      if (accessFeet.some(([x, z]) => Math.hypot(x - d.x, z - d.z) < 180)) continue;
      const angle = d.yaw * Math.PI / 180;
      for (const side of [-1, 1]) {
        const nx = Math.sin(angle) * side; const nz = Math.cos(angle) * side;
        const edge = p.width / 2 + .75;
        const length = Math.max(8, Math.min(60, (d.y - site.groundAt(d.x + nx * 24, d.z + nz * 24)) * 2 + 4));
        const x = d.x + nx * (edge + length); const z = d.z + nz * (edge + length);
        const base = Math.ceil((site.groundAt(x, z) + .05) * 16) / 16;
        if (base < .5 || d.y - base < 3 || d.y - base > 24) continue;
        const count = Math.max(Math.ceil(length / .45), Math.ceil((d.y - base) / .3));
        const points: DeckPoint[] = [];
        for (let i = 0; i <= count; i++) {
          const t = i / count; const px = x - nx * length * t; const pz = z - nz * length * t;
          const y = Math.round((base + (d.y - base) * t) * 16) / 16;
          if (px < 8 || pz < 8 || px > size - 8 || pz > size - 8 || site.groundAt(px, pz) > y + .08 || [-1, 0, 1].some((s) => site.ground.heaps.owner[at(px + nz * s, pz - nx * s)]! >= 0 || site.ground.water[at(px + nz * s, pz - nx * s)])) break;
          let overhead = false;
          for (let bx = Math.floor(px / 16) - 2; bx <= Math.floor(px / 16) + 2; bx++) for (let bz = Math.floor(pz / 16) - 2; bz <= Math.floor(pz / 16) + 2; bz++) for (const other of deckBins.get(`${bx},${bz}`) ?? []) {
            const q = other.d; if (q.y <= y + .35 || q.y - .4 >= y + 2.1) continue;
            const turn = q.yaw * Math.PI / 180; const dx = px - q.x; const dz = pz - q.z;
            if (Math.abs(dx * Math.cos(turn) - dz * Math.sin(turn)) < 2.45 && Math.abs(dx * Math.sin(turn) + dz * Math.cos(turn)) < other.width / 2 + .45) overhead = true;
          }
          if (overhead) break;
          points.push({ x: px, y, z: pz, yaw: Math.atan2(-nx, -nz) * 180 / Math.PI, gap: false });
        }
        if (points.length !== count + 1) continue;
        if (!access.has(p)) access.set(p, []);
        access.get(p)!.push({ name: station.name, points }); accessFeet.push([x, z]); found = true; break;
      }
    }
  }
  const swims = new Map<Path, BridgeRecord["swim"]>();
  const swimLines: { a: Point; b: Point }[] = [];
  for (const { p, deck } of planned) {
    const found: BridgeRecord["swim"] = [];
    if (p.way.kind !== "breakwater") for (const d of deck.filter((d, i) => i % 9 === 0 && !d.gap && d.y > .8 && site.groundAt(d.x, d.z) < -1.8)) {
      const angle = d.yaw * Math.PI / 180; const dx = Math.sin(angle); const dz = Math.cos(angle); const distance = p.width / 2 + 5;
      if (Array.from({ length: Math.ceil(distance * 2) + 1 }, (_, i) => i - distance).every((s) => site.groundAt(d.x + dx * s, d.z + dz * s) < -1.8)) found.push({ x: d.x, z: d.z, dx, dz, distance });
    }
    const selected = found.filter((_, i) => i % Math.max(1, Math.floor(found.length / 3)) === 0).slice(0, 3); swims.set(p, selected);
    for (const d of selected) {
      const a: Point = [d.x - d.dx * d.distance, d.z - d.dz * d.distance]; const b: Point = [d.x + d.dx * d.distance, d.z + d.dz * d.distance]; swimLines.push({ a, b });
      for (let s = -d.distance - 2; s <= d.distance + 2; s++) for (let side = -2; side <= 2; side++) {
        const i = at(d.x + d.dx * s - d.dz * side, d.z + d.dz * s + d.dx * side);
        if (site.ground.water[i]) site.ground.height[i] = Math.min(-3, site.ground.height[i]!);
      }
    }
  }
  const laneIndex = new Map<string, { a: DeckPoint; b: DeckPoint }[]>();
  for (const deck of [...planned.map((p) => p.deck), ...[...access.values()].flat().map((a) => a.points)]) for (let i = 1; i < deck.length; i++) {
    const a = deck[i - 1]!; const b = deck[i]!; if (a.gap || b.gap) continue;
    for (let x = Math.floor((Math.min(a.x, b.x) - 6) / 16); x <= Math.floor((Math.max(a.x, b.x) + 6) / 16); x++) for (let z = Math.floor((Math.min(a.z, b.z) - 6) / 16); z <= Math.floor((Math.max(a.z, b.z) + 6) / 16); z++) {
      const k = `${x},${z}`; if (!laneIndex.has(k)) laneIndex.set(k, []); laneIndex.get(k)!.push({ a, b });
    }
  }
  for (const { p, deck, length } of planned) {
    const m = new Mason(worldFrame(size), 0);
    for (const a of access.get(p) ?? []) {
      for (let i = 0; i < a.points.length; i++) {
        const d = a.points[i]!;
        m.put("step", d.x, d.y - .2, d.z, "concrete", d.yaw); m.cover(d.x, d.z, 16);
        if (i % 8 === 4) for (let top = d.y - .4; top > site.groundAt(d.x, d.z); top -= 4) m.put("pier4", d.x, top - 2, d.z);
      }
      const end = a.points.at(-1)!; const turn = end.yaw * Math.PI / 180;
      m.put("floor4", end.x + Math.sin(turn) * 2, end.y - .2, end.z + Math.cos(turn) * 2, "concrete", end.yaw);
    }
    for (let i = 0; i < deck.length; i++) {
      const d = deck[i]!; if (d.gap) continue;
      const a = d.yaw * Math.PI / 180; const dx = Math.cos(a); const dz = -Math.sin(a);
      for (let side = -p.width / 2 + 2; side < p.width / 2; side += 4) m.put("floor4", d.x - dz * side, d.y - .2, d.z + dx * side, "concrete", d.yaw);
      m.cover(d.x, d.z, p.width / 2 + 10);
      if (p.way.kind === "breakwater") {
        if (i % 3 === 0) m.put("rubble4", d.x, d.y - .1, d.z, "concrete", d.yaw + 17);
      } else if (i % 3 === 0 && i > 1 && i < deck.length - 2) {
        for (const side of [-1, 1]) if ((i + side + p.way.id) % 11 !== 0) m.put("sill4", d.x - dz * (p.width / 2 + .15) * side, d.y + .45, d.z + dx * (p.width / 2 + .15) * side, p.way.kind === "rail_bridge" ? "rust" : "limestone", d.yaw);
      }
      if (i % 9 === 4 && p.way.kind !== "breakwater" && !(SUSPENDED.has(p.way.structure ?? "") && site.ground.water[at(d.x, d.z)] === 1)) {
        for (const side of p.width > 4 ? [-p.width / 2 + .7, p.width / 2 - .7] : [0]) {
          const x = d.x - dz * side; const z = d.z + dx * side; const bed = site.groundAt(x, z);
          for (let top = d.y - .4; top > bed; top -= 4) m.put("pier4", x, top - 2, z);
        }
      }
    }
    // Side furniture from one branch must not cross another branch's walking line.
    for (let i = m.pieces.length - 1; i >= 0; i--) {
      const p = m.pieces[i]!; const shape = p.kind.split("_")[1] as RuinShape;
      if (shape.startsWith("floor") || shape.startsWith("rubble") || shape === "step") continue;
      const [w, h, d] = RUIN_SHAPES[shape]; const angle = p.yaw * Math.PI / 180;
      const blocked = (laneIndex.get(`${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`) ?? []).some(({ a, b }) => {
        const dx = b.x - a.x; const dz = b.z - a.z; const den = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, den ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / den : 0));
        const x = a.x + dx * t - p.x; const z = a.z + dz * t - p.z; const y = a.y + (b.y - a.y) * t;
        return p.y + h / 2 > y + .1 && p.y - h / 2 < y + 2.2 && Math.abs(x * Math.cos(angle) - z * Math.sin(angle)) < w / 2 + .65 && Math.abs(x * Math.sin(angle) + z * Math.cos(angle)) < d / 2 + .65;
      });
      const swimmer = shape.startsWith("pier") && p.y + h / 2 > -1.8 && p.y - h / 2 < .4 && swimLines.some(({ a, b }) => {
        const dx = b[0] - a[0]; const dz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(p.x - a[0] - dx * t, p.z - a[1] - dz * t) < 1.5;
      });
      if (blocked || swimmer) m.pieces.splice(i, 1);
    }
    const record: BridgeRecord = { id: p.way.id, name: p.way.name, kind: p.way.kind, class: p.way.class, layer: p.way.layer, width: p.width,
      length: Number(length.toFixed(1)), blocks: m.pieces.length, status: "built", heightRule: "class clearance, layer +5 m; shared vertices; dry terminal at ground; target grade 10% before 1/16 m quantization; deck steps <=0.3125 m; close overlapping levels joined",
      low: Math.min(...deck.map((d) => d.y)), high: Math.max(...deck.map((d) => d.y)), deck, swim: [], access: [], approaches: approaches.get(p) ?? 0 };
    if (!m.pieces.length) record.status = "no pieces";
    else if (!accept(m)) record.status = "budget rejected";
    else {
      for (let k = 1; k < deck.length; k++) {
        const a = deck[k - 1]!; const b = deck[k]!; if (a.gap || b.gap) continue;
        corridors.push({ a: [a.x, a.z], b: [b.x, b.z], width: p.width + 2, low: Math.min(a.y, b.y) - .5, high: Math.max(a.y, b.y) + 3.5 });
      }
      record.swim = swims.get(p) ?? [];
      record.access = access.get(p) ?? [];
      for (const a of record.access) for (let k = 1; k < a.points.length; k++) {
        const start = a.points[k - 1]!; const end = a.points[k]!;
        corridors.push({ a: [start.x, start.z], b: [end.x, end.z], width: 4, low: Math.min(start.y, end.y) - .5, high: Math.max(start.y, end.y) + 2.5 });
      }
    }
    records.push(record);
  }
  outlines.push(...makeSuspension(site, planned, accept));
  return { records, corridors, outlines };
}

export function bridgeHoles(frame: Frame, corridors: readonly Corridor[], base: number, height: number): Frame {
  const rings = [...frame.rings];
  for (const r of corridors) {
    if (r.high < base || r.low > base + height + 2.5) continue;
    const local = ([x, z]: Point): Point => [(x - frame.x) * frame.c - (z - frame.z) * frame.s, (x - frame.x) * frame.s + (z - frame.z) * frame.c];
    const a = local(r.a); const b = local(r.b); const margin = r.width / 2 + 1;
    if (Math.min(a[0], b[0]) > frame.width / 2 + margin || Math.max(a[0], b[0]) < -frame.width / 2 - margin || Math.min(a[1], b[1]) > frame.depth / 2 + margin || Math.max(a[1], b[1]) < -frame.depth / 2 - margin) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]); if (length < .01) continue;
    const dx = (b[0] - a[0]) / length; const dz = (b[1] - a[1]) / length;
    rings.push([[a[0] - dx - dz * margin, a[1] - dz + dx * margin], [b[0] + dx - dz * margin, b[1] + dz + dx * margin], [b[0] + dx + dz * margin, b[1] + dz - dx * margin], [a[0] - dx + dz * margin, a[1] - dz - dx * margin]]);
  }
  return { ...frame, rings };
}

export function corridorIndex(corridors: readonly Corridor[]): (frame: Frame) => Corridor[] {
  const bins = new Map<string, Corridor[]>();
  for (const c of corridors) {
    for (let x = Math.floor((Math.min(c.a[0], c.b[0]) - c.width) / 128); x <= Math.floor((Math.max(c.a[0], c.b[0]) + c.width) / 128); x++) for (let z = Math.floor((Math.min(c.a[1], c.b[1]) - c.width) / 128); z <= Math.floor((Math.max(c.a[1], c.b[1]) + c.width) / 128); z++) {
      const k = `${x},${z}`; if (!bins.has(k)) bins.set(k, []); bins.get(k)!.push(c);
    }
  }
  return (frame) => {
    const found = new Set<Corridor>(); const radius = Math.hypot(frame.width, frame.depth) / 2;
    for (let x = Math.floor((frame.x - radius) / 128); x <= Math.floor((frame.x + radius) / 128); x++) for (let z = Math.floor((frame.z - radius) / 128); z <= Math.floor((frame.z + radius) / 128); z++) for (const c of bins.get(`${x},${z}`) ?? []) found.add(c);
    return [...found];
  };
}
