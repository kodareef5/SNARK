import { AIR_FRAME as A, AIR_IMPELLERS, airBayZ } from "../../shared/world/air-support-art.ts";
import {
  Model,
  IRON,
  SLATE,
  STEEL,
  SHELL,
  EDGE,
  GLASS,
  ORANGE,
  GOLD,
  TEAL,
  RUBBER,
  RED,
  OPTIC,
  JADE,
  BLUE,
  type Point,
} from "./air-support-shapes.ts";

type Axis = "x" | "y" | "z";
type Section = readonly [at: number, width: number, bottom: number, top: number];
type Turn = readonly [at: number, radius: number, paint: number];
const TAU = Math.PI * 2,
  SIGNS = [-1, 1] as const;
const shellPower = (n: number, e: number) => Math.sign(n) * Math.pow(Math.abs(n), e);
const local = (axis: Axis, x: number, y: number, z: number): Point => (axis === "x" ? [z, x, y] : axis === "y" ? [x, z, -y] : [x, y, z]);
const unit = (x: number, y: number, z: number): Point => {
  const d = Math.hypot(x, y, z) || 1;
  return [x / d, y / d, z / d];
};
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Each section of the moulding has its own tangent around the curve and along the shoulder. */
function mould(m: Model, x: number, z: number, sections: Section[], paint: number, count = 28, exponent = 0.77): void {
  const rings = sections.map(([at, w, b, t]) =>
    Array.from({ length: count }, (_, j): Point => {
      const a = (j * TAU) / count;
      return [x + w * shellPower(Math.cos(a), exponent), (t + b) / 2 + ((t - b) / 2) * shellPower(Math.sin(a), exponent), z + at];
    }),
  );
  const norm = rings.map((ring, i) =>
    ring.map((_, j) => {
      const l = ring[(j + count - 1) % count]!,
        r = ring[(j + 1) % count]!;
      const low = rings[Math.max(0, i - 1)]![j]!,
        high = rings[Math.min(rings.length - 1, i + 1)]![j]!;
      const a = r[0] - l[0],
        b = r[1] - l[1],
        c = r[2] - l[2],
        d = high[0] - low[0],
        e = high[1] - low[1],
        f = high[2] - low[2];
      return unit(b * f - c * e, c * d - a * f, a * e - b * d);
    }),
  );
  m.face([...rings[0]!].reverse(), paint);
  for (let i = 1; i < rings.length; i++)
    for (let j = 0; j < count; j++) {
      const k = (j + 1) % count,
        p = rings[i - 1]!,
        q = rings[i]!,
        a = norm[i - 1]!,
        b = norm[i]!;
      const u = 0.06 + (0.88 * j) / count,
        v = 0.06 + (0.88 * (j + 1)) / count;
      const y = 0.06 + (0.88 * (i - 1)) / (rings.length - 1),
        w = 0.06 + (0.88 * i) / (rings.length - 1);
      m.face(
        [p[j]!, p[k]!, q[k]!, q[j]!],
        paint,
        [a[j]!, a[k]!, b[k]!, b[j]!],
        [
          [u, y, 0],
          [v, y, 0],
          [v, w, 0],
          [u, w, 0],
        ],
      );
    }
  m.face(rings[rings.length - 1]!, paint);
}

/** The running surface is smooth around a turned part; a radial step retains its hard shoulder. */
function lathe(m: Model, axis: Axis, origin: Point, profile: Turn[], sides = 24): void {
  const cs = Array.from({ length: sides }, (_, i) => [Math.cos((i * TAU) / sides), Math.sin((i * TAU) / sides)] as const);
  const rings = profile.map(([at, r]) => cs.map(([c, s]) => add(origin, local(axis, c * r, s * r, at))));
  for (let k = 1; k < rings.length; k++) {
    const a = profile[k - 1]!,
      b = profile[k]!,
      dq = b[0] - a[0],
      dr = b[1] - a[1],
      len = Math.hypot(dq, dr);
    if (len < 1e-8) continue;
    const normals = cs.map(([c, s]) => local(axis, (c * dq) / len, (s * dq) / len, -dr / len));
    for (let j = 0; j < sides; j++) {
      const l = (j + 1) % sides,
        u = 0.06 + (0.88 * j) / sides,
        v = 0.06 + (0.88 * (j + 1)) / sides;
      m.face(
        [rings[k - 1]![j]!, rings[k - 1]![l]!, rings[k]![l]!, rings[k]![j]!],
        b[2],
        [normals[j]!, normals[l]!, normals[l]!, normals[j]!],
        [
          [u, 0.08, 0],
          [v, 0.08, 0],
          [v, 0.92, 0],
          [u, 0.92, 0],
        ],
      );
    }
  }
  if (profile[0]![1] > 0.0002) m.face([...rings[0]!].reverse(), profile[0]![2]);
  if (profile.at(-1)![1] > 0.0002) m.face(rings.at(-1)!, profile.at(-1)![2]);
}

