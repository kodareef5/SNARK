import { hash3 } from "./raster.ts";
import { inside, Mason, SIDES, tileKey, tilesOf, type Tile } from "./ruin-geometry.ts";
import type { Composition, Rule } from "./ruin-vocabulary.ts";

export interface LayoutOptions { seed: number; playable: number; detail: number; coreU?: number; }
const has = (tiles: Set<string>, t: Tile, dx: number, dz: number): boolean => tiles.has(tileKey(t.i + dx, t.j + dz));

// A layout composes an intact circulation path, structural frame, then the remnants around it.
export function stack(m: Mason, tiles: Tile[], bay: number, height: number, rule: Rule, opts: LayoutOptions, base = 0, openHall = false): void {
  if (!tiles.length || height < 4) return;
  const keys = new Set(tiles.map((t) => tileKey(t.i, t.j)));
  if (rule.collapse === "lost-top") height = Math.max(16, Math.floor(height * (rule.damage?.retain ?? .72) / 4) * 4);
  const floors = Math.round(height / 4); const playable = Math.min(floors, opts.playable);
  const candidates = bay === 8 ? tiles.filter((t) => has(keys, t, 0, 1) && has(keys, t, 0, -1)).sort((a, b) => (a.u - (opts.coreU ?? 0)) ** 2 + a.v ** 2 - (b.u - (opts.coreU ?? 0)) ** 2 - b.v ** 2) : [];
  const cores: Tile[] = candidates.length ? [candidates[0]!] : [];
  const wanted = Math.min(8, Math.max(1, Math.ceil(tiles.length * bay * bay / 3500)));
  while (cores.length < wanted) {
    const next = candidates.filter((t) => cores.every((c) => Math.hypot(c.u - t.u, c.v - t.v) >= 32)).sort((a, b) => Math.min(...cores.map((c) => Math.hypot(c.u - b.u, c.v - b.v))) - Math.min(...cores.map((c) => Math.hypot(c.u - a.u, c.v - a.v))))[0];
    if (!next) break; cores.push(next);
  }
  const escape = cores.map((c) => tiles.find((t) => Math.abs(t.u - c.u) === bay && t.v === c.v && has(keys, t, 0, 1) && has(keys, t, 0, -1) && !cores.includes(t))).filter((t): t is Tile => !!t);
  const entryCores = cores.length ? cores : [[...tiles].sort((a, b) => Math.abs(a.u) - Math.abs(b.u) || Math.abs(a.v) - Math.abs(b.v))[0]!];
  const entryLane = (t: Tile): boolean => entryCores.some((c) => t.i === c.i);
  const safe = (t: Tile): boolean => cores.some((c) => Math.abs(t.u - c.u) <= bay && Math.abs(t.v - c.v) <= bay) || entryLane(t);
  const form = rule.form ?? { shell: "masonry", inside: "suites", roof: "flat", front: "porch", windowEvery: 3 };
  const mode = rule.collapse ?? "shear";
  const minU = Math.min(...tiles.map((t) => t.u)); const maxU = Math.max(...tiles.map((t) => t.u));
  const minV = Math.min(...tiles.map((t) => t.v)); const maxV = Math.max(...tiles.map((t) => t.v));
  const cornerU = hash3(opts.seed, 7, 0) % 2 === 0 ? maxU : minU;
  const cornerV = hash3(opts.seed, 7, 1) % 2 === 0 ? maxV : minV;
  const radius = Math.max(bay * 1.1, Math.min(maxU - minU + bay, maxV - minV + bay) * (rule.damage?.radius ?? .44));
  const tops = new Map<string, number>(); const damaged = new Set<Tile>();
  for (const t of tiles) {
    const distance = Math.hypot(t.u - cornerU, t.v - cornerV);
    const broken = !safe(t) && distance < radius;
    let top = floors;
    if (broken) {
      damaged.add(t);
      if (mode === "shear") top = Math.max(0, Math.floor(floors * distance / radius));
      if (mode === "pancake" || mode === "facade") top = 0;
      if (mode === "lost-top") top = Math.max(1, Math.floor(floors * .55));
    }
    if (mode === "lost-top" && !safe(t)) top = Math.min(top, Math.max(playable, Math.floor(floors * .7)));
    tops.set(tileKey(t.i, t.j), top); m.cover(t.u, t.v, bay * .75);
  }
  // Merge only complete rectangles at the same level. Stair, escape and collapse holes remain holes.
  const plates = new Map<number, Tile[]>();
  for (const t of tiles) {
    const top = tops.get(tileKey(t.i, t.j))!;
    for (let level = 1; level <= top; level++) {
      if ((cores.includes(t) || escape.includes(t)) && level <= playable) continue;
      const roof = level === top; const supported = level <= playable || roof;
      if (!supported || openHall && !safe(t) && !roof) continue;
      if (damaged.has(t) && ["burnt", "hanging"].includes(mode) && !roof) continue;
      if (!plates.has(level)) plates.set(level, []); plates.get(level)!.push(t);
    }
  }
  for (const [level, row] of plates) mergeFloors(m, row, bay, base + level * 4);
  const posts = new Map<string, { u: number; v: number; top: number }>();
  for (const t of tiles) {
    const top = tops.get(tileKey(t.i, t.j))!; if (!top) continue;
    const burnt = damaged.has(t) && mode === "burnt";
    const edge = SIDES.some(([dx, dz]) => (tops.get(tileKey(t.i + dx, t.j + dz)) ?? 0) < top);
    // Walls carry the perimeter. Interior supports occur at 16 m, never every 4 m.
    if (burnt || !edge && t.i % 2 === 0 && t.j % 2 === 0) posts.set(tileKey(t.i, t.j), { u: t.u + bay / 2, v: t.v + bay / 2, top: Math.min(top, playable) });
    for (let side = 0; side < SIDES.length; side++) {
      const [dx, dz] = SIDES[side]!; const adjacent = tops.get(tileKey(t.i + dx, t.j + dz)) ?? 0;
      if (adjacent >= top || damaged.has(t) && mode === "hanging") continue;
      const u = t.u + dx * bay / 2; const v = t.v + dz * bay / 2; const turn = dx === 0 ? 0 : 90;
      for (let level = adjacent; level < top;) {
        const h = base + level * 4;
        const entry = level === 0 && (entryLane(t) || ["loading", "shopfront", "clock"].includes(form.front) && (t.i + t.j) % 2 === 0);
        const upper = level >= playable; const lookout = top > playable && level === playable;
        if (upper && bay === 8 && top - level >= 4 && !burnt && !lookout) {
          m.put("zshaft8", u, h + 8, v, form.shell === "curtain" ? (rule.infill ?? "blue") : rule.finish, turn); level += 4; continue;
        }
        const opening = lookout || form.shell === "open" || (t.i + t.j + side + level) % form.windowEvery === 0;
        if (burnt) {
          m.put(bay === 8 ? "beam8" : "beam4", u, h + 3.7, v, "concrete", turn);
          if (level === 0) m.put("fin4", u - dz * (bay / 2 - .4), h + 2, v + dx * (bay / 2 - .4), "steel");
        } else if (!entry && !opening && bay === 8) {
          m.put("zpanel8", u, h + 2, v, form.shell === "curtain" && level > 0 ? (rule.infill ?? "blue") : rule.finish, turn);
        } else {
          m.put(bay === 8 ? "beam8" : "beam4", u, h + 3.7, v, "concrete", turn);
          if (!entry) {
            m.put(bay === 8 ? "sill8" : "sill4", u, h + .45, v, rule.finish, turn);
            if (!opening) m.put("wall4", u, h + 1.4, v, rule.finish, turn);
          }
          if ((t.i + t.j + side) % 2 === 0 || entry) m.put("fin4", u - dz * (bay / 2 - .4), h + 2, v + dx * (bay / 2 - .4), rule.finish, turn);
        }
        if (!upper && !burnt && (form.front === "balconies" || form.front === "deco") && bay === 8 && level % 2 === 1) m.put("trim8", u + dx * .6, h + 3.2, v + dz * .6, rule.finish, turn);
        if (!upper && !burnt && bay === 8 && level > 0 && form.front === "balconies") {
          m.put("zbalcony", u + dx * 1, h - .2, v + dz * 1, rule.finish, turn);
          m.put("sill8", u + dx * 1.8, h + .45, v + dz * 1.8, rule.finish, turn);
        }
        if (side === 0 && level === 0 && form.front === "shopfront") assembly(m, rule, "shopfront", u, 0, v);
        level++;
      }
    }
    if (opts.detail < 2 && !cores.includes(t) && !escape.includes(t) && !entryLane(t) && !damaged.has(t)) {
      const neighbour = entryCores.find((c) => Math.abs(c.i - t.i) === 1 && c.j !== t.j && !cores.concat(escape).some((other) => other.i === c.i && other.j === t.j) && Array.from({ length: Math.abs(c.j - t.j) + 1 }, (_, i) => keys.has(tileKey(c.i, Math.min(c.j, t.j) + i))).every(Boolean));
      if (neighbour && bay === 8) interior(m, t, neighbour.u < t.u ? -1 : 1, openHall ? 1 : Math.min(top, playable), base, form.inside, rule);
      else if (base === 0 && (t.i + t.j) % 3 === 0 && !safe(t)) {
        const cover = form.inside === "storage" ? "zcore" : "zcover";
        m.put(cover, t.u, cover === "zcore" ? 2 : .55, t.v, form.inside === "storage" ? "rust" : rule.finish);
      }
    }
  }
  for (const p of posts.values()) m.post(p.u, base, p.v, p.top * 4);
  if (base === 0) for (const core of cores) { m.stairs(core, playable); const drop = escape.find((t) => Math.abs(t.u - core.u) === bay && t.v === core.v); if (drop) m.escape(drop, playable, core); }
  if (base === 0) for (const core of entryCores) {
    let lo = core.j; let hi = core.j;
    while (keys.has(tileKey(core.i, lo - 1))) lo--; while (keys.has(tileKey(core.i, hi + 1))) hi++;
    const column = tiles.filter((t) => t.i === core.i && t.j >= lo && t.j <= hi).sort((a, b) => a.v - b.v);
    for (const t of column) m.cover(t.u, t.v, 9);
    for (const [t, dir] of [[column[0]!, -1], [column.at(-1)!, 1]] as const) {
      const [x, z] = m.point(t.u, t.v + dir * bay / 2); const [coreX, coreZ] = m.point(core.u, core.v);
      m.entries.push({ x, y: m.base, z, yaw: m.frame.yaw, coreX, coreZ }); m.cover(t.u, t.v + dir * bay / 2, 16);
      if (dir < 0 && bay === 8) assembly(m, rule, form.front, t.u, 0, t.v - bay / 2);
    }
  }
  const cap = tiles.filter((t) => (tops.get(tileKey(t.i, t.j)) ?? 0) === floors && !cores.includes(t) && !escape.includes(t) && !entryLane(t));
  if (cap.length && opts.detail < 2) {
    const t = cap[Math.floor(cap.length / 2)]!;
    if (form.roof === "service") m.put("zcore", t.u, base + height + 2, t.v, "steel");
    if (form.roof === "hip") for (const r of cap.filter((r) => r.i % 2 === 0)) { m.put("zroof8", r.u, base + height + .5, r.v, "clay"); m.put("zroof8", r.u, base + height + 1.5, r.v, "clay", 90); }
    if (form.roof === "monitor" || form.roof === "nave") for (const r of cap.filter((r) => r.i % 2 === 0 && r.j === t.j)) { m.put("zpanel8", r.u, base + height + 2, r.v, "steel"); m.put("zroof8", r.u, base + height + 4.5, r.v, "rust"); }
    if (form.front === "belfry") { m.put("zcore", t.u, base + height + 2, t.v, rule.finish); m.put("fin8", t.u, base + height + 8, t.v, rule.finish); m.put("trim4", t.u, base + height + 10, t.v, rule.finish); }
  }
  if ((rule.feature === "deco" || form.front === "deco") && opts.detail === 0) {
    const t = [...tiles].sort((a, b) => a.v - b.v || Math.abs(a.u) - Math.abs(b.u))[0]!;
    m.put(height >= 8 ? "fin8" : "fin4", t.u, base + Math.min(8, height) / 2, t.v - bay / 2, rule.finish);
    if (height >= 12) m.put("crown", t.u, base + height - 2, t.v - bay / 2 - 2.5, rule.finish);
  }
  if (mode === "lost-top") for (const t of cap.filter((t) => (t.i + t.j) % 4 === 0).slice(0, 6)) {
    m.put("fin4", t.u, base + height + 2, t.v, "steel"); m.put("rubble4", t.u + 1.5, base + height + .55, t.v, "concrete", 19);
  }
  for (const t of [...damaged].filter((t) => !entryLane(t))) collapse(m, t, mode, height, rule, opts, base);
}

