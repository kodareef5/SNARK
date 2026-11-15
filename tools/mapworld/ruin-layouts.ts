import type { RuinShape } from "../../content/miami-ruins.ts";
import { hash3, rand3 } from "./raster.ts";
import { inside, Mason, SIDES, tileKey, tilesOf, type Tile } from "./ruin-geometry.ts";
import type { Rule } from "./ruin-vocabulary.ts";

export interface LayoutOptions { seed: number; playable: number; detail: number; coreU?: number; }
const has = (tiles: Set<string>, t: Tile, dx: number, dz: number): boolean => tiles.has(tileKey(t.i + dx, t.j + dz));

// A layout composes an intact circulation path, structural frame, then the remnants around it.
export function stack(m: Mason, tiles: Tile[], bay: number, height: number, rule: Rule, opts: LayoutOptions, base = 0, openHall = false): void {
  if (tiles.length === 0 || height < 4) return;
  const keys = new Set(tiles.map((t) => tileKey(t.i, t.j)));
  const floors = Math.round(height / 4);
  const playable = Math.min(floors, opts.playable);
  const candidates = bay === 8 ? [...tiles].filter((t) => has(keys, t, 0, 1) && has(keys, t, 0, -1)).sort((a, b) => (a.u - (opts.coreU ?? 0)) ** 2 + a.v ** 2 - (b.u - (opts.coreU ?? 0)) ** 2 - b.v ** 2) : [];
  const cores: Tile[] = candidates.length ? [candidates[0]!] : [];
  const wanted = Math.min(8, Math.max(1, Math.ceil(tiles.length * bay * bay / 3500)));
  while (cores.length < wanted) {
    const next = candidates.filter((t) => cores.every((c) => Math.hypot(c.u - t.u, c.v - t.v) >= 32)).sort((a, b) => Math.min(...cores.map((c) => Math.hypot(c.u - b.u, c.v - b.v))) - Math.min(...cores.map((c) => Math.hypot(c.u - a.u, c.v - a.v))))[0];
    if (!next) break; cores.push(next);
  }
  const escape = cores.map((c) => tiles.find((t) => Math.abs(t.u - c.u) === bay && t.v === c.v && has(keys, t, 0, 1) && has(keys, t, 0, -1) && !cores.includes(t))).filter((t): t is Tile => !!t);
  const safe = (t: Tile): boolean => cores.some((c) => Math.abs(t.u - c.u) <= bay && Math.abs(t.v - c.v) <= bay);
  const entryLane = (t: Tile): boolean => cores.some((c) => t.i === c.i);
  const edge = (t: Tile): boolean => SIDES.some(([dx, dz]) => !has(keys, t, dx, dz));
  const court = rule.recipe === "mall" || rule.recipe === "school" || rule.recipe === "theatre";
  const xs = tiles.map((t) => t.u); const zs = tiles.map((t) => t.v);
  const minU = Math.min(...xs); const maxU = Math.max(...xs); const minV = Math.min(...zs); const maxV = Math.max(...zs);
  const midU = (minU + maxU) / 2; const midV = (minV + maxV) / 2;
  const rx = Math.max(bay, (maxU - minU) / 3); const rz = Math.max(bay, (maxV - minV) / 3);
  const corner = hash3(opts.seed, 7, 0) % 4;
  const tops = new Map<string, number>();
  for (const t of tiles) {
    const outerCourt = court && tiles.length > 24 && Math.abs(t.u - midU) < rx && Math.abs(t.v - midV) < rz && !safe(t);
    const cornerU = corner % 2 === 0 ? maxU : minU; const cornerV = corner < 2 ? maxV : minV;
    const crushed = !safe(t) && Math.hypot(t.u - cornerU, t.v - cornerV) < Math.min(maxU - minU, maxV - minV) * .38;
    const top = outerCourt ? 0 : crushed ? Math.max(1, Math.floor(floors * .35)) : floors;
    tops.set(tileKey(t.i, t.j), top);
    if (top === 0) continue;
    m.cover(t.u, t.v, bay * .75);
    for (let level = 1; level <= top; level++) {
      if ((cores.includes(t) || escape.includes(t)) && level <= playable) continue;
      const isSafe = safe(t) && level <= playable;
      const roof = level === top;
      const hallGap = openHall && !edge(t) && !isSafe && !roof;
      if (hallGap) continue;
      if (level > playable && !roof) continue;
      if (!isSafe && rand3(opts.seed, t.i * 313 + t.j, level) < rule.holes) continue;
      m.floor([t.u, t.v], base + level * 4, bay);
    }
    if (base === 0 && !safe(t) && !entryLane(t) && rand3(opts.seed, t.i, t.j) < rule.holes * .65) {
      m.put("rubble4", t.u - 1, .55, t.v, "concrete", (hash3(t.i, t.j, opts.seed) % 7) * 13);
      if (opts.detail === 0) m.put("rubble", t.u + 1.5, .35, t.v + 1.5, "concrete", 27);
    }
  }
  const posts = new Map<string, { u: number; v: number; top: number }>();
  for (const t of tiles) {
    const top = tops.get(tileKey(t.i, t.j))!;
    if (top === 0) continue;
    for (const du of [-.5, .5]) for (const dv of [-.5, .5]) {
      const k = tileKey(t.i + du, t.j + dv); const existing = posts.get(k);
      if (!existing || existing.top < top) posts.set(k, { u: t.u + du * bay, v: t.v + dv * bay, top });
    }
    for (let side = 0; side < SIDES.length; side++) {
      const [dx, dz] = SIDES[side]!;
      const adjacent = tops.get(tileKey(t.i + dx, t.j + dz)) ?? 0;
      if (adjacent >= top) continue;
      const u = t.u + dx * bay / 2; const z = t.v + dz * bay / 2;
      const turn = dx === 0 ? 0 : 90;
      const beam: RuinShape = bay === 8 ? "beam8" : "beam4";
      const sill: RuinShape = bay === 8 ? "sill8" : "sill4";
      const wall: RuinShape = bay === 8 ? "wall8" : "wall4";
      const trim: RuinShape = bay === 8 ? "trim8" : "trim4";
      for (let level = adjacent; level < top; level++) {
        const h = base + level * 4;
        const rnd = rand3(opts.seed + side, t.i * 313 + t.j, level);
        // The ground has a door at least every second bay; remaining bays have real window gaps.
        const entry = level === 0 && (hash3(t.i, t.j, side) % 2 === 0 || safe(t) || entryLane(t));
        if (level > playable && level % (opts.detail > 0 ? 4 : 2) !== 0 && level !== top - 1) continue;
        m.put(beam, u, h + 3.7, z, "concrete", turn);
        if (!entry && rnd > rule.holes) {
          if (rand3(opts.seed + 73, t.i * 313 + t.j + side, level) < rule.wall && opts.detail < 2) m.put(wall, u, h + 1.4, z, rule.infill && (t.i + t.j + level) % 3 === 0 ? rule.infill : rule.finish, turn);
          else m.put(sill, u, h + .45, z, rule.finish, turn);
        }
        if ((rule.feature === "deco" || rule.feature === "balconies") && level <= playable && opts.detail < 2) m.put(trim, u + dx * .35, h + 3.15, z + dz * .35, rule.finish, turn);
      }
    }
    if ((rule.feature === "rooms" || rule.recipe === "hotel" || rule.recipe === "hospital") && opts.detail === 0 && !safe(t) && !entryLane(t) && !edge(t) && hash3(t.i, t.j, opts.seed) % 3 === 0) {
      for (let level = 0; level < Math.min(top, playable); level++) m.put("wall4", t.u - 1.6, base + level * 4 + 1.4, t.v + bay / 2, rule.finish);
    }
  }
  for (const p of posts.values()) m.post(p.u, base, p.v, p.top * 4);
  if (base === 0) for (const core of cores) {
    m.stairs(core, playable);
    const drop = escape.find((t) => Math.abs(t.u - core.u) === bay && t.v === core.v);
    if (drop) m.escape(drop, playable, core);
    let lo = core.j; let hi = core.j;
    while (keys.has(tileKey(core.i, lo - 1))) lo--;
    while (keys.has(tileKey(core.i, hi + 1))) hi++;
    const column = tiles.filter((t) => t.i === core.i && t.j >= lo && t.j <= hi && (tops.get(tileKey(t.i, t.j)) ?? 0) > 0).sort((a, b) => a.v - b.v);
    for (const t of column) m.cover(t.u, t.v, 9);
    for (const [t, dir] of [[column[0]!, -1], [column.at(-1)!, 1]] as const) {
      const [x, z] = m.point(t.u, t.v + dir * bay / 2);
      m.entries.push({ x, y: m.base, z, yaw: m.frame.yaw, coreX: m.point(core.u, core.v)[0], coreZ: m.point(core.u, core.v)[1] });
      m.cover(t.u, t.v + dir * bay / 2, 16);
    }
  }
  if (rule.feature === "deco" && opts.detail === 0) {
    const t = [...tiles].sort((a, b) => a.v - b.v || Math.abs(a.u) - Math.abs(b.u))[0]!;
    const fin = height >= 8 ? 8 : 4;
    m.put(fin === 8 ? "fin8" : "fin4", t.u, base + fin / 2, t.v - bay / 2, rule.finish);
    if (height >= 12) m.put("crown", t.u, base + height - 2, t.v - bay / 2 + 1.5, rule.finish);
  }
}