/** A film conforms to the moulded surface through every crease in its longitudinal profile. */
function film(
  m: Model,
  shape: Section[],
  x: number,
  z: number,
  orientation: number,
  side: number,
  rise: number,
  from: number,
  to: number,
  bottom: number,
  top: number,
  offset: number,
  paint: number,
  label = -1,
  exponent = 0.67,
): void {
  const surface = (at: number, theta: number): Point => {
    let i = 1;
    while (i < shape.length - 1 && shape[i]![0] < at) i++;
    const a = shape[i - 1]!,
      b = shape[i]!,
      t = Math.max(0, Math.min(1, (at - a[0]) / (b[0] - a[0])));
    const w = a[1] + (b[1] - a[1]) * t,
      lo = a[2] + (b[2] - a[2]) * t,
      hi = a[3] + (b[3] - a[3]) * t;
    return [
      x + side * (w + offset) * shellPower(Math.cos(theta), exponent),
      rise + (lo + hi) / 2 + ((hi - lo) / 2 + offset) * shellPower(Math.sin(theta), exponent),
      z + orientation * at,
    ];
  };
  const sections = [from, ...shape.map((s) => s[0]).filter((at) => at > from && at < to), to];
  const bands = Math.max(1, Math.ceil((top - bottom) / 0.2));
  for (let i = 1; i < sections.length; i++)
    for (let j = 0; j < bands; j++) {
      const zl = sections[i - 1]!,
        zr = sections[i]!,
        b = bottom + ((top - bottom) * j) / bands,
        t = bottom + ((top - bottom) * (j + 1)) / bands;
      const corners = [
        [zl, b],
        [zl, t],
        [zr, t],
        [zr, b],
      ];
      if (side * orientation < 0) corners.reverse();
      const points: Point[] = [],
        normals: Point[] = [],
        uv: Point[] = [];
      for (const [at, th] of corners) {
        const a = at!,
          h = th!,
          v = (h - bottom) / (top - bottom),
          u = (a - from) / (to - from);
        const q = surface(a, h),
          l = surface(a - 0.001, h),
          r = surface(a + 0.001, h);
        const g = surface(a, h - 0.001),
          w = surface(a, h + 0.001);
        const ux = w[0] - g[0],
          uy = w[1] - g[1],
          dx = r[0] - l[0],
          dy = r[1] - l[1],
          dz = r[2] - l[2];
        points.push(q);
        normals.push(unit(side * orientation * uy * dz, -side * orientation * ux * dz, side * orientation * (ux * dy - uy * dx)));
        uv.push([
          0.036 + 0.928 * (side * orientation > 0 ? 1 - u : u),
          label < 0 ? 0.08 + 0.84 * (1 - v) : (label + 0.075 + 0.85 * (1 - v)) / 4,
          0,
        ]);
      }
      m.face(points, paint, normals, uv, label < 0 ? undefined : 14);
    }
}

function plate(m: Model, points: Point[], thickness: Point, paint: number): void {
  m.solid([points, points.map((p) => add(p, thickness))], paint);
}

/** Four plates share a vertically stacked printing tile. Lower-left is first on each reading face. */
function print(m: Model, points: Point[], band: number): void {
  const top = (band + 0.075) / 4,
    bottom = (band + 0.925) / 4;
  m.face(
    points,
    SHELL,
    undefined,
    [
      [0.035, bottom, 0],
      [0.965, bottom, 0],
      [0.965, top, 0],
      [0.035, top, 0],
    ],
    14,
  );
}

function sideLabel(m: Model, side: number, x: number, y: number, z: number, width: number, height: number, band: number): void {
  const l = z + (side * width) / 2,
    r = z - (side * width) / 2,
    b = y - height / 2,
    t = y + height / 2;
  print(
    m,
    [
      [x, b, l],
      [x, b, r],
      [x, t, r],
      [x, t, l],
    ],
    band,
  );
}

/** A pair of outer shoes sits above and below the mouth that receives the clamp's toe. */
export function lug(m: Model, x: number, z: number): void {
  const side = Math.sign(x);
  for (const y of [A.jawY - 0.121, A.jawY + 0.091]) m.box(x, y, z, 0.237, 0.072, 0.394, ORANGE);
  for (const dz of [-0.158, 0.158]) m.box(x, A.jawY, z + dz, 0.23, 0.23, 0.071, ORANGE);
  m.box(x - side * 0.075, A.jawY, z, 0.026, 0.17, 0.245, RUBBER);
  for (const dz of [-0.155, 0.155])
    for (const dy of [-0.104, 0.11]) m.rod([x + side * 0.104, A.jawY + dy, z + dz], [x + side * 0.128, A.jawY + dy, z + dz], 0.033, STEEL, 6);
}

