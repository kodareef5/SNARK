import { fileURLToPath } from "node:url";
import type { PackMaterial } from "../../shared/pack/pack.ts";
import { AIR_FRAME as A, AIR_PIECES, airBayZ, airMesh, type AirPiece } from "../../shared/world/air-support-art.ts";
import { defaultPalette, nearestColour, REGION_BASE } from "../../shared/pack/palette.ts";
import { type SourceLod, type SourceMesh } from "./write.ts";

type Point = [number, number, number];
type Ring = [z: number, halfWidth: number, bottom: number, top: number];
const palette = defaultPalette();
const coat = (r: number, g: number, b: number) => nearestColour(palette, r, g, b);
const IRON = coat(44, 53, 59),
  SLATE = coat(68, 80, 84),
  STEEL = coat(117, 127, 127);
const SHELL = coat(208, 207, 185),
  EDGE = coat(229, 225, 209),
  GLASS = coat(36, 73, 78);
const ORANGE = coat(212, 105, 42),
  GOLD = coat(240, 176, 74),
  TEAL = coat(123, 204, 207);
const RUBBER = coat(35, 36, 38),
  RED = coat(192, 57, 50);

const swatches = [IRON, SLATE, STEEL, SHELL, EDGE, GLASS, ORANGE, GOLD, TEAL, RUBBER, RED];
export const airMaterial = {
  id: "core:air_support/finish",
  name: "finish",
  dir: fileURLToPath(new URL("../../assets/raw/air-support/", import.meta.url)),
  spec: { base: "base.png", normal: "normal.png", packed: "finish.png" },
};
export const airTextures = (["base", "normal", "mro"] as const).map((role) => ({ id: airMaterial.id + "/" + role, role, top: 256 }));
const finish: PackMaterial = {
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

class Model {
  private readonly uv: number[] = [];
  private readonly normals: number[] = [];
  private readonly verts: number[] = [];
  private readonly indices: number[] = [];
  private readonly colors: number[] = [];

  readonly level: number;
  constructor(level: number) {
    this.level = level;
  }

  face(points: Point[], color: number): void {
    const start = this.verts.length / 3;
    for (const point of points) {
      this.verts.push(...point);
      this.colors.push(color);
    }
    if (this.level === 0) this.surface(points, color);
    for (let i = 2; i < points.length; i++) this.indices.push(start, start + i - 1, start + i);
  }

  private surface(points: Point[], color: number): void {
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
    const tile = Math.max(0, swatches.indexOf(color));
    for (let i = 0; i < points.length; i++) {
      this.uv.push(
        ((tile % 4) + 0.06 + (0.88 * (s[i]! - left)) / width) / 4,
        (Math.floor(tile / 4) + 0.06 + (0.88 * (t[i]! - bottom)) / height) / 4,
      );
      this.normals.push(nx / n, ny / n, nz / n);
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

  duct(x: number, y: number, z: number, radius: number): void {
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
      error: [0, 0.035, 0.18][this.level],
    };
  }
}

function carrier(m: Model): void {
  for (const s of [-1, 1]) {
    const x = s * 0.84;
    m.shell(
      x,
      [
        [-3.9, 0.12, -0.08, 0.17],
        [-3.36, 0.19, -0.2, 0.27],
        [-1.9, 0.19, -0.26, 0.14],
        [1.8, 0.19, -0.26, 0.14],
        [3.35, 0.19, -0.2, 0.27],
        [3.9, 0.12, -0.08, 0.17],
      ],
      IRON,
    );
    m.box(x, 0.17, 0, 0.16, 0.12, 4.3, ORANGE);
    for (const z of [-3.52, 3.52]) {
      m.rod([x, 0.06, z], [s * 1.39, -0.12, z], 0.18, STEEL, 6, 0.13);
      m.box(s * 1.38, -0.09, z, 0.36, 0.22, 0.43, ORANGE);
    }
    if (m.level < 2) {
      for (let i = 0; i < 5; i++) {
        const a = -2 + i * 0.8;
        m.rod([x, -0.2, a], [s * 0.61, 0.52, a + 0.78], 0.043, STEEL, 5);
        m.rod([x, -0.2, a + 0.78], [s * 0.61, 0.52, a], 0.038, SLATE, 5);
      }
      m.rod([s * 0.61, 0.52, -2.2], [s * 0.61, 0.52, 2.2], 0.08, SHELL);
    }
  }
  for (const sign of [-1, 1]) {
    const c = sign * A.rotorZ,
      rise = sign < 0 ? 0.4 : 0;
    m.shell(
      0,
      [
        [c - 1.15, 0.38, -0.18, 0.32 + rise],
        [c - 0.7, 0.8, -0.35, 0.64 + rise],
        [c + 0.43, 0.78, -0.3, 1 + rise],
        [c + 1.03, 0.53, -0.16, 0.93 + rise],
        [c + 1.28, 0.32, 0.03, 0.61 + rise],
      ],
      SHELL,
    );
    m.shell(
      0,
      [
        [c - 0.78, 0.61, 0.27 + rise, 0.64 + rise],
        [c - 0.52, 0.67, 0.34 + rise, 0.75 + rise],
        [c - 0.39, 0.67, 0.37 + rise, 0.78 + rise],
      ],
      ORANGE,
    );
    m.rod([0, 0.65 + rise, c], [0, 1.31 + rise, c], 0.29, IRON, 12, 0.19);
    m.rod([0, 1.27 + rise, c], [0, 1.43 + rise, c], 0.29, STEEL, 12);
    m.rod([0, 1.4 + rise, c], [0, 1.47 + rise, c], 0.15, ORANGE, 10, 0.1);
    if (m.level < 2)
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) m.box(side * 0.76, 0.12 + rise * 0.4, c - 0.47 + i * 0.14, 0.055, 0.27, 0.075, IRON);
        m.box(side * 0.78, 0.47 + rise * 0.65, c + 0.16, 0.042, 0.07, 0.4, side < 0 ? RED : TEAL);
        for (let i = 0; i < 3; i++) {
          const x = side * 0.805,
            z = c - 0.45 + i * 0.17;
          m.rod([x, -0.015, z], [x, 0.215, z + 0.1], 0.046, GOLD, 4);
        }
      }
    m.box(0, -0.1, c, 1.99, 0.23, 0.36, SLATE);
    m.rod([-0.83, 0.02, c - sign * 0.8], [0.83, 0.02, c - sign * 0.8], 0.1, STEEL);
  }
  m.shell(
    0,
    [
      [1.23, 0.42, 0.05, 0.32],
      [2.59, 0.56, -0.02, 0.5],
      [3.22, 0.55, -0.12, 0.64],
    ],
    SLATE,
  );
  m.shell(
    0,
    [
      [4.76, 0.41, 0.21, 0.57],
      [5.03, 0.32, 0.11, 0.48],
      [5.16, 0.17, 0.14, 0.4],
    ],
    GLASS,
  );
  m.box(0, 0.1, 5.13, 0.24, 0.06, 0.06, TEAL);
}

