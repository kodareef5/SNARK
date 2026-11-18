import { TANKER_ANCHORS } from "../../../../../content/vehicles/tanker.ts";
import { nearestColour } from "../../../../../shared/pack/palette.ts";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";
import rig from "./ref/rig.json" with { type: "json" };
import shells from "./ref/distance.json" with { type: "json" };
const rgb = [
  [31, 99, 94],
  [237, 226, 189],
  [215, 154, 58],
  [60, 77, 78],
  [38, 40, 39],
  [149, 156, 146],
  [81, 73, 54],
  [223, 218, 173],
  [167, 62, 43],
  [233, 167, 62],
  [103, 135, 133],
  [62, 62, 54],
  [49, 55, 53],
  [96, 78, 59],
  [59, 109, 106],
  [31, 36, 37],
  [229, 222, 191],
];
export default {
  kind: "creature",
  source: { scripts: ["model.py"] },
  scale: 1,
  skeleton: { id: "core:tanker", root: "chassis", bones: Object.keys(rig).length, order: Object.keys(rig) },
  sockets: Object.entries(TANKER_ANCHORS).map(([name, offset]) => ({ name, bone: "chassis", offset })),
  zones: [],
  regions: [],
  clips: [],
  feet: [],
  gaits: {},
  materials: { livery: { base: "tex/service.png", packed: "tex/orm.png" } },
  flat: 2,
  budgets: { triangles: [26500, 13500, 9800, 3750, 1100, 870], texture: { top: 1024, megabytes: 12 } },
  preserveBones: Object.keys(rig).filter((b) => b.startsWith("wheel_")),
  distanceLods(names, palette) {
    const colours = rgb.map((c) => nearestColour(palette, c[0]!, c[1]!, c[2]!));
    return shells.map((level) => {
      const positions: number[] = [],
        indices: number[] = [],
        bones: number[] = [],
        colors: number[] = [];
      for (const [name, swatch, vertices, faces] of level as [string, number, number[], number[]][]) {
        const base = positions.length / 3,
          bone = names.indexOf(name);
        if (bone < 0) throw new Error(`Missing tanker joint ${name}`);
        positions.push(...vertices);
        indices.push(...faces.map((i) => i + base));
        for (let i = 0; i < vertices.length; i += 3) {
          bones.push(bone);
          colors.push(colours[swatch]!);
        }
      }
      return {
        positions: Float32Array.from(positions),
        indices: Uint32Array.from(indices),
        bones: Uint8Array.from(bones),
        colors: Uint8Array.from(colors),
      };
    });
  },
} satisfies CreatureAsset;
