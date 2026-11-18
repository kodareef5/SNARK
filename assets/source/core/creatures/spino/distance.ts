// Closed, articulated sections retain the crown of the sail, tooth-bearing
// snout, four contacts and the thin swimming paddle at texture-free distances.
import { nearestColour, REGION_BASE } from "../../../../../shared/pack/palette.ts";
import type { SourceLod } from "../../../../../tools/pack/write.ts";
type Point = [number, number, number];
type Row = [number, number, number, number, number, string]; // z, bottom, roof, width, centre X, joint

export function distanceLods(names: readonly string[], palette: Uint8Array): SourceLod[] {
  const sand = nearestColour(palette, 174, 157, 121),
    teal = nearestColour(palette, 96, 119, 106);
  const ember = nearestColour(palette, 162, 95, 60),
    honey = nearestColour(palette, 197, 151, 89);
  const axial: Row[] = [
    [-6.98, 1.15, 1.22, 0.012, 0, "tail_7"],
    [-6.35, 1.11, 2.15, 0.034, 0, "tail_7"],
    [-5.5, 1.24, 2.29, 0.055, 0, "tail_6"],
    [-4.48, 1.5, 2.21, 0.13, 0, "tail_5"],
    [-3.46, 1.7, 2.26, 0.24, 0, "tail_4"],
    [-2.48, 1.73, 2.48, 0.33, 0, "tail_3"],
    [-1.57, 1.58, 2.84, 0.47, 0, "tail_2"],
    [-0.67, 1.36, 3.1, 0.62, 0, "tail_1"],
    [0.11, 1.18, 3.23, 0.78, 0, "pelvis"],
    [1.32, 1.16, 3.29, 0.95, 0, "spine"],
    [2.38, 1.28, 3.34, 0.94, 0, "chest"],
    [3.06, 1.37, 3.19, 0.78, 0, "chest"],
    [3.63, 1.86, 3.46, 0.46, 0, "neck_1"],
    [4.4, 2.41, 3.82, 0.42, 0, "neck_2"],
    [4.96, 2.86, 3.76, 0.48, 0, "skull"],
    [5.54, 2.64, 3.42, 0.4, 0, "skull"],
    [6.27, 2.35, 2.88, 0.28, 0, "skull"],
    [6.86, 2.14, 2.53, 0.17, 0, "skull"],
    [6.99, 2.18, 2.36, 0.07, 0, "skull"],
  ];
  const fin: Row[] = [
    [-2.05, 2.49, 2.8, 0.07, 0, "tail_2"],
    [-1.5, 2.72, 3.44, 0.1, 0, "tail_2"],
    [-0.87, 2.99, 4.63, 0.11, 0, "sail_rear"],
    [-0.24, 3.12, 4.99, 0.135, 0, "sail_rear"],
    [0.28, 3.19, 5.15, 0.145, 0, "sail_mid"],
    [0.78, 3.21, 5.18, 0.15, 0, "sail_mid"],
    [1.42, 3.2, 5.05, 0.15, 0, "sail_mid"],
    [2.04, 3.21, 4.84, 0.14, 0, "sail_front"],
    [2.66, 3.13, 4.22, 0.115, 0, "sail_front"],
    [3.37, 3.03, 3.35, 0.065, 0, "neck_1"],
  ];
  const jaw: Row[] = [
    [4.54, 2.49, 2.66, 0.29, 0, "jaw"],
    [4.97, 2.49, 2.89, 0.43, 0, "jaw"],
    [5.58, 2.43, 2.65, 0.36, 0, "jaw"],
    [6.29, 2.15, 2.35, 0.24, 0, "jaw"],
    [6.83, 1.96, 2.15, 0.17, 0, "jaw"],
    [6.98, 2.13, 2.2, 0.065, 0, "jaw"],
  ];
  return [false, true].map((far) => {
    const positions: number[] = [],
      colors: number[] = [],
      joints: number[] = [],
      indices: number[] = [];
    const lookup = new Map<string, number>();
    function vertex(p: Point, bone: string, col: number): number {
      const key = [bone, col, ...p].join(",");
      let i = lookup.get(key);
      if (i === undefined) {
        const j = names.indexOf(bone);
        if (j < 0) throw new Error("Spino distance mesh needs " + bone);
        i = colors.length;
        lookup.set(key, i);
        positions.push(...p);
        colors.push(col);
        joints.push(j);
      }
      return i;
    }
    function tube(rows: Row[], n: number, surface: "trunk" | "sail" | "jaw" | "leg"): void {
      const points = rows.map(([z, lo, hi, w, cx]) =>
        Array.from({ length: n }, (_, k): Point => {
          const a = (k * 2 * Math.PI) / n + Math.PI / 2;
          return [cx + w * Math.cos(a), (lo + hi) / 2 + ((hi - lo) / 2) * Math.sin(a), z];
        }),
      );
      function face(a: number, k: number, b: number, l: number, c: number, m: number, col: number): void {
        indices.push(
          vertex(points[a]![k]!, rows[a]![5], col),
          vertex(points[b]![l]!, rows[b]![5], col),
          vertex(points[c]![m]!, rows[c]![5], col),
        );
      }
      for (let i = 1; i < rows.length; i++)
        for (let k = 0; k < n; k++) {
          const l = (k + 1) % n,
            upper = Math.cos((2 * Math.PI * (k + 0.5)) / n);
          const col =
            surface === "sail"
              ? upper > 0.1
                ? REGION_BASE + 2
                : honey
              : surface === "jaw"
                ? sand
                : surface === "leg"
                  ? REGION_BASE + 5
                  : upper < -0.25
                    ? sand
                    : i % 4 === 0 && upper > 0.25
                      ? REGION_BASE + 3
                      : teal;
          face(i - 1, k, i - 1, l, i, k, col);
          face(i - 1, l, i, l, i, k, col);
        }
      for (let k = 1; k + 1 < n; k++) {
        face(0, 0, 0, k + 1, 0, k, surface === "sail" ? ember : teal);
        const e = rows.length - 1;
        face(e, 0, e, k, e, k + 1, surface === "sail" ? ember : sand);
      }
    }
    tube(far ? axial.filter((_, i) => ![2, 3, 5, 10, 11, 15].includes(i)) : axial, far ? 4 : 6, "trunk");
    tube(far ? fin.filter((_, i) => ![3, 4, 6].includes(i)) : fin, 4, "sail");
    tube(far ? jaw.filter((_, i) => i !== 2 && i !== 4) : jaw, far ? 3 : 4, "jaw");
    for (const [side, s] of [
      ["l", 1],
      ["r", -1],
    ] as const)
      for (const fore of [false, true]) {
        const kind = fore ? "fore" : "hind";
        const pts = fore
          ? [
              [0.68, 2.54, 3.17, 0.3],
              [0.88, 1.65, 3.14, 0.24],
              [0.98, 1.12, 3.1, 0.23],
              [1.01, 0.48, 3.57, 0.13],
              [1.04, 0.15, 3.76, 0.16],
              [1.12, 0.09, 4.25, 0.2],
            ]
          : [
              [0.6, 2.47, 0.2, 0.44],
              [0.79, 1.72, 0.3, 0.37],
              [0.86, 1.26, 0.24, 0.26],
              [0.94, 0.53, -0.31, 0.16],
              [0.99, 0.14, -0.31, 0.18],
              [1.04, 0.09, 0.17, 0.21],
            ];
        // Ring sections across each segment perpendicular to its centre line.
        const stages = ["upper", "upper", "lower", "ankle", "foot", "foot"];
        const ids = far ? [0, 2, 4, 5] : [0, 1, 2, 3, 4, 5],
          n = far ? 3 : 5;
        const rings = ids.map((idx, j) => {
          const [x, y, z, r] = pts[idx]!,
            prev = pts[ids[Math.max(0, j - 1)]!]!,
            next = pts[ids[Math.min(ids.length - 1, j + 1)]!]!;
          const dz = next[2]! - prev[2]!,
            dy = next[1]! - prev[1]!,
            len = Math.hypot(dy, dz);
          return Array.from({ length: n }, (_, k): Point => [
            s * x! + r! * Math.cos((k * 2 * Math.PI) / n),
            y! + (Math.sin((k * 2 * Math.PI) / n) * r! * (idx >= 4 ? 0.36 : 1) * dz) / len,
            z! - (Math.sin((k * 2 * Math.PI) / n) * r! * dy) / len,
          ]);
        });
        const id = (i: number, k: number) =>
          vertex(
            rings[i]![k]!,
            kind + "_" + stages[ids[i]!]! + "_" + side,
            i === ids.length - 1 ? sand : REGION_BASE + 5,
          );
        for (let i = 1; i < ids.length; i++)
          for (let k = 0; k < n; k++) {
            const l = (k + 1) % n;
            indices.push(id(i - 1, k), id(i - 1, l), id(i, k), id(i - 1, l), id(i, l), id(i, k));
          }
        for (let k = 1; k < n - 1; k++) {
          const e = ids.length - 1;
          indices.push(id(0, 0), id(0, k + 1), id(0, k), id(e, 0), id(e, k), id(e, k + 1));
        }
      }
    return {
      positions: Float32Array.from(positions),
      colors: Uint8Array.from(colors),
      bones: Uint8Array.from(joints),
      indices: Uint32Array.from(indices),
    };
  });
}
