// Rex v2, built from Patch's T-rex (ref/SOURCES.md). The plan is planning/workstreams/rex2.md.
import { defaultPalette, nearestColour } from "../../../../../shared/pack/palette.ts";
import type { CreatureAsset, ZoneSpec } from "../../../../../tools/art/spec.ts";

const palette = defaultPalette();
// The old Rex's six regions, by the same names, so a saved animal keeps its colours.
const regions = [
  ["Flanks", 0x777348], ["Throat and belly", 0xc0a477], ["Dorsal bars", 0x49483b],
  ["Face and nasal ridges", 0x99664a], ["Limbs and tail bands", 0x62644c], ["Claws and brow scutes", 0x92774f],
] as const;

// Capsules fitted to the skin of the bones they cover. A first fit; step 6 of the plan checks them.
const zones: ZoneSpec[] = [
  { zone: "torso", on: "pelvis", from: "pelvis", to: "spine", covers: ["pelvis"] },
  { zone: "torso", on: "spine", from: "spine", to: "chest", covers: ["spine"] },
  { zone: "torso", on: "chest", from: "chest", to: "neck_1", covers: ["chest"] },
  { zone: "torso", on: "neck_1", from: "neck_1", to: "neck_2", covers: ["neck_1"] },
  { zone: "torso", on: "neck_2", from: "neck_2", to: "skull", covers: ["neck_2"] },
  { zone: "head", on: "skull", covers: ["skull"] },
  { zone: "head", on: "jaw", covers: ["jaw"] },
  { zone: "torso", on: "tail_1", from: "tail_1", to: "tail_2", covers: ["tail_1"] },
  { zone: "torso", on: "tail_2", from: "tail_2", to: "tail_3", covers: ["tail_2"] },
  { zone: "torso", on: "tail_3", from: "tail_3", to: "tail_4", covers: ["tail_3"] },
  { zone: "torso", on: "tail_4", from: "tail_4", to: "tail_5", covers: ["tail_4"] },
  { zone: "torso", on: "tail_5", from: "tail_5", to: "tail_6", covers: ["tail_5", "tail_6"] },
  ...(["l", "r"] as const).flatMap((s): ZoneSpec[] => {
    const side = s === "l" ? "L" : "R";
    return [
      { zone: `leg${side}`, on: `thigh_${s}`, from: `thigh_${s}`, to: `shank_${s}`, covers: [`thigh_${s}`] },
      { zone: `leg${side}`, on: `shank_${s}`, from: `shank_${s}`, to: `metatarsus_${s}`, covers: [`shank_${s}`] },
      { zone: `leg${side}`, on: `metatarsus_${s}`, from: `metatarsus_${s}`, to: `toes_${s}`, covers: [`metatarsus_${s}`] },
      { zone: `foot${side}`, on: `toes_${s}`, covers: [`toes_${s}`] },
      { zone: `arm${side}`, on: `humerus_${s}`, from: `humerus_${s}`, to: `forearm_${s}`, covers: [`humerus_${s}`] },
      { zone: `hand${side}`, on: `forearm_${s}`, covers: [`forearm_${s}`] },
    ];
  }),
];

const loop = ["idle", "walk", "run"];
const single = ["attack", "flinch", "call"];

export default {
  modelCredit: "Animated T-rex by Patch, made with anymove (https://patch.gg/create/toolbox/assets/anymove:trex), CC0 1.0. Adapted for SNARK",
  kind: "creature",
  source: { scripts: ["import.py"] },
  scale: 1,
  skeleton: { id: "rex2", root: "pelvis", bones: 25 },
  zones,
  sockets: [
    { name: "seat", bone: "chest", of: ["spine", "chest"], at: "top" },
    { name: "overhead", bone: "chest", of: ["chest", "neck_1", "neck_2", "skull"], at: "top" },
    { name: "head", bone: "skull", of: ["skull"], at: "top" },
    { name: "mouth", bone: "jaw", of: ["jaw"], at: "front" },
    { name: "bite", bone: "skull", of: ["skull"], at: "front" },
    { name: "vent", bone: "pelvis", offset: [0, -0.5, -0.5] },
  ],
  regions: regions.map(([name, rgb]) => ({ name, sample: nearestColour(palette, rgb >>> 16, (rgb >>> 8) & 255, rgb & 255) })),
  clips: [...loop, ...single].map((name) => ({ name, source: name, loop: loop.includes(name) })),
  materials: {
    rex2: { base: "tex/rex2_base.png", normal: "tex/rex2_normal.png", packed: "tex/rex2_packed.png" },
  },
  feet: ["toes_l", "toes_r"],
  // How far the source's Walk_Root and Run_Root travel in one cycle (ref/gait.py).
  gaits: { walk: { stride: 4.23 }, run: { stride: 6.29 } },
  budgets: { triangles: [58000, 30000, 14500, 6200, 2600, 1000], texture: { top: 4096, megabytes: 160 } },
  flat: 5,
} satisfies CreatureAsset;
