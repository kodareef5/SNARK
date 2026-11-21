// Cook the foreshore on the terrain itself, so the camera, walker, swimmer and water shader see the same beach.
export const BEACH_LAND = 1,
  BEACH_SEA = 2;

/** The caller identifies surveyed sand and open marine bed. Other ground (especially quays and lakes) is protected. */
export function shapeBeach(
  height: Float32Array,
  nx: number,
  nz: number,
  cell: number,
  kindAt: (i: number) => number,
  sandyBed: (i: number) => void,
): number {
  const reach = 12,
    r = Math.ceil(reach / cell),
    tile = 16,
    across = Math.ceil(nx / tile);
  const tiles = new Set<number>();
  // Most of a city never meets the kernel. Find only tiles within one kernel radius of a sandy land/sea edge.
  for (let y = 1; y < nz - 1; y++) {
    for (let x = 1; x < nx - 1; x++) {
      const i = y * nx + x,
        h = height[i]!;
      if (h < -0.25 || h > 2 || kindAt(i) !== BEACH_LAND) continue;
      if (
        kindAt(i - 1) !== BEACH_SEA &&
        kindAt(i + 1) !== BEACH_SEA &&
        kindAt(i - nx) !== BEACH_SEA &&
        kindAt(i + nx) !== BEACH_SEA
      )
        continue;
      for (let ty = Math.floor(Math.max(0, y - r) / tile); ty <= Math.floor(Math.min(nz - 1, y + r) / tile); ty++)
        for (let tx = Math.floor(Math.max(0, x - r) / tile); tx <= Math.floor(Math.min(nx - 1, x + r) / tile); tx++)
          tiles.add(ty * across + tx);
    }
  }
  const kernel: { x: number; y: number; w: number }[] = [];
  let mass = 0;
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d2 = ((x * x + y * y) * cell * cell) / (reach * reach);
      if (d2 >= 1) continue;
      const w = (1 - d2) ** 2;
      kernel.push({ x, y, w });
      mass += w;
    }
  const indices: number[] = [],
    values: number[] = [],
    bed: number[] = [];
  for (const id of tiles) {
    const x0 = (id % across) * tile,
      y0 = Math.floor(id / across) * tile;
    for (let y = Math.max(1, y0); y < Math.min(nz - 1, y0 + tile); y++) {
      for (let x = Math.max(1, x0); x < Math.min(nx - 1, x0 + tile); x++) {
        const i = nx * y + x,
          original = height[i]!,
          kind = kindAt(i);
        if (!kind || original < -1.35 || original > 1.65) continue;
        // Keep shared map boundary vertices surveyed and ease out over the last kernel radius.
        const edge = Math.min(1, Math.min(x, y, nx - 1 - x, nz - 1 - y) / r);
        let land = 0,
          sea = 0,
          sum = 0;
        for (const k of kernel) {
          if (edge < 1 && (x+k.x < 0 || x+k.x >= nx || y+k.y < 0 || y+k.y >= nz)) continue;
          const j = i + k.y * nx + k.x,
            h = height[j]!,
            neighbour = kindAt(j);
          if (neighbour === BEACH_LAND) land += k.w;
          else if (neighbour === BEACH_SEA) sea += k.w;
          else continue;
          sum += k.w * h;
        }
        const weight = sea + land;
        if (land <= 0 || sea <= 0) continue;
        const shore = land / weight;
        // The smoothed land fraction reconstructs the contour between survey pixels. Grade through it and
        // blend back to the measured relief on either side. Near a wall, the missing samples taper the edit.
        const mixed = 4 * shore * (1 - shore);
        const surveyed = sum / weight;
        const face = surveyed + ((shore - 0.5) * 0.74 - surveyed) * 0.7 * mixed;
        const strength = edge * Math.min(1, 5 * mixed) * Math.max(0, Math.min(1, (weight / mass - 0.5) * 2));
        const value = original + Math.max(-0.55, Math.min(0.55, face - original)) * strength;
        if (Math.abs(value - original) > 0.001) {
          indices.push(i);
          values.push(value);
        }
        if (kind === BEACH_SEA && value > -0.55 && shore > 0.025 && strength > 0.35) bed.push(i);
      }
    }
  }
  // Commit together so traversal order and tile boundaries cannot imprint the result.
  for (let i = 0; i < indices.length; i++) height[indices[i]!] = values[i]!;
  for (const i of bed) sandyBed(i);
  return indices.length;
}
