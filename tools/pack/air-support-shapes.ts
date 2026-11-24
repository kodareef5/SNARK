import { fileURLToPath } from "node:url";
import type { PackMaterial } from "../../shared/pack/pack.ts";
import { defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { type SourceLod } from "./write.ts";

export type Point = [number, number, number];
type Ring = [z: number, halfWidth: number, bottom: number, top: number];
const palette = defaultPalette();
const coat = (r: number, g: number, b: number) => nearestColour(palette, r, g, b);
export const IRON = coat(44, 53, 59),
  SLATE = coat(68, 80, 84),
  STEEL = coat(117, 127, 127);
export const SHELL = coat(208, 207, 185),
  EDGE = coat(229, 225, 209),
  GLASS = coat(36, 73, 78);
export const ORANGE = coat(212, 105, 42),
  GOLD = coat(240, 176, 74),
  TEAL = coat(123, 204, 207);
export const RUBBER = coat(35, 36, 38),
  RED = coat(192, 57, 50);

export const OPTIC = coat(21, 34, 79),
  JADE = coat(90, 151, 133),
  BLUE = coat(42, 123, 143);
export const swatches = [IRON, SLATE, STEEL, SHELL, EDGE, GLASS, ORANGE, GOLD, TEAL, RUBBER, RED, OPTIC, JADE, BLUE];
export const airMaterial = {
  id: "core:air_support/finish",
  name: "finish",
  dir: fileURLToPath(new URL("../../assets/raw/air-support/", import.meta.url)),
  spec: { base: "base.png", normal: "normal.png", packed: "finish.png" },
};
export const airTextures = (["base", "normal", "mro"] as const).map((role) => ({ id: airMaterial.id + "/" + role, role, top: 512 }));
export const finish: PackMaterial = {
  id: airMaterial.id,
  base: 0,
  normal: 1,
  mro: 2,
  mask: -1,
  mask2: -1,
  tint: [1, 1, 1],
  grey: 1,
  emissive: 0,
  flags: 0,
  cutoff: 0,
  span: 1,
};

export class Model {
  private readonly uv: number[] = [];
  private readonly normals: number[] = [];
  private readonly verts: number[] = [];
  private readonly indices: number[] = [];
  private readonly colors: number[] = [];

  readonly level: number;
  constructor(level: number) {
    this.level = level;
  }

  face(points: Point[], color: number, shading?: Point[], mapped?: Point[], tile = swatches.indexOf(color)): void {
    const start = this.verts.length / 3;
    for (const point of points) {
      this.verts.push(...point);
      this.colors.push(color);
    }
    if (this.level === 0) this.surface(points, shading, mapped, Math.max(0, tile));
    for (let i = 2; i < points.length; i++) this.indices.push(start, start + i - 1, start + i);
  }

  private surface(points: Point[], shading: Point[] | undefined, mapped: Point[] | undefined, tile: number): void {
    const [a, b, c] = points as [Point, Point, Point, ...Point[]];
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const n = Math.hypot(nx, ny, nz) || 1,
      u = Math.hypot(ux, uy, uz) || 1;
    const s = points.map((p) => (p[0] * ux + p[1] * uy + p[2] * uz) / u);
    const t = points.map((p) => (p[0] * (ny * uz - nz * uy) + p[1] * (nz * ux - nx * uz) + p[2] * (nx * uy - ny * ux)) / (n * u));
    const left = Math.min(...s),
      bottom = Math.min(...t),
      width = Math.max(...s) - left || 1,
      height = Math.max(...t) - bottom || 1;
    for (let i = 0; i < points.length; i++) {
      this.uv.push(
        ((tile % 4) + (mapped?.[i]?.[0] ?? 0.06 + (0.88 * (s[i]! - left)) / width)) / 4,
        (Math.floor(tile / 4) + (mapped?.[i]?.[1] ?? 0.06 + (0.88 * (t[i]! - bottom)) / height)) / 4,
      );
      if (shading) this.normals.push(...shading[i]!);
      else this.normals.push(nx / n, ny / n, nz / n);
    }
  }

  /** Each section is a clockwise ring looking from its first end toward its last. */
  solid(rings: Point[][], color: number): void {
    this.face([...rings[0]!].reverse(), color);
    for (let i = 1; i < rings.length; i++) {
      const prev = rings[i - 1]!,
        next = rings[i]!;
      for (let j = 0; j < prev.length; j++) {
        const k = (j + 1) % prev.length;
        this.face([prev[j]!, prev[k]!, next[k]!, next[j]!], color);
      }
    }
    this.face(rings[rings.length - 1]!, color);
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number): void {
    const a = w / 2,
      b = h / 2;
    this.solid(
      [z - d / 2, z + d / 2].map((c) => [
        [x - a, y - b, c],
        [x + a, y - b, c],
        [x + a, y + b, c],
        [x - a, y + b, c],
      ]),
      color,
    );
  }

  shell(x: number, rings: Ring[], color: number): void {
    this.solid(
      rings.map(([z, w, lo, hi]) => {
        const bevel = Math.min(w * 0.32, (hi - lo) * 0.3);
        return [
          [x - w + bevel, lo, z],
          [x + w - bevel, lo, z],
          [x + w, lo + bevel, z],
          [x + w, hi - bevel, z],
          [x + w - bevel, hi, z],
          [x - w + bevel, hi, z],
          [x - w, hi - bevel, z],
          [x - w, lo + bevel, z],
        ];
      }),
      color,
    );
  }

  rod(start: Point, end: Point, r: number, color: number, sides = 8, endRadius = r): void {
    const dx = end[0] - start[0],
      dy = end[1] - start[1],
      dz = end[2] - start[2];
    const length = Math.hypot(dx, dy, dz),
      nx = dx / length,
      ny = dy / length,
      nz = dz / length;
    const ax = Math.abs(ny) < 0.9 ? nz : ny,
      ay = Math.abs(ny) < 0.9 ? 0 : -nx,
      az = Math.abs(ny) < 0.9 ? -nx : 0;
    const norm = Math.hypot(ax, ay, az),
      ux = ax / norm,
      uy = ay / norm,
      uz = az / norm;
    const vx = ny * uz - nz * uy,
      vy = nz * ux - nx * uz,
      vz = nx * uy - ny * ux;
    this.solid(
      [start, end].map((point, k) =>
        Array.from({ length: sides }, (_, j): Point => {
          const angle = ((j + 0.5) * Math.PI * 2) / sides,
            a = Math.cos(angle) * (k ? endRadius : r),
            b = Math.sin(angle) * (k ? endRadius : r);
          return [point[0] + ux * a + vx * b, point[1] + uy * a + vy * b, point[2] + uz * a + vz * b];
        }),
      ),
      color,
    );
  }

  duct(x: number, y: number, z: number, radius: number, parked: boolean): void {
    const n = this.level === 0 ? 16 : 8;
    const vertex = (a: number, r: number, h: number): Point => [x + Math.cos(a) * r, y + h, z + Math.sin(a) * r];
    for (let i = 0; i < n; i++) {
      const a = (i * Math.PI * 2) / n,
        b = ((i + 1) * Math.PI * 2) / n;
      const outer = radius,
        inner = radius * 0.76,
        h = radius * 0.27;
      this.face([vertex(b, outer, h), vertex(a, outer, h), vertex(a, inner, h), vertex(b, inner, h)], SHELL);
      this.face([vertex(a, outer, -h), vertex(a, outer, h), vertex(b, outer, h), vertex(b, outer, -h)], IRON);
      this.face([vertex(b, inner, -h), vertex(b, inner, h), vertex(a, inner, h), vertex(a, inner, -h)], STEEL);
      this.face([vertex(a, inner, -h), vertex(a, outer, -h), vertex(b, outer, -h), vertex(b, inner, -h)], SLATE);
    }
    if (!parked) return;
    this.rod([x - radius * 0.78, y, z], [x + radius * 0.78, y, z], 0.021, IRON, 4);
    this.rod([x, y, z - radius * 0.78], [x, y, z + radius * 0.78], 0.021, IRON, 4);
  }

  finish(): SourceLod {
    return {
      positions: Float32Array.from(this.verts),
      colors: Uint8Array.from(this.colors),
      indices: Uint32Array.from(this.indices),
      uvs: this.level === 0 ? Float32Array.from(this.uv) : undefined,
      normals: this.level === 0 ? Float32Array.from(this.normals) : undefined,
      error: [0, 0.035, 0.09][this.level],
    };
  }
}