export function tower(m: Mason, tiles: Tile[], rule: Rule, opts: LayoutOptions, twins = false): void {
  const bay = 8;
  const podium = tiles.length > 45 ? 8 : 0;
  const width = Math.min(40, m.frame.width * .7); const depth = Math.min(40, m.frame.depth * .7);
  const offsets = twins && m.frame.width > 64 ? [-m.frame.width * .24, m.frame.width * .24] : [0];
  const bodies = offsets.map((offset) => tiles.filter((t) => Math.abs(t.u - offset) < width / 2 && Math.abs(t.v) < depth / 2));
  const shaftTiles = new Set(bodies.flat());
  if (podium) stack(m, tiles.filter((t) => !shaftTiles.has(t)), bay, podium, { ...rule, holes: .12 }, { ...opts, playable: 2 });
  for (const selected of bodies) {
    const body = selected.length >= 3 ? selected : tiles;
    // Body and its core start at ground, so the podium never caps a staircase.
    stack(m, body, bay, rule.height, rule, opts);
  }
}

function arena(m: Mason, tiles: Tile[], rule: Rule, opts: LayoutOptions): void {
  const rx = m.frame.width / 2 - 8; const rz = m.frame.depth / 2 - 8;
  if (rx < 20 || rz < 20) { stack(m, tiles, 8, 12, rule, opts, 0, true); return; }
  const ring = tiles.filter((t) => (t.u / rx) ** 2 + (t.v / rz) ** 2 > .55);
  stack(m, ring, 8, 12, { ...rule, wall: .03, holes: .12 }, { ...opts, playable: 3 }, 0, true);
  const onRoute = (u: number, v: number): boolean => m.routes.some((r) => {
    const dx = r.x - m.frame.x; const dz = r.z - m.frame.z;
    return Math.hypot(u - (dx * m.frame.c - dz * m.frame.s), v - (dx * m.frame.s + dz * m.frame.c)) < 11;
  });
  const n = Math.floor(Math.PI * (rx + rz) / 8);
  for (let a = 0; a < n; a++) {
    const theta = a / n * Math.PI * 2;
    const turn = -Math.atan2(rz * Math.cos(theta), -rx * Math.sin(theta)) * 180 / Math.PI;
    // Four radial aisles through the seating; the missing roof exposes the bowl.
    if (a % Math.round(n / 4) < 2) continue;
    for (let row = 0; row < 10; row++) {
      const scale = .55 + row * .025;
      const u = Math.cos(theta) * rx * scale; const v = Math.sin(theta) * rz * scale;
      if (!onRoute(u, v)) m.put("seat", u, .4 + row * .4, v, "concrete", turn);
    }
    const u = Math.cos(theta) * rx * .9; const v = Math.sin(theta) * rz * .9;
    if (onRoute(u, v)) continue;
    const top = a > n * .58 && a < n * .8 ? Math.max(8, rule.height - 12) : rule.height;
    m.post(u, 0, v, top);
    m.put("trim8", u, top, v, "limestone", turn);
    if (a % 3 !== 0) m.put("wall8", u, top - 2, v, "limestone", turn);
  }
}

