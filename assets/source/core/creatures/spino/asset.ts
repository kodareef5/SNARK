import { SPINO_REGIONS } from "../../../../../content/creatures/spino.ts";
import type { CreatureAsset, Vec3, ZoneName, ZoneSpec } from "../../../../../tools/art/spec.ts";
import { distanceLods } from "./distance.ts";

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
        fore ? [0.26 * sign, -1.31, -0.03] : [0.2 * sign, -0.92, 0.29],
        fore ? 0.25 : 0.35,
      ),
      zone(
        region as ZoneName,
        kind + "_lower_" + s,
        fore ? [0.06 * sign, -0.76, 0.47] : [0.09 * sign, -0.86, -0.7],
        fore ? 0.18 : 0.22,
      ),
      zone(
        ((fore ? "hand" : "foot") + (s === "l" ? "L" : "R")) as ZoneName,
        kind + "_foot_" + s,
        [0.06 * sign, -0.03, 0.39],
        0.16,
      ),
    );
  }
  return [
    { name: "grip_" + s, bone: "neck_1", offset: [0.17 * sign, 1.11, 0.61] as Vec3 },
    { name: "rest_" + s, bone: "neck_1", offset: [0.63 * sign, 0.15, 0.56] as Vec3 },
    ...(["fore", "hind"] as const).map((k) => ({
      name: k + "_foot_" + s,
      bone: k + "_foot_" + s,
      offset: [0.03 * sign, -0.105, 0.14] as Vec3,
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
    "Spinosaurus by Grab3D (https://grab3d.com/models/creatures/spinosaurus/), CC0 1.0. Fitted mesh, jaw, rig, motion, saddle and river paint by SNARK",
  source: { scripts: ["rig.py", "model.py", "saddle.py", "clips.py"] },
  scale: 1,
  skeleton: { id: "spino", root: "pelvis", bones: 33 },
  zones: [
    zone("torso", "pelvis", [0, 0, 0.76], 0.69),
    zone("torso", "spine", [0, 0.06, 1.33], 0.8),
    zone("torso", "chest", [0, 0.06, 1.13], 0.81),
    zone("torso", "neck_1", [0, 0.25, 0.63], 0.46),
    zone("torso", "neck_2", [0, 0.43, 0.82], 0.38),
    zone("head", "skull", [0, -0.81, 2.44], 0.3),
    zone("head", "jaw", [0, -0.8, 2.2], 0.2),
    ...[1, 2, 3, 4, 5, 6, 7].map((i) =>
      zone("torso", "tail_" + i, [0, -0.12, -0.89], [0.44, 0.32, 0.26, 0.19, 0.15, 0.11, 0.09][i - 1]!),
    ),
    ...limbs,
  ],
  sockets: [
    { name: "seat", bone: "neck_1", offset: [0, 0.9, 0.41] },
    { name: "head", bone: "skull", offset: [0, 0.22, 0.57] },
    { name: "overhead", bone: "sail_mid", offset: [0, 2.34, 0] },
    { name: "bite", bone: "skull", offset: [0, -0.91, 2.4] },
    { name: "mouth", bone: "jaw", offset: [0, -0.58, 1.73] },
    { name: "vent", bone: "pelvis", offset: [0, -0.95, -0.43] },
    ...sockets,
  ],
  regions: SPINO_REGIONS.map((r) => ({ name: r.name, sample: r.colors[0]![0] })),
  materials: {
    spino_hide: {
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
  gaits: {
    walk: { stride: 2.12 },
    run: { stride: 3.2 },
    swim: { stride: 6, stated: "A 36-frame tail stroke at five metres per second." },
  },
  budgets: { triangles: [18500, 8800, 4600, 2100, 850, 600, 255], texture: { top: 2048, megabytes: 24, layer: 256 } },
  flat: 3,
  distanceLods,
  worn: [
    {
      item: "core:saddle_spino",
      object: "saddle",
      materials: { spino_tack: { base: "tex/tack.png" } },
      budgets: { triangles: [3500, 1250, 440, 130] },
      flat: 2,
    },
  ],
} satisfies CreatureAsset;
