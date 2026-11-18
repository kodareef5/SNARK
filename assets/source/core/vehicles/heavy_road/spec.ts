import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";
import { nearestColour } from "../../../../../shared/pack/palette.ts";

export function heavyRoadAsset(
  folder: string,
  name: string,
  anchors: Record<string, readonly [number, number, number]>,
  triangles: number[],
): CreatureAsset {
  const joints = Object.keys(
    JSON.parse(readFileSync(folder + "/rig.json", "utf8")),
  );
  const palette: number[][] = JSON.parse(
    readFileSync(folder + "/palette.json", "utf8"),
  );
  return {
    kind: "creature",
    source: { scripts: ["model.py"] },
    scale: 1,
    skeleton: {
      id: "core:" + name,
      root: "chassis",
      bones: joints.length,
      order: joints,
    },
    sockets: Object.entries(anchors).map(([name, offset]) => ({
      name,
      offset,
      bone: "chassis",
    })),
    zones: [],
    regions: [],
    clips: [],
    feet: [],
    gaits: {},
    materials: { livery: { base: "livery.png", packed: "orm.png" } },
    flat: 2,
    budgets: { triangles, texture: { top: 1024, megabytes: 12 } },
    distanceLods(bones, pal) {
      const swatches = palette.map(([r, g, b]) =>
        nearestColour(pal, r!, g!, b!),
      );
      return [2, 3, 4, 5].map((level) => {
        const parts: [string, number, number[], number[]][] = JSON.parse(
          gunzipSync(
            readFileSync(folder + "/lod" + level + ".json.gz"),
          ).toString(),
        );
        const pos: number[] = [],
          idx: number[] = [],
          joints: number[] = [],
          colors: number[] = [];
        for (const [name, tile, v, f] of parts) {
          const joint = bones.indexOf(name),
            base = pos.length / 3;
          if (joint < 0) throw new Error("Missing rigid joint " + name);
          pos.push(...v);
          for (const i of f) idx.push(base + i);
          for (let i = 0; i < v.length; i += 3) {
            joints.push(joint);
            colors.push(swatches[tile]!);
          }
        }
        return {
          positions: Float32Array.from(pos),
          indices: Uint32Array.from(idx),
          bones: Uint8Array.from(joints),
          colors: Uint8Array.from(colors),
        };
      });
    },
  };
}