function rotor(m: Model): void {
  const r = A.rotorRadius;
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const edge = (x: number, z: number, y: number): Point => [c * x + s * z, y, -s * x + c * z];
    const strips = [
      [0.16, 0.09, 0],
      [0.63, 0.17, 0],
      [r - 0.45, 0.11, -0.12],
      [r, 0.06, -0.26],
    ];
    for (let j = 1; j < strips.length; j++) {
      const [p, w, t] = strips[j - 1]!,
        [q, v, u] = strips[j]!;
      m.solid(
        [-0.024, 0.024].map((y) => [edge(p!, t! - w!, y), edge(p!, t! + w!, y), edge(q!, u! + v!, y), edge(q!, u! - v!, y)]),
        j === 3 ? GOLD : IRON,
      );
    }
  }
}

function clamp(m: Model): void {
  m.rod([0, 0, 0], [0.12, -0.32, 0], 0.18, SLATE, 8);
  m.box(0.13, -0.76, 0, 0.22, 0.92, 0.28, ORANGE);
  m.box(0.13, -0.81, 0.15, 0.1, 0.63, 0.035, IRON);
  m.box(0.13, -0.81, -0.15, 0.1, 0.63, 0.035, IRON);
  m.rod([0.13, -1.06, 0], [0.13, -1.73, 0], 0.085, STEEL, 8);
  m.box(0.13, -1.74, 0, 0.23, 0.27, 0.31, SLATE);
  m.rod([0.13, -1.75, 0], [-0.04, -2.08, 0], 0.105, ORANGE, 6);
  m.box(-0.1, -2.055, 0, 0.28, 0.12, 0.27, GOLD);
  if (m.level === 0) m.rod([0, -0.16, 0.16], [0.09, -0.97, 0.16], 0.032, IRON, 5);
}