export function detailedClamp(m: Model): void {
  lathe(
    m,
    "z",
    [0, -0.035, 0],
    [
      [-0.241, 0.11, STEEL],
      [-0.219, 0.142, STEEL],
      [-0.168, 0.145, IRON],
      [-0.149, 0.117, GOLD],
      [0.149, 0.117, SLATE],
      [0.168, 0.145, GOLD],
      [0.219, 0.142, STEEL],
      [0.241, 0.101, STEEL],
    ],
    16,
  );
  for (const s of SIGNS) {
    const z = s * 0.119;
    const edge: Point[] = [
      [-0.115, 0.025, z],
      [-0.073, -0.311, z],
      [0.006, -0.59, z],
      [0.108, -0.61, z],
      [0.214, -0.31, z],
      [0.173, 0.035, z],
    ];
    plate(m, s > 0 ? edge : [...edge].reverse(), [0, 0, s * 0.067], SLATE);
    m.rod([-0.038, -0.28, z + s * 0.061], [0.076, -0.48, z + s * 0.062], 0.052, IRON, 8);
    lathe(
      m,
      "z",
      [0.03, -0.3, z + s * 0.075],
      [
        [-0.022, 0.073, IRON],
        [0.009, 0.069, STEEL],
        [0.022, 0.043, STEEL],
      ],
      10,
    );
  }
  m.shell(
    0.152,
    [
      [-0.135, 0.12, -1.13, -0.38],
      [-0.093, 0.153, -1.17, -0.35],
      [0.093, 0.153, -1.17, -0.35],
      [0.135, 0.12, -1.13, -0.38],
    ],
    ORANGE,
  );
  for (const s of SIGNS) {
    const z = s * 0.149;
    m.box(0.145, -0.73, z, 0.2, 0.58, 0.026, IRON);
    for (let i = 0; i < 4; i++) {
      const y = -0.54 - i * 0.126;
      m.rod([0.066, y - 0.044, z + s * 0.016], [0.216, y + 0.013, z + s * 0.016], 0.024, GOLD, 4);
    }
    m.rod([0.035, -0.48, s * 0.167], [0.035, -1.36, s * 0.167], 0.032, STEEL, 10);
  }
  lathe(
    m,
    "y",
    [0.146, 0, 0],
    [
      [-1.73, 0.066, STEEL],
      [-1.67, 0.083, STEEL],
      [-1.21, 0.083, STEEL],
      [-1.195, 0.105, IRON],
      [-1.14, 0.108, IRON],
      [-1.125, 0.131, STEEL],
      [-1.02, 0.125, STEEL],
    ],
    18,
  );
  const cable: Point[] = [
    [0.08, -0.07, -0.216],
    [-0.068, -0.22, -0.228],
    [-0.038, -0.5, -0.218],
    [0.063, -0.67, -0.193],
    [0.104, -0.9, -0.173],
  ];
  for (let i = 1; i < cable.length; i++) m.rod(cable[i - 1]!, cable[i]!, 0.027, RUBBER, 7);
  m.box(0.147, -1.7, 0, 0.218, 0.197, 0.209, SLATE);
  for (const s of SIGNS) {
    const z = s * 0.096;
    const cheek: Point[] = [
      [0.009, -1.67, z],
      [0.084, -1.86, z],
      [-0.105, -1.997, z],
      [-0.213, -2.019, z],
      [-0.214, -2.083, z],
      [-0.12, -2.091, z],
      [0.054, -2.024, z],
      [0.225, -1.833, z],
      [0.228, -1.68, z],
    ];
    plate(m, s > 0 ? cheek : [...cheek].reverse(), [0, 0, s * 0.051], ORANGE);
  }
  lathe(
    m,
    "z",
    [0.134, -1.756, 0],
    [
      [-0.167, 0.064, IRON],
      [-0.157, 0.083, STEEL],
      [-0.132, 0.08, STEEL],
      [0.132, 0.08, IRON],
      [0.157, 0.083, STEEL],
      [0.167, 0.064, STEEL],
    ],
    12,
  );
  m.box(-0.111, -2.056, 0, 0.239, 0.08, 0.199, STEEL);
  m.box(-0.172, -2.054, 0, 0.093, 0.088, 0.174, GOLD);
  m.box(0.31, -0.716, 0, 0.025, 0.38, 0.17, IRON);
  sideLabel(m, 1, 0.325, -0.716, 0, 0.16, 0.055, 2);
}

