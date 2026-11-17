import { VELOCE_ART, BERLINETTA_ART } from "../../../../../content/vehicles/sports-art.ts";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";

export function sportsAsset(art: typeof VELOCE_ART | typeof BERLINETTA_ART, paint: number): CreatureAsset {
  // Retain enough of the Berlinetta on the penultimate level for its measured error to stay below the last level.
  const penultimate = art.id === "core:berlinetta" ? 1550 : 1200;
  return {
    kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
    skeleton: { id: art.id, root: "chassis", bones: art.bones.length, order: art.bones },
    zones: [], sockets: Object.entries(art.anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
    regions: [
      { name: "Paint", sample: paint },
      { name: "Upholstery", sample: art.id === "core:veloce" ? 84 : 97 },
      { name: "Wheels", sample: 91 },
    ],
    materials: {
      coachwork: {
        base: "../sports/tex/base.png", normal: "../sports/tex/normal.png", height: "../sports/tex/height.png",
        packed: "../sports/tex/finish.png", regions: "../sports/tex/regions.png",
        hurt: "../sports/tex/hurt.png", decay: "../sports/tex/decay.png", cutout: true,
      },
    },
    clips: [], feet: [], gaits: {}, flat: 2, preserveBones: ["steering_wheel"],
    budgets: { triangles: [30000, 11000, 5500, 2500, penultimate, 650], texture: { top: 512, megabytes: 4, layer: 256 } },
  };
}
