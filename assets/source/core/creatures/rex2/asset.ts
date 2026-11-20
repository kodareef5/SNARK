// Rex v2, built from Patch's T-rex (ref/SOURCES.md). The plan is planning/workstreams/rex2.md.
import { defaultPalette, nearestColour } from "../../../../../shared/pack/palette.ts";
import type { CreatureAsset, ZoneSpec } from "../../../../../tools/art/spec.ts";
import rider from "./ref/rider.json";
import fitted from "./ref/zones.json";

const palette = defaultPalette();
// The old Rex's six regions, by the same names, so a saved animal keeps its colours.
const regions = [
  ["Flanks", 0x777348], ["Throat and belly", 0xc0a477], ["Dorsal bars", 0x49483b],
  ["Face and nasal ridges", 0x99664a], ["Limbs and tail bands", 0x62644c], ["Claws and brow scutes", 0x92774f],
] as const;

// Hit capsules fitted to the built skin by ref/zones.ts: along each bone's skin, holding three quarters of it.
const zones = fitted as ZoneSpec[];

const loop = ["idle", "walk", "run", "swim", "swim_idle", "fall", "torpor_idle"];
const single = ["idle_look", "idle_scent", "attack", "call", "startled", "flinch", "land", "turn", "torpor_in", "torpor_eat", "torpor_out", "death"];

export default {
  modelCredit: "Animated T-rex by Patch, made with anymove (https://patch.gg/create/toolbox/assets/anymove:trex), CC0 1.0. Adapted for SNARK",
  kind: "creature",
  source: { scripts: ["import.py", "gaits.py", "clips.py", "saddle.py"] },
  scale: 1,
  skeleton: { id: "rex2", root: "pelvis", bones: 25 },
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
  // tex/rex2_normal.png and rex2_packed.png are the source's own (ref/prepare.py); the rest are made by ref/paint.py.
  materials: {
    rex2: {
      base: "tex/rex2_base.png", normal: "tex/rex2_normal.png", packed: "tex/rex2_packed.png",
      regions: { mask: "tex/rex2_mask.png", mask2: "tex/rex2_mask2.png" },
      hurt: "tex/rex2_hurt.png", decay: "tex/rex2_decay.png",
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
  // Limp as the death clip's roll ends (tick 46), a little before. The arms have no hands, so the forearms are bodies.
  // Each limit is a little past what the clips bend that joint.
  ragdoll: { limp: 40, bodies: [
    { bone: "pelvis", mass: 0.4 }, { bone: "skull", mass: 0.08, swing: 65, twist: 40 },
    { bone: "tail_3", mass: 0.05, swing: 50, twist: 32 }, { bone: "tail_5", mass: 0.032, swing: 40, twist: 25 },
    ...(["l", "r"] as const).flatMap((side) => [
      { bone: `forearm_${side}`, mass: 0.012, swing: 55, twist: 60 },
      { bone: `shank_${side}`, mass: 0.12, swing: 85, twist: 60 },
      { bone: `toes_${side}`, mass: 0.1, swing: 78, twist: 46 },
    ]),
  ],
  // The thighs are wider than the hips, and the trunk and tail root carry the body on the ground. Their capsules ride
  // on the pelvis body, so a fallen Rex rests on them and its thigh doesn't sink.
  contacts: ["thigh_l", "thigh_r", "metatarsus_l", "metatarsus_r", "humerus_l", "humerus_r", "spine", "chest", "neck_1", "neck_2", "jaw", "tail_1", "tail_2", "tail_4"] },
  // Worn as core:saddle_rex2 until it takes the Rex's place, because two packs can't both hold core:saddle_rex/worn.
  worn: [{
    item: "core:saddle_rex2", object: "saddle",
    materials: { rex2_saddle: { base: "tex/rex2_saddle_base.png", normal: "tex/rex2_saddle_normal.png", packed: "tex/rex2_saddle_packed.png" } },
    budgets: { triangles: [4800, 1600, 550, 360] }, flat: 2,
  }],
} satisfies CreatureAsset;