function mergeFloors(m: Mason, tiles: Tile[], bay: number, y: number): void {
  const left = new Map(tiles.map((t) => [tileKey(t.i, t.j), t]));
  for (const t of tiles) {
    if (!left.has(tileKey(t.i, t.j))) continue;
    let cells = 1;
    for (const n of bay === 4 ? [4, 2] : [2]) if (Array.from({ length: n * n }, (_, k) => left.has(tileKey(t.i + k % n, t.j + Math.floor(k / n)))).every(Boolean)) { cells = n; break; }
    m.floor([t.u + (cells - 1) * bay / 2, t.v + (cells - 1) * bay / 2], y, bay * cells);
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) left.delete(tileKey(t.i + i, t.j + j));
  }
}

export function assembly(m: Mason, rule: Rule, name: string, u: number, y: number, v: number): void {
  for (const [shape, du, dy, dv, finish, turn] of rule.assemblies?.[name]?.parts ?? []) m.put(shape, u + du, y + dy, v + dv, finish === "finish" ? rule.finish : finish, turn ?? 0);
}

function interior(m: Mason, t: Tile, dir: number, floors: number, base: number, kind: string, rule: Rule): void {
  if (["parking", "nave", "concourse"].includes(kind)) {
    m.put("zcover", t.u, base + .55, t.v + 1.5, kind === "parking" ? "concrete" : rule.finish); return;
  }
  m.floor([t.u, t.v], base, 8); m.floor([t.u + dir * 8, t.v], base, 8);
  for (let level = 0; level < floors; level++) {
    const y = base + level * 4;
    // Two doors at either end of a four-metre partition open onto the protected corridor.
    m.put("wall4", t.u + dir * 4, y + 1.4, t.v, rule.finish, 90);
    m.put("wall8", t.u, y + 1.4, t.v + 4, rule.finish);
    if (kind === "rooms" || kind === "wards" || kind === "domestic") m.put("zbed", t.u - dir * 2, y + .25, t.v + 1, "steel");
    else if (kind === "storage") m.put("zcore", t.u - dir * 2, y + 2, t.v + 1.5, "rust");
    else m.put("zcounter", t.u - dir * 1.5, y + .5, t.v + 1, rule.finish);
    if (level === 0 || level === floors - 1) {
      const points = [[t.u + dir * 4.8, t.v - 2.9], [t.u + dir * 2, t.v - 2.9], [t.u + dir * 2, t.v + 2.9], [t.u + dir * 4.8, t.v + 2.9], [t.u + dir * 4.8, t.v - 2.9]].map(([u, v]) => { const [x, z] = m.point(u!, v!); return { x, y: m.base + y, z }; });
      m.rooms.push({ kind, points });
    }
  }
}

