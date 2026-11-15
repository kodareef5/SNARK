import { RUIN_SHAPES, type RuinShape } from "../../content/ruins.ts";
import { S } from "./ground.ts";
import type { Mason } from "./ruin-geometry.ts";
import type { Site, StaticPiece } from "./statics.ts";

export interface Approach { street: { x: number; y: number; z: number }; door: { x: number; y: number; z: number }; core: { x: number; y: number; z: number }; ramp: number; }
export function accessPlanner(site: Site, infrastructure: readonly StaticPiece[]): ((m: Mason, owner: number) => Approach[]) & { reserve: (routes: Approach[]) => void } {
  const { n, surface, heaps } = site.ground; const size = (n - 1) * 2;
  const bins = new Map<string, { x: number; z: number }[]>();
  interface Solid { x: number; z: number; lo: number; hi: number; c: number; s: number; w: number; d: number; }
  const index = (pieces: readonly StaticPiece[]): Map<number, Solid[]> => {
    const out = new Map<number, Solid[]>();
    for (const p of pieces) {
      const [w, h, d] = RUIN_SHAPES[p.kind.split("_")[1] as RuinShape]; const angle = p.yaw * Math.PI / 180;
      const k = Math.floor(p.x / 16) + Math.floor(p.z / 16) * 1024;
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push({ x: p.x, z: p.z, lo: p.y - h / 2, hi: p.y + h / 2, c: Math.cos(angle), s: Math.sin(angle), w: w / 2 + .45, d: d / 2 + .45 });
    }
    return out;
  };
  const solids = index(infrastructure);
  const at = (x: number, z: number): number => Math.round((size - z) / 2) * n + Math.round((size - x) / 2);
  for (let row = 2; row < n - 2; row += 4) for (let col = 2; col < n - 2; col += 4) {
    const i = row * n + col; if (surface[i] !== S.STREET && surface[i] !== S.HIGHWAY) continue;
    const x = size - col * 2; const z = size - row * 2; const k = `${Math.floor(x / 64)},${Math.floor(z / 64)}`;
    if (!bins.has(k)) bins.set(k, []); bins.get(k)!.push({ x, z });
  }
  const reserved = new Map<number, Approach[]>();
  const reserve = (routes: Approach[]): void => {
    for (const a of routes) for (let z = Math.floor((Math.min(a.street.z, a.door.z) - 8) / 32); z <= Math.floor((Math.max(a.street.z, a.door.z) + 8) / 32); z++) for (let x = Math.floor((Math.min(a.street.x, a.door.x) - 8) / 32); x <= Math.floor((Math.max(a.street.x, a.door.x) + 8) / 32); x++) {
      const k = x + z * 1024; if (!reserved.has(k)) reserved.set(k, []); reserved.get(k)!.push(a);
    }
  };
  const plan = (m: Mason, owner: number): Approach[] => {
    const out: Approach[] = [];
    const own = index(m.pieces.filter((p) => { const shape = RUIN_SHAPES[p.kind.split("_")[1] as RuinShape]; return p.y + shape[1] / 2 > m.base + .4 && p.y - shape[1] / 2 < m.base + 2.2; }));
    const obstructed = (x: number, z: number, y: number): boolean => {
      const bx = Math.floor(x / 16); const bz = Math.floor(z / 16);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const grid of [own, solids]) {
        for (const o of grid.get(bx + dx + (bz + dz) * 1024) ?? []) {
          if (o.hi <= y + .38 || o.lo >= y + 2.1) continue;
          const px = x - o.x; const pz = z - o.z;
          if (Math.abs(px * o.c - pz * o.s) < o.w && Math.abs(px * o.s + pz * o.c) < o.d) return true;
        }
      }
      return false;
    };
    for (const entry of m.entries) {
      const insideLength = Math.hypot(entry.x - entry.coreX, entry.z - entry.coreZ);
      if (Array.from({ length: Math.ceil(insideLength) + 1 }, (_, i) => i / Math.ceil(insideLength)).some((t) => obstructed(entry.x + (entry.coreX - entry.x) * t, entry.z + (entry.coreZ - entry.z) * t, m.base))) continue;
      let ramp = 1;
      const bx = Math.floor(entry.x / 64); const bz = Math.floor(entry.z / 64); const candidates: { x: number; z: number }[] = [];
      for (let x = bx - 2; x <= bx + 2; x++) for (let z = bz - 2; z <= bz + 2; z++) candidates.push(...bins.get(`${x},${z}`) ?? []);
      candidates.sort((a, b) => Math.hypot(a.x - entry.x, a.z - entry.z) - Math.hypot(b.x - entry.x, b.z - entry.z));
      const street = [4, 0].flatMap((margin) => candidates.slice(0, 48).map((street) => ({ street, margin }))).find(({ street: p, margin }) => {
        const len = Math.hypot(p.x - entry.x, p.z - entry.z); const groundY = site.groundAt(p.x, p.z); const y = Math.abs(groundY - m.base) < .4 ? m.base : groundY;
        if (len > 112 || len < 4 || y < .1 || Math.abs(y - m.base) / len > .12) return false;
        let boundary = len;
        for (let s = 0; s <= len; s += .25) {
          const x = p.x + (entry.x - p.x) * s / len; const z = p.z + (entry.z - p.z) * s / len;
          const other = heaps.owner[at(x, z)];
          if (other !== undefined && other >= 0 && other !== owner) return false;
          for (const [dx, dz] of [[-margin, 0], [margin, 0], [0, -margin], [0, margin]]) {
            const beside = heaps.owner[at(x + dx!, z + dz!)];
            if (beside !== undefined && beside >= 0 && beside !== owner) return false;
          }
          if (other === owner) boundary = Math.min(boundary, s);
        }
        ramp = Math.max(.05, (boundary - 3) / len);
        if (Math.abs(y - m.base) / (len * ramp) > .18) return false;
        for (let s = 0; s <= len; s += .25) {
          const t = s / len; const x = p.x + (entry.x - p.x) * t; const z = p.z + (entry.z - p.z) * t;
          const level = y + (m.base - y) * Math.min(1, t / ramp);
          if (obstructed(x, z, level)) return false;
          for (const a of [...(reserved.get(Math.floor(x / 32) + Math.floor(z / 32) * 1024) ?? []), ...out]) {
            const dx = a.door.x - a.street.x; const dz = a.door.z - a.street.z;
            const along = Math.max(0, Math.min(1, ((x - a.street.x) * dx + (z - a.street.z) * dz) / (dx * dx + dz * dz)));
            if (Math.hypot(x - a.street.x - dx * along, z - a.street.z - dz * along) >= 8) continue;
            const other = a.street.y + (a.door.y - a.street.y) * Math.min(1, along / a.ramp);
            if (Math.abs(other - level) > .35) return false;
          }
        }
        return true;
      })?.street;
      if (!street) continue;
      const groundY = site.groundAt(street.x, street.z);
      const from = { ...street, y: Math.abs(groundY - m.base) < .4 ? m.base : groundY }; const door = { x: entry.x, y: m.base, z: entry.z };
      out.push({ street: from, door, core: { x: entry.coreX, y: m.base, z: entry.coreZ }, ramp });
      const length = Math.hypot(from.x - door.x, from.z - door.z);
      for (let d = 0; d <= length; d += 2) {
        const t = d / length; const x = from.x + (door.x - from.x) * t; const z = from.z + (door.z - from.z) * t; const y = from.y + (door.y - from.y) * Math.min(1, t / ramp);
        m.clear.push({ x, z, radius: 10 });
        if ([-6, -4, -2, 0, 2, 4, 6].some((s) => site.ground.water[at(x + (door.x - from.x) / length * s, z + (door.z - from.z) / length * s)])) {
          m.pieces.push({ kind: "core:zruin_floor4_concrete", x, y: y - .2, z, yaw: Math.atan2(from.z - door.z, door.x - from.x) * 180 / Math.PI });
        }
      }
      const inside = Math.hypot(entry.coreX - door.x, entry.coreZ - door.z);
      for (let d = 0; d <= inside; d += 2) {
        const t = d / inside; const x = door.x + (entry.coreX - door.x) * t; const z = door.z + (entry.coreZ - door.z) * t;
        if (site.ground.water[at(x, z)] || site.groundAt(x, z) < m.base - .4) m.pieces.push({ kind: "core:zruin_floor4_concrete", x, y: m.base - .2, z, yaw: entry.yaw });
      }
    }
    return out;
  };
  return Object.assign(plan, { reserve });
}
export function gradeApproaches(site: Site, approaches: readonly Approach[], owner: number): void {
  const { n, height, water, heaps } = site.ground; const size = (n - 1) * 2;
  for (const a of approaches) {
    const dx = a.door.x - a.street.x; const dz = a.door.z - a.street.z; const length = Math.hypot(dx, dz);
    for (let row = Math.max(0, Math.floor((size - Math.max(a.street.z, a.door.z) - 5) / 2)); row <= Math.min(n - 1, Math.ceil((size - Math.min(a.street.z, a.door.z) + 5) / 2)); row++) for (let col = Math.max(0, Math.floor((size - Math.max(a.street.x, a.door.x) - 5) / 2)); col <= Math.min(n - 1, Math.ceil((size - Math.min(a.street.x, a.door.x) + 5) / 2)); col++) {
      const i = row * n + col; if (water[i] || (owner >= 0 && heaps.owner[i]! >= 0 && heaps.owner[i] !== owner)) continue;
      const x = size - col * 2; const z = size - row * 2;
      const t = Math.max(0, Math.min(1, ((x - a.street.x) * dx + (z - a.street.z) * dz) / (length * length)));
      const distance = Math.hypot(x - a.street.x - dx * t, z - a.street.z - dz * t); if (distance >= 5) continue;
      const y = Math.abs(a.street.y - a.door.y) < .4 ? a.door.y : a.street.y + (a.door.y - a.street.y) * Math.min(1, t / a.ramp); const weight = Math.min(1, (5 - distance) / 2);
      height[i] = height[i]! * (1 - weight) + y * weight;
    }
  }
}
