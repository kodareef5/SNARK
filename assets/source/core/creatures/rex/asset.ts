// The Tyrannosaurus, built from Patch's animated T-rex (ref/SOURCES.md, ref/DESIGN.md). The plan that made it is
// planning/workstreams/rex2.md.
import { defaultPalette, nearestColour } from "../../../../../shared/pack/palette.ts";
import type { CreatureAsset, ZoneSpec } from "../../../../../tools/art/spec.ts";
import rider from "./ref/rider.json";
import fitted from "./ref/zones.json";

const palette = defaultPalette();
// The six dye regions, named as the earlier Rex's were so a saved animal keeps its colours. Each sample is the
// region's first wild colour (content/creatures/rex.ts), for the review sheet.
const regions = [
  ["Flanks", 0x54412e], ["Throat and belly", 0x9a7f5b], ["Dorsal bars", 0x3a261c],
  ["Face and nasal ridges", 0x655038], ["Limbs and tail bands", 0x54412e], ["Claws and brow scutes", 0x3a261c],
] as const;

// Hit capsules fitted to the built skin by ref/zones.ts, along each bone.
const zones = fitted as ZoneSpec[];

const loop = ["idle", "walk", "run", "swim", "swim_idle", "fall", "torpor_idle"];
const single = ["idle_look", "idle_scent", "attack", "call", "startled", "flinch", "land", "turn", "torpor_in", "torpor_eat", "torpor_out", "death"];

export default {
  modelCredit: "Animated T-rex by Patch, made with anymove (https://patch.gg/create/toolbox/assets/anymove:trex), CC0 1.0. Adapted for SNARK",
  kind: "creature",
  source: { scripts: ["import.py", "gaits.py", "clips.py", "saddle.py"] },
  scale: 1,
  skeleton: { id: "rex", root: "pelvis", bones: 25 },
  zones,
  // Offsets are from each bone's joint at rest, in metres (ref/caps.ts prints where they land). The seat and the
  // rider's grips, footrests, soles and knees are placed by saddle.py and kept in ref/rider.json. The vent is under the
  // root of the tail.
  sockets: [
    ...Object.entries(rider).map(([name, offset]) => ({ name, bone: "spine", offset: offset as [number, number, number] })),
    { name: "overhead", bone: "spine", offset: [0, 2.4, 0.3] },
    { name: "head", bone: "skull", of: ["skull"], at: "top" },
    { name: "mouth", bone: "jaw", of: ["jaw"], at: "front" },
    { name: "bite", bone: "skull", of: ["skull"], at: "front" },
    { name: "vent", bone: "pelvis", offset: [0, -0.85, -1.0] },
  ],
  regions: regions.map(([name, rgb]) => ({ name, sample: nearestColour(palette, rgb >>> 16, (rgb >>> 8) & 255, rgb & 255) })),
  clips: [...loop, ...single].map((name) => ({ name, source: name, loop: loop.includes(name) })),
  // tex/rex_normal.png and rex_packed.png are the source's own (ref/prepare.py); the rest are made by ref/paint.py.
  materials: {
    rex: {
      base: "tex/rex_base.png", normal: "tex/rex_normal.png", packed: "tex/rex_packed.png",
      regions: { mask: "tex/rex_mask.png", mask2: "tex/rex_mask2.png" },
      hurt: "tex/rex_hurt.png", decay: "tex/rex_decay.png",
    },
  },
  feet: ["toes_l", "toes_r"],
  // How far the source's Walk_Root and Run_Root travel in one cycle (ref/gait.py).
  gaits: {
    walk: { stride: 4.23 }, run: { stride: 6.29 },
    swim: { stride: 3.8, stated: "Alternating hindlimb strokes at three metres per second." },
  },
  budgets: { triangles: [58000, 30000, 14500, 6200, 2600, 1000, 300, 112], texture: { top: 4096, megabytes: 64, layer: 256 } },
  flat: 5,
  // Limp as the death clip's roll ends, at tick 46, so it settles quickly from lying. Each limit is a little past what
  // the clips bend that joint.
  ragdoll: { limp: 46, bodies: [
    { bone: "pelvis", mass: 0.4 }, { bone: "skull", mass: 0.08, swing: 62, twist: 18 },
    { bone: "tail_3", mass: 0.082, swing: 33, twist: 13 },
    ...(["l", "r"] as const).flatMap((side) => [
      { bone: `forearm_${side}`, mass: 0.012, swing: 51, twist: 58 },
      { bone: `shank_${side}`, mass: 0.12, swing: 76, twist: 28 },
      { bone: `toes_${side}`, mass: 0.1, swing: 75, twist: 45 },
    ]),
  ],
  // The thighs are wider than the hips, and the trunk and tail root carry the body on the ground. Their capsules ride
  // on the pelvis body, so a fallen Rex rests on them and its thigh doesn't sink. The tail's end rides on the middle of
  // the tail: as a body of its own, light and long, it kept swinging after the rest had settled.
  contacts: ["thigh_l", "thigh_r", "metatarsus_l", "metatarsus_r", "humerus_l", "humerus_r", "spine", "chest", "neck_1", "neck_2", "jaw", "tail_1", "tail_2", "tail_4", "tail_5"] },
  // Its saddle, fitted by saddle.py.
  worn: [{
    item: "core:saddle_rex", object: "saddle",
    materials: { rex_saddle: { base: "tex/rex_saddle_base.png", normal: "tex/rex_saddle_normal.png", packed: "tex/rex_saddle_packed.png" } },
    budgets: { triangles: [4800, 1600, 550, 360] }, flat: 2,
  }],
} satisfies CreatureAsset;
