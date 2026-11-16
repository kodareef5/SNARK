import rig from "../../../../../content/landmarks/koru-sails.json" with { type: "json" };
import { shared, type CreatureAsset } from "../../../../../tools/art/spec.ts";

export function sailAsset(name: string): CreatureAsset {
  const sail = rig.sails.find((s) => s.id === name)!;
  const maps = (kind: string) => shared(import.meta.dir, `core:koru_sails/${kind}`, {
    tiles: 2, base: `tex/${kind}_base.png`, normal: `tex/${kind}_normal.png`, packed: `tex/${kind}_packed.png`, height: `tex/${kind}_height.png`,
  });
  return {
    kind: "creature", source: { scripts: ["model.py"] }, scale: 1, authoredLevels: true,
    skeleton: { id: sail.skeleton, root: "root", bones: sail.bones.length, order: sail.bones },
    zones: [], sockets: [], regions: [], clips: [], feet: [], gaits: {},
    materials: { cloth: maps("cloth"), reinforcement: maps("reinforcement"), ...("gaff" in sail ? { spar: maps("spar") } : {}) },
    budgets: { triangles: [30000, 16000, 10000, 6500, 4500, 3000], texture: { top: 1024, megabytes: 24 } }, flat: 1,
  };
}