function collapse(m: Mason, t: Tile, mode: string, height: number, rule: Rule, opts: LayoutOptions, base: number): void {
  m.falls.push({ mode, u: t.u, v: t.v });
  if (base !== 0 || opts.detail > 1) return;
  if (mode === "facade") { m.put("zpanel8", t.u, 2, t.v + 3.5, rule.finish); if (height >= 8) m.put("zpanel8", t.u, 6, t.v + 3.5, rule.finish); }
  if (mode === "pancake") for (let n = 0; n < (rule.damage?.layers ?? 3); n++) m.put("floor8", t.u + (n % 2) * .5, .3 + n * .6, t.v, "concrete", n * 7);
  else if (mode === "hanging") { m.put("floor8", t.u + 1, height - .2, t.v, "concrete", 12); m.put("rubble4", t.u, .55, t.v + 1, "concrete", 21); }
  else if (mode !== "burnt") {
    m.put("rubble4", t.u, .55, t.v + 1, "concrete", 21); m.put("rubble", t.u - 2, .35, t.v - 1, "concrete", 63);
    if (mode === "shear" && hash3(t.i, t.j, opts.seed) % 3 === 0) {
      const points = [[-3, 0, -3], [-2, .7, -1], [0, 1.1, 1], [2.5, 0, -2.5]].map(([u, y, v]) => { const [x, z] = m.point(t.u + u!, t.v + v!); return { x, y: m.base + y!, z }; });
      m.rooms.push({ kind: "rubble", points });
    }
  }
}