function blades(m: Model, x: number, y: number, z: number, r: number, s: number): void {
  for (let n = 0; n < 5; n++) {
    const phase = (n * TAU) / 5,
      point = (a: number, ray: number, h: number): Point => [x + ray * Math.cos(phase + s * a), y + h, z + ray * Math.sin(phase + s * a)];
    const wing: Point[] = [
      point(0, 0.031, -0.012),
      point(0.53, r * 0.83, -0.002),
      point(0.59, r * 0.88, 0.01),
      point(0.23, r * 0.86, 0.013),
      point(-0.28, 0.04, 0.008),
    ];
    plate(m, s > 0 ? wing : [...wing].reverse(), [0, 0.004, 0], SLATE);
  }
  lathe(
    m,
    "y",
    [x, y, z],
    [
      [-0.025, 0.034, IRON],
      [0.011, 0.044, STEEL],
      [0.023, 0.038, SLATE],
      [0.036, 0.019, IRON],
    ],
    14,
  );
}

function fan(m: Model, x: number, y: number, z: number, r: number, s: number, parked: boolean): void {
  const origin: Point = [x, y, z];
  // An annular return closes over its start, leaving the fan visible from underneath.
  const stations: Turn[] = [
    [-0.04, r * 0.92, IRON],
    [-0.027, r, IRON],
    [0.008, r, SLATE],
    [0.044, r * 0.945, SHELL],
    [0.05, r * 0.892, EDGE],
    [0.042, r * 0.828, STEEL],
    [0.028, r * 0.81, IRON],
    [-0.044, r * 0.81, IRON],
    [-0.041, r * 0.92, SLATE],
  ];
  const ring = (at: number, rad: number, a: number): Point => add(origin, [Math.cos(a) * rad, at, -Math.sin(a) * rad]);
  const n = 28;
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1]!,
      b = stations[i]!,
      dy = b[0] - a[0],
      dr = b[1] - a[1],
      d = Math.hypot(dy, dr);
    for (let j = 0; j < n; j++) {
      const u = (j * TAU) / n,
        v = ((j + 1) * TAU) / n;
      const norm = (t: number): Point => [(Math.cos(t) * dy) / d, -dr / d, (-Math.sin(t) * dy) / d];
      const color = i === 4 && j >= 4 && j < 8 ? ORANGE : b[2];
      m.face([ring(a[0], a[1], u), ring(a[0], a[1], v), ring(b[0], b[1], v), ring(b[0], b[1], u)], color, [norm(u), norm(v), norm(v), norm(u)]);
    }
  }
  for (let j = 0; j < 3; j++) {
    const a = (TAU * j) / 3;
    m.rod([x, y - 0.031, z], [x + Math.cos(a) * r * 0.82, y - 0.031, z + Math.sin(a) * r * 0.82], 0.01, SLATE, 5);
  }
  if (parked) blades(m, x, y, z, r, s);
}

function cameraEye(m: Model, x: number, y: number, z: number, scale: number): void {
  const profile: Turn[] = [
    [-0.025, 0.078, IRON],
    [0.001, 0.089, SLATE],
    [0.014, 0.09, STEEL],
    [0.027, 0.082, SLATE],
    [0.029, 0.072, IRON],
    [0.013, 0.065, IRON],
    [0.015, 0.06, BLUE],
  ];
  lathe(
    m,
    "z",
    [x, y, z],
    profile.map(([d, r, c]) => [d * scale, r * scale, c]),
    28,
  );
  const n = 32,
    point = (radius: number, a: number): Point => [
      x + Math.cos(a) * radius * scale,
      y + Math.sin(a) * radius * scale,
      z + (0.018 + (1 - radius / 0.061) ** 2 * 0.006) * scale,
    ];
  const uv = (radius: number, a: number): Point => [0.5 + (0.435 * Math.cos(a) * radius) / 0.061, 0.5 - (0.435 * Math.sin(a) * radius) / 0.061, 0];
  for (let j = 0; j < n; j++) {
    const a = (TAU * j) / n,
      b = (TAU * (j + 1)) / n;
    m.face(
      [point(0, 0), point(0.061, a), point(0.061, b)],
      OPTIC,
      [
        [0, 0, 1],
        [Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0.996],
        [Math.cos(b) * 0.085, Math.sin(b) * 0.085, 0.996],
      ],
      [uv(0, 0), uv(0.061, a), uv(0.061, b)],
      15,
    );
  }
}

