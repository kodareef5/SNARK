import { PARASAUR_DYES } from "../../../../../content/creatures/parasaur.ts";
import type { CreatureAsset, MaterialSpec, Vec3, ZoneName, ZoneSpec } from "../../../../../tools/art/spec.ts";

function material(name: string, alive = true): MaterialSpec {
  const image = (role: string) => `tex/${name}_${role}.png`;
  return {
    base: image("base"), normal: image("normal"), packed: image("packed"), height: image("height"),
    ...(alive ? { regions: { mask: image("mask"), mask2: image("mask2") }, hurt: image("hurt"), decay: image("decay") } : {}),
  };
}

const loops = ["idle", "walk", "run", "swim", "swim_idle", "fall", "torpor_idle"];
const actions = ["idle_look", "turn", "attack", "call", "startled", "flinch", "jump", "land", "torpor_in", "torpor_eat", "torpor_out", "death"];

function cap(zone: ZoneName, on: string, a: Vec3, b: Vec3, radius: number): ZoneSpec {
  return { zone, on, a, b, radius };
}

export default {
  kind: "creature",
  source: { scripts: ["rig.py", "model.py", "saddle.py", "clips.py"] },
  scale: 1,
  skeleton: { id: "parasaur", root: "pelvis", bones: 27 },
  zones: [
    cap("torso", "pelvis", [0,-.10,-.10], [0,-.13,.75], .59),
    cap("torso", "chest", [0,-.12,-.06], [0,-.08,.77], .535),
    cap("torso", "neck_1", [0,-.08,-.03], [0,.17,.59], .345),
    cap("torso", "neck_2", [0,-.06,.02], [0,.43,.53], .257),
    cap("head", "skull", [0,.27,.05], [0,-.10,.99], .217),
    cap("head", "crest_root", [0,-.015,.02], [0,.41,-.48], .135),
    cap("head", "crest_tip", [0,.01,-.04], [0,.065,-.82], .114),
    cap("head", "jaw", [0,-.051,.03], [0,-.13,.95], .125),
    ...[["tail_1",.44,.78],["tail_2",.305,.74],["tail_3",.205,.69],["tail_4",.127,.64],["tail_5",.072,.66]].map(
      ([bone,radius,length]) => cap("torso", String(bone), [0,.01,-.08], [0,-.10,-Number(length)], Number(radius))),
    ...(["l","r"] as const).flatMap(s => {
      const limb = s === "l" ? "L" : "R";
      return [
        cap(`leg${limb}`, `thigh_${s}`, [0,.08,-.03], [0,-.62,.30], .256),
        cap(`leg${limb}`, `shank_${s}`, [0,.01,.03], [0,-.49,-.44], .151),
        cap(`leg${limb}`, `hock_${s}`, [0,.03,-.01], [0,-.53,.21], .108),
        cap(`foot${limb}`, `toes_${s}`, [0,-.003,-.10], [0,-.034,.30], .146),
        cap(`arm${limb}`, `upper_arm_${s}`, [0,.02,.04], [0,-.65,-.17], .157),
        cap(`arm${limb}`, `forearm_${s}`, [0,.02,0], [0,-.73,.25], .099),
        cap(`hand${limb}`, `manus_${s}`, [0,-.06,.02], [0,-.15,.12], .092),
      ];
    }),
  ],
  sockets: [
    { name: "seat", bone: "chest", offset: [0,.715,.520] },
    { name: "mouth", bone: "jaw", offset: [0,-.105,.97] },
    { name: "bite", bone: "skull", offset: [0,-.167,1.056] },
    { name: "head", bone: "skull", offset: [0,.23,.19] },
    { name: "overhead", bone: "chest", offset: [0,1.98,.18] },
    { name: "vent", bone: "pelvis", offset: [0,-.56,-.43] },
    ...(["l","r"] as const).flatMap(s => {
      const sign = s === "l" ? 1 : -1;
      return [
        { name: `grip_${s}`, bone: "chest", offset: [sign*.195,.767,.923] as Vec3 },
        { name: `rest_${s}`, bone: "chest", offset: [sign*.651,-.282,.622] as Vec3 },
        { name: `hand_${s}`, bone: `manus_${s}`, offset: [0,-.187,.107] as Vec3 },
        { name: `foot_${s}`, bone: `toes_${s}`, offset: [0,-.102,.18] as Vec3 },
      ];
    }),
  ],
  regions: ["back","sides","belly","crest"].map((name,i) => ({ name, sample: PARASAUR_DYES[i]! })),
  materials: { parasaur_hide: material("parasaur_hide"), parasaur_face: material("parasaur_face") },
  clips: [...loops,...actions].map(name => ({ name, source: name, loop: loops.includes(name) })),
  feet: ["toes_l","toes_r"],
  gaits: { walk: { stride: 2.6 }, run: { stride: 4.16 },
    swim: { stride: 3, stated: "Alternating limb sweeps drive a 3 m water stroke." } },
  ragdoll: { limp: 16, bodies: [
    { bone: "pelvis", mass: .55 }, { bone: "skull", mass: .09, swing: 100, twist: 60 },
    { bone: "tail_1", mass: .09, swing: 47, twist: 35 }, { bone: "tail_3", mass: .05, swing: 65, twist: 40 },
    { bone: "thigh_l", mass: .11, swing: 115, twist: 60 }, { bone: "thigh_r", mass: .11, swing: 115, twist: 60 },
  ] },
  flat: 3,
  budgets: { triangles: [29000,10500,4500,1700,660,250,96], texture: { top: 2048, megabytes: 45, layer: 256 } },
  worn: [{ item: "core:saddle_parasaur", object: "saddle", materials: { parasaur_tack: material("parasaur_tack",false) },
    budgets: { triangles: [10500,2600,850,275,110,72,42] }, flat: 2 }],
} satisfies CreatureAsset;