function pod(m: Model): void {
  m.box(0, 0.13, 0, 2.4, 0.26, 7.8, IRON);
  m.box(0, 0.28, 0, 2.21, 0.1, 7.58, STEEL);
  for (const x of [-1.13, 1.13]) {
    m.box(x, 0.27, 0, 0.12, 0.19, 7.72, SHELL);
    for (const z of [-A.jawZ, A.jawZ]) {
      m.box(x, 0.97, z, 0.14, 1.88, 0.18, SLATE);
      m.box(x, 1.65, z, 0.2, 0.25, 0.32, ORANGE);
    }
  }
  for (const z of [-3.82, 3.82]) {
    m.box(0, 1.03, z, 2.2, 1.63, 0.13, SHELL);
    m.box(0, 1.74, z + (z < 0 ? -0.08 : 0.08), 1.76, 0.12, 0.035, SLATE);
    m.box(0, 0.49, z + (z < 0 ? -0.08 : 0.08), 1.76, 0.08, 0.035, ORANGE);
    if (m.level < 2) for (const x of [-0.63, 0, 0.63]) m.box(x, 1.05, z + (z < 0 ? -0.08 : 0.08), 0.085, 1.16, 0.04, STEEL);
  }
  m.box(-1.12, 1, 0, 0.11, 1.53, 7.55, SLATE);
  m.box(-1.19, 1, 0, 0.035, 1.4, 7.34, SHELL);
  if (m.level < 2)
    for (let i = 0; i < 6; i++) {
      const z = airBayZ(i);
      m.box(-1.21, 1, z, 0.045, 1.24, 0.073, STEEL);
      m.box(0, 0.44, z, 1.67, 0.16, 0.7, IRON);
      m.box(0.86, 0.53, z, 0.07, 0.3, 0.69, SLATE);
      if (m.level === 0) digit(m, i + 1, 0.903, 0.54, z + 0.17, 0.125);
      for (const x of [-0.65, 0.65]) {
        m.box(x, 0.58, z, 0.16, 0.2, 0.47, ORANGE);
        m.rod([x, 0.53, z - 0.23], [x, 0.81, z - 0.29], 0.05, STEEL, 5);
        m.rod([x, 0.53, z + 0.23], [x, 0.81, z + 0.29], 0.05, STEEL, 5);
      }
    }
}

function roof(m: Model): void {
  m.box(1.13, 0.013, 0, 2.28, 0.11, 7.58, SHELL);
  for (const x of [0.08, 2.18]) m.box(x, -0.06, 0, 0.1, 0.11, 7.61, SLATE);
  if (m.level < 2)
    for (let i = 0; i < 6; i++) {
      const z = airBayZ(i);
      m.box(1.13, -0.079, z, 2.14, 0.09, 0.072, STEEL);
      m.box(1.13, 0.078, z, 1.98, 0.035, 0.095, EDGE);
    }
}

