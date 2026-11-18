// Far silhouettes are fitted to the hero in both grounded and airborne poses.
import { nearestColour, REGION_BASE } from "../../../../../shared/pack/palette.ts";
import type { SourceLod } from "../../../../../tools/pack/write.ts";
import levels from "./ref/distance.json";

export function distanceLods(names: readonly string[], palette: Uint8Array): SourceLod[] {
  // The outer bars, wing base and bill keep each animal's own dyes even when textures drop out.
  const pigments = [
    REGION_BASE, REGION_BASE + 1, nearestColour(palette, 155, 120, 96), REGION_BASE + 2,
    nearestColour(palette, 109, 68, 50), nearestColour(palette, 94, 81, 71), nearestColour(palette, 177, 155, 116),
  ];
  return levels.map(level => {
    const positions: number[] = [], bones: number[] = [], colors: number[] = [], indices: number[] = [];
    const vertices = new Map<number, number>();
    for (const [a, b, c, pigment] of level.faces) {
      for (const source of [a!, b!, c!]) {
        const key = source * pigments.length + pigment!;
        let index = vertices.get(key);
        if (index === undefined) {
          const [x, y, z, bone] = level.vertices[source]! as [number, number, number, string];
          const joint = names.indexOf(bone);
          if (joint < 0) throw new Error(`Pteranodon distance mesh needs ${bone}`);
          index = colors.length;
          vertices.set(key, index);
          positions.push(x, y, z);
          bones.push(joint);
          colors.push(pigments[pigment!]!);
        }
        indices.push(index);
      }
    }
    return { positions: Float32Array.from(positions), bones: Uint8Array.from(bones), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices) };
  });
}