export function tower(m: Mason, tiles: Tile[], rule: Rule, opts: LayoutOptions, twins = false): void {
  const bay = 8;
  const podium = tiles.length > 45 ? 8 : 0;
  const width = Math.min(40, m.frame.width * .7); const depth = Math.min(40, m.frame.depth * .7);
  const offsets = twins && m.frame.width > 64 ? [-m.frame.width * .24, m.frame.width * .24] : [0];
  const bodies = offsets.map((offset) => { const selected = tiles.filter((t) => Math.abs(t.u - offset) < width / 2 && Math.abs(t.v) < depth / 2); return selected.length >= 3 ? selected : tiles; });
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
  if (special && rule.compositions?.[special]) { compose(m, tilesOf(m.frame, 8), rule, opts, rule.compositions[special]!); return; }
  if (rule.recipe === "arena") { arena(m, tilesOf(m.frame, 8), rule, opts); return; }
  if (!special && rule.form?.plan && ["court", "wards"].includes(rule.form.plan) && tiles.length >= 12 && bay === 8 && rule.height <= 36) {
    const lo = Math.min(...tiles.map((t) => t.i)); const hi = Math.max(...tiles.map((t) => t.i));
    const back = Math.max(...tiles.map((t) => t.j)); const front = Math.min(...tiles.map((t) => t.j)); const mid = (front + back) / 2;
    const left = tiles.filter((t) => t.i < lo + 2); const right = tiles.filter((t) => t.i > hi - 2 && !left.includes(t));
    const cross = tiles.filter((t) => !left.includes(t) && !right.includes(t) && (rule.form!.plan === "court" ? t.j >= back - 1 : Math.abs(t.j - mid) <= .5));
    for (const [index, wing] of [left, right, cross].entries()) {
      const height = index === 2 ? Math.min(8, rule.height) : rule.height;
      stack(m, wing, bay, height, rule, opts); if (wing.length) m.wings.push({ tiles: wing.length, height, u: wing[0]!.u, v: wing[0]!.v });
    }
    return;
  }
  if (!special && rule.form?.plan === "platform" && rule.height <= 36) {
    const middle = (Math.min(...tiles.map((t) => t.j)) + Math.max(...tiles.map((t) => t.j))) / 2;
    const concourse = tiles.filter((t) => Math.abs(t.j - middle) <= 1);
    stack(m, concourse, bay, Math.min(8, rule.height), { ...rule, form: { ...rule.form, shell: "open" } }, opts, 0, true);
    for (const t of concourse.filter((t) => t.i % 2 === 0 && t.j === Math.floor(middle))) m.put("zroof16", t.u, Math.min(8, rule.height) + .5, t.v, "steel");
    return;
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
    const loI = Math.min(...tiles.map((t) => t.i)); const hiI = Math.max(...tiles.map((t) => t.i));
    const loJ = Math.min(...tiles.map((t) => t.j)); const hiJ = Math.max(...tiles.map((t) => t.j));
    const middle = Math.round((loI + hiI) / 2);
    for (const t of tiles) {
      let k = "";
      if (t.j <= loJ + 2) k = t.i < middle ? "0,0" : "1,0";
      else if (t.j >= hiJ - 2) k = t.i < middle - 1 ? "0,1" : "1,1";
      else if (t.i <= loI + 2) k = "2,0";
      else if (t.i >= hiI - 2) k = "2,1";
      else if (Math.abs(t.i - middle) <= 1 && t.j < (loJ + hiJ) / 2) k = "3,0";
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(t);
    }
    for (const [k, wing] of groups) {
      const [i, j] = k.split(",").map(Number); const factor = [.5, .75, 1][(i! + j! * 2 + opts.seed) % 3]!;
      const height = Math.max(4, Math.floor(rule.height * factor / 4) * 4);
      stack(m, wing, bay, height, rule, opts, 0, ["shed", "hall"].includes(rule.recipe));
      m.wings.push({ tiles: wing.length, height, u: wing.reduce((n, t) => n + t.u, 0) / wing.length, v: wing.reduce((n, t) => n + t.v, 0) / wing.length });
    }
    return;
  }
  const hall = ["shed", "hall", "theatre", "service", "marina"].includes(rule.recipe);
  stack(m, tiles, bay, rule.height, rule, opts, 0, hall);
  if (["service", "civic", "school", "hospital", "shop"].includes(rule.recipe)) {
    const front = tiles.filter((t) => t.j === Math.min(...tiles.map((a) => a.j)));
    for (const t of front) m.put(bay === 8 ? "trim8" : "trim4", t.u, 3.2, t.v - bay / 2, rule.finish);
  }
}

