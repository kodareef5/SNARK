import { pieceMiddle, RUIN_SHAPES, type RuinShape } from "../../content/ruins.ts";
import type { BridgeRecord, DeckPoint } from "./bridges.ts";
import { S } from "./ground.ts";
import { binKey } from "./raster.ts";
import type { Mason } from "./ruin-geometry.ts";
import type { Site, StaticPiece } from "./statics.ts";

/** The ground an approach to a door may start from. */
const APPROACHED = new Set<number>([S.STREET, S.HIGHWAY, S.SIDEWALK, S.WALKWAY, S.PLAZA]);
const streetLevel = (ground: number, base: number): number => Math.abs(ground - base) < .4 ? base : base - Math.round((base - ground) * 4) / 4;
/**
 * How far an approach may run under or over the ground it crosses, outside its own footprint. gradeApproaches cuts or
 * fills the ground to it 5 m either side and blends back over 2 m, so deeper than this leaves a trench or a bank steeper
 * than a survivor climbs (SLOPE_COS) across whatever way passes there.
 */
export const APPROACH_DEPTH = 2;
/** The height a bridge's deck point digs the ground down to, a sample round it, once every building is planned (ruins.ts). */
export const deckCeiling = (bridge: Pick<BridgeRecord, "kind">, d: DeckPoint): number => d.y - (bridge.kind === "road_bridge" ? .02 : .4);

export interface Approach { street: { x: number; y: number; z: number }; door: { x: number; y: number; z: number }; core: { x: number; y: number; z: number }; ramp: number; }
/**
 * Plans each door's approach from the street. `bridges` are dug down under their decks after every building is planned,
 * except on the samples `kept` (the road's own ground at their ends), so an approach is planned on the ground as they will
 * leave it: one that starts beside a deck starts at the dug level, and no ramp is left standing over the hole.
 */
