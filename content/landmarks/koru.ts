// Koru, a three-masted schooner of 125 m moored as a landmark (assets/source/landmarks/koru/). Its modules are walked as
// statics drawn as nothing, each 16 m of its length is drawn by one module of it, its doors swap as a base's do, and its
// sail control sets and strikes the sails. Its layout is the art's, written by author_layout.py.

import layout from "./koru-layout.json" with { type: "json" };
import { shapeHalf, type Def, type MotionFacet, type ShapeLook, type StructureDef } from "../../shared/content/defs.ts";
import { YAW_UNITS } from "../../shared/coords.ts";
import type { Landmark } from "../../shared/world/landmark.ts";

type Vec3 = readonly [number, number, number];

interface Parts {
  readonly boxes?: readonly { readonly at: readonly number[]; readonly half: readonly number[] }[];
  readonly hulls?: readonly { readonly points: readonly (readonly number[])[] }[];
}

interface Module extends Parts {
  readonly id: string;
  readonly mesh: string;
  readonly category: string;
  readonly color: number;
  readonly origin: readonly number[];
  /** Degrees. */
  readonly yaw: number;
  readonly placed: boolean;
  readonly opens?: string;
  readonly look?: Parts;
}

export const KORU_LAYOUT = layout;
const MODULES = layout.modules as readonly Module[];

const v3 = (p: readonly number[]): Vec3 => [p[0]!, p[1]!, p[2]!];
const partsOf = (p: Parts): ShapeLook => ({ boxes: (p.boxes ?? []).map((b) => ({ at: v3(b.at), half: v3(b.half) })), hulls: (p.hulls ?? []).map((h) => ({ corners: h.points.map(v3) })) });
const yawOf = (degrees: number): number => Math.round((degrees * YAW_UNITS) / 360) & (YAW_UNITS - 1);

const motion: MotionFacet = { seconds: layout.motion.seconds, parts: layout.motion.parts as unknown as MotionFacet["parts"], say: ["set the sails", "strike the sails"] };

const defs: Def[] = MODULES.flatMap((m): Def[] => {
  const walked = partsOf(m), look = m.look ? partsOf(m.look) : undefined;
  const shape = `${m.id}_shape`;
  const structure: StructureDef = {
    type: "structure",
    class: "static",
    id: m.id,
    mesh: m.mesh,
    shape,
    half: shapeHalf(walked.boxes!, walked.hulls, look),
    color: m.color,
    hp: 10000,
    ...(m.opens ? { opens: m.opens } : {}),
    ...(m.id === layout.motion.static ? { motion } : {}),
  };
  return [{ type: "shape", id: shape, role: m.category === "door" ? "door" : "thing", boxes: walked.boxes!, hulls: walked.hulls, ...(look ? { look } : {}) }, structure];
});

/** The ground of the bay under it and the quay its gangway lands on, which the map lays for it. */
const BEAM = layout.dimensions.beam / 2;
const LANDING = layout.docking.shoreLanding;

export const KORU: Landmark = {
  name: "koru",
  defs,
  pieces: MODULES.filter((m) => m.placed).map((m) => ({ kind: m.id, at: v3(m.origin), yaw: yawOf(m.yaw) })),
  // Its tender lies off the stern steps, bow to the yacht.
  vehicles: [{ kind: "core:boat", id: "koru/tender", at: [0, 0, layout.dimensions.hullMinZ - 14], yaw: 0, condition: [0.85, 1], fuel: [0.6, 0.9] }],
  ground: [
    { from: [-BEAM - 6, layout.dimensions.hullMinZ - 26], to: [BEAM + 6, layout.dimensions.bowspritTip[2]! + 4], y: layout.dimensions.lowestKeel - 1.5, dig: true },
    { from: [LANDING[0]! - 0.4, LANDING[2]! - 16], to: [LANDING[0]! + 24, LANDING[2]! + 16], y: LANDING[1]! },
  ],
};
