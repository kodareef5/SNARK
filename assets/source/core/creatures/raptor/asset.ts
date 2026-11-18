import type { CreatureAsset, MaterialSpec, SocketSpec, Vec3, ZoneName, ZoneSpec } from "../../../../../tools/art/spec.ts";
import { RAPTOR_DYES } from "../../../../../content/creatures/raptor.ts";

const names = ["back", "belly", "claws", "wing and tail bars", "face", "feather tips"];
function surface(name: string, living = true): MaterialSpec {
  const path = (role: string) => `tex/${name}_${role}.png`;
  return {
    base: path("base"), normal: path("normal"), packed: path("packed"), height: path("height"),
    ...(living ? { regions: { mask: path("mask"), mask2: path("mask2") }, hurt: path("hurt"), decay: path("decay") } : {}),
  };
}
const capsule = (zone: ZoneName, on: string, a: Vec3, b: Vec3, radius: number): ZoneSpec => ({ zone, on, a, b, radius });
const socket = (name: string, bone: string, offset: Vec3): SocketSpec => ({ name, bone, offset });
const loop = ["idle", "walk", "run", "swim", "swim_idle", "fall", "torpor_idle"];
const single = ["idle_look", "turn", "jump", "land", "attack", "call", "startled", "flinch", "torpor_in", "torpor_eat", "torpor_out", "death"];

export default {
  kind: "creature",
  source: { scripts: ["rig.py", "model.py", "saddle.py", "clips.py"] },
  scale: 1, skeleton: { id: "raptor", root: "pelvis", bones: 25 },
  zones: [
    capsule("torso", "pelvis", [0, .009, -.17], [0, -.016, .24], .253),
    capsule("torso", "chest", [0, -.013, -.08], [0, -.029, .345], .226),
    capsule("torso", "neck_1", [0, .015, .007], [0, .22, .251], .123),
    capsule("torso", "neck_2", [0, -.007, .007], [0, .208, .216], .113),
    capsule("head", "skull", [0, .015, .02], [0, -.026, .476], .112),
    capsule("head", "jaw", [0, -.024, -.007], [0, -.031, .453], .069),
    capsule("torso", "tail_1", [0, .013, -.09], [0, .011, -.41], .166),
    capsule("torso", "tail_2", [0, .004, .011], [0, -.010, -.47], .099),
    capsule("torso", "tail_3", [0, -.003, .007], [0, -.010, -.41], .067),
    capsule("torso", "tail_4", [0, -.008, .02], [0, .011, -.36], .044),
    capsule("torso", "tail_5", [0, -.003, -.005], [0, .024, -.495], .039),
    ...(["l", "r"] as const).flatMap(side => {
      const sg = side === "l" ? 1 : -1, label = side === "l" ? "L" : "R";
      return [
        capsule(`leg${label}`, `thigh_${side}`, [sg*.016, .004, -.015], [sg*.029, -.34, .257], .105),
        capsule(`leg${label}`, `shank_${side}`, [0, .005, -.005], [-sg*.015, -.302, -.335], .072),
        capsule(`leg${label}`, `metatarsus_${side}`, [0, -.014, .003], [0, -.246, .136], .035),
        capsule(`foot${label}`, `toes_${side}`, [0, -.002, -.013], [sg*.022, -.032, .215], .064),
        capsule(`arm${label}`, `humerus_${side}`, [0, 0, 0], [sg*.061, -.19, -.141], .060),
        capsule(`arm${label}`, `forearm_${side}`, [0, .004, -.007], [sg*.016, -.037, .267], .047),
        capsule(`hand${label}`, `manus_${side}`, [0, .006, -.011], [-sg*.006, -.088, .170], .047),
      ];
    }),
  ],
  sockets: [
    socket("seat", "chest", [0, .324, -.106]), socket("vent", "pelvis", [0, -.147, -.190]),
    socket("overhead","chest",[0, .685, -.05]), socket("head","skull",[0,.05,.128]),
    socket("bite","skull",[0,-.043,.557]), socket("mouth","jaw",[0,-.011,.500]),
    ...(["l","r"] as const).flatMap(side => {
      const s = side === "l" ? 1 : -1;
      return [
        socket(`grip_${side}`, "chest", [s*.078,.430,.068]),
        socket(`knee_${side}`, "chest", [s*.255,.148,.107]),
        socket(`rest_${side}`, "chest", [s*.30,-.083,-.011]),
        socket(`sole_${side}`, "chest", [s*.30,-.092,-.006]),
        socket(`breath_${side}`, "skull", [s*.065,-.023,.477]),
        socket(`foot_${side}`, `toes_${side}`, [0,-.045,.125]),
      ];
    }),
  ],
  clips: [...loop,...single].map(name => ({ name, source: name, loop: loop.includes(name) })),
  regions: names.map((name,i) => ({ name, sample: RAPTOR_DYES[i]! })),
  materials: { raptor_hide: surface("raptor_hide"), raptor_feather: surface("raptor_feather"), raptor_detail: surface("raptor_detail") },
  feet: ["toes_l","toes_r"],
  gaits: { walk: { stride: 1.92 }, run: { stride: 3.33 }, swim: { stride: 2.4, stated: "Alternating hindfoot strokes in water at three metres per second." } },
  budgets: { triangles: [38000,11200,5100,2800,430,260,100], texture: { top: 1024, megabytes: 26, layer: 128 } },
  flat: 4,
  ragdoll: { limp: 18, bodies: [
    { bone: "pelvis", mass: .55 }, { bone: "skull", mass: .08, swing: 105, twist: 65 },
    { bone: "tail_1", mass: .09, swing: 60, twist: 45 }, { bone: "tail_4", mass: .04, swing: 55, twist: 45 },
    { bone: "thigh_l", mass: .12, swing: 115, twist: 75 }, { bone: "thigh_r", mass: .12, swing: 115, twist: 75 },
  ] },
  worn: [{ item: "core:saddle_raptor", object: "saddle", materials: { raptor_saddle: surface("raptor_saddle", false) },
    budgets: { triangles: [3400,1200,480,160] }, flat: 2 }],
} satisfies CreatureAsset;
