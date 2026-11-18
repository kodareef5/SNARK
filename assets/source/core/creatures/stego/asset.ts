import type { CreatureAsset } from "../../../../../tools/art/spec.ts";
import { defaultPalette, nearestColour } from "../../../../../shared/pack/palette.ts";

const palette = defaultPalette();
const tone = (rgb: number): number => nearestColour(palette, rgb >> 16, (rgb >> 8) & 255, rgb & 255);
// Fitted against the posed skin. A pair of finite contacts follows the broad
// anterior and posterior shoulders of plates 07 and 10 through all three modes.
type Contact = { a: readonly [number, number, number]; b: readonly [number, number, number]; radius: number };
const bladeContacts: Record<string, Contact | undefined> = {
  edge_plate_07: { a: [.45542, .7658, -.43761], b: [.27006, .44955, .29156], radius: .28995 },
  edge_plate_10: { a: [-.02372, -.06273, -.24651], b: [-.27556, .24151, -.12403], radius: .21961 },
  plate_02: { a: [-.1721, .5961, -.2562], b: [-.0698, .1954, .1134], radius: .27306 },
  plate_03: { a: [.2365, .76, -.208], b: [.0553, .406, .267], radius: .33215 },
  plate_05: { a: [.2462, .3813, .3081], b: [.4701, .8736, -.3061], radius: .31187 },
  plate_06: { a: [-.4423, .8502, -.2936], b: [-.3453, .0223, .0422], radius: .36544 },
  plate_07: { a: [.18408, .29334, -.47934], b: [.06721, -.02406, -.18451], radius: .28995 },
  plate_08: { a: [-.2245, .5731, -.3066], b: [.0536, -.0668, -.0499], radius: .36653 },
  plate_09: { a: [.1345, .0599, -.3987], b: [.1282, .4547, -.1485], radius: .32094 },
  plate_10: { a: [-.05971, .21016, -.44016], b: [-.21616, .37621, -.376], radius: .21961 },
  plate_11: { a: [.1532, .2517, -.3167], b: [.1933, .0817, .0591], radius: .22868 },
  plate_12: { a: [-.07, .1981, -.2436], b: [-.0693, -.0135, .0064], radius: .16298 },
  plate_13: { a: [.0437, .0952, -.2197], b: [.1005, -.0249, -.0271], radius: .15737 },
};
// Keep convex tail sections on their own joints during the sweep. A single piece for each
// narrow dorsal blade follows its rigid motion without including the open air on either side.
const caudalSection = [2, 2, .35] as const;
const dorsalBlade = [2, .42, .32] as const;
const tailCells = {
  ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`tail_${i + 1}`, caudalSection])),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`plate_${String(i + 8).padStart(2, "0")}`, dorsalBlade])),
  spike_front_l: caudalSection, spike_front_r: caudalSection,
  spike_rear_l: caudalSection, spike_rear_r: caudalSection,
};
const loop = new Set(["idle", "walk", "run", "swim", "swim_idle", "fall", "plate_hardened", "plate_heavy", "plate_sharpened", "torpor_idle"]);
const feet = ["hind_foot_l", "fore_foot_l", "hind_foot_r", "fore_foot_r"] as const;
const footfalls = (duty: number) => feet.map((foot, i) => { const plant = [0, .75, .5, .25][i]!; return { foot, plant, lift: (plant + duty) % 1 }; });
const clips = ["idle", "idle_look", "idle_graze", "walk", "run", "turn", "attack", "attack_right", "impale_in", "impale_hold", "impale_out", "plate_switch", "plate_hardened", "plate_heavy", "plate_sharpened", "call", "startled", "flinch", "swim", "swim_idle", "startled_swim", "land_swim", "torpor_out_swim", "fall", "land", "torpor_in", "torpor_idle", "torpor_eat", "torpor_out", "death"];
const skin = (name: string) => ({
  base: `tex/${name}_base.png`, normal: `tex/${name}_normal.png`, packed: `tex/${name}_packed.png`, regions: name === "stego_saddle" ? `tex/${name}_regions.png` : { mask: `tex/${name}_mask.png`, mask2: `tex/${name}_mask2.png` }, height: `tex/${name}_height.png`, hurt: `tex/${name}_hurt.png`, decay: `tex/${name}_decay.png`,
});

function sculpt(name: string) {
  const path = `tex/sculpt/${name}`;
  return { ...skin(name), base: `${path}_base.png`, normal: `${path}_normal.png`, packed: `${path}_packed.png`,
    regions: { mask: `${path}_mask.png`, mask2: `${path}_mask2.png` } };
}

