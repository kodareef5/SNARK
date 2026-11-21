// The banks of water that are not a beach, cooked on the terrain as the beach is (beach.ts). The ground's 2 m samples
// are each land or water, so a waterline that runs across them steps from sample to sample, and a low bank of grass
// drops from its 12 cm into the water in one sample. Here the waterline is put where a filter of BANK_REACH finds the
// line between the land and the water round it, and a low soft bank (grass, open ground, mangrove, marsh) is given a
// short slope down to that line and on into the water over BANK_SLOPE metres inland and out, eased back into the measured
// ground beyond. A bank higher than BANK_HIGH, and every built one (a road, a walk, a wall, a quay), is left as it was
// measured: its own counts in the filter, but is never moved.

/** What a sample is to the banks: none of them, water or land; BANK_FIXED added where it counts but stays as it is. */
export const BANK_NONE = 0, BANK_WATER = 1, BANK_LAND = 2, BANK_FIXED = 4;
/** Metres round a sample over which the line between land and water is found. */
export const BANK_REACH = 8;
/** Metres inland of the waterline and out from it over which a soft bank slopes. */
export const BANK_SLOPE = [3, 5] as const;
/** Metres over its water above which a bank is high, and left as it was. */
export const BANK_HIGH = 1;
/** The deepest the slope takes the water at its foot, and the shallowest; the most any sample moves. */
const FOOT = [-0.8, -0.15] as const;
const MOST = 0.6;

const smooth = (lo: number, hi: number, v: number): number => {
  const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
};

/**
 * The share of a filter of radius 1, weighing (1 - d²)² at d, that lies on one side of a straight line at signed
 * distance s from its middle, by s from -1 to 1 in TABLE steps: across a line its weight is (1 - u²)^(5/2), so the
 * share is the integral of that from -s.
 */
const TABLE = 400;
const SHARE = (() => {
  const steps = 4000, column: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const u = -1 + (2 * k) / steps, a = Math.max(0, 1 - u * u);
    column.push(a * a * Math.sqrt(a));
  }
  const sum: number[] = [0];
  for (let k = 1; k <= steps; k++) sum.push(sum[k - 1]! + (column[k - 1]! + column[k]!) / 2);
  const all = sum[steps]!;
  // share(s) = the part of the filter at u > -s.
  return Array.from({ length: TABLE + 1 }, (_, t) => {
    const s = -1 + (2 * t) / TABLE;
    return 1 - sum[Math.round(((-s + 1) / 2) * steps)]! / all;
  });
})();

/** The signed distance, as a share of the filter's radius, at which the filter has `share` of its weight on the land. */
export function shareDistance(share: number): number {
  let lo = 0, hi = TABLE;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (SHARE[mid]! < share) lo = mid;
    else hi = mid;
  }
  const a = SHARE[lo]!, b = SHARE[hi]!;
  const t = b > a ? (share - a) / (b - a) : 0;
  return -1 + (2 * (lo + Math.max(0, Math.min(1, t)))) / TABLE;
}

/**
 * Rounds the banks of `height` (metres, `nx` by `nz` samples `cell` apart). `kindAt` says what a sample is to the banks;
 * `levelAt` the surface of the water it is in or beside, the sea's 0 or a lake's. `bed` is told each sample of water
 * at the foot of a soft bank after the change, and `edge` each that was water and is now land. Returns the samples moved.
 */
