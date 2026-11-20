// The mock world's ground: a grid of kinds a metre square, painted from a scene's features, and the map a player's map
// screen would show of it. The map is drawn from the ground as the world starts, so a change after (a bridge down, a
// wall raised) is seen only up close, as in a game; with fog it shows only what the character has been near.

export const GROUND = 0, CLIFF = 1, DEEP = 2, SHALLOW = 3, ROAD = 4, BRIDGE = 5;
/** The letter each kind is drawn with, in the terrain and map channels. */
export const CHAR = [".", "#", "~", ",", "=", "H"] as const;
export const LEGEND: Record<string, string> = { ".": "ground", "#": "blocked", "~": "deep_water", ",": "shallow_water", "=": "road", H: "bridge", "?": "unknown" };

export type P2 = [number, number];
export type Feature =
  | { type: "cliff"; from: P2; to: P2; width?: number; height?: number }
  | { type: "water"; rect: [number, number, number, number]; depth?: "deep" | "shallow" }
  | { type: "road"; points: P2[]; width?: number }
  | { type: "bridge"; from: P2; to: P2; width?: number }
  | { type: "ground"; rect: [number, number, number, number] };

export interface TerrainSpec {
  /** The map's extent: x0, z0 (north-west), x1, z1. Outside it is the map's edge, which nothing crosses. */
  bounds: [number, number, number, number];
  features: Feature[];
  /** "full": the map screen shows all the ground; "fog": only what the character has been near. */
  map?: "full" | "fog";
  /** Changes after the start, which the map does not show: the surprises. */
  changes?: { at_s: number; feature: Feature }[];
}

export class Terrain {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;
  readonly kinds: Uint8Array;
  /** How tall a blocked cell is, for things that fly. */
  readonly heights: Float32Array;
  /** The kinds as the map screen drew them at the start. */
  readonly mapped: Uint8Array;
  readonly fog: boolean;
  /** Cells the character has been near, under fog. */
  readonly explored: Uint8Array;

  constructor(spec: TerrainSpec) {
    const [x0, z0, x1, z1] = spec.bounds;
    this.x0 = Math.floor(x0);
    this.z0 = Math.floor(z0);
    this.w = Math.ceil(x1 - x0);
    this.h = Math.ceil(z1 - z0);
    this.kinds = new Uint8Array(this.w * this.h);
    this.heights = new Float32Array(this.w * this.h);
    for (const f of spec.features) this.paint(f);
    this.mapped = this.kinds.slice();
    this.fog = spec.map === "fog";
    this.explored = new Uint8Array(this.w * this.h);
  }

  private index(x: number, z: number): number {
    const i = Math.floor(x) - this.x0, j = Math.floor(z) - this.z0;
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }

  /** The kind at a point; the map's edge counts as blocked. */
  at(x: number, z: number): number {
    const k = this.index(x, z);
    return k < 0 ? CLIFF : this.kinds[k]!;
  }

  height(x: number, z: number): number {
    const k = this.index(x, z);
    return k < 0 ? 1000 : this.heights[k]!;
  }

  private set(x: number, z: number, kind: number, height = 0): void {
    const k = this.index(x, z);
    if (k < 0) return;
    this.kinds[k] = kind;
    this.heights[k] = kind === CLIFF ? height : 0;
  }

  paint(f: Feature): void {
    if (f.type === "water" || f.type === "ground") {
      const [ax, az, bx, bz] = f.rect;
      const kind = f.type === "ground" ? GROUND : f.depth === "shallow" ? SHALLOW : DEEP;
      for (let z = Math.min(az, bz); z < Math.max(az, bz); z++) for (let x = Math.min(ax, bx); x < Math.max(ax, bx); x++) this.set(x, z, kind);
      return;
    }
    const kind = f.type === "cliff" ? CLIFF : f.type === "road" ? ROAD : BRIDGE;
    const width = f.width ?? (f.type === "cliff" ? 2 : f.type === "road" ? 6 : 4);
    const height = f.type === "cliff" ? (f.height ?? 30) : 0;
    const pts = f.type === "road" ? f.points : [f.from, f.to];
    for (let i = 0; i + 1 < pts.length; i++) this.stroke(pts[i]!, pts[i + 1]!, width, kind, height);
  }

  /** A band `width` wide along a segment. */
  private stroke(a: P2, b: P2, width: number, kind: number, height: number): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const half = width / 2;
    const [minx, maxx] = [Math.min(a[0], b[0]) - half, Math.max(a[0], b[0]) + half];
    const [minz, maxz] = [Math.min(a[1], b[1]) - half, Math.max(a[1], b[1]) + half];
    for (let z = Math.floor(minz); z <= Math.ceil(maxz); z++) {
      for (let x = Math.floor(minx); x <= Math.ceil(maxx); x++) {
        const cx = x + 0.5, cz = z + 0.5;
        const t = Math.max(0, Math.min(1, ((cx - a[0]) * (b[0] - a[0]) + (cz - a[1]) * (b[1] - a[1])) / (len * len)));
        const d = Math.hypot(cx - (a[0] + t * (b[0] - a[0])), cz - (a[1] + t * (b[1] - a[1])));
        if (d <= half) this.set(x, z, kind, height);
      }
    }
  }

  /** Marks what is within `radius` of a point as explored (a player sees the land about it as it goes). */
  explore(x: number, z: number, radius: number): void {
    if (!this.fog) return;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const k = this.index(x + dx, z + dz);
        if (k >= 0) this.explored[k] = 1;
      }
    }
  }

  /** Whether a straight line between two points stays clear of blocked ground taller than `above` (sight, flight). */
  clear(ax: number, az: number, bx: number, bz: number, above = 1.5): boolean {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      if (this.at(x, z) === CLIFF && this.height(x, z) > above) return false;
    }
    return true;
  }

  /** The map screen: the ground as drawn at the start, `cell` metres a letter, blocked winning where a quarter of
   * the cell is blocked (so a thin wall is not drawn away), unknown where fog hides it. */
  map(cell = 4): { cell: number; origin: [number, number]; size: [number, number]; rows: string[] } {
    const cw = Math.ceil(this.w / cell), ch = Math.ceil(this.h / cell);
    const rows: string[] = [];
    for (let j = 0; j < ch; j++) {
      let row = "";
      for (let i = 0; i < cw; i++) {
        const counts = [0, 0, 0, 0, 0, 0];
        let seen = 0, n = 0;
        for (let dz = 0; dz < cell; dz++) {
          for (let dx = 0; dx < cell; dx++) {
            const x = i * cell + dx, z = j * cell + dz;
            if (x >= this.w || z >= this.h) continue;
            const k = z * this.w + x;
            n++;
            counts[this.mapped[k]!]!++;
            if (!this.fog || this.explored[k]) seen++;
          }
        }
        if (this.fog && seen < n / 2) {
          row += "?";
          continue;
        }
        let kind = counts.indexOf(Math.max(...counts));
        if (counts[CLIFF]! * 4 >= n) kind = CLIFF;
        row += CHAR[kind];
      }
      rows.push(row);
    }
    return { cell, origin: [this.x0, this.z0], size: [cw, ch], rows };
  }
}