export function accessPlanner(site: Site, infrastructure: readonly StaticPiece[], bridges: readonly Pick<BridgeRecord, "kind" | "deck">[] = [], kept: ReadonlySet<number> = new Set()): ((m: Mason, owner: number) => Approach[]) & { reserve: (routes: Approach[]) => void } {
  const { surface, heaps } = site.ground; const { nx, nz, x1, z1 } = site.ground.grid;
  const dug = new Map<number, number>();
  for (const r of bridges) for (const d of r.deck) if (!d.gap) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const row = Math.round((z1 - d.z) / 2) + dz, col = Math.round((x1 - d.x) / 2) + dx, i = row * nx + col;
    if (row >= 0 && col >= 0 && row < nz && col < nx && !kept.has(i)) dug.set(i, Math.min(dug.get(i) ?? Infinity, deckCeiling(r, d)));
  }
  const bins = new Map<string, { x: number; z: number }[]>();
  // A solid is in every 4 m bin within w + d of its middle, past which no point it holds can lie, so a point's own bin
  // holds every solid that can stand in its way.
  const index = (pieces: readonly StaticPiece[]): Map<number, Solid[]> => {
    const out = new Map<number, Solid[]>();
    for (const p of pieces) {
      const name = p.kind.split("_")[1] as RuinShape; const [w, h, d] = RUIN_SHAPES[name]; const angle = p.yaw * Math.PI / 180; const y = pieceMiddle(name, p.y);
      const o = { x: p.x, z: p.z, lo: y - h / 2, hi: y + h / 2, floor: p.kind.includes("_floor"), c: Math.cos(angle), s: Math.sin(angle), w: w / 2 + .45, d: d / 2 + .45 };
      const reach = o.w + o.d;
      for (let z = Math.floor((p.z - reach) / 4); z <= Math.floor((p.z + reach) / 4); z++) for (let x = Math.floor((p.x - reach) / 4); x <= Math.floor((p.x + reach) / 4); x++) {
        const bin = out.get(binKey(x, z)); if (bin) bin.push(o); else out.set(binKey(x, z), [o]);
      }
    }
    return out;
  };
  const solids = index(infrastructure);
  const at = (x: number, z: number): number => Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2);
  const groundAt = (x: number, z: number): number => Math.min(site.groundAt(x, z), dug.get(at(x, z)) ?? Infinity);
  for (let row = 2; row < nz - 2; row += 4) for (let col = 2; col < nx - 2; col += 4) {
    // A door is reached from where people walk as well as from the street: the sidewalk, a walkway, a plaza.
    const i = row * nx + col; if (!APPROACHED.has(surface[i]!)) continue;
    const x = x1 - col * 2; const z = z1 - row * 2; const k = `${Math.floor(x / 64)},${Math.floor(z / 64)}`;
    if (!bins.has(k)) bins.set(k, []); bins.get(k)!.push({ x, z });
  }
  const reserved = new Map<number, Approach[]>();
  const reserve = (routes: Approach[]): void => {
    for (const a of routes) for (let z = Math.floor((Math.min(a.street.z, a.door.z) - 8) / 32); z <= Math.floor((Math.max(a.street.z, a.door.z) + 8) / 32); z++) for (let x = Math.floor((Math.min(a.street.x, a.door.x) - 8) / 32); x <= Math.floor((Math.max(a.street.x, a.door.x) + 8) / 32); x++) {
      const k = binKey(x, z); if (!reserved.has(k)) reserved.set(k, []); reserved.get(k)!.push(a);
    }
  };
  const plan = (m: Mason, owner: number): Approach[] => {
    const out: Approach[] = [];
    const own = index(m.pieces.filter((p) => { const name = p.kind.split("_")[1] as RuinShape; const h = RUIN_SHAPES[name][1]; const y = pieceMiddle(name, p.y); return y + h / 2 > m.base + .4 && y - h / 2 < m.base + 2.2; }));
    // A walk's samples a quarter metre apart read one bin many times running: its lists are kept from the last.
    let lastKey = NaN; let ownHere: Solid[] = []; let solidsHere: Solid[] = [];
    const obstructed = (x: number, z: number, y: number): boolean => {
      const k = binKey(Math.floor(x / 4), Math.floor(z / 4));
      if (k !== lastKey) { lastKey = k; ownHere = own.get(k) ?? []; solidsHere = solids.get(k) ?? []; }
      for (const o of ownHere) if (stands(o, x, z, y, false)) return true;
      for (const o of solidsHere) if (stands(o, x, z, y, true)) return true;
      return false;
    };
    let lastReserved = NaN; let reservedHere: Approach[] = [];
    const reservedAt = (x: number, z: number): Approach[] => {
      const k = binKey(Math.floor(x / 32), Math.floor(z / 32));
      if (k !== lastReserved) { lastReserved = k; reservedHere = reserved.get(k) ?? []; }
      return reservedHere;
    };
    for (const entry of m.entries) {
      const insideLength = Math.hypot(entry.x - entry.coreX, entry.z - entry.coreZ);
      if (Array.from({ length: Math.ceil(insideLength) + 1 }, (_, i) => i / Math.ceil(insideLength)).some((t) => obstructed(entry.x + (entry.coreX - entry.x) * t, entry.z + (entry.coreZ - entry.z) * t, m.base))) continue;
      let ramp = 1;
      const bx = Math.floor(entry.x / 64); const bz = Math.floor(entry.z / 64); const candidates: { x: number; z: number }[] = [];
      for (let x = bx - 2; x <= bx + 2; x++) for (let z = bz - 2; z <= bz + 2; z++) candidates.push(...bins.get(`${x},${z}`) ?? []);
      // The distances worked out once sort as they would worked out at every comparison. One past 112 m is never taken,
      // and sorts after every one that may be, so leaving it out leaves the 48 nearest that may be as they were.
      const nearest = candidates.map((p) => ({ p, len: Math.hypot(p.x - entry.x, p.z - entry.z) })).filter((c) => !(c.len > 112)).sort((a, b) => a.len - b.len).slice(0, 48);
      // The first that passes and keeps within APPROACH_DEPTH of the ground; where none keeps within it, the one that keeps
      // nearest it, so a door that has a way in keeps one.
      let shallowest = null as { street: { x: number; z: number }; ramp: number; depth: number } | null;
      // Which streets passed the squares beside their way with a margin: with none they pass them too, then fail as before.
      const besideClear = new Uint8Array(nearest.length);
      const tries = (p: { x: number; z: number }, len: number, margin: number, j: number): boolean => {
        if (margin === 0 && besideClear[j]) return false;
        const groundY = groundAt(p.x, p.z); const y = streetLevel(groundY, m.base);
        if (len > 112 || len < 4 || y < .1 || Math.abs(y - m.base) / len > .12) return false;
        let boundary = len;
        // With no margin the squares beside are the square itself.
        const beside = margin > 0 ? [-margin, 0, margin, 0, 0, -margin, 0, margin] : [];
        for (let s = 0; s <= len; s += .25) {
          const x = p.x + (entry.x - p.x) * s / len; const z = p.z + (entry.z - p.z) * s / len;
          const other = heaps.owner[at(x, z)];
          if (other !== undefined && other >= 0 && other !== owner) return false;
          for (let i = 0; i < beside.length; i += 2) {
            const next = heaps.owner[at(x + beside[i]!, z + beside[i + 1]!)];
            if (next !== undefined && next >= 0 && next !== owner) return false;
          }
          if (other === owner) boundary = Math.min(boundary, s);
        }
        besideClear[j] = 1;
        ramp = Math.max(.05, (boundary - 3) / len);
        if (Math.abs(y - m.base) > .4) ramp = Math.floor(len * ramp / 4) * 4 / len;
        if (ramp <= 0) return false;
        if (Math.abs(y - m.base) / (len * ramp) > .18) return false;
        let depth = 0;
        for (let s = 0; s <= len; s += .25) {
          const t = s / len; const x = p.x + (entry.x - p.x) * t; const z = p.z + (entry.z - p.z) * t;
          const level = y + (m.base - y) * Math.min(1, t / ramp);
          if (obstructed(x, z, level)) return false;
          for (const a of reservedAt(x, z)) if (clashes(a, x, z, level)) return false;
          for (const a of out) if (clashes(a, x, z, level)) return false;
          // A bridge's deck dug under it on its way would leave its ramp standing over the hole.
          const i = at(x, z);
          if ((dug.get(i) ?? Infinity) < level - .4) return false;
          if (heaps.owner[i] !== owner) depth = Math.max(depth, Math.abs(groundAt(x, z) - level));
        }
        if (depth > APPROACH_DEPTH) {
          if (!shallowest || depth < shallowest.depth) shallowest = { street: p, ramp, depth };
          return false;
        }
        return true;
      };
      let found: { street: { x: number; z: number } } | undefined;
      for (const margin of [4, 0]) {
        for (let j = 0; j < nearest.length && !found; j++) if (tries(nearest[j]!.p, nearest[j]!.len, margin, j)) found = { street: nearest[j]!.p };
      }
      if (!found && shallowest) ramp = shallowest.ramp;
      const street = found?.street ?? shallowest?.street;
      if (!street) continue;
      const groundY = groundAt(street.x, street.z);
      const from = { ...street, y: streetLevel(groundY, m.base) }; const door = { x: entry.x, y: m.base, z: entry.z };
      out.push({ street: from, door, core: { x: entry.coreX, y: m.base, z: entry.coreZ }, ramp });
      const length = Math.hypot(from.x - door.x, from.z - door.z);
      const hillside = Math.abs(from.y - door.y) > .4;
      if (hillside) {
        const modules = Math.round(length * ramp / 4); const dx = (door.x - from.x) / length; const dz = (door.z - from.z) / length;
        const yaw = Math.atan2(dx, dz) * 180 / Math.PI;
        for (let i = 0; i < modules; i++) {
          const lo = from.y + Math.round((door.y - from.y) * i / modules * 4) / 4;
          const hi = from.y + Math.round((door.y - from.y) * (i + 1) / modules * 4) / 4;
          const rise = Math.round(Math.abs(hi - lo) * 4);
          m.pieces.push({ kind: rise ? `core:zruin_ramp${rise}_concrete` : "core:zruin_floor4_concrete", x: from.x + dx * (i * 4 + 2), y: (lo + hi) / 2 - .2, z: from.z + dz * (i * 4 + 2), yaw: yaw + (hi < lo ? 180 : 0) });
        }
        for (let d = modules * 4 + 2; d <= length + 1; d += 2) m.pieces.push({ kind: "core:zruin_floor4_concrete", x: from.x + dx * d, y: door.y - .2, z: from.z + dz * d, yaw });
      }
      for (let d = 0; d <= length; d += 2) {
        const t = d / length; const x = from.x + (door.x - from.x) * t; const z = from.z + (door.z - from.z) * t; const y = from.y + (door.y - from.y) * Math.min(1, t / ramp);
        m.clear.push({ x, z, radius: 10 });
        if (!hillside && [-6, -4, -2, 0, 2, 4, 6].some((s) => [-4, 0, 4].some((side) => {
          const i = at(x + (door.x - from.x) / length * s - (door.z - from.z) / length * side, z + (door.z - from.z) / length * s + (door.x - from.x) / length * side);
          return site.ground.water[i] || heaps.owner[i]! >= 0 && heaps.owner[i] !== owner;
        }))) {
          m.pieces.push({ kind: "core:zruin_floor4_concrete", x, y: y - .2, z, yaw: Math.atan2(from.z - door.z, door.x - from.x) * 180 / Math.PI });
        }
      }
      const inside = Math.hypot(entry.coreX - door.x, entry.coreZ - door.z);
      for (let d = 0; d <= inside; d += 2) {
        const t = d / inside; const x = door.x + (entry.coreX - door.x) * t; const z = door.z + (entry.coreZ - door.z) * t;
        if (hillside || site.ground.water[at(x, z)] || site.groundAt(x, z) < m.base - .4) m.pieces.push({ kind: "core:zruin_floor4_concrete", x, y: m.base - .2, z, yaw: entry.yaw });
      }
    }
    return out;
  };
  return Object.assign(plan, { reserve });
}
const NEAR = 8.01;
interface Solid { x: number; z: number; lo: number; hi: number; floor: boolean; c: number; s: number; w: number; d: number; }

