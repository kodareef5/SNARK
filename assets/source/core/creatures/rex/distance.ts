// Closed, rigged silhouette meshes for the two farthest distance levels.
import { nearestColour, REGION_BASE } from "../../../../../shared/pack/palette.ts";
import type { SourceLod } from "../../../../../tools/pack/write.ts";
import type { Vec3 } from "../../../../../tools/art/spec.ts";

// Longitudinal section: z, belly, crown, half width, joint. Upper arcade
// and dentary meet at the lips, then separate with the same jaw as the hero.
type Station = [number, number, number, number, string];
const axial: Station[] = [
  [-7.1, 1.74, 1.79, 0.025, "tail_5"],
  [-4.6, 1.81, 2.33, 0.25, "tail_4"],
  [-3.8, 1.95, 2.72, 0.37, "tail_3"],
  [-3, 2.09, 3.14, 0.47, "tail_2"],
  [-1.65, 2.24, 3.79, 0.78, "tail_1"],
  [-0.94, 2.18, 4.02, 0.98, "pelvis"],
  [0.25, 1.86, 3.89, 0.92, "chest"],
  [0.95, 1.74, 3.82, 0.87, "chest"],
  [2.1, 2.48, 4.13, 0.64, "neck_1"],
  [2.6, 2.78, 4.25, 0.6, "neck_2"],
  [2.97, 3.26, 4.42, 0.64, "skull"],
  [3.27, 3.45, 4.55, 0.75, "skull"],
  [3.94, 3.36, 4.23, 0.52, "skull"],
  [5.12, 3.49, 3.88, 0.19, "maxilla"],
];
const dentary: Station[] = [
  [2.88, 3.05, 3.47, 0.37, "jaw"],
  [3.14, 2.81, 3.5, 0.58, "jaw"],
  [4.05, 2.97, 3.35, 0.43, "jaw"],
  [5.03, 3.25, 3.44, 0.17, "jaw"],
];
type Ring = { centre: Vec3; u: Vec3; v: Vec3; bone: string };

export function distanceLods(bones: readonly string[], palette: Uint8Array): SourceLod[] {
  const umber = nearestColour(palette, 56, 43, 34),
    charcoal = nearestColour(palette, 47, 41, 37);
  const amber = nearestColour(palette, 139, 91, 55),
    ochre = nearestColour(palette, 114, 79, 54);
  const cream = nearestColour(palette, 167, 143, 113),
    jaw = nearestColour(palette, 133, 111, 82);
  return [false, true].map((farthest) => {
    const positions: number[] = [],
      colors: number[] = [],
      joints: number[] = [],
      indices: number[] = [];
    const lookup = new Map<string, number>();
    function vertex(point: Vec3, bone: string, colour: number): number {
      const key = [bone, colour, ...point].join(",");
      let index = lookup.get(key);
      if (index === undefined) {
        const joint = bones.indexOf(bone);
        if (joint < 0) throw new Error(`Rex distance mesh needs ${bone}`);
        index = colors.length;
        positions.push(...point);
        colors.push(colour);
        joints.push(joint);
        lookup.set(key, index);
      }
      return index;
    }
    function tube(rows: Ring[], sides: number, surface: "body" | "jaw" | "limb", offset = 0): void {
      const rings = rows.map(({ centre, u, v }) =>
        Array.from({ length: sides }, (_, k): Vec3 => {
          const theta = offset + (2 * Math.PI * k) / sides;
          const a = Math.cos(theta),
            b = Math.sin(theta);
          return [centre[0] + u[0] * a + v[0] * b, centre[1] + u[1] * a + v[1] * b, centre[2] + u[2] * a + v[2] * b];
        }),
      );
      function face(r: number, k: number, s: number, l: number, t: number, m: number, colour: number): void {
        for (const [row, col] of [
          [r, k],
          [s, l],
          [t, m],
        ] as const)
          indices.push(vertex(rings[row]![col]!, rows[row]!.bone, colour));
      }
      for (let r = 1; r < rows.length; r++)
        for (let k = 0; k < sides; k++) {
          const l = (k + 1) % sides,
            altitude = Math.sin(offset + ((k + 0.5) * 2 * Math.PI) / sides);
          const z = (rows[r]!.centre[2] + rows[r - 1]!.centre[2]) * 0.5;
          const bar = Math.sin(z * 4.4 + 1.7 * altitude);
          let colour = surface === "jaw" ? (altitude < -0.12 ? cream : jaw) : ochre;
          if (surface === "body")
            colour =
              altitude < -0.48
                ? cream
                : altitude > 0.72
                  ? charcoal
                  : bar > 0.49 && altitude > -0.35
                    ? umber
                    : altitude < 0.08
                      ? amber
                      : ochre;
          if (surface === "limb") colour = r >= rows.length - 2 ? umber : k % 3 === 0 ? ochre : jaw;
          // A few broad fields receive the animal's dye, interleaved with baked hide.
          if (surface === "body" && altitude > 0.3 && altitude < 0.74 && bar > 0.8) colour = REGION_BASE + 2;
          face(r - 1, k, r - 1, l, r, k, colour);
          face(r - 1, l, r, l, r, k, colour);
        }
      for (let k = 1; k + 1 < sides; k++) {
        const end = rows.length - 1;
        face(0, 0, 0, k + 1, 0, k, umber);
        face(end, 0, end, k, end, k + 1, surface === "jaw" ? jaw : ochre);
      }
    }
    function trunk(stations: Station[], selected: number[], sides: number, part: "body" | "jaw"): void {
      tube(
        selected.map((i) => {
          const [z, bottom, top, w, bone] = stations[i]!;
          return { centre: [0, (top + bottom) / 2, z], u: [w, 0, 0], v: [0, (top - bottom) / 2, 0], bone };
        }),
        sides,
        part,
      );
    }
    const bodyRows = farthest ? [0, 2, 5, 7, 9, 11, 13] : [0, 1, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13];
    trunk(axial, bodyRows, farthest ? 4 : 6, "body");
    trunk(dentary, farthest ? [1, 3] : [0, 1, 2, 3], farthest ? 3 : 4, "jaw");
    for (const side of [-1, 1]) {
      const suffix = side > 0 ? "_l" : "_r";
      // y, x, z, transverse and fore-aft radii, controlling joint.
      type Leg = [number, number, number, number, number, string];
      const leg: Leg[] = [
        [3.05, 0.78, -0.68, 0.42, 0.71, "thigh"],
        [1.95, 0.72, -0.02, 0.3, 0.42, "shank"],
        [0.95, 0.64, -0.86, 0.17, 0.22, "metatarsus"],
        [0.18, 0.65, -0.5, 0.16, 0.21, "toes"],
        [0.066, 0.65, -0.15, 0.28, 0.48, "toes"],
      ];
      const rings = (source: Leg[]) =>
        source.map(([y, x, z, w, d, bone]): Ring => {
          return { centre: [side * x, y, z], u: [w, 0, 0], v: [0, 0, d], bone: bone + suffix };
        });
      tube(rings(leg), farthest ? 3 : 5, "limb", farthest ? Math.PI / 2 : 0);
      if (!farthest) {
        const arm: Leg[] = [
          [2.93, 0.53, 1.65, 0.12, 0.16, "humerus"],
          [2.54, 0.65, 1.42, 0.083, 0.1, "forearm"],
          [2.39, 0.72, 2.05, 0.027, 0.045, "manus"],
        ];
        tube(rings(arm), 3, "limb");
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