export function surveyDrone(m: Model, parked: boolean): void {
  mould(
    m,
    0,
    0,
    [
      [-0.8, 0.048, -0.015, 0.071],
      [-0.75, 0.11, -0.065, 0.107],
      [-0.58, 0.166, -0.091, 0.145],
      [-0.36, 0.194, -0.126, 0.159],
      [0.02, 0.202, -0.14, 0.167],
      [0.32, 0.197, -0.134, 0.162],
      [0.45, 0.138, -0.11, 0.135],
      [0.5, 0.098, -0.07, 0.118],
    ],
    IRON,
    28,
    0.74,
  );
  const cover: Section[] = [
    [-0.772, 0.056, 0.067, 0.099],
    [-0.692, 0.13, 0.067, 0.158],
    [-0.51, 0.181, 0.067, 0.206],
    [-0.275, 0.2, 0.065, 0.231],
    [0.012, 0.195, 0.056, 0.245],
    [0.17, 0.18, 0.058, 0.213],
    [0.27, 0.151, 0.062, 0.168],
    [0.29, 0.122, 0.073, 0.14],
  ];
  mould(m, 0, 0, cover, SHELL, 28, 0.76);
  for (const s of SIGNS) {
    film(m, cover, 0, 0, 1, s, 0, -0.615, -0.576, -0.57, 1.571, 0.004, ORANGE, -1, 0.76);
    film(m, cover, 0, 0, 1, s, 0, -0.568, -0.553, -0.57, 1.571, 0.004, GOLD, -1, 0.76);
    film(m, cover, 0, 0, 1, s, 0, -0.179, -0.171, 0.02, 1.55, 0.003, STEEL, -1, 0.76);
    film(m, cover, 0, 0, 1, s, 0, 0.135, 0.142, -0.37, 1.55, 0.003, STEEL, -1, 0.76);
    film(m, cover, 0, 0, 1, s, 0, -0.522, -0.23, 0.65, 1.33, 0.004, SLATE, -1, 0.76);
    for (let j = 0; j < 5; j++) {
      const at = -0.485 + j * 0.05;
      film(m, cover, 0, 0, 1, s, 0, at, at + 0.02, 0.7, 1.28, 0.006, IRON, -1, 0.76);
    }
  }
  const cheek: Section[] = [
    [-0.29, 0.053, -0.07, 0.122],
    [-0.19, 0.073, -0.084, 0.149],
    [0.16, 0.084, -0.085, 0.156],
    [0.36, 0.071, -0.116, 0.126],
    [0.52, 0.055, -0.122, 0.105],
    [0.6, 0.033, -0.091, 0.076],
    [0.625, 0.018, -0.018, 0.032],
  ];
  for (const side of SIGNS) {
    const x = side * 0.147;
    mould(m, x, 0, cheek, JADE, 22, 0.68);
    film(m, cheek, x, 0, 1, side, 0, -0.12, 0.18, -0.36, 0.4, 0.004, IRON, -1, 0.68);
    film(m, cheek, x, 0, 1, side, 0, -0.108, 0.169, -0.31, 0.35, 0.007, SHELL, 1, 0.68);
    film(m, cheek, x, 0, 1, side, 0, 0.22, 0.241, -0.5, 0.8, 0.004, ORANGE, -1, 0.68);
    film(m, cheek, x, 0, 1, side, 0, 0.286, 0.299, -0.5, 0.8, 0.004, GOLD, -1, 0.68);
    for (const z of [-0.17, 0.38]) {
      const outer = side * (0.147 + (z < 0 ? 0.074 : 0.073));
      m.rod([outer - side * 0.003, 0.023, z], [outer + side * 0.011, 0.023, z], 0.015, STEEL, 8);
    }
    const mountX = side * 0.36;
    for (const z of [-0.36, 0.235]) {
      const gate: Point[] = [
        [side * 0.13, -0.005, z - 0.18],
        [side * 0.213, -0.001, z - 0.163],
        [mountX, 0.014, z - 0.084],
        [mountX, 0.022, z + 0.073],
        [side * 0.137, 0.01, z - 0.035],
      ];
      plate(m, side > 0 ? gate : [...gate].reverse(), [0, 0.043, 0], SLATE);
      m.rod([side * 0.202, 0.027, z - 0.124], [side * 0.29, 0.042, z - 0.06], 0.016, STEEL, 7);
    }
    const rail: Point[] = [
      [side * 0.112, -0.102, -0.52],
      [side * 0.139, -0.151, -0.412],
      [side * 0.139, -0.167, 0.208],
      [side * 0.124, -0.096, 0.311],
    ];
    for (let i = 1; i < rail.length; i++) m.rod(rail[i - 1]!, rail[i]!, 0.022, RUBBER, 9);
  }
  for (const hub of AIR_IMPELLERS) fan(m, hub.x, hub.y, hub.z, 0.171, hub.turn, parked);
  mould(
    m,
    0,
    0,
    [
      [0.271, 0.052, 0.073, 0.126],
      [0.342, 0.095, 0.093, 0.138],
      [0.418, 0.137, 0.092, 0.151],
      [0.47, 0.147, 0.092, 0.17],
      [0.54, 0.151, 0.086, 0.174],
      [0.631, 0.125, 0.085, 0.166],
      [0.682, 0.094, 0.097, 0.153],
      [0.707, 0.071, 0.112, 0.141],
    ],
    SHELL,
    24,
    0.7,
  );
  lathe(
    m,
    "x",
    [0, -0.01, 0.536],
    [
      [-0.152, 0.06, IRON],
      [-0.147, 0.067, STEEL],
      [-0.13, 0.063, SLATE],
      [0.13, 0.063, IRON],
      [0.147, 0.067, STEEL],
      [0.152, 0.06, STEEL],
    ],
    18,
  );
  mould(
    m,
    0,
    0,
    [
      [0.441, 0.062, -0.087, 0.069],
      [0.477, 0.097, -0.125, 0.098],
      [0.528, 0.119, -0.145, 0.118],
      [0.591, 0.125, -0.149, 0.121],
      [0.646, 0.118, -0.134, 0.111],
      [0.673, 0.099, -0.119, 0.092],
    ],
    SLATE,
    24,
    0.84,
  );
  cameraEye(m, -0.018, -0.009, 0.674, 0.97);
  cameraEye(m, 0.078, 0.043, 0.686, 0.32);
  mould(
    m,
    0,
    0,
    [
      [-0.69, 0.088, 0.125, 0.149],
      [-0.61, 0.12, 0.145, 0.172],
      [-0.486, 0.139, 0.17, 0.201],
      [-0.429, 0.115, 0.189, 0.205],
    ],
    SLATE,
    18,
    0.72,
  );
  for (let j = 0; j < 5; j++) {
    const z = -0.648 + j * 0.042,
      y = 0.151 + j * 0.012;
    m.rod([-0.09, y, z], [0.09, y, z], 0.012, IRON, 8);
  }
  mould(
    m,
    0,
    0,
    [
      [-0.39, 0.046, 0.208, 0.23],
      [-0.25, 0.062, 0.215, 0.246],
      [0.01, 0.062, 0.222, 0.258],
      [0.09, 0.044, 0.214, 0.24],
    ],
    ORANGE,
    18,
    0.64,
  );
  for (const x of [-0.066, 0.066]) {
    m.rod([x, 0.223, -0.225], [x, 0.238, -0.018], 0.008, STEEL, 7);
    m.rod([x, 0.237, -0.018], [x * 0.81, 0.232, 0.05], 0.008, STEEL, 7);
  }
  m.box(0, 0.24, 0.116, 0.073, 0.014, 0.038, GLASS);
  m.box(0, 0.252, 0.114, 0.054, 0.012, 0.016, TEAL);
}

