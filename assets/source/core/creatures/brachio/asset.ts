import { distanceLods } from "./distance.ts";
import { BRACHIO_REGIONS } from "../../../../../content/creatures/brachio.ts";
import type { CreatureAsset, Vec3, ZoneName, ZoneSpec } from "../../../../../tools/art/spec.ts";

const zone = (region: ZoneName, bone: string, b: Vec3, radius: number): ZoneSpec => ({
  zone: region,
  on: bone,
  a: [0, 0, 0],
  b,
  radius,
});
const limbs: ZoneSpec[] = [];
const sockets = (["l", "r"] as const).flatMap((s) => {
  const sign = s === "l" ? 1 : -1;
  for (const fore of [false, true]) {
    const kind = fore ? "fore" : "hind";
    const region = (fore ? "arm" : "leg") + (s === "l" ? "L" : "R");
    limbs.push(
      zone(
        region as ZoneName,
        kind + "_upper_" + s,
        fore ? [0.12 * sign, -1.64, -0.14] : [0.17 * sign, -1.36, 0.21],
        fore ? 0.38 : 0.45,
      ),
      zone(
        region as ZoneName,
        kind + "_lower_" + s,
        fore ? [-0.03 * sign, -1.64, 0.73] : [-0.02 * sign, -1.29, -0.55],
        fore ? 0.33 : 0.35,
      ),
      zone(
        ((fore ? "hand" : "foot") + (s === "l" ? "L" : "R")) as ZoneName,
        kind + "_foot_" + s,
        [0.06 * sign, -0.03, 0.39],
        0.35,
      ),
    );
  }
  return [
    { name: "grip_" + s, bone: "spine", offset: [0.16 * sign, 2.39, 0.76] as Vec3 },
    { name: "rest_" + s, bone: "spine", offset: [0.67 * sign, 1.33, 0.56] as Vec3 },
    ...(["fore", "hind"] as const).map((k) => ({
      name: k + "_foot_" + s,
      bone: k + "_foot_" + s,
      offset: [0, -0.17, 0.15] as Vec3,
    })),
  ];
});
const loops = ["idle", "walk", "run", "swim", "swim_idle", "fall", "torpor_idle"];
const singles = [
  "idle_look",
  "turn",
  "attack",
  "call",
  "startled",
  "flinch",
  "land",
  "torpor_in",
  "torpor_out",
  "death",
];
export default {
  kind: "creature",
  modelCredit:
    "Brachiosaurus by Grab3D (https://grab3d.com/models/creatures/brachiosaurus/), CC0 1.0. Fitted mesh, rig, motion, saddle and canopy paint by SNARK",
  source: { scripts: ["rig.py", "model.py", "saddle.py", "clips.py"] },
  scale: 1,
  skeleton: { id: "brachio", root: "pelvis", bones: 32 },
  zones: [
    zone("torso", "pelvis", [0, 0.31, 0.9], 0.98),
    zone("torso", "spine", [0, 0.45, 1.3], 1.22),
    zone("torso", "chest", [0, 0.87, 0.92], 1.25),
    zone("torso", "neck_1", [0, 1.28, 0.38], 0.83),
    zone("torso", "neck_2", [0, 1.35, 0.49], 0.66),
    zone("torso", "neck_3", [0, 1.34, 0.38], 0.49),
    zone("torso", "neck_4", [0, 1.16, 0.26], 0.4),
    zone("torso", "neck_5", [0, 1.1, 0.4], 0.34),
    zone("head", "skull", [0, 0.36, 1.36], 0.32),
    ...[1, 2, 3, 4, 5, 6, 7].map((i) =>
      zone(
        "torso",
        "tail_" + i,
        [[0, 0, 0.0, 0.05, 0.2, 0.47, 0.68][i - 1]!, -0.13, -0.96],
        [0.69, 0.51, 0.39, 0.3, 0.23, 0.16, 0.085][i - 1]!,
      ),
    ),
    ...limbs,
  ],
  sockets: [
    { name: "seat", bone: "spine", offset: [0, 2.14, 0.47] },
    { name: "head", bone: "skull", offset: [0, 0.5, 0.81] },
    { name: "overhead", bone: "skull", offset: [0, 1.05, 0.62] },
    { name: "mouth", bone: "skull", offset: [0, 0.24, 1.3] },
    { name: "stomp", bone: "fore_foot_l", offset: [0, -0.12, 0.19] },
    { name: "vent", bone: "pelvis", offset: [0, -1.12, -0.39] },
    ...sockets,
  ],
  regions: BRACHIO_REGIONS.map((r) => ({ name: r.name, sample: r.colors[0]![0] })),
  materials: {
    brachio_hide: {
      base: "tex/base.png",
      hurt: "tex/hurt.png",
      decay: "tex/decay.png",
      normal: "tex/normal.png",
      packed: "tex/packed.png",
      regions: { mask: "tex/mask.png", mask2: "tex/mask2.png" },
      tops: { mask: 512, mask2: 512, mro: 512 },
    },
  },
  clips: [...loops, ...singles].map((name) => ({ name, source: name, loop: loops.includes(name) })),
  feet: ["hind_foot_l", "hind_foot_r", "fore_foot_l", "fore_foot_r"],
  ground: {
    maxTilt: 40, maxStep: 0.9, probe: 3,
    legs: (["hind", "fore"] as const).flatMap(kind => ["l", "r"].map(side => ({
      upper: `${kind}_upper_${side}`, lower: `${kind}_lower_${side}`,
      end: `${kind}_ankle_${side}`, socket: `${kind}_foot_${side}`,
    }))),
  },
  gaits: {
    walk: { stride: 2.8 },
    run: { stride: 3.6 },
    swim: { stride: 4.32, stated: "A 54-frame paddle cycle at 2.4 metres per second." },
  },
  budgets: {
    triangles: [18500, 8800, 4600, 2100, 850, 600, 295],
    texture: { top: 2048, megabytes: 24, layer: 256 },
  },
  flat: 3,
  distanceLods,
  preserveBones: ["skull", "neck_3", "tail_7", "fore_foot_l", "fore_foot_r", "hind_foot_l", "hind_foot_r"],
  worn: [
    {
      item: "core:saddle_brachio",
      object: "saddle",
      materials: { brachio_tack: { base: "tex/tack.png" } },
      budgets: { triangles: [4000, 1250, 440, 170] },
      flat: 2,
    },
  ],
} satisfies CreatureAsset;