function compose(m: Mason, tiles: Tile[], rule: Rule, opts: LayoutOptions, composition: Composition): void {
  const inRect = (t: Tile, rect: number[]): boolean => t.u >= rect[0]! && t.v >= rect[1]! && t.u <= rect[2]! && t.v <= rect[3]!;
  for (const op of composition.operations) {
    const selected = tiles.filter((t) => (!op.rect || inRect(t, op.rect)) && (!op.exclude || !inRect(t, op.exclude)));
    if (op.op === "stack") stack(m, selected, 8, Math.max(4, (op.height ?? rule.height) + (op.offset ?? 0)), { ...rule, feature: op.feature ?? rule.feature }, { ...opts, playable: op.playable ?? opts.playable, coreU: op.coreU }, 0, op.hall);
    if (op.op === "tower") tower(m, tiles, rule, opts);
    if (op.op === "arena") arena(m, tiles, rule, opts);
    if (op.op === "parts" || op.op === "front") {
      const front = op.op === "front" ? Math.min(...tiles.map((t) => t.v)) - 4 : 0;
      for (const [shape, u, y, v, finish, turn] of op.parts ?? []) m.put(shape, u, y + (op.fromTop ? rule.height : 0), v + front, finish === "finish" ? rule.finish : finish, turn ?? 0);
    }
    if (op.op === "ribs") {
      const edge = (op.rear ? Math.max : Math.min)(...selected.map((t) => t.j));
      for (const t of selected.filter((t) => t.j === edge)) {
        for (let y = 0; y < rule.height; y += 16) m.put("fin16", t.u - 4, y + 8, t.v + (op.rear ? 4 : -4), op.finish ?? rule.finish);
        m.put("trim8", t.u, rule.height, t.v + (op.rear ? 4 : -4), op.finish ?? rule.finish);
      }
    }
    if (op.op === "portal") for (let i = m.pieces.length - 1; i >= 0; i--) {
      const p = m.pieces[i]!; const u = (p.x - m.frame.x) * m.frame.c - (p.z - m.frame.z) * m.frame.s;
      if (Math.abs(u) < (op.width ?? 12) / 2 && p.y - m.base < (op.height ?? 16) - .5) m.pieces.splice(i, 1);
    }
  }
}