function fairing(m: Model, x: number, z: number, sign: number, rise: number, sections: Section[], paint: number): void {
  const oriented: Section[] = sections.map(([at, w, b, t]) => [sign * at, w, b + rise, t + rise]);
  if (sign < 0) oriented.reverse();
  mould(m, x, z, oriented, paint, 32, 0.67);
}

export function liftStation(m: Model, c: number, sign: number, rise: number): void {
  const foot = rise * 0.5;
  fairing(
    m,
    0,
    c,
    sign,
    foot,
    [
      [-1.43, 0.27, -0.025, 0.2],
      [-1.32, 0.49, -0.1, 0.37],
      [-1.03, 0.64, -0.23, 0.4],
      [-0.52, 0.73, -0.3, 0.42],
      [0.27, 0.74, -0.31, 0.53],
      [0.69, 0.68, -0.25, 0.48],
      [1.04, 0.42, -0.1, 0.31],
      [1.24, 0.21, -0.009, 0.208],
    ],
    SLATE,
  );
  const cowl: Section[] = [
    [-1.23, 0.28, 0.08, 0.34],
    [-1.02, 0.55, 0.02, 0.54],
    [-0.78, 0.66, 0.0, 0.71],
    [-0.43, 0.68, 0.01, 0.84],
    [0.03, 0.65, 0.065, 0.88],
    [0.53, 0.59, 0.09, 0.77],
    [0.9, 0.43, 0.16, 0.6],
    [1.19, 0.176, 0.21, 0.4],
  ];
  fairing(m, 0, c, sign, rise, cowl, SHELL);
  for (const s of SIGNS) {
    film(m, cowl, 0, c, sign, s, rise, -0.915, -0.727, -0.43, 1.571, 0.011, ORANGE);
    film(m, cowl, 0, c, sign, s, rise, -0.685, -0.658, -0.43, 1.571, 0.011, GOLD);
    film(m, cowl, 0, c, sign, s, rise, -0.087, -0.078, -0.6, 1.56, 0.009, STEEL);
    film(m, cowl, 0, c, sign, s, rise, 0.465, 0.478, -0.47, 1.56, 0.009, STEEL);
    film(m, cowl, 0, c, sign, s, rise, -0.52, 0.14, -0.38, 0.31, 0.012, SLATE);
    film(m, cowl, 0, c, sign, s, rise, -0.495, 0.116, -0.33, 0.26, 0.016, SHELL, 0);
    film(m, cowl, 0, c, sign, s, rise, 0.569, 0.896, -0.23, 0.51, 0.012, IRON);
    film(m, cowl, 0, c, sign, s, rise, 0.597, 0.873, -0.18, 0.47, 0.017, GLASS);
    const x = s * 0.638;
    fairing(
      m,
      x,
      c,
      sign,
      foot,
      [
        [-1.04, 0.077, -0.13, 0.28],
        [-0.88, 0.132, -0.18, 0.385],
        [-0.6, 0.143, -0.18, 0.39],
        [-0.055, 0.163, -0.185, 0.35],
        [0.32, 0.151, -0.143, 0.283],
        [0.56, 0.105, -0.074, 0.19],
        [0.66, 0.045, -0.009, 0.09],
      ],
      JADE,
    );
    m.box(s * 0.796, 0.175 + foot, c - sign * 0.376, 0.06, 0.243, 0.666, IRON);
    for (let k = 0; k < 7; k++) {
      const z = c + sign * (-0.65 + k * 0.088);
      m.rod([s * 0.833, foot + 0.055, z], [s * 0.84, foot + 0.271, z + sign * 0.082], 0.03, STEEL, 4);
    }

    m.rod([s * 0.754, -0.032 + foot, c + sign * 0.49], [s * 0.795, -0.027 + foot, c + sign * 0.15], 0.026, s > 0 ? TEAL : RED, 8);
    for (const k of [-1, 1]) {
      const z = c + sign * (-0.36 + k * 0.31);
      m.rod([s * 0.698, foot - 0.067, z], [s * 0.748, foot - 0.067, z], 0.04, GOLD, 6);
    }
    const innerZ = c - sign * 1.13;
    m.rod([s * 0.36, rise + 0.16, innerZ], [s * 0.36, rise + 0.25, innerZ - sign * 0.18], 0.134, IRON, 14, 0.116);
    m.rod([s * 0.36, rise + 0.24, innerZ - sign * 0.166], [s * 0.36, rise + 0.257, innerZ - sign * 0.199], 0.12, STEEL, 16, 0.124);
    m.rod([s * 0.36, rise + 0.256, innerZ - sign * 0.197], [s * 0.36, rise + 0.261, innerZ - sign * 0.208], 0.087, RUBBER, 16);
  }
  const nose = c + sign * 0.9;
  fairing(
    m,
    0,
    nose,
    sign,
    rise,
    [
      [-0.18, 0.45, 0.02, 0.36],
      [0.01, 0.475, 0.02, 0.37],
      [0.235, 0.36, 0.06, 0.333],
      [0.371, 0.212, 0.11, 0.26],
      [0.412, 0.133, 0.133, 0.213],
    ],
    IRON,
  );
  fairing(
    m,
    0,
    nose,
    sign,
    rise,
    [
      [-0.135, 0.436, 0.106, 0.31],
      [0.013, 0.46, 0.101, 0.32],
      [0.198, 0.349, 0.13, 0.295],
      [0.335, 0.176, 0.145, 0.247],
    ],
    GLASS,
  );
  m.box(0, 0.174 + rise, c + sign * 1.306, 0.151, 0.03, 0.023, TEAL);
  lathe(
    m,
    "y",
    [0, rise, c],
    [
      [0.66, 0.366, IRON],
      [0.8, 0.378, SLATE],
      [0.85, 0.346, STEEL],
      [0.871, 0.257, STEEL],
      [0.91, 0.251, IRON],
      [0.942, 0.285, GOLD],
      [0.974, 0.294, GOLD],
      [1.01, 0.246, SLATE],
      [1.16, 0.208, STEEL],
      [1.202, 0.227, STEEL],
      [1.229, 0.272, IRON],
    ],
    28,
  );
  lathe(
    m,
    "y",
    [0, rise, c],
    [
      [1.203, 0.292, IRON],
      [1.244, 0.334, SLATE],
      [1.298, 0.331, STEEL],
      [1.32, 0.252, SLATE],
      [1.368, 0.227, IRON],
      [1.392, 0.25, STEEL],
      [1.43, 0.214, STEEL],
      [1.468, 0.125, ORANGE],
    ],
    28,
  );
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6,
      x = Math.sin(a),
      z = Math.cos(a);
    m.rod([x * 0.29, rise + 0.882, c + z * 0.29], [x * 0.23, rise + 1.206, c + z * 0.23], 0.027, STEEL, 8);
    m.rod([x * 0.285, rise + 0.878, c + z * 0.285], [x * 0.27, rise + 0.898, c + z * 0.27], 0.05, IRON, 8);
    m.rod([x * 0.272, rise + 1.273, c + z * 0.272], [x * 0.272, rise + 1.307, c + z * 0.272], 0.036, IRON, 6);
  }
  for (const s of SIGNS) {
    m.rod([s * 0.77, -0.01, c - sign * 0.76], [s * 0.57, 0.19 + foot, c - sign * 1.04], 0.102, SLATE, 9);
    m.rod([s * 0.56, 0.18 + foot, c - sign * 1.045], [s * 0.56, 0.19 + foot, c - sign * 1.145], 0.134, IRON, 10);
  }
}