export function layout(m: Mason, rule: Rule, opts: LayoutOptions, special?: string): void {
  let bay = rule.bay;
  let tiles = tilesOf(m.frame, bay);
  if (bay === 4 && tiles.length * 16 > 6000 && m.frame.width > 64 && m.frame.depth > 48) { bay = 8; tiles = tilesOf(m.frame, bay); }
  if (bay === 8 && tiles.length < 3) { bay = 4; tiles = tilesOf(m.frame, bay); }
  if (tiles.length === 0) {
    if (m.frame.width >= 4 && m.frame.depth >= 1) {
      for (let u = -m.frame.width / 2 + 2; u <= m.frame.width / 2 - 2; u += 4) if ([-1.99, 0, 1.99].every((dx) => [-.24, .24].every((dz) => inside(m.frame, u + dx, dz)))) m.put("wall4", u, 1.4, 0, rule.finish);
    } else if (m.frame.width >= 2 && m.frame.depth >= 1.5 && [-.99, .99].every((u) => [-.74, .74].every((v) => inside(m.frame, u, v)))) m.put("rubble", 0, .35, 0);
    return;
  }
  if (special === "freedom") {
    const baseTiles = tilesOf(m.frame, 8);
    const shaft = baseTiles.filter((t) => Math.abs(t.u) <= 8 && Math.abs(t.v) <= 12);
    stack(m, baseTiles.filter((t) => !shaft.includes(t)), 8, 8, { ...rule, finish: "limestone", holes: .15 }, { ...opts, playable: 2 });
    const shaftHeight = Math.max(8, rule.height - 20);
    stack(m, shaft, 8, shaftHeight, { ...rule, finish: "limestone", holes: .08, wall: .55 }, { ...opts, playable: Math.max(8, opts.playable) });
    m.put("floor16", 0, shaftHeight, 0);
    for (const u of [-6, 6]) for (const v of [-6, 6]) m.put("crown", u, shaftHeight + 2, v, "limestone");
    for (const v of [-6, 6]) for (const u of [-4, 4]) m.put("trim8", u, shaftHeight + 4, v, "limestone");
    for (const u of [-4, 4]) for (const v of [-4, 4]) m.put("crown", u, shaftHeight + 6, v, "limestone");
    for (const u of [-2, 2]) for (const v of [-2, 2]) m.put("crown", u, shaftHeight + 10, v, "limestone");
    m.put("crown", 0, shaftHeight + 14, 0, "mint"); m.put("fin4", 0, shaftHeight + 18, 0, "limestone");
    return;
  }
  if (special === "arena" || rule.recipe === "arena") { arena(m, tilesOf(m.frame, 8), rule, opts); return; }
  if (special === "dupont") {
    const all = tilesOf(m.frame, 8);
    const shaft = all.filter((t) => Math.abs(t.u) < 32 && Math.abs(t.v) < 16);
    stack(m, all.filter((t) => !shaft.includes(t)), 8, 8, rule, { ...opts, playable: 2 });
    stack(m, shaft, 8, rule.height, { ...rule, wall: .6 }, opts);
    for (const t of shaft.filter((t) => t.j === Math.min(...shaft.map((a) => a.j)))) {
      for (let y = 0; y < rule.height; y += 16) m.put("fin16", t.u - 4, y + 8, t.v - 4, "limestone");
      m.put("trim8", t.u, rule.height, t.v - 4, "limestone");
    }
    return;
  }
  if (special === "loft") {
    const body = tilesOf(m.frame, 8).filter((t) => Math.abs(t.u) <= 20 && Math.abs(t.v) <= 20);
    stack(m, body, 8, rule.height, { ...rule, feature: "balconies" }, { ...opts, coreU: -16 });
    for (let i = m.pieces.length - 1; i >= 0; i--) {
      const p = m.pieces[i]!; const u = (p.x - m.frame.x) * m.frame.c - (p.z - m.frame.z) * m.frame.s;
      if (Math.abs(u) < 6 && p.y - m.base < 15.5) m.pieces.splice(i, 1);
    }
    for (const u of [-8, 8]) m.put("fin16", u, 8, -20, "clay");
    m.put("trim8", -4, 16, -20, "clay"); m.put("trim8", 4, 16, -20, "clay"); return;
  }
  if (special === "twins") { tower(m, tilesOf(m.frame, 8), rule, opts, true); return; }
  if (special === "ritz") {
    const all = tilesOf(m.frame, 8); const shaft = all.filter((t) => Math.abs(t.u) <= 12 && Math.abs(t.v) <= 12);
    stack(m, all.filter((t) => !shaft.includes(t)), 8, 8, rule, { ...opts, playable: 2 });
    stack(m, shaft, 8, Math.max(8, rule.height - 4), { ...rule, feature: "deco", wall: .6 }, opts);
    m.put("crown", 0, rule.height - 2, -8, "rose"); m.put("fin4", 0, rule.height - 2, -10, "limestone"); return;
  }
  if (rule.recipe === "tower" || (rule.recipe === "hotel" && rule.height > 32)) {
    tower(m, tilesOf(m.frame, 8), rule, opts);
    return;
  }
  if (rule.recipe === "park") {
    for (const t of tiles.filter((t) => hash3(t.i, t.j, opts.seed) % 31 === 0)) m.put("seat", t.u, .4, t.v);
    return;
  }
  if (rule.recipe === "monument") {
    m.put("plinth", 0, .5, 0); m.put("crown", 0, 3, 0, "limestone"); m.put("fin8", 0, 9, 0, "limestone"); return;
  }
  if (rule.recipe === "utility") {
    for (const t of tiles.filter((t) => t.i % 2 === 0 && t.j % 2 === 0)) {
      for (let k = 0; k < 8; k++) if (k !== 2) m.put("tank", t.u + Math.cos(k * Math.PI / 4) * 5, 2, t.v + Math.sin(k * Math.PI / 4) * 5, "concrete", -k * 45 + 90);
    }
    return;
  }
  if (!special && tiles.length * bay * bay > 6000 && m.frame.width > 64 && m.frame.depth > 48 && !["park", "utility"].includes(rule.recipe)) {
    const groups = new Map<string, Tile[]>();
    for (const t of tiles) {
      if (t.i % 7 === 6 || t.j % 7 === 6) continue;
      const k = `${Math.floor(t.i / 7)},${Math.floor(t.j / 7)}`;
      if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(t);
    }
    for (const [k, wing] of groups) {
      const [i, j] = k.split(",").map(Number); const factor = [.5, .75, 1][hash3(i!, j!, opts.seed) % 3]!;
      const height = Math.max(4, Math.floor(rule.height * factor / 4) * 4);
      stack(m, wing, bay, height, rule, opts, 0, ["shed", "hall"].includes(rule.recipe));
      m.wings.push({ tiles: wing.length, height, u: wing.reduce((n, t) => n + t.u, 0) / wing.length, v: wing.reduce((n, t) => n + t.v, 0) / wing.length });
    }
    return;
  }
  const hall = ["shed", "hall", "theatre", "service", "marina"].includes(rule.recipe);
  stack(m, tiles, bay, rule.height, rule, opts, 0, hall);
  if (special === "convention") {
    for (const t of tiles.filter((t) => t.j === Math.max(...tiles.map((a) => a.j)))) {
      for (let y = 0; y < rule.height; y += 4) m.put("fin4", t.u, y + 2, t.v + 4, "limestone");
      m.put("trim8", t.u, rule.height, t.v + 4, "blue");
    }
  }
  if (rule.recipe === "house") {
    for (const t of tiles.filter((t) => t.j % 2 === 0)) {
      if (rand3(opts.seed, t.i, t.j) > .65) continue;
      m.put("trim4", t.u, rule.height + .15, t.v, "clay");
      m.put("beam4", t.u, rule.height + .7, t.v + 1);
    }
  }
  if (["service", "civic", "school", "hospital", "shop"].includes(rule.recipe)) {
    const front = tiles.filter((t) => t.j === Math.min(...tiles.map((a) => a.j)));
    for (const t of front) m.put(bay === 8 ? "trim8" : "trim4", t.u, 3.2, t.v - bay / 2, rule.finish);
  }
}
