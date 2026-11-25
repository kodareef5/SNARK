import { TEK_JAW, TEK_LATCH, TEK_WALL, jawContact, jawDepth, latchDepth } from "../../../content/building/tek-wall.ts";

type Point = readonly [number, number];
type Vertex = readonly [number, number, number];
type Polygon = readonly Vertex[];

/** Only metal standing above the field can intercept the last part of the incoming ray. */
function exposed(points: Polygon): Polygon {
  const out: Vertex[] = [];
  let a = points[points.length - 1]!;
  for (const b of points) {
    if ((b[2] > 0) !== (a[2] > 0)) {
      const t = a[2] / (a[2] - b[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0]);
    }
    if (b[2] > 0) out.push(b);
    a = b;
  }
  return out;
}

function casting(foot: readonly Point[], cap: readonly Point[], low: number, depth: (x: number) => number): Polygon[] {
  const top = cap.map(([x, y]): Vertex => [x, y, depth(x) - TEK_WALL.fieldZ]);
  const base = foot.map(([x, y]): Vertex => [x, y, low - TEK_WALL.fieldZ]);
  const sides = base.map((p, i) => {
    const j = (i + 1) % base.length;
    return exposed([p, base[j]!, top[j]!, top[i]!]);
  });
  return [exposed(top), ...sides].filter(p => p.length >= 3);
}

const cheek = casting(TEK_JAW.foot, TEK_JAW.cap, TEK_JAW.low, jawDepth);
const bars = TEK_JAW.copperRuns.flatMap(run => {
  const p = jawContact(run);
  return casting(p, p, 0, () => TEK_JAW.copperZ);
});
const latch = [...casting(TEK_LATCH.foot, TEK_LATCH.cap, TEK_LATCH.low, latchDepth),
  ...casting(TEK_LATCH.tab, TEK_LATCH.tab, 0, () => TEK_LATCH.tabZ)];

/** The ray projects each raised polygon onto the field. Test its endpoint in that silhouette. */
function covered(faces: readonly Polygon[], x: number, y: number, dx: number, dy: number): boolean {
  for (const p of faces) {
    const last = p[p.length - 1]!;
    let ax = last[0] - last[2] * dx, ay = last[1] - last[2] * dy, inside = false;
    for (const q of p) {
      const bx = q[0] - q[2] * dx, by = q[1] - q[2] * dy;
      if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
      ax = bx; ay = by;
    }
    if (inside) return true;
  }
  return false;
}

/** From the field out to the collider, dx and dy are local travel per metre of depth. */
export function hardwareBlocks(u: number, v: number, entryU: number, entryV: number, dx: number, dy: number): boolean {
  if (Math.max(u, entryU) > 1.07 && Math.min(u, entryU) < 1.25 && Math.max(v, entryV) > -.46 && Math.min(v, entryV) < -.24 &&
      covered(latch, u, v, dx, dy)) return true;
  if (Math.max(Math.abs(u), Math.abs(entryU)) < .82 || Math.max(Math.abs(v), Math.abs(entryV)) < .82) return false;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    if (Math.max(sx * u, sx * entryU) < .82 || Math.max(sy * v, sy * entryV) < .82) continue;
    const run = (2 * TEK_JAW.origin - sx * u - sy * v) * Math.SQRT1_2, cross = (sy * v - sx * u) * Math.SQRT1_2;
    const dr = (-sx * dx - sy * dy) * Math.SQRT1_2, dc = (sy * dy - sx * dx) * Math.SQRT1_2;
    if (covered(cheek, run, cross, dr, dc) || covered(cheek, run, -cross, dr, -dc) || covered(bars, run, cross, dr, dc)) return true;
  }
  return false;
}