/** Whether a solid stands in the way of a walker at (x, y, z); a floor of the infrastructure's just under it does too. */
function stands(o: Solid, x: number, z: number, y: number, infrastructure: boolean): boolean {
  const overDeck = infrastructure && o.floor && o.hi < y - .35 && o.hi > y - 3;
  if (!overDeck && (o.hi <= y + .38 || o.lo >= y + 2.1)) return false;
  const px = x - o.x; const pz = z - o.z;
  return Math.abs(px * o.c - pz * o.s) < o.w && Math.abs(px * o.s + pz * o.c) < o.d;
}

/** Whether an approach passes within 8 m of (x, z) at another level than `level`. */
function clashes(a: Approach, x: number, z: number, level: number): boolean {
  // Past 8 m and a centimetre off the box round its ends, it is past 8 m from the line: the test below says no.
  const sx = a.street.x, sz = a.street.z, ex = a.door.x, ez = a.door.z;
  if ((x < sx - NEAR && x < ex - NEAR) || (x > sx + NEAR && x > ex + NEAR) || (z < sz - NEAR && z < ez - NEAR) || (z > sz + NEAR && z > ez + NEAR)) return false;
  const dx = a.door.x - a.street.x; const dz = a.door.z - a.street.z;
  const along = Math.max(0, Math.min(1, ((x - a.street.x) * dx + (z - a.street.z) * dz) / (dx * dx + dz * dz)));
  if (Math.hypot(x - a.street.x - dx * along, z - a.street.z - dz * along) >= 8) return false;
  const other = a.street.y + (a.door.y - a.street.y) * Math.min(1, along / a.ramp);
  return Math.abs(other - level) > .35;
}

