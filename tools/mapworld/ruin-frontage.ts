import { Mason, type Frame } from "./ruin-geometry.ts";
import type { RuinRecord } from "./ruins.ts";
import type { Vocabulary } from "./ruin-vocabulary.ts";

/** Join aligned low street fronts across small tessellation gaps, subject to the same route and piece budgets as props. */
export function joinFrontages(records: RuinRecord[], v: Vocabulary, accept: (m: Mason) => boolean): number {
  const rows = records.filter((r) => r.height <= 36 && r.party?.some((s) => s === 1 || s === 3) && ["apartment", "hotel", "shop", "fabric", "civic"].includes(r.form));
  const bins = new Map<string, RuinRecord[]>();
  for (const r of rows) { const k = `${Math.floor(r.x / 64)},${Math.floor(r.z / 64)}`; if (!bins.has(k)) bins.set(k, []); bins.get(k)!.push(r); }
  let joined = 0;
  for (const r of rows) {
    const a = r.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    const bx = Math.floor(r.x / 64); const bz = Math.floor(r.z / 64);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (const q of bins.get(`${bx + dx},${bz + dz}`) ?? []) {
      if (q.part <= r.part || Math.abs(q.y - r.y) > .3 || Math.abs(q.yaw - r.yaw) > 4) continue;
      const u = (q.x - r.x) * c - (q.z - r.z) * s; const z = (q.x - r.x) * s + (q.z - r.z) * c;
      const width = Math.floor(r.width / 8) * 8; const qw = Math.floor(q.width / 8) * 8;
      const front = -Math.floor(r.depth / 8) * 4; const qfront = z - Math.floor(q.depth / 8) * 4;
      const gap = Math.abs(u) - (width + qw) / 2;
      if (gap <= .1 || gap > 10 || Math.abs(front - qfront) > 1) continue;
      const mid = Math.sign(u) * (width / 2 + gap / 2);
      const f: Frame = { x: r.x, z: r.z, yaw: r.yaw, c, s, width: r.width, depth: r.depth, rings: [] };
      const m = new Mason(f, Math.min(r.y, q.y)); const finish = (v.districts[r.district] ?? v.districts.default)!.finish[0]!;
      m.put(gap < 4.1 ? "wall4" : "wall8", mid, 1.4, (front + qfront) / 2, finish);
      m.put(gap < 4.1 ? "trim4" : "trim8", mid, 3.2, (front + qfront) / 2, finish);
      if (accept(m)) joined++;
    }
  }
  return joined;
}
