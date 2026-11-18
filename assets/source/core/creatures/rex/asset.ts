import { defaultPalette, nearestColour } from "../../../../../shared/pack/palette.ts";
import type { CreatureAsset, MaterialSpec, SocketSpec, Vec3, ZoneName, ZoneSpec } from "../../../../../tools/art/spec.ts";

const palette = defaultPalette();
const pigments = [
  ["Flanks", 0x777348], ["Throat and belly", 0xc0a477], ["Dorsal bars", 0x49483b],
  ["Face and nasal ridges", 0x99664a], ["Limbs and tail bands", 0x62644c], ["Claws and brow scutes", 0x92774f],
] as const;

function material(name: string, living = true): MaterialSpec {
  const picture = (role: string) => `tex/${name}_${role}.png`;
  return {
    base: picture("base"), normal: picture("normal"), packed: picture("packed"), height: picture("height"),
    regions: { mask: picture("mask"), mask2: picture("mask2") },
    ...(living ? { hurt: picture("hurt"), decay: picture("decay") } : {}),
  };
}

function capsule(zone: ZoneName, on: string, a: Vec3, b: Vec3, radius: number): ZoneSpec {
  return { zone, on, a, b, radius };
}

function limbs(): ZoneSpec[] {
  const result: ZoneSpec[] = [];
  for (const [suffix, region, sign] of [["l", "L", 1], ["r", "R", -1]] as const) {
    result.push(
      capsule(`leg${region}`, `thigh_${suffix}`, [.040 * sign, -.02, -.10], [.136 * sign, -.91, .67], .455),
      capsule(`leg${region}`, `shank_${suffix}`, [0, -.12, -.11], [-.08 * sign, -.90, -.81], .228),
      capsule(`leg${region}`, `metatarsus_${suffix}`, [0, -.06, .03], [0, -.69, .37], .147),
      capsule(`foot${region}`, `toes_${suffix}`, [0, .015, -.04], [.003 * sign, -.022, .81], .30),
      capsule(`arm${region}`, `humerus_${suffix}`, [0, 0, 0], [.12 * sign, -.34, -.18], .104),
      capsule(`arm${region}`, `forearm_${suffix}`, [0, 0, 0], [.075 * sign, -.055, .52], .09),
      capsule(`hand${region}`, `manus_${suffix}`, [0, 0, 0], [.02 * sign, -.124, .221], .075),
    );
  }
  return result;
}

function socket(name: string, bone: string, offset: Vec3): SocketSpec { return { name, bone, offset }; }

const loop = ["idle", "walk", "run", "swim", "swim_idle", "fall", "torpor_idle"];
const single = ["idle_look", "idle_scent", "attack", "call", "startled", "flinch", "land", "turn", "torpor_in", "torpor_eat", "torpor_out", "death"];

export default {
  kind: "creature",
  source: { scripts: ["rig.py", "model.py", "clips.py", "saddle.py"] },
  scale: 1,
  skeleton: { id: "rex", root: "pelvis", bones: 29 },
  zones: [
    // The ilia support the fallen hip across its width. Neighbouring tail and chest cover its longitudinal axis.
    capsule("torso", "pelvis", [-.45, -.01, .26], [.45, -.01, .26], .72),
    capsule("torso", "chest", [0, -.06, -.04], [0, .015, .89], .76),
    capsule("torso", "neck_1", [0, .065, -.03], [0, .24, .70], .43),
    capsule("torso", "neck_2", [0, .06, -.08], [0, .27, .56], .415),
    capsule("head", "skull", [0, .15, .08], [0, .068, 1.43], .47),
    capsule("head", "jaw", [0, -.125, .19], [0, -.075, 1.51], .235),
    capsule("torso", "tail_1", [0, .08, -.49], [0, -.09, -1.22], .535),
    capsule("torso", "tail_2", [0, .01, 0], [0, -.32, -1.17], .374),
    capsule("torso", "tail_3", [0, -.005, -.03], [0, -.39, -1.17], .28),
    capsule("torso", "tail_4", [0, .02, 0], [0, -.33, -1.20], .157),
    capsule("torso", "tail_5", [0, -.012, .02], [0, -.21, -1.178], .122),
    ...limbs(),
  ],
  sockets: [
    socket("seat", "chest", [0, 1.126, .21]), socket("vent", "pelvis", [0, -.45, -.48]),
    socket("overhead", "chest", [0, 1.64, .17]), socket("head", "skull", [0, .37, .40]),
    socket("bite", "skull", [0, -.144, 1.60]), socket("mouth", "jaw", [0, .035, 1.45]),
    ...(["l", "r"] as const).flatMap((s) => {
      const k = s === "l" ? 1 : -1;
      return [
        socket(`grip_${s}`, "chest", [k * .19, 1.416, .58]),
        socket(`rest_${s}`, "chest", [k * .646, .675, .50]),
        socket(`sole_${s}`, "chest", [k * .656, .604, .55]),
        socket(`knee_${s}`, "chest", [k * .47, .98, .65]),
        socket(`breath_${s}`, "skull", [k * .39, .288, 1.642]),
        socket(`foot_${s}`, `toes_${s}`, [0, -.105, .27]),
      ];
    }),
  ],
  regions: pigments.map(([name, rgb]) => ({ name, sample: nearestColour(palette, rgb >>> 16, (rgb >>> 8) & 255, rgb & 255) })),
  clips: [...loop, ...single].map(name => ({ name, source: name, loop: loop.includes(name) })),
  materials: { rex_hide: material("rex_hide"), rex_head: material("rex_head"), rex_detail: material("rex_detail") },
  feet: ["toes_l", "toes_r"],
  gaits: { walk: { stride: 3.36 }, run: { stride: 6.16 }, swim: { stride: 3.8, stated: "Alternating hindlimb strokes at three metres per second." } },
  budgets: { triangles: [36000, 14500, 6200, 2600, 880, 260, 100], texture: { top: 2048, megabytes: 68, layer: 256 } },
  flat: 4,
  ragdoll: { limp: 50, bodies: [
    { bone: "pelvis", mass: .4 }, { bone: "skull", mass: .10, swing: 45, twist: 40 },
    { bone: "tail_3", mass: .05, swing: 50, twist: 32 }, { bone: "tail_5", mass: .032, swing: 40, twist: 25 },
    ...(["l", "r"] as const).flatMap(side => [
      { bone: `manus_${side}`, mass: .012, swing: 55, twist: 40 },
      { bone: `shank_${side}`, mass: .12, swing: 85, twist: 60 },
      { bone: `toes_${side}`, mass: .10, swing: 35, twist: 20 },
    ]),
  ] },
  worn: [{ item: "core:saddle_rex", object: "saddle", materials: { rex_saddle: material("rex_saddle", false) },
    budgets: { triangles: [4800, 1600, 550, 160] }, flat: 2 }],
} satisfies CreatureAsset;