export default {
  kind: "creature",
  source: { scripts: ["rig.py", "refit.py", "saddle.py", "clips.py"] },
  scale: 1,
  skeleton: { id: "stego", root: "pelvis", bones: 64 },
  regions: [
    { name: "Dorsal pattern", material: "back", sample: tone(0x233b2d) },
    { name: "Hide", material: "hide", sample: tone(0x435b39) },
    { name: "Countershade", material: "belly", sample: tone(0x9c9669) },
    { name: "Plate body", material: "plate", sample: tone(0x86522e) },
    { name: "Plate edge", material: "edge", sample: tone(0x493024) },
    { name: "Horn", material: "horn", sample: tone(0x998a5c) },
  ],
  materials: { stego_skin: sculpt("stego_skin"), stego_horn: sculpt("stego_horn") },
  zones: [
    // Measured finite capsule envelope, including the proximal pelvic mass.
    // The fitted pelvis and hip support the resting hide through the side roll.
    { zone: "torso", on: "pelvis", a: [0, .20, .02], b: [0, .060, .90], radius: 1.09 },
    // Three tapered cervical sections prevent the broad shoulder envelope
    // from claiming torso hits in front of the visible face. The forward
    // section overlaps the head envelope; it does not enclose a second skull.
    { zone: "torso", on: "neck_1", a: [-0.110360, 0.073459, 0.265030], b: [0.114523, 0.073459, 0.265030], radius: 0.734530 },
    { zone: "torso", on: "neck_2", a: [-0.000101, 0.054949, 0.140918], b: [-0.000101, 0.139558, 0.140918], radius: 0.383286 },
    { zone: "torso", on: "neck_3", a: [0.004328, -0.029059, 0.0605], b: [0.004328, -0.026802, 0.0605], radius: 0.228 },
    // Finite envelopes measured from native skin. A separate jaw follows the
    // actual opening; dense orbital topology must not turn the skull fit sideways.
    { zone: "head", on: "skull", a: [-0.000594, 0.041871, 0.032907], b: [-0.000594, 0.041871, 0.421805], radius: 0.270193 },
    { zone: "head", on: "jaw", a: [0.001718, -0.015769, -0.111133], b: [0.000849, -0.035690, 0.334592], radius: 0.161956 },
    { zone: "torso", on: "tail_1", a: [0, -.1015, -.3525], b: [0, -.1169, -.4060], radius: .9375 },
    { zone: "torso", on: "tail_3", from: "tail_3", to: "tail_5", covers: ["tail_3", "tail_4"] },
    { zone: "torso", on: "tail_5", from: "tail_5", to: "tail_7", covers: ["tail_5", "tail_6", "tail_7"] },
    ...Array.from({ length: 16 }, (_, i) => {
      const name = `plate_${String(i).padStart(2, "0")}`;
      const fit = bladeContacts[name];
      return fit ? { zone: "torso" as const, on: name, ...fit } : { zone: "torso" as const, on: name, covers: [name] };
    }),
    ...["edge_plate_07", "edge_plate_10"].map(name => ({ zone: "torso" as const, on: name, ...bladeContacts[name]! })),
    ...["front", "rear"].flatMap((pair) => ["l", "r"].map((side) => ({ zone: "torso" as const, on: `spike_${pair}_${side}`, covers: [`spike_${pair}_${side}`] }))),
    { zone: "legL", on: "hind_upper_l", a: [0.242470, -0.466847, 0.045131], b: [0.387190, -0.301565, 0.264560], radius: 0.492218 },
    { zone: "legL", on: "hind_lower_l", a: [-0.057867, -0.735580, -0.105], b: [-0.057867, -0.052875, -0.075426], radius: 0.435447 },
    { zone: "legR", on: "hind_upper_r", a: [-0.229250, -0.441606, 0.049089], b: [-0.383404, -0.295428, 0.259776], radius: 0.482507 },
    { zone: "legR", on: "hind_lower_r", a: [0.064732, -0.735216, -0.103], b: [0.021236, -0.065406, -0.075273], radius: 0.442566 },
    // The bearing edge of each medial manus digit extends beyond the pastern.
    { zone: "armL", on: "fore_foot_l", a: [-.09, -.153, .222], b: [-.099, -.182, .463], radius: .04326 },
    { zone: "armR", on: "fore_foot_r", a: [.09, -.153, .222], b: [.099, -.182, .463], radius: .04326 },
    ...(["l", "r"] as const).flatMap((s) => [
      { zone: s === "l" ? "armL" as const : "armR" as const, on: `fore_upper_${s}`, from: `fore_upper_${s}`, to: `fore_foot_${s}`, covers: [`fore_upper_${s}`, `fore_lower_${s}`, `fore_foot_${s}`] },
    ]),
  ],
  hitSurfaces: [
    { zone: "torso", root: "tail_1", cells: tailCells,
      padding: { tail_3: .015, tail_4: .015, tail_6: .012, plate_08: .022, plate_09: .022, plate_10: .017, plate_11: .012 } },
    ...Array.from({ length: 8 }, (_, i) => `plate_${String(i).padStart(2, "0")}`).map(root => ({
      zone: "torso" as const, root, cells: { [root]: dorsalBlade }, ...(root === "plate_07" ? { padding: { plate_07: .026 } } : {}),
    })),
  ],
  sockets: [
    { name: "seat", bone: "chest", offset: [0, .89, .75] },
    ...(["l", "r"] as const).flatMap((side, i) => [
      { name: `grip_${side}`, bone: "chest", offset: [(i === 0 ? 1 : -1) * .17, 1.20, 1.02] as const },
      { name: `rest_${side}`, bone: "chest", offset: [(i === 0 ? 1 : -1) * .29, .40, 1.05] as const },
    ]),
    { name: "mouth", bone: "skull", offset: [0, -.13, .5695] },
    { name: "head", bone: "skull", offset: [0, .07, .1675] },
    { name: "overhead", bone: "spine", offset: [0, 2.53, .03] },
    { name: "tail_base", bone: "tail_1", offset: [0, 0, 0] },
    { name: "tail_mid", bone: "tail_4", offset: [0, 0, 0] },
    { name: "tail_tip", bone: "tail_7", offset: [0, .05, -.48] },
    { name: "impale", bone: "tail_7", offset: [.78, .04, -.732] },
    { name: "sole_l", bone: "chest", offset: [.29, .325, 1.1805] },
    { name: "sole_r", bone: "chest", offset: [-.29, .325, 1.1805] },
    { name: "nostril_l", bone: "skull", offset: [.125, .015, .335] },
    { name: "nostril_r", bone: "skull", offset: [-.125, .015, .335] },
    { name: "breath_l", bone: "skull", offset: [.10119128, -.002, .335] },
    { name: "breath_r", bone: "skull", offset: [-.10119128, -.002, .335] },
    { name: "vent", bone: "pelvis", offset: [0, -.83, -.56] },
    { name: "hind_foot_l", bone: "hind_foot_l", offset: [0.00000000, -0.27500001, 0.13999999] },
    { name: "hind_foot_r", bone: "hind_foot_r", offset: [0.00000000, -0.27500001, 0.13999999] },
    { name: "fore_foot_l", bone: "fore_foot_l", offset: [0.00038487, -0.23999999, 0.13951063] },
    { name: "fore_foot_r", bone: "fore_foot_r", offset: [0.00000000, -0.23999999, 0.13499999] },
  ],
  clips: clips.map((name) => ({ name, source: name, loop: loop.has(name) })),
  breath: ["breath_l", "breath_r"],
  feet,
  ground: { maxTilt: 45, maxStep: .6, probe: 2.5, legs: ["fore", "hind"].flatMap((kind) => ["l", "r"].map((side) => ({ upper: `${kind}_upper_${side}`, lower: `${kind}_lower_${side}`, end: `${kind}_foot_${side}`, socket: `${kind}_foot_${side}` }))) },
  gaits: { walk: { stride: 1.8, footfalls: footfalls(39 / 60) }, run: { stride: 2.4, footfalls: footfalls(20 / 36) }, swim: { stride: 3, stated: "Paddling in water has no planted ground contact." } },
  budgets: { triangles: [32000, 14000, 6200, 2600, 1000, 340], texture: { top: 2048, megabytes: 64, layer: 512 } },
  // Retain the weighted, textured flank while the medium-tier silhouette is 38 px tall.
  flat: 4,
  preserveBones: [...Array.from({ length: 16 }, (_, i) => `plate_${String(i).padStart(2, "0")}`), ...["front", "rear"].flatMap((pair) => ["l", "r"].map((side) => `spike_${pair}_${side}`))],
  worn: [{ item: "core:saddle_stego", object: "stego_saddle", materials: { stego_saddle: skin("stego_saddle") }, budgets: { triangles: [5000, 2200, 900, 300] } }],
  ragdoll: {
    limp: 52,
    contacts: [...["front", "rear"].flatMap((pair) => ["l", "r"].map((side) => `spike_${pair}_${side}`)), ...Array.from({ length: 12 }, (_, i) => `plate_${String(i + 2).padStart(2, "0")}`)],
    bodies: [
      { bone: "pelvis", mass: .78 },
      { bone: "skull", mass: .035, swing: 35, twist: 25 },
      { bone: "tail_1", mass: .10, swing: 60, twist: 30 },
      { bone: "tail_3", mass: .06, swing: 60, twist: 30 },
      { bone: "tail_5", mass: .025, swing: 60, twist: 30 },
    ],
  },
} satisfies CreatureAsset;