export function liftRails(m: Model): void {
  for (const s of SIGNS) {
    for (const z of [-2.15, 0, 2.15]) {
      m.box(s * 0.832, -0.032, z, 0.37, 0.34, 0.174, SLATE);
      m.rod([s * 0.958, -0.02, z], [s * 1.017, -0.02, z], 0.071, STEEL, 6);
    }
    for (const z of [-A.jawZ, A.jawZ]) {
      const side = s * 1.26;
      lathe(
        m,
        "z",
        [side, -0.084, z],
        [
          [-0.256, 0.12, IRON],
          [-0.228, 0.13, STEEL],
          [-0.198, 0.165, SLATE],
          [0.198, 0.165, SLATE],
          [0.222, 0.13, STEEL],
          [0.255, 0.105, GOLD],
        ],
        16,
      );
      m.rod([s * 0.94, -0.135, z - 0.26], [s * 1.25, -0.124, z - 0.14], 0.088, SLATE, 8);
      m.rod([s * 0.94, -0.135, z + 0.26], [s * 1.25, -0.124, z + 0.14], 0.088, SLATE, 8);
    }
    const conduit: Point[] = [
      [s * 0.52, 0.32, -2.8],
      [s * 0.53, 0.41, -2.0],
      [s * 0.49, 0.35, -1.77],
      [s * 0.49, 0.35, 1.77],
      [s * 0.53, 0.41, 2.01],
      [s * 0.52, 0.32, 2.8],
    ];
    for (let i = 1; i < conduit.length; i++) m.rod(conduit[i - 1]!, conduit[i]!, 0.043, s > 0 ? RUBBER : ORANGE, 9);
    for (const z of [-1.45, -0.72, 0.72, 1.45]) m.box(s * 0.49, 0.35, z, 0.104, 0.105, 0.068, STEEL);
  }
  for (const z of [-1.84, 0, 1.84]) {
    m.rod([-0.84, -0.1, z], [0.84, -0.1, z], 0.091, IRON, 6);
    m.rod([-0.57, 0.5, z], [0.57, 0.5, z], 0.048, STEEL, 6);
  }
}

