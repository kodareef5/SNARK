// Rings follow the sloping body, turn up the neck and turn forward again at the muzzle.
// The two distance levels keep separate plantar surfaces and articulated neck sections.
import { nearestColour } from "../../../../../shared/pack/palette.ts";
import type { SourceLod } from "../../../../../tools/pack/write.ts";

type Station = readonly [
  bone: string,
  x: number,
  height: number,
  forward: number,
  width: number,
  rise: number,
  setback: number,
];
const body: Station[] = [
  ["tail_7", 1.42, 1.96, -6.68, 0.026, 0.037, 0],
  ["tail_7", 0.79, 1.86, -5.83, 0.14, 0.12, 0],
  ["tail_5", 0.15, 2.03, -4.4, 0.25, 0.25, 0],
  ["tail_4", 0, 2.34, -3.05, 0.39, 0.39, 0],
  ["tail_2", 0, 2.72, -1.62, 0.56, 0.57, -0.08],
  ["tail_1", 0, 2.95, -0.73, 0.71, 0.84, -0.2],
  ["pelvis", 0, 3.28, 0.1, 1.0, 1.15, -0.23],
  ["spine", 0, 3.59, 1.12, 1.34, 1.49, -0.26],
  ["spine", 0, 3.85, 1.94, 1.52, 1.64, -0.44],
  ["chest", 0, 4.14, 2.68, 1.4, 1.65, -0.8],
  ["chest", 0, 4.7, 3.32, 1.23, 1.26, -1.03],
  ["neck_1", 0, 5.58, 3.58, 0.92, 0.65, -1.15],
  ["neck_2", 0, 6.7, 3.99, 0.68, 0.33, -0.89],
  ["neck_3", 0, 7.97, 4.42, 0.55, 0.18, -0.67],
  ["neck_4", 0, 9.14, 4.65, 0.47, 0.13, -0.57],
  ["neck_5", 0, 10.32, 4.96, 0.39, 0.16, -0.54],
  ["neck_5", 0, 10.97, 5.19, 0.35, 0.26, -0.52],
  ["skull", 0, 11.4, 5.61, 0.31, 0.36, -0.38],
  ["skull", 0, 11.64, 5.99, 0.33, 0.32, -0.1],
  ["skull", 0, 11.61, 6.21, 0.3, 0.32, -0.06],
  ["skull", 0, 11.45, 6.47, 0.26, 0.2, 0],
  ["skull", 0, 11.43, 6.68, 0.16, 0.12, 0],
];
export function distanceLods(names: readonly string[], palette: Uint8Array): SourceLod[] {
  const dorsal = nearestColour(palette, 92, 105, 89),
    flank = nearestColour(palette, 153, 144, 112);
  const belly = nearestColour(palette, 184, 169, 133),
    foot = nearestColour(palette, 134, 124, 103);
  return [false, true].map((far) => {
    const positions: number[] = [],
      colors: number[] = [],
      bones: number[] = [],
      indices: number[] = [];
    function tube(rows: Station[], count: number, leg = false) {
      const first = colors.length;
      for (const [name, x, y, z, w, up, back] of rows) {
        const bone = names.indexOf(name);
        if (bone < 0) throw new Error(`Missing Brachiosaurus distance joint ${name}`);
        for (let i = 0; i < count; i++) {
          const angle = (2 * Math.PI * i) / count,
            c = Math.cos(angle);
          positions.push(x + w * Math.sin(angle), y + up * c, z + back * c);
          bones.push(bone);
          colors.push(leg ? foot : c > 0.45 ? dorsal : c < -0.45 ? belly : flank);
        }
      }
      for (let row = 1; row < rows.length; row++) {
        for (let k = 0; k < count; k++) {
          const a = first + (row - 1) * count + k,
            b = first + (row - 1) * count + ((k + 1) % count);
          indices.push(a, a + count, b, b, a + count, b + count);
        }
      }
      const last = first + count * (rows.length - 1);
      for (let k = 1; k < count - 1; k++)
        indices.push(first, first + k, first + k + 1, last, last + k + 1, last + k);
    }
    const skipped = new Set([1, 3, 5, 8, 12, 16, 19]);
    tube(far ? body.filter((_, i) => !skipped.has(i)) : body, far ? 6 : 8);
    for (const side of ["l", "r"])
      for (const kind of ["fore", "hind"]) {
        const s = side === "l" ? 1 : -1;
        // The bottom two rings give each column a heel, toe and flat sole.
        const rows =
          kind === "fore"
            ? [
                [1.0, 4.18, 3.3, 0.45, 0.55],
                [1.06, 3.15, 3.12, 0.42, 0.48],
                [1.03, 2.35, 3.28, 0.34, 0.43],
                [1.04, 1.0, 3.84, 0.32, 0.34],
                [1.07, 0.25, 3.91, 0.37, 0.42],
                [1.07, 0.02, 3.92, 0.4, 0.42],
              ]
            : [
                [0.92, 3.63, 0.54, 0.52, 0.63],
                [1.03, 2.73, 0.69, 0.46, 0.56],
                [1.06, 1.89, 0.52, 0.37, 0.46],
                [1.04, 0.92, 0.24, 0.33, 0.35],
                [1.08, 0.25, 0.3, 0.43, 0.47],
                [1.08, 0.02, 0.33, 0.44, 0.51],
              ];
        const stages = ["upper", "upper", "lower", "ankle", "foot", "foot"];
        const rings: Station[] = rows.map(([x, y, z, w, r], i) => [
          `${kind}_${stages[i]}_${side}`,
          s * x!,
          y!,
          z!,
          w!,
          0,
          r!,
        ]);
        tube(far ? rings.filter((_, i) => i !== 1 && i !== 4) : rings, far ? 4 : 5, true);
      }
    return {
      positions: Float32Array.from(positions),
      bones: Uint8Array.from(bones),
      colors: Uint8Array.from(colors),
      indices: Uint32Array.from(indices),
    };
  });
}
