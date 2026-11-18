import { hash3 } from "./raster.ts";
import { BREAK_AT, FACADE_AT, RUIN_SHAPES, type FacadeModule, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import { inside, Mason, SIDES, tileKey, tilesOf, type Tile } from "./ruin-geometry.ts";
import type { Composition, Round, Rule, Vocabulary } from "./ruin-vocabulary.ts";

export interface LayoutOptions { seed: number; playable: number; detail: number; coreU?: number; }
type Op = Composition["operations"][number];
const has = (tiles: Set<string>, t: Tile, dx: number, dz: number): boolean => tiles.has(tileKey(t.i + dx, t.j + dz));

// A layout composes an intact circulation path, structural frame, then the remnants around it.
export function stack(m: Mason, tiles: Tile[], bay: number, height: number, rule: Rule, opts: LayoutOptions, base = 0, openHall = false): void {
  if (!tiles.length || height < 4) return;
  const keys = new Set(tiles.map((t) => tileKey(t.i, t.j))); const byKey = new Map(tiles.map((t) => [tileKey(t.i, t.j), t]));
  if (rule.collapse === "lost-top") height = Math.max(16, Math.floor(height * (rule.damage?.retain ?? .72) / 4) * 4);
  const floors = Math.round(height / 4); let playable = Math.min(floors, opts.playable);
  const candidates = bay === 8 ? tiles.filter((t) => has(keys, t, 0, 1) && has(keys, t, 0, -1)).sort((a, b) => (a.u - (opts.coreU ?? 0)) ** 2 + a.v ** 2 - (b.u - (opts.coreU ?? 0)) ** 2 - b.v ** 2) : [];
  const cores: Tile[] = candidates.length ? [candidates[0]!] : [];
  const wanted = Math.min(8, Math.max(1, Math.ceil(tiles.length * bay * bay / 3500)));
  while (cores.length < wanted) {
    const next = candidates.filter((t) => cores.every((c) => Math.hypot(c.u - t.u, c.v - t.v) >= 32)).sort((a, b) => Math.min(...cores.map((c) => Math.hypot(c.u - b.u, c.v - b.v))) - Math.min(...cores.map((c) => Math.hypot(c.u - a.u, c.v - a.v))))[0];
    if (!next) break; cores.push(next);
  }
  const escape = cores.map((c) => tiles.find((t) => Math.abs(t.u - c.u) === bay && t.v === c.v && has(keys, t, 0, 1) && has(keys, t, 0, -1) && !cores.includes(t))).filter((t): t is Tile => !!t);
  if (escape.length < cores.length) playable = Math.min(playable, 8);
  const entryCores = cores.length ? cores : [[...tiles].sort((a, b) => Math.abs(a.u) - Math.abs(b.u) || Math.abs(a.v) - Math.abs(b.v))[0]!];
  const entryLane = (t: Tile): boolean => entryCores.some((c) => t.i === c.i);
  const safe = (t: Tile): boolean => cores.some((c) => Math.abs(t.u - c.u) <= bay && Math.abs(t.v - c.v) <= bay) || entryLane(t);
  const form = rule.form ?? { shell: "masonry", inside: "suites", roof: "flat", front: "porch", windowEvery: 3 };
  const mode = rule.collapse ?? "shear";
  const minU = Math.min(...tiles.map((t) => t.u)); const maxU = Math.max(...tiles.map((t) => t.u));
  const minV = Math.min(...tiles.map((t) => t.v)); const maxV = Math.max(...tiles.map((t) => t.v));
  const wind = rule.event?.travel;
  const cornerU = wind ? (wind[0] * m.frame.c - wind[1] * m.frame.s > 0 ? minU : maxU) : hash3(opts.seed, 7, 0) % 2 === 0 ? maxU : minU;
  const cornerV = wind ? (wind[0] * m.frame.s + wind[1] * m.frame.c > 0 ? minV : maxV) : hash3(opts.seed, 7, 1) % 2 === 0 ? maxV : minV;
  const radius = Math.max(bay * 1.1, Math.min(maxU - minU + bay, maxV - minV + bay) * (rule.damage?.radius ?? .44));
  const tops = new Map<string, number>(); const damaged = new Set<Tile>();
  for (const t of tiles) {
    const distance = Math.hypot(t.u - cornerU, t.v - cornerV);
    const broken = !safe(t) && distance < radius;
    let top = floors;
    if (form.terrace && floors > 2 && !safe(t) && (t.u === minU || t.u === maxU)) top = Math.max(1, floors - form.terrace);
    if (form.setbacks && floors > 3 && !safe(t)) top = Math.max(2, floors - Math.ceil(Math.abs(t.u) / Math.max(8, maxU) * form.setbacks));
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
  /** Whether tile `t`, standing `top` storeys, has a floor slab at `level`. */
  const slab = (t: Tile, level: number, top: number): boolean => {
    if ((cores.includes(t) || escape.includes(t)) && level <= playable) return false;
    const roof = level === top;
    return (level <= playable || roof) && !(openHall && !safe(t) && !roof) && !(damaged.has(t) && ["burnt", "hanging"].includes(mode) && !roof);
  };
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
      // A wall onto the street or a setback wears its kind's modules; one onto a fallen bay is its broken inside.
      const beside = byKey.get(tileKey(t.i + dx, t.j + dz));
      const broken = !!beside && damaged.has(beside);
      const grammar = bay === 8 && !burnt ? form.facade : undefined;
      // A slab of flats has blank short ends; a tower has flats on every side.
      const end = grammar?.ends && dx !== 0 && m.frame.width >= 1.5 * m.frame.depth && rule.recipe !== "tower";
      const capped = !damaged.has(t) && mode !== "lost-top";
      const nearFall = SIDES.some(([a, b]) => { const n = byKey.get(tileKey(t.i + a, t.j + b)); return !!n && damaged.has(n); });
      // Where the bay beside fell, this bay's slabs end at the break, whole, spalled or snapped, open to the gap; walls
      // stand only above the playable floors.
      let from = adjacent;
      if (broken && !damaged.has(t) && !burnt && bay === 8 && opts.detail < 2) {
        for (let level = adjacent + 1; level <= Math.min(top, playable); level++) {
          if (!slab(t, level, top)) continue;
          const pick = hash3(opts.seed + 211, t.i * 4 + side, t.j * 64 + level) % 20;
          const end = pick < 8 ? "zendsnap" : pick < 13 ? "zendspall" : pick < 16 ? "zendwhole" : "zendsag";
          facade(m, end, u, base + level * 4, v, side, "fracture");
          // A vine hangs from one whole or spalled end in three.
          if ((end === "zendwhole" || end === "zendspall") && pick % 3 === 0) facade(m, "zvine", u, base + level * 4 - 0.1, v, side, "concrete", end === "zendwhole" ? 0.2 : 0.1);
        }
        from = Math.max(adjacent, playable);
      }
      // What fell lies heaped against the wall it fell from.
      if (broken && adjacent === 0 && !damaged.has(t) && bay === 8 && opts.detail < 2 && mode !== "burnt") facade(m, "zwedge", u, base, v, side, "concrete");
      for (let level = from; level < top;) {
        const h = base + level * 4;
        const entry = level === 0 && (entryLane(t) || ["loading", "shopfront", "clock"].includes(form.front) && (t.i + t.j) % 2 === 0);
        const upper = level >= playable; const lookout = top > playable && level === playable;
        const party = rule.party?.includes(side) && adjacent === 0;
        // Onto a fallen bay the playable floors' walls are its broken inside; the storeys above wear the facade's.
        if (grammar && !party && !lookout && !(broken && level < playable)) {
          const last = capped && level === top - 1;
          if (upper && top - level >= 4) {
            const lid = capped && level + 4 === top;
            facade(m, end ? (lid ? "zshafttop" : "zshaft8") : lid ? grammar.stackTop : grammar.stack, u, h, v, side, rule.finish);
            level += 4; continue;
          }
          // A shop's front has its own door; any other ground floor keeps an open bay where the way in is.
          const open = grammar.ground === "zstore";
          const shut = grammar.shutter && !entry && hash3(opts.seed + 57, t.i * 4 + side, t.j) % 4 === 0 ? grammar.shutter : grammar.ground;
          // Beside a failure, a balcony's solid front may have fallen to its rail.
          const railed = grammar.floor === "zbalc" && nearFall && hash3(opts.seed + 83, t.i * 4 + side, t.j * 64 + level) % 3 === 0;
          const name = end ? (level === 0 && entry ? null : last ? "zpaneltop" : "zpanel8")
            : level === 0 ? (entry && !open ? grammar.gate ?? null : last ? grammar.groundTop ?? shut : shut)
            : last ? grammar.top : railed ? "zbalcrail" : grammar.floor;
          if (name) {
            facade(m, name, u, h, v, side, rule.finish);
            // Beside a failure a vine hangs from one balcony in three.
            if (nearFall && (name === "zbalc" || name === "zbalcrail") && hash3(opts.seed + 89, t.i * 4 + side, t.j * 64 + level) % 3 === 0) facade(m, "zvine", u, h, v, side, "concrete", 2);
            if (level === 0 && last && !end && !grammar.groundTop) facade(m, "zparapet8", u, h + 4, v, side, rule.finish);
            level++; continue;
          }
        }
        if (upper && bay === 8 && top - level >= 4 && !burnt && !lookout) {
          m.put("zshaft8", u, h + 8, v, form.shell === "curtain" ? (rule.infill ?? "blue") : rule.finish, turn); level += 4; continue;
        }
        // A lobby's way in has its frame, step and canopy.
        if (grammar?.ground === "zlobby" && level === 0 && entry && !broken && !party) facade(m, "zentry", u, h, v, side, rule.finish);
        const opening = !party && (lookout || form.shell === "open" || (t.i + t.j + side + level) % form.windowEvery === 0);
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
        if (!form.facade && !upper && !burnt && (form.front === "balconies" || form.front === "deco") && bay === 8 && level % 2 === 1) m.put("trim8", u + dx * .6, h + 3.2, v + dz * .6, rule.finish, turn);
        if (!form.facade && !upper && !burnt && !party && bay === 8 && level > 0 && form.front === "balconies") {
          m.put("zbalcony", u + dx * 1, h - .2, v + dz * 1, rule.finish, turn);
          m.put("sill8", u + dx * 1.8, h + .45, v + dz * 1.8, rule.finish, turn);
        }
        if (!form.facade && side === 0 && level === 0 && form.front === "shopfront") assembly(m, rule, "shopfront", u, 0, v);
        level++;
      }
      const party = rule.party?.includes(side) && adjacent === 0;
      if (bay !== 8 || opts.detail >= 2 || burnt || party || top === 0) continue;
      // Where the storey above broke away the wall's top is broken too, stepping, sloping or notched.
      if (!capped && !safe(t) && mode !== "hanging") facade(m, `zcrown${1 + hash3(opts.seed + 97, t.i * 4 + side, t.j) % 4}` as RuinShape, u, base + top * 4, v, side, rule.finish);
      // What fell from a wall lies along its foot: one bay in four, one in two beside a failure; never at a way in.
      const doorway = entryLane(t) || ["loading", "shopfront", "clock"].includes(form.front) || grammar?.ground === "zstore" && !nearFall;
      const fell = hash3(opts.seed + 101, t.i * 4 + side, t.j) % 8;
      if (adjacent === 0 && !broken && !doorway && fell < (nearFall ? 4 : 2)) facade(m, fell % 2 ? "zskirt1" : "zskirt2", u, base, v, side, "concrete");
    }
    // A tuft has rooted on one broken roof in ten.
    if ((damaged.has(t) || mode === "lost-top") && !safe(t) && top > 0 && bay === 8 && opts.detail < 2 && hash3(opts.seed + 103, t.i, t.j) % 10 === 0) {
      m.put("zshrub", t.u + (t.i % 2 ? 2 : -2), base + top * 4 + 0.62, t.v + (t.j % 2 ? 2 : -2), "concrete", hash3(t.i, t.j, 3) % 360);
    }
    // A garage's ramp runs along its front behind every third bay, a storey's worth of them seen through the open decks.
    if (form.inside === "parking" && bay === 8 && t.v === minV && t.i % 3 === 1 && !safe(t) && !damaged.has(t) && opts.detail < 2) {
      for (let level = 0; level < Math.min(top, playable); level++) m.put("zdeckramp", t.u, base + level * 4 + .85, t.v - 1.5, "concrete", 90);
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
  if (base === 0) for (const core of cores) {
    m.stairs(core, playable);
    const drop = escape.find((t) => Math.abs(t.u - core.u) === bay && t.v === core.v);
    if (drop && playable >= 12) {
      m.stairExit(drop, playable, core);
      const dir = playable % 2 === 0 ? -1 : 1; const y = playable * 4;
      const gallery = tiles.find((t) => t.i === core.i && t.j === core.j + dir)!;
      m.put("zbed", gallery.u + 2.8, y + .25, gallery.v + dir * 1.5, rule.finish);
      m.put("zcover", gallery.u + 2.8, y + .55, gallery.v - dir * 1.5, rule.finish, 90);
      m.put("zpartition", gallery.u + 4, y + 1.4, gallery.v, rule.finish, 90);
      m.put("zroof8", gallery.u, y + 3.5, gallery.v, rule.finish);
      const points = [[core.u - 1.5, core.v + dir * 3.25], [core.u - 1.5, core.v + dir * 5.5], [gallery.u, gallery.v], [drop.u - 1.5, drop.v + dir * 5.5], [drop.u - 1.5, drop.v + dir * 3.25]];
      const route = points.concat([...points].reverse()).map(([u, v]) => { const [x, z] = m.point(u!, v!); return { x, y: m.base + y, z }; });
      m.rooms.push({ kind: "refuge", points: route });
    } else if (drop) m.stairExit(drop, playable, core);
  }
  if (base === 0) for (const core of entryCores) {
    let lo = core.j; let hi = core.j;
    while (keys.has(tileKey(core.i, lo - 1))) lo--; while (keys.has(tileKey(core.i, hi + 1))) hi++;
    const column = tiles.filter((t) => t.i === core.i && t.j >= lo && t.j <= hi).sort((a, b) => a.v - b.v);
    for (const t of column) m.cover(t.u, t.v, 9);
    for (const [t, dir] of [[column[0]!, -1], [column.at(-1)!, 1]] as const) {
      const [x, z] = m.point(t.u, t.v + dir * bay / 2); const [coreX, coreZ] = m.point(core.u, core.v);
      m.entries.push({ x, y: m.base, z, yaw: m.frame.yaw, coreX, coreZ }); m.cover(t.u, t.v + dir * bay / 2, 16);
      // A shop's front module is its own way in, sign band and door.
      if (dir < 0 && bay === 8 && form.facade?.ground !== "zstore") assembly(m, rule, form.front, t.u, 0, t.v - bay / 2);
    }
  }
  if (base === 0) for (const core of cores) for (const row of [-1, 1]) {
    const gallery = tiles.find((t) => t.i === core.i && t.j === core.j + row); if (!gallery) continue;
    let lo = core.i; let hi = core.i;
    while (keys.has(tileKey(lo - 1, gallery.j))) lo--; while (keys.has(tileKey(hi + 1, gallery.j))) hi++;
    const path = [[gallery.u, gallery.v], [core.u, core.v - 3.25], [core.u - 1.5, core.v - 3.25], [core.u, core.v - 3.25], [gallery.u, gallery.v]].map(([u, v]) => { const [x, z] = m.point(u!, v!); return { x, y: m.base, z }; });
    for (const [edge, dir] of [[lo, -1], [hi, 1]]) {
      const tile = tiles.find((t) => t.i === edge && t.j === gallery.j)!;
      const [x, z] = m.point(tile.u + dir! * bay / 2, tile.v); const [coreX, coreZ] = m.point(gallery.u, gallery.v);
      m.alternatives.push({ entry: { x, y: m.base, z, yaw: m.frame.yaw + 90, coreX, coreZ, crossing: true }, support: [gallery.u, gallery.v], path });
    }
  }
  const cap = tiles.filter((t) => (tops.get(tileKey(t.i, t.j)) ?? 0) === floors && !cores.includes(t) && !escape.includes(t));
  if (cap.length && opts.detail < 2) {
    const t = cap[Math.floor(cap.length / 2)]!;
    if (form.marker) {
      const front = [...cap].sort((a, b) => a.v - b.v || Math.abs(a.u) - Math.abs(b.u))[0]!;
      assembly(m, rule, form.marker, front.u, base + height, front.v);
    }
    if (form.roof === "service") m.put("zcore", t.u, base + height + 2, t.v, "steel");
    if (form.roof === "hip" || form.roof === "pitched") pitched(m, cap, bay, base + height);
    if (form.roof === "monitor" || form.roof === "nave") for (const r of cap.filter((r) => r.i % 2 === 0 && r.j === t.j)) { m.put("zpanel8", r.u, base + height + 2, r.v, "steel"); m.put("zpitch8", r.u, base + height + 5.4, r.v, form.roof === "nave" ? "clay" : "rust"); }
    if (form.front === "belfry") { m.put("zcore", t.u, base + height + 2, t.v, rule.finish); m.put("fin8", t.u, base + height + 8, t.v, rule.finish); m.put("trim4", t.u, base + height + 10, t.v, rule.finish); }
    if (height <= 20 && !["hip", "pitched", "nave"].includes(form.roof) && hash3(opts.seed, 32, 1) / 4294967296 < (rule.roofGrowth ?? 0)) {
      m.put("zcover", t.u, base + height + .55, t.v, "clay");
      m.put("zshrub", t.u, base + height + 1.1, t.v, "concrete", 13);
      if (hash3(opts.seed, 32, 2) % 3 === 0) m.put("zshrub", t.u + 2, base + height + .62, t.v + 2);
      m.put("rubble", t.u + 2, base + height + .35, t.v + 2);
    }
  }
  if ((rule.feature === "deco" || form.front === "deco") && opts.detail === 0) {
    const t = [...tiles].sort((a, b) => a.v - b.v || Math.abs(a.u) - Math.abs(b.u))[0]!;
    m.put(height >= 8 ? "fin8" : "fin4", t.u, base + Math.min(8, height) / 2, t.v - bay / 2, rule.finish);
    if (height >= 12) m.put("crown", t.u, base + height - 2, t.v - bay / 2 - 2.5, rule.finish);
  }
  if (mode === "lost-top") for (const t of cap.filter((t) => (t.i + t.j) % 4 === 0).slice(0, 6)) {
    m.put("fin4", t.u, base + height + 2, t.v, "steel"); m.put("rubble4", t.u + 1.5, base + height + .55, t.v, "concrete", 19);
  }
  for (const t of [...damaged].filter((t) => !entryLane(t))) collapse(m, t, mode, height, rule, opts, base, bay, !has(keys, t, 0, -1) ? -1 : !has(keys, t, 0, 1) ? 1 : 0);
  // A downpipe runs down the front corner of the end wall of a low building with a facade, its foot stained.
  const corner = [...tiles].sort((a, b) => a.j - b.j || a.i - b.i)[0];
  if (corner && form.facade && bay === 8 && base === 0 && opts.detail < 2 && !has(keys, corner, -1, 0) && !damaged.has(corner) && hash3(opts.seed + 19, 3, 5) % 2 === 0) {
    const top = Math.min(tops.get(tileKey(corner.i, corner.j)) ?? 0, 6);
    for (let level = 0; level < top; level++) facade(m, level === 0 ? "zpipefoot" : level === top - 1 ? "zpipetop" : "zpipe4", corner.u - bay / 2, level * 4, corner.v - bay / 2 + 0.7, 3, "concrete");
  }
  // One column of the failure stands at its edge with its broken head, the slab it held fallen at its foot.
  if (bay === 8 && base === 0 && opts.detail < 2 && mode !== "burnt") {
    const edge = [...damaged].filter((t) => !entryLane(t)).flatMap((t) => SIDES.map(([dx, dz], side) => ({ t, side, dx, dz, n: byKey.get(tileKey(t.i + dx, t.j + dz)) })))
      .filter((e) => e.n && !damaged.has(e.n) && (tops.get(tileKey(e.n.i, e.n.j)) ?? 0) > (tops.get(tileKey(e.t.i, e.t.j)) ?? 0))
      .sort((a, b) => hash3(opts.seed + 7, a.t.i * 4 + a.side, a.t.j) - hash3(opts.seed + 7, b.t.i * 4 + b.side, b.t.j))[0];
    if (edge) {
      const { t, side, dx, dz } = edge; const y = base + (tops.get(tileKey(t.i, t.j)) ?? 0) * 4;
      // The slab lies within its bay, clear of the walls round it, its low end in rubble so it does not read as a ramp.
      const sign = hash3(opts.seed, t.i, t.j) % 2 ? 1 : -1;
      const turn = [180, 90, 0, 270][side]!;
      m.put("zstub", t.u + dx * 3.5 + dz * sign * 2.5, y + RUIN_SHAPES.zstub[1] / 2, t.v + dz * 3.5 + dx * sign * 2.5, "fracture", turn);
      m.put("zfallen", t.u + dx * 0.9 + dz * sign * 1.5, y + RUIN_SHAPES.zfallen[1] / 2, t.v + dz * 0.9 + dx * sign * 1.5, "concrete", turn);
      m.put("rubble", t.u - dx * 1.7 + dz * sign * 1.5, y + RUIN_SHAPES.rubble[1] / 2, t.v - dz * 1.7 + dx * sign * 1.5, "concrete", turn + 90);
      // A panel of the wall beside hangs from one fixing at its top slab's edge over the gap.
      const high = tops.get(tileKey(edge.n!.i, edge.n!.j)) ?? 0;
      if (hash3(opts.seed, t.j, t.i) % 2 === 0) facade(m, "zhang", t.u + dx * bay / 2, base + high * 4, t.v + dz * bay / 2, (side + 2) % 4, rule.finish);
    }
    // A column of a bay that fell to the ground stands out of plumb in one in three.
    for (const t of damaged) if ((tops.get(tileKey(t.i, t.j)) ?? 0) === 0 && !entryLane(t) && hash3(opts.seed + 7, t.j, t.i) % 3 === 0) {
      const a = hash3(t.i, t.j, opts.seed) % 4;
      m.put("zleancol", t.u + (a & 1 ? 3.3 : -3.3), base + RUIN_SHAPES.zleancol[1] / 2, t.v + (a & 2 ? 3.3 : -3.3), "concrete", a * 90 + 45);
    }
  }
}

/**
 * A storey's module of the wall on side `side` of a tile, whose line's middle is (u, v), its floor at h: a facade module
 * stands out from the line as content/ruins.ts lays it out, `out` further, and a plain box (a blank end wall) on the line.
 */
function facade(m: Mason, name: RuinShape, u: number, h: number, v: number, side: number, finish: RuinFinish, out = 0): void {
  const at = FACADE_AT[name as FacadeModule] ?? BREAK_AT[name];
  if (!at) { m.put(name, u, h + RUIN_SHAPES[name][1] / 2, v, finish, side % 2 ? 90 : 0); return; }
  const [dx, dz] = SIDES[side]!;
  m.put(name, u + dx * (at[2]! + out), h + at[1]!, v + dz * (at[2]! + out), finish, [180, 90, 0, 270][side]!);
}

function pitched(m: Mason, tiles: Tile[], bay: number, y: number): void {
  const left = new Set(tiles.map((t) => tileKey(t.i, t.j)));
  for (const t of tiles) {
    if (!left.has(tileKey(t.i, t.j))) continue;
    let cells = 1;
    for (const n of bay === 4 ? [4, 2] : [2]) if (Array.from({ length: n * n }, (_, k) => left.has(tileKey(t.i + k % n, t.j + Math.floor(k / n)))).every(Boolean)) { cells = n; break; }
    const shape = bay * cells >= 16 ? "zpitch16" : bay * cells === 8 ? "zpitch8" : "zpitch4";
    m.put(shape, t.u + (cells - 1) * bay / 2, y + RUIN_SHAPES[shape][1] / 2, t.v + (cells - 1) * bay / 2, "clay");
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) left.delete(tileKey(t.i + i, t.j + j));
  }
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
  const first = m.pieces.length;
  for (const [shape, du, dy, dv, finish, turn] of rule.assemblies?.[name]?.parts ?? []) m.part(shape, u + du, y + dy, v + dv, finish === "finish" ? rule.finish : finish, turn ?? 0);
  if (rule.assemblies?.[name]?.role === "roof identity") m.assemblies.push(m.pieces.slice(first));
}

function interior(m: Mason, t: Tile, dir: number, floors: number, base: number, kind: string, rule: Rule): void {
  if (["parking", "nave", "concourse"].includes(kind)) {
    m.put("zcover", t.u, base + .55, t.v + 1.5, kind === "parking" ? "concrete" : rule.finish); return;
  }
  m.floor([t.u, t.v], base, 8); m.floor([t.u + dir * 8, t.v], base, 8);
  for (let level = 0; level < floors; level++) {
    const y = base + level * 4;
    // Two doors at either end of a four-metre partition open onto the protected corridor.
    const profile: Vocabulary["interiors"][string] = rule.interiors?.[kind] ?? { divider: "wall4", back: "wall8", parts: [["zcounter", 1.5, .5, 1, "finish"]] };
    if (profile.divider) m.put(profile.divider, t.u + dir * 4, y + RUIN_SHAPES[profile.divider][1] / 2, t.v, rule.finish, 90);
    if (profile.back) m.put(profile.back, t.u, y + RUIN_SHAPES[profile.back][1] / 2, t.v + 4, rule.finish);
    for (const [shape, du, dy, dv, finish, turn] of profile.parts) m.part(shape, t.u - dir * du, y + dy, t.v + dv, finish === "finish" ? rule.finish : finish, turn ?? 0);
    if (level === 0 || level === floors - 1) {
      const points = [[t.u + dir * 4.8, t.v - 2.9], [t.u + dir * 2, t.v - 2.9], [t.u + dir * 2, t.v + 2.9], [t.u + dir * 4.8, t.v + 2.9], [t.u + dir * 4.8, t.v - 2.9]].map(([u, v]) => { const [x, z] = m.point(u!, v!); return { x, y: m.base + y, z }; });
      m.rooms.push({ kind, points });
    }
  }
}

function collapse(m: Mason, t: Tile, mode: string, height: number, rule: Rule, opts: LayoutOptions, base: number, bay: number, facadeSide: number): void {
  m.falls.push({ mode, u: t.u, v: t.v });
  if (base !== 0 || opts.detail > 1) return;
  if (mode === "facade" && facadeSide) for (let y = 0; y < Math.min(12, height); y += 4) {
    m.put("fin4", t.u - 3.5, y + 2, t.v + facadeSide * 3.5, rule.finish);
    m.put("fin4", t.u + 3.5, y + 2, t.v + facadeSide * 3.5, rule.finish);
    m.put("sill8", t.u, y + .45, t.v + facadeSide * 3.5, rule.finish);
    m.put("zheader", t.u, y + 3.5, t.v + facadeSide * 3.5, rule.finish);
  }
  if (mode === "pancake") {
    m.put("rubble4", t.u - 1, .55, t.v + 1, "concrete", 38);
    m.put("rubble4", t.u + .7, 1.1, t.v - .7, "concrete", -28);
    m.put("rubble", t.u + 2.5, .35, t.v - 2.8, "concrete", 61);
    for (let n = 0; n < (rule.damage?.layers ?? 3); n++) {
      const h = hash3(t.i, t.j, opts.seed + n * 71);
      const u = ((h & 255) / 255 - .5) * 4; const v = (((h >>> 8) & 255) / 255 - .5) * 4;
      const palette = rule.damage?.plates ?? ["plate15", "plate4", "plate30"] as const;
      const shape = palette[n % palette.length]!;
      m.put(shape, t.u + u, RUIN_SHAPES[shape][1] / 2 + n * .38 + ((h >>> 16) & 255) / 700, t.v + v, "concrete", h % 160 - 80 + n % 2 * 180);
    }
  }
  else if (mode === "hanging") { const shape = rule.damage?.plates?.[0] ?? "plate30"; m.put(shape, t.u + 1, height - RUIN_SHAPES[shape][1] / 2, t.v, "concrete", 12); m.put("rubble4", t.u, .55, t.v + 1, "concrete", 21); }
  else if (mode !== "burnt") {
    m.put("rubble4", t.u, .55, t.v + 1, "concrete", 21); m.put("rubble", t.u - 2, .35, t.v - 1, "concrete", 63);
    if (mode === "lost-top") { m.put("mound", t.u, 1, t.v - 1); m.put("plate30", t.u + .5, RUIN_SHAPES.plate30[1] / 2, t.v, "concrete", 160); }
    if (mode === "facade" && !facadeSide) { const shape = rule.damage?.front ?? "front60"; m.put(shape, t.u, RUIN_SHAPES[shape][1] / 2, t.v, "concrete", 15); }
    if (mode === "shear" && bay === 8 && !m.rooms.some((r) => r.kind === "rubble") && hash3(t.i, t.j, opts.seed) % 3 === 0) {
      m.floor([t.u, t.v], 0, 8);
      const points = [[-3, 0, -3], [-2, .7, -1], [0, 1.1, 1], [2.5, 0, -2.5]].map(([u, y, v]) => { const [x, z] = m.point(t.u + u!, t.v + v!); return { x, y: m.base + y!, z }; });
      m.rooms.push({ kind: "rubble", points });
    }
  }
}

export function tower(m: Mason, tiles: Tile[], rule: Rule, opts: LayoutOptions, twins = false): void {
  const bay = 8;
  const limit = opts.detail === 3 ? 24 : 40;
  const podium = tiles.length > 45 && opts.detail < 3 ? 8 : 0;
  const width = Math.min(limit, m.frame.width * .7); const depth = Math.min(limit, m.frame.depth * .7);
  const offsets = twins && m.frame.width > 64 ? [-m.frame.width * .24, m.frame.width * .24] : [0];
  const bodies = offsets.map((offset) => {
    let selected = tiles.filter((t) => Math.abs(t.u - offset) < width / 2 && Math.abs(t.v) < depth / 2);
    if (selected.length < 3 && opts.detail === 3) {
      const keys = new Set(tiles.map((t) => tileKey(t.i, t.j)));
      const anchor = tiles.filter((t) => has(keys, t, 0, -1) && has(keys, t, 0, 1)).sort((a, b) => a.u ** 2 + a.v ** 2 - b.u ** 2 - b.v ** 2)[0];
      if (anchor) selected = tiles.filter((t) => Math.abs(t.i - anchor.i) <= 1 && Math.abs(t.j - anchor.j) <= 1);
    }
    return selected.length >= 3 ? selected : tiles;
  });
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
  if (!special && rule.form?.plan && ["court", "wards"].includes(rule.form.plan) && tiles.length >= 12 && tiles.length * bay * bay <= 6000 && bay === 8 && rule.height <= 36) {
    const lo = Math.min(...tiles.map((t) => t.i)); const hi = Math.max(...tiles.map((t) => t.i));
    const back = Math.max(...tiles.map((t) => t.j)); const front = Math.min(...tiles.map((t) => t.j)); const mid = (front + back) / 2;
    const thickness = hi - lo >= 5 ? 2 : 1;
    const left = tiles.filter((t) => t.i < lo + thickness); const right = tiles.filter((t) => t.i > hi - thickness && !left.includes(t));
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
    const keys = new Set(tiles.map((t) => tileKey(t.i, t.j)));
    const courts: Tile[] = [];
    for (const t of [...tiles].sort((a, b) => hash3(a.i, a.j, opts.seed) - hash3(b.i, b.j, opts.seed))) {
      if (courts.some((c) => Math.hypot(t.u - c.u, t.v - c.v) < 64)) continue;
      if (Array.from({ length: 49 }, (_, n) => keys.has(tileKey(t.i + n % 7 - 3, t.j + Math.floor(n / 7) - 3))).every(Boolean)) courts.push(t);
    }
    const left = new Map(tiles.filter((t) => !courts.some((c) => Math.abs(t.i - c.i) <= 1 && Math.abs(t.j - c.j) <= 1)).map((t) => [tileKey(t.i, t.j), t]));
    const groups: Tile[][] = [];
    // Maximal wings follow the surviving polygon; courts interrupt large solid interiors.
    for (const t of tiles) {
      if (!left.has(tileKey(t.i, t.j))) continue;
      const candidates = [[3, 7], [7, 3], [4, 5], [5, 4], [3, 4], [4, 3], [3, 3], [2, 4], [4, 2], [2, 3], [3, 2], [1, 4], [4, 1], [2, 2], [1, 3], [3, 1], [1, 2], [2, 1], [1, 1]];
      if (hash3(t.i, t.j, opts.seed) % 2) for (const size of candidates) size.reverse();
      const [w, d] = candidates.find(([w, d]) => Array.from({ length: w! * d! }, (_, n) => left.has(tileKey(t.i + n % w!, t.j + Math.floor(n / w!)))).every(Boolean))!;
      const wing: Tile[] = [];
      for (let j = 0; j < d!; j++) for (let i = 0; i < w!; i++) { const k = tileKey(t.i + i, t.j + j); wing.push(left.get(k)!); left.delete(k); }
      groups.push(wing);
    }
    for (const [index, wing] of groups.entries()) {
      const factor = [.5, .75, 1][hash3(index, opts.seed, 41) % 3]!;
      const height = Math.max(4, Math.floor(rule.height * factor / 4) * 4);
      stack(m, wing, bay, height, rule, opts, 0, ["shed", "hall"].includes(rule.recipe));
      m.wings.push({ tiles: wing.length, height, u: wing.reduce((n, t) => n + t.u, 0) / wing.length, v: wing.reduce((n, t) => n + t.v, 0) / wing.length });
    }
    return;
  }
  const hall = ["shed", "hall", "theatre", "service", "marina"].includes(rule.recipe);
  stack(m, tiles, bay, rule.height, rule, opts, 0, hall);
  if (["service", "civic", "school", "hospital", "shop"].includes(rule.recipe) && !rule.form?.facade) {
    const front = tiles.filter((t) => t.j === Math.min(...tiles.map((a) => a.j)));
    for (const t of front) m.put(bay === 8 ? "trim8" : "trim4", t.u, 3.2, t.v - bay / 2, rule.finish);
  }
}

/**
 * Pieces round a circle at one height, each turned along it and as many as its length allows; one at the middle when the
 * circle is smaller than a piece. `scale` stretches the circle along u and v into an ellipse.
 */
function ring(m: Mason, op: Round, radius: number, y: number, finish: RuinFinish, scale?: readonly [number, number]): void {
  const shape = op.shape ?? "crown"; const [cu, cv] = op.at ?? [0, 0]; const [from, to] = op.arc ?? [0, 360];
  const along = RUIN_SHAPES[shape][0];
  const whole = to - from >= 360;
  if (scale) {
    const ru = radius * scale[0]; const rv = radius * scale[1];
    if ((ru + rv) / 2 < along / 2) { m.put(shape, cu, y, cv, finish); return; }
    const count = Math.max(whole ? 3 : 2, Math.round((((ru + rv) / 2) * (to - from) * Math.PI) / 180 / along));
    for (let k = 0; k < count; k++) {
      const rad = ((from + (to - from) * (whole ? k / count : k / (count - 1))) * Math.PI) / 180;
      m.put(shape, cu + ru * Math.cos(rad), y, cv + rv * Math.sin(rad), finish, -(Math.atan2(rv * Math.cos(rad), -ru * Math.sin(rad)) * 180) / Math.PI);
    }
    return;
  }
  if (radius < along / 2) { m.put(shape, cu, y, cv, finish); return; }
  const count = Math.max(whole ? 3 : 2, Math.round((radius * (to - from) * Math.PI) / 180 / along));
  for (let k = 0; k < count; k++) {
    const a = from + (to - from) * (whole ? k / count : k / (count - 1));
    const rad = (a * Math.PI) / 180;
    m.put(shape, cu + radius * Math.cos(rad), y, cv + radius * Math.sin(rad), finish, -(a + 90));
  }
}

/** The largest radius of a round op, and how its ellipse stretches a circle of that radius, if it is one. */
function roundOf(op: Round): [number, (readonly [number, number]) | undefined] {
  if (!op.radii) return [op.radius ?? 8, undefined];
  const r = Math.max(op.radii[0], op.radii[1]);
  return [r, [op.radii[0] / r, op.radii[1] / r]];
}

/** A stepped pyramid of courses a piece high round a shrinking rectangle, each filled in to where the course above reaches. */
function pyramid(m: Mason, op: Op, rule: Rule): void {
  const shape = op.shape ?? "zmass8"; const [along, h, depth] = RUIN_SHAPES[shape]; const finish = op.finish ?? rule.finish;
  const [cu, cv] = op.at ?? [0, 0]; const [hu, hv] = op.half ?? [m.frame.width / 2, m.frame.depth / 2];
  const foot = op.y ?? 0; const rise = (op.height ?? rule.height) - foot;
  const square = (wu: number, wv: number, y: number): void => {
    const nu = Math.max(1, Math.round((2 * wu + depth) / along)); const nv = Math.max(1, Math.round((2 * wv) / along));
    for (const side of [-1, 1]) {
      for (let i = 0; i < nu; i++) m.put(shape, cu - wu - depth / 2 + ((i + .5) * (2 * wu + depth)) / nu, y, cv + side * wv, finish);
      if (wv > along / 2) for (let i = 0; i < nv; i++) m.put(shape, cu + side * wu, y, cv - wv + ((i + .5) * 2 * wv) / nv, finish, 90);
    }
  };
  const courses: [number, number][] = [];
  for (let k = 0; k * h < rise; k++) { const f = 1 - ((k + .5) * h) / rise; courses.push([hu * f, hv * f]); }
  courses.forEach(([wu, wv], k) => {
    const y = foot + (k + .5) * h; const [nu, nv] = courses[k + 1] ?? [-along, -along];
    for (let j = 0; ; j++) {
      const iu = wu - j * along; const iv = wv - j * along;
      if (j > 0 && iu < nu + along / 4 && iv < nv + along / 4) break;
      if (iv <= along / 2) { if (iu > -along / 2) for (let u = -Math.max(0, iu); u <= Math.max(0, iu) + .01; u += along) m.put(shape, cu + u, y, cv, finish); break; }
      if (iu <= along / 2) { for (let v = -iv; v <= iv + .01; v += along) m.put(shape, cu, y, cv + v, finish, 90); break; }
      square(iu, iv, y);
    }
  });
}

/** A wheel standing in a vertical plane: its rim of pieces round a hub, cabins outside it, and a leg each side to the ground. */
function wheel(m: Mason, op: Op, rule: Rule): void {
  const shape = op.shape ?? "crown"; const [along, h] = RUIN_SHAPES[shape]; const finish = op.finish ?? rule.finish;
  const r = op.radius ?? 20; const [cu, cv] = op.at ?? [0, 0]; const hub = op.y ?? r + 2;
  const turn = ((op.turn ?? 0) * Math.PI) / 180; const cu1 = Math.cos(turn); const sv1 = Math.sin(turn);
  const at = (w: number, y: number, shapeName: RuinShape, finishName: RuinFinish): void => m.put(shapeName, cu + w * cu1, y, cv + w * sv1, finishName, -(op.turn ?? 0));
  const count = Math.max(8, Math.round((2 * Math.PI * r) / Math.max(along, h)));
  for (let k = 0; k < count; k++) { const a = (2 * Math.PI * k) / count; at(r * Math.cos(a), hub + r * Math.sin(a), shape, finish); }
  for (let k = 0; k < (op.cabins ?? 0); k++) { const a = (2 * Math.PI * k) / op.cabins!; at((r + 3.5) * Math.cos(a), hub + (r + 3.5) * Math.sin(a), "zcore", "blue"); }
  at(0, hub, "zcore", "steel");
  for (const side of [-1, 1]) for (let y = 0; y < hub - 4; y += 16) {
    const top = Math.min(hub - 2, y + 16); const piece: RuinShape = top - y > 8 ? "fin16" : top - y > 4 ? "fin8" : "fin4";
    m.put(piece, cu - side * 4 * sv1, y + RUIN_SHAPES[piece][1] / 2, cv + side * 4 * cu1, "steel", -(op.turn ?? 0));
  }
}

/** A lattice tower: rings of beams round a square narrowing up a curve, a leg at each corner between them, floors at its decks and a spire. */
function lattice(m: Mason, op: Op, rule: Rule): void {
  const beam = op.shape ?? "trim8"; const along = RUIN_SHAPES[beam][0]; const finish = op.finish ?? rule.finish;
  const [cu, cv] = op.at ?? [0, 0]; const [hu, hv] = op.half ?? [m.frame.width / 2, m.frame.depth / 2];
  const top = op.height ?? rule.height; const tip = op.tip ?? 1.5; const p = op.profile ?? 1; const every = op.every ?? 8;
  const half = (y: number): [number, number] => { const f = (1 - Math.min(1, y / top)) ** p; return [tip + (hu - tip) * f, tip + (hv - tip) * f]; };
  for (let y = 0; y < top - every / 2; y += every) {
    const [wu, wv] = half(y + every); const [lu, lv] = half(y + every / 2);
    if (y + every < top) for (const side of [-1, 1]) {
      const nu = Math.max(1, Math.round((2 * wu) / along)); const nv = Math.max(1, Math.round((2 * wv) / along));
      for (let i = 0; i < nu; i++) m.put(beam, cu - wu + ((i + .5) * 2 * wu) / nu, y + every, cv + side * wv, finish);
      for (let i = 0; i < nv; i++) m.put(beam, cu + side * wu, y + every, cv - wv + ((i + .5) * 2 * wv) / nv, finish, 90);
    }
    const leg: RuinShape = every >= 16 ? "fin16" : every >= 8 ? "fin8" : "fin4";
    for (const su of [-1, 1]) for (const sv of [-1, 1]) m.put(leg, cu + su * lu, y + every / 2, cv + sv * lv, finish);
  }
  for (const d of op.decks ?? []) {
    const [wu, wv] = half(d);
    for (let u = -wu + 4; u <= wu - 3.99; u += 8) for (let v = -wv + 4; v <= wv - 3.99; v += 8) m.put("floor8", cu + u, d, cv + v, finish);
  }
  m.put("fin16", cu, top + 8, cv, "steel");
}

/** A roof of plates over the chosen part of the footprint, each raised to where a shallow dome over it stands. */
function vault(m: Mason, tiles: Tile[], op: Op, rule: Rule): void {
  if (!tiles.length) return;
  const shape = op.shape ?? "floor16"; const along = RUIN_SHAPES[shape][0]; const finish = op.finish ?? rule.finish;
  const minU = Math.min(...tiles.map((t) => t.u)) - 4; const maxU = Math.max(...tiles.map((t) => t.u)) + 4;
  const minV = Math.min(...tiles.map((t) => t.v)) - 4; const maxV = Math.max(...tiles.map((t) => t.v)) + 4;
  const [cu, cv] = op.at ?? [(minU + maxU) / 2, (minV + maxV) / 2];
  const [ru, rv] = op.radii ?? [(maxU - minU) / 2, (maxV - minV) / 2];
  const keys = new Set(tiles.map((t) => `${Math.round(t.u)},${Math.round(t.v)}`));
  const near = (u: number, v: number): boolean => tiles.some((t) => Math.abs(t.u - u) <= 4 && Math.abs(t.v - v) <= 4) || keys.has(`${Math.round(u)},${Math.round(v)}`);
  const spring = op.y ?? rule.height; const rise = op.rise ?? 8;
  for (let u = minU + along / 2; u < maxU; u += along) for (let v = minV + along / 2; v < maxV; v += along) {
    if (!near(u, v)) continue;
    const d = ((u - cu) / ru) ** 2 + ((v - cv) / rv) ** 2;
    m.put(shape, u, spring + Math.round(rise * Math.max(0, 1 - d) * 4) / 4, v, finish);
  }
}

function compose(m: Mason, tiles: Tile[], rule: Rule, opts: LayoutOptions, composition: Composition): void {
  const inRect = (t: Tile, rect: number[]): boolean => t.u >= rect[0]! && t.v >= rect[1]! && t.u <= rect[2]! && t.v <= rect[3]!;
  for (const op of composition.operations) {
    const selected = tiles.filter((t) => (!op.rect || inRect(t, op.rect)) && (!op.exclude || !inRect(t, op.exclude)));
    if (op.op === "stack") stack(m, selected, 8, Math.max(4, (op.height ?? rule.height) + (op.offset ?? 0)), { ...rule, form: op.form ?? rule.form, feature: op.feature ?? rule.feature }, { ...opts, playable: op.playable ?? opts.playable, coreU: op.coreU }, 0, op.hall);
    if (op.op === "tower") tower(m, tiles, rule, opts);
    if (op.op === "arena") arena(m, tiles, rule, opts);
    if (op.op === "parts" || op.op === "front") {
      const front = op.op === "front" ? Math.min(...tiles.map((t) => t.v)) - 4 : 0;
      for (const [shape, u, y, v, finish, turn] of op.parts ?? []) m.part(shape, u, y + (op.fromTop ? rule.height : 0), v + front, finish === "finish" ? rule.finish : finish, turn ?? 0);
    }
    if (op.op === "ribs") {
      const edge = (op.rear ? Math.max : Math.min)(...selected.map((t) => t.j));
      for (const t of selected.filter((t) => t.j === edge)) {
        for (let y = 0; y < rule.height; y += 16) m.put("fin16", t.u - 4, y + 8, t.v + (op.rear ? 4 : -4), op.finish ?? rule.finish);
        m.put("trim8", t.u, rule.height, t.v + (op.rear ? 4 : -4), op.finish ?? rule.finish);
      }
    }
    if (op.op === "ring") { const [r, scale] = roundOf(op); for (const y of op.heights ?? []) ring(m, op, r, y, op.finish ?? rule.finish, scale); }
    if (op.op === "dome") {
      // A drum up to the springing, then courses a block high as far in as the dome's radius at their middle, each
      // filled inward to where the course above it reaches, so the dome is closed from above. `below` carries the
      // sphere down from the drum's foot, each course filled outward to the one above, so it is closed from below.
      const [r, scale] = roundOf(op); const shape = op.shape ?? "crown"; const [along, h] = RUIN_SHAPES[shape]; const spring = op.y ?? rule.height;
      const finish = op.finish ?? rule.finish; const top = op.rise ?? r;
      const at = (d: number): number => op.rise === undefined ? Math.sqrt(Math.max(0, r * r - d ** 2)) : r * Math.sqrt(Math.max(0, 1 - (d / top) ** 2));
      for (let y = spring - (op.drum ?? 0); y < spring - .01; y += h) ring(m, op, r, y + h / 2, finish, scale);
      const radii: number[] = [];
      for (let k = 0; k * h < top; k++) radii.push(at((k + .5) * h));
      radii.forEach((outer, k) => {
        const inner = radii[k + 1] ?? -along;
        // Each course lays at least its own ring, however little the course above draws in (near a large dome's springing).
        for (let rho = outer; rho === outer || rho > inner + along / 4; rho -= along) ring(m, op, Math.max(0, rho), spring + (k + .5) * h, finish, scale);
      });
      const foot = spring - (op.drum ?? 0); const lower: number[] = [];
      for (let k = 0; k * h < (op.below ?? 0); k++) lower.push(at((k + .5) * h));
      lower.forEach((rho, k) => {
        const above = k === 0 ? r : lower[k - 1]!;
        for (let q = rho; q < above - along / 4 || q === rho; q += along) ring(m, op, Math.max(0, q), foot - (k + .5) * h, finish, scale);
      });
    }
    if (op.op === "pyramid") pyramid(m, op, rule);
    if (op.op === "wheel") wheel(m, op, rule);
    if (op.op === "vault") vault(m, selected, op, rule);
    if (op.op === "lattice") lattice(m, op, rule);
    if (op.op === "portal") for (let i = m.pieces.length - 1; i >= 0; i--) {
      const p = m.pieces[i]!; const u = (p.x - m.frame.x) * m.frame.c - (p.z - m.frame.z) * m.frame.s;
      if (Math.abs(u) < (op.width ?? 12) / 2 && p.y - m.base < (op.height ?? 16) - .5) m.pieces.splice(i, 1);
    }
  }
}