export function gradeApproaches(site: Site, approaches: readonly Approach[], owner: number, protectedGround?: ReadonlySet<number>): void {
  const { height, water, heaps } = site.ground; const { nx, nz, x1, z1 } = site.ground.grid;
  for (const a of approaches) {
    const dx = a.door.x - a.street.x; const dz = a.door.z - a.street.z; const length = Math.hypot(dx, dz);
    for (let row = Math.max(0, Math.floor((z1 - Math.max(a.street.z, a.door.z) - 5) / 2)); row <= Math.min(nz - 1, Math.ceil((z1 - Math.min(a.street.z, a.door.z) + 5) / 2)); row++) for (let col = Math.max(0, Math.floor((x1 - Math.max(a.street.x, a.door.x) - 5) / 2)); col <= Math.min(nx - 1, Math.ceil((x1 - Math.min(a.street.x, a.door.x) + 5) / 2)); col++) {
      const i = row * nx + col; if (water[i] || protectedGround?.has(i) || (owner >= 0 && heaps.owner[i]! >= 0 && heaps.owner[i] !== owner)) continue;
      const x = x1 - col * 2; const z = z1 - row * 2;
      const t = Math.max(0, Math.min(1, ((x - a.street.x) * dx + (z - a.street.z) * dz) / (length * length)));
      const distance = Math.hypot(x - a.street.x - dx * t, z - a.street.z - dz * t); if (distance >= 5) continue;
      const y = Math.abs(a.street.y - a.door.y) < .4 ? a.door.y : a.street.y + (a.door.y - a.street.y) * Math.min(1, t / a.ramp); const weight = Math.min(1, (5 - distance) / 2);
      height[i] = height[i]! * (1 - weight) + y * weight;
    }
  }
}