const digits = ["", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg"];
function digit(m: Model, value: number, x: number, y: number, z: number, size: number): void {
  const segments = digits[value]!;
  const up = size * 0.72,
    wide = size * 0.48,
    stroke = size * 0.19;
  for (const [key, level] of [
    ["a", up],
    ["g", 0],
    ["d", -up],
  ] as const)
    if (segments.includes(key)) m.box(x, y + level, z, 0.012, stroke, wide * 1.65, EDGE);
  for (const [key, level, side] of [
    ["f", up / 2, 1],
    ["b", up / 2, -1],
    ["e", -up / 2, 1],
    ["c", -up / 2, -1],
  ] as const)
    if (segments.includes(key)) m.box(x, y + level, z + side * wide, 0.012, up * 0.82, stroke, EDGE);
}

function side(m: Model): void {
  m.box(0, 0.79, 0, 0.105, 1.52, 7.55, SHELL);
  m.box(0.061, 0.34, 0, 0.025, 0.126, 7.48, ORANGE);
  m.box(0.068, 0.41, 0.88, 0.026, 0.022, 5.38, GOLD);
  m.box(-0.065, 1.46, 0, 0.08, 0.16, 7.56, SLATE);
  if (m.level < 2)
    for (let i = 0; i < 6; i++) {
      const z = airBayZ(i);
      m.box(0.068, 0.92, z - 0.51, 0.03, 0.93, 0.045, STEEL);
      m.box(0.068, 0.84, z - 0.23, 0.04, 0.42, 0.37, SLATE);
      digit(m, i + 1, 0.093, 0.84, z - 0.23, 0.17);
      m.box(-0.076, 0.76, z, 0.046, 1.23, 0.07, STEEL);
      m.box(0.074, 1.18, z + 0.2, 0.04, 0.13, 0.31, IRON);
      m.box(0.1, 1.18, z + 0.2, 0.025, 0.032, 0.16, STEEL);
    }
}

function drone(m: Model): void {
  m.shell(
    0,
    [
      [-0.81, 0.08, 0.02, 0.17],
      [-0.58, 0.19, -0.08, 0.21],
      [0.17, 0.235, -0.13, 0.23],
      [0.56, 0.18, -0.09, 0.17],
      [0.75, 0.1, -0.025, 0.105],
    ],
    SHELL,
  );
  m.shell(
    0,
    [
      [0.31, 0.214, 0.028, 0.187],
      [0.49, 0.193, 0.008, 0.178],
      [0.61, 0.15, -0.012, 0.14],
    ],
    GLASS,
  );
  m.shell(
    0,
    [
      [-0.72, 0.075, -0.065, 0.018],
      [-0.47, 0.165, -0.15, 0.025],
      [0.28, 0.214, -0.15, 0.025],
      [0.64, 0.132, -0.067, 0.025],
    ],
    SLATE,
  );
  m.box(0, 0.234, -0.14, 0.11, 0.025, 0.36, ORANGE);
  m.rod([0, 0.06, 0.71], [0, 0.06, 0.76], 0.067, IRON, 12);
  m.rod([0, 0.06, 0.76], [0, 0.06, 0.775], 0.048, TEAL, 12);
  if (m.level === 0) for (let i = 0; i < 5; i++) m.box(0, 0.214, -0.53 + i * 0.052, 0.19, 0.023, 0.024, IRON);
  for (const x of [-0.37, 0.37])
    for (const z of [-0.4, 0.22]) {
      m.rod([0, 0.02, z + 0.08], [x, 0.04, z], 0.049, SLATE, 6);
      m.duct(x, 0.045, z, 0.17);
    }
  m.rod([0, -0.045, 0.47], [0, -0.175, 0.47], 0.095, IRON, 10);
  m.rod([0, -0.147, 0.45], [0, -0.147, 0.57], 0.064, TEAL, 10);
  for (const x of [-0.12, 0.12]) m.rod([x, -0.15, -0.37], [x, -0.15, 0.3], 0.034, IRON, 6);
}

function chassis(m: Model): void {
  for (const x of [-0.76, 0.76]) m.box(x, 1.09, 0, 0.18, 0.3, 9.23, SLATE);
  m.box(0, 1.247, 0, 2.53, 0.1, 9.3, IRON);
  for (const x of [-1.23, 1.23]) {
    m.box(Math.sign(x) * 1.25, 1.16, 0, 0.072, 0.17, 9.29, SHELL);
    if (m.level < 2) for (let i = 0; i < 6; i++) m.box(Math.sign(x) * 1.3, 1.16, -3.8 + i * 1.5, 0.028, 0.065, 0.54, ORANGE);
  }
  m.box(0, 0.6, -4.51, 2.45, 0.16, 0.17, STEEL);
  for (const x of [-1.03, 1.03]) {
    m.box(x, 0.89, -4.58, 0.37, 0.17, 0.13, RED);
    m.box(x, 0.78, -4.0, 0.35, 0.4, 0.065, RUBBER);
  }
  for (const z of A.axle) m.rod([-1.1, A.wheel, z], [1.1, A.wheel, z], 0.13, SLATE);
  m.rod([0, 0.81, 3.75], [0, 1.24, 3.75], 0.11, STEEL, 10);
}

function marker(m: Model): void {
  for (const x of [-A.halfWidth, A.halfWidth])
    for (const z of [-A.halfLength, A.halfLength]) {
      m.box(x, 0.04, z - Math.sign(z) * 0.5, 0.095, 0.07, 1, GOLD);
      m.box(x - Math.sign(x) * 0.35, 0.04, z, 0.7, 0.07, 0.095, GOLD);
      m.rod([x, 0.04, z], [x, 0.6, z], 0.047, GOLD, 5);
      m.box(x, 0.59, z - Math.sign(z) * 0.18, 0.067, 0.06, 0.36, EDGE);
    }
  m.rod([-0.35, 0.05, 1.32], [0, 0.05, 1.98], 0.07, GOLD, 4);
  m.rod([0, 0.05, 1.98], [0.35, 0.05, 1.32], 0.07, GOLD, 4);
}

function feet(m: Model): void {
  for (const x of [-0.86, 0.86]) {
    m.box(x, 0.66, 0, 0.16, 0.95, 0.18, SLATE);
    m.box(x, 0.18, 0, 0.11, 0.32, 0.12, STEEL);
    m.box(x, 0.053, 0, 0.37, 0.1, 0.4, IRON);
  }
}

function wheel(m: Model): void {
  const n = m.level === 0 ? 24 : m.level === 1 ? 12 : 8;
  m.rod([-0.15, 0, 0], [-0.11, 0, 0], 0.45, RUBBER, n, A.wheel);
  m.rod([-0.11, 0, 0], [0.1, 0, 0], A.wheel, RUBBER, n);
  m.rod([0.1, 0, 0], [0.15, 0, 0], A.wheel, RUBBER, n, 0.45);
  m.rod([0.145, 0, 0], [0.165, 0, 0], 0.3, STEEL, n, 0.285);
  m.rod([0.164, 0, 0], [0.181, 0, 0], 0.24, SLATE, n);
  m.rod([0.181, 0, 0], [0.208, 0, 0], 0.105, STEEL, n);
  if (m.level === 0)
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4,
        y = 0.164 * Math.sin(a),
        z = 0.164 * Math.cos(a);
      m.rod([0.18, y, z], [0.195, y, z], 0.028, SHELL, 6);
    }
}

const builders: Record<AirPiece, (m: Model) => void> = {
  carrier,
  rotor,
  clamp,
  pod,
  roof,
  side,
  drone,
  chassis,
  wheel,
  feet,
  marker,
  indicator: (m) => m.box(0, 0, 0, 0.035, 0.07, 0.31, REGION_BASE),
};

export function airSupportMeshes(): SourceMesh[] {
  return AIR_PIECES.map((piece) => ({
    id: airMesh(piece),
    ...(piece === "indicator" || piece === "marker" ? {} : { flat: 1, materials: [finish], textures: airTextures }),
    lods: [0, 1, 2].map((level) => {
      const model = new Model(level);
      builders[piece](model);
      return model.finish();
    }),
  }));
}