export function cradle(m: Model, z: number): void {
  // The dock's rubber saddles meet the two long runners on the aircraft underside.
  for (const x of [-0.34, 0.22])
    for (const side of SIGNS) {
      const center = z + side * 0.139;
      m.box(x, 0.584, center, 0.135, 0.177, 0.128, SLATE);
      m.box(x, 0.702, center, 0.15, 0.096, 0.145, ORANGE);
      m.box(x, 0.748, center, 0.151, 0.033, 0.154, RUBBER);
      for (const dz of [-0.065, 0.065]) m.box(x, 0.768, center + dz, 0.149, 0.046, 0.025, RUBBER);
    }
}

export function backboard(m: Model): void {
  for (let i = 0; i < 6; i++) {
    const z = airBayZ(i);
    m.box(-1.033, 1.2, z, 0.051, 0.52, 0.56, IRON);
    for (const v of [-0.1, 0, 0.1]) m.box(-0.998, 1.21 + v, z, 0.041, 0.035, 0.41, STEEL);
    m.rod([-0.964, 0.857, z], [-0.964, 0.973, z], 0.045, GOLD, 8);
  }
}

export function impeller(m: Model): void {
  if (m.level === 0) blades(m, 0, 0, 0, 0.171, 1);
  else {
    m.rod([-0.143, 0, 0], [0.143, 0, 0], 0.018, SLATE, 4);
    m.rod([0, 0, -0.143], [0, 0, 0.143], 0.018, SLATE, 4);
  }
}