export function shapeBanks(height: Float32Array, nx: number, nz: number, cell: number, kindAt: (i: number) => number, levelAt: (i: number) => number, bed: (i: number) => void, edge: (i: number) => void): number {
  const r = Math.ceil(BANK_REACH / cell), tile = 16, across = Math.ceil(nx / tile);
  const tiles = new Set<number>();
  // Only tiles within a filter's radius of a soft bank's waterline.
  for (let y = 1; y < nz - 1; y++) {
    for (let x = 1; x < nx - 1; x++) {
      const i = y * nx + x;
      if (kindAt(i) !== BANK_LAND) continue;
      const level = levelAt(i);
      let wet = false;
      for (const j of [i - 1, i + 1, i - nx, i + nx]) if ((kindAt(j) & 3) === BANK_WATER && Math.abs(levelAt(j) - level) < 0.01) wet = true;
      if (!wet) continue;
      for (let ty = Math.floor(Math.max(0, y - r) / tile); ty <= Math.floor(Math.min(nz - 1, y + r) / tile); ty++)
        for (let tx = Math.floor(Math.max(0, x - r) / tile); tx <= Math.floor(Math.min(nx - 1, x + r) / tile); tx++) tiles.add(ty * across + tx);
    }
  }
  const kernel: { x: number; y: number; w: number }[] = [];
  let mass = 0;
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d2 = ((x * x + y * y) * cell * cell) / (BANK_REACH * BANK_REACH);
      if (d2 >= 1) continue;
      const w = (1 - d2) * (1 - d2);
      kernel.push({ x, y, w });
      mass += w;
    }
  const indices: number[] = [], values: number[] = [], beds: number[] = [], edges: number[] = [];
  for (const id of tiles) {
    const x0 = (id % across) * tile, y0 = Math.floor(id / across) * tile;
    for (let y = Math.max(1, y0); y < Math.min(nz - 1, y0 + tile); y++) {
      for (let x = Math.max(1, x0); x < Math.min(nx - 1, x0 + tile); x++) {
        const i = nx * y + x, kind = kindAt(i);
        if (kind !== BANK_LAND && kind !== BANK_WATER) continue;
        const level = levelAt(i), original = height[i]! - level;
        // Shared map boundary samples keep their survey, and the change eases out over the last filter radius.
        const border = Math.min(1, Math.min(x, y, nx - 1 - x, nz - 1 - y) / r);
        let land = 0, soft = 0, water = 0, landSum = 0, waterSum = 0;
        for (const k of kernel) {
          if (x + k.x < 0 || x + k.x >= nx || y + k.y < 0 || y + k.y >= nz) continue;
          const j = i + k.y * nx + k.x, c = kindAt(j) & 3;
          if (c === BANK_NONE || Math.abs(levelAt(j) - level) >= 0.01) continue;
          const h = height[j]! - level;
          if (c === BANK_LAND) {
            land += k.w;
            landSum += k.w * h;
            if (kindAt(j) === BANK_LAND) soft += k.w;
          } else {
            water += k.w;
            waterSum += k.w * h;
          }
        }
        if (land <= 0 || water <= 0) continue;
        const top = landSum / land, foot = Math.max(FOOT[0], Math.min(FOOT[1], waterSum / water));
        // Metres inland of the line the filter finds, and the slope's height there: up to the bank's top over
        // BANK_SLOPE inland, and down to its foot over BANK_SLOPE out. A high bank is left as it is.
        const s = shareDistance(land / (land + water)) * BANK_REACH, slope = BANK_SLOPE[s >= 0 ? 0 : 1];
        const target = s >= 0 ? Math.max(0.02, top) * Math.min(1, s / slope) : foot * Math.min(1, -s / slope);
        // Most of the land round it must be a soft bank, so the water before a road or a quay is left as it is.
        const strength = border * (1 - smooth(slope, 2 * slope, Math.abs(s))) * (1 - smooth(BANK_HIGH * 0.8, BANK_HIGH * 1.2, top)) * smooth(0.3, 0.7, soft / land) * Math.max(0, Math.min(1, ((land + water) / mass - 0.5) * 2));
        if (strength <= 0) continue;
        const value = original + Math.max(-MOST, Math.min(MOST, target - original)) * strength;
        if (Math.abs(value - original) > 0.001) {
          indices.push(i);
          values.push(value + level);
        }
        if (value < 0 && s > -BANK_SLOPE[1] && s < 0.5) beds.push(i);
        if (kind === BANK_WATER && value >= 0) edges.push(i);
      }
    }
  }
  // Commit together, so the order the tiles are taken in cannot show in the result.
  for (let k = 0; k < indices.length; k++) height[indices[k]!] = values[k]!;
  for (const i of beds) bed(i);
  for (const i of edges) edge(i);
  return indices.length;
}
