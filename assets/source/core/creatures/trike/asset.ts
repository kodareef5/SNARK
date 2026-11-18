import type { CreatureAsset, MaterialSpec, ZoneSpec } from "../../../../../tools/art/spec.ts";
import { TRIKE_DYES } from "../../../../../content/creatures/trike.ts";

function maps(name: string, damage = true): MaterialSpec {
  return { base: `tex/${name}_base.png`, normal: `tex/${name}_normal.png`, packed: `tex/${name}_packed.png`,
    regions: `tex/${name}_regions.png`, height: `tex/${name}_height.png`,
    ...(damage ? { hurt: `tex/${name}_hurt.png`, decay: `tex/${name}_decay.png` } : {}) };
}

function leg(side: "l" | "r"): ZoneSpec[] {
  const suffix = side === "l" ? "L" : "R";
  const sign = side === "l" ? 1 : -1;
  return ["front", "back"].flatMap((end) => [
    { zone: `leg${suffix}` as const, on: `${end}_upper_${side}`,
      a: [sign * (end === "front" ? .07 : .20), end === "front" ? -.14 : -.20, end === "front" ? -.035 : -.05] as const,
      b: [sign * (end === "front" ? .30 : .25), end === "front" ? -.65 : -.64, end === "front" ? -.35 : .20] as const, radius: end === "front" ? .30 : .35 },
    // The projecting ulna sits behind and outside the forearm joint.
    { zone: `leg${suffix}` as const, on: `${end}_lower_${side}`,
      a: end === "front" ? [sign * .075, -.095, -.075] as const : [sign * .025, -.06, .025] as const,
      b: [-sign * (end === "front" ? .045 : .03), end === "front" ? -.64 : -.56, end === "front" ? .49 : -.22] as const, radius: end === "front" ? .20 : .21 },
    // The metatarsal has its own anatomical capsule. Two small transverse
    // contacts bound the broad, flat pad without an inflated round ankle.
    { zone: `foot${suffix}` as const, on: `${end}_foot_${side}`,
      a: [0, -.02, -.01] as const,
      b: [0, end === "front" ? -.175 : -.185, end === "front" ? .20 : .12] as const, radius: .18 },
    { zone: `foot${suffix}` as const, on: `${end}_toes_${side}`,
      a: [-.24, .005, -.21] as const, b: [.24, .005, -.21] as const, radius: .10 },
    { zone: `foot${suffix}` as const, on: `${end}_pad_${side}`,
      a: [end === "front" ? -.27 : -.30, -.015, end === "front" ? .39 : .36] as const,
      b: [end === "front" ? .27 : .30, -.015, end === "front" ? .39 : .36] as const, radius: .08 },
  ]);
}

/** Original anatomy, skin, rig, saddle and performances; provenance in ref/DESIGN.md. */
export default {
  kind: "creature",
  source: { scripts: ["rig.py", "clips.py", "model.py", "saddle.py"] },
  scale: 1,
  skeleton: { id: "trike", root: "body", bones: 48 },
  zones: [
    { zone: "torso", on: "body", a: [0, -.06, -.70], b: [0, -.03, .85], radius: .74 },
    { zone: "torso", on: "pelvis", a: [0, .58, -.90], b: [0, .58, .95], radius: .30 },
    ...(["l", "r"] as const).map(side => ({ zone: "torso" as const, on: `flank_support_${side}`, a: [0, -.10, -.60] as const, b: [0, -.10, .90] as const, radius: .61 })),
    // The trunk is oval in section. These bounded upper lobes cover the
    // visible back without making the entire round belly capsule larger.
    ...(["l", "r"] as const).map(side => ({ zone: "torso" as const, on: `back_support_${side}`, a: [0, .10, -.55] as const, b: [0, .10, 1.30] as const, radius: .25 })),
    { zone: "torso", on: "chest", a: [0, -.08, 1.25], b: [0, .30, 1.25], radius: .52 },
    { zone: "torso", on: "neck", a: [0, -.02, -.10], b: [0, -.02, .68], radius: .50 },
    { zone: "head", on: "skull", a: [0, .15, .18], b: [0, -.40, 1.35], radius: .39 },
    { zone: "head", on: "jaw", a: [0, -.08, 0], b: [0, -.11, 1.10], radius: .23 },
    { zone: "head", on: "frill_l", a: [.02, .08, .45], b: [.01, .93, -.37], radius: .27 },
    { zone: "head", on: "frill_r", a: [-.02, .08, .45], b: [-.01, .93, -.37], radius: .27 },
    { zone: "head", on: "frill_rim_l", a: [.05, 0, .10], b: [0, .55, -.15], radius: .15 },
    { zone: "head", on: "frill_rim_r", a: [-.05, 0, .10], b: [0, .55, -.15], radius: .15 },
    // Separate keel and rib witnesses cover the vaulted shield's actual
    // central/bilateral skin; the narrow outer rim stays independently fitted.
    { zone: "head", on: "frill_keel", a: [0, .10, .10], b: [0, .85, -.50], radius: .22 },
    { zone: "head", on: "frill_rib_l", a: [.06, .16, 0], b: [.06, .91, -.59], radius: .18 },
    { zone: "head", on: "frill_rib_r", a: [-.06, .16, 0], b: [-.06, .91, -.59], radius: .18 },
    { zone: "head", on: "horn_l", from: "horn_l", covers: ["horn_l"] },
    { zone: "head", on: "horn_r", from: "horn_r", covers: ["horn_r"] },
    { zone: "head", on: "horn_nose", from: "horn_nose", covers: ["horn_nose"] },
    { zone: "torso", on: "tail_1", a: [0, .10, -.10], b: [0, -.24, -.70], radius: .44 },
    { zone: "torso", on: "tail_2", a: [0, 0, -.10], b: [0, -.40, -.68], radius: .23 },
    { zone: "torso", on: "tail_3", a: [0, -.01, -.05], b: [0, -.24, -.82], radius: .12 },
    ...leg("l"), ...leg("r"),
  ],
  // The vaulted shield and tapering horn section follow the actual skull skin.
  // Fitting the adjoining neck preserves the boundary of frontal head armour.
  hitSurfaces: [{ zone: "head", root: "skull", cells: {
    skull: [.38, .35, .43], jaw: [.35, .35, .45],
    frill_l: [.38, .35, .45], frill_r: [.38, .35, .45],
    horn_l: [1, 1, .28], horn_r: [1, 1, .28], horn_nose: [1, .20, 1],
  } }, { zone: "torso", root: "neck", cells: { neck: [.38, .35, .43] } }],
  sockets: [
    { name: "head", bone: "skull", offset: [0, .08, .47] },
    // Air-space witnesses inside the actual recessed nares, rather than a
    // bind-pose lower rim that rotates sideways during collapse.
    { name: "breath_l", bone: "skull", offset: [.29, -.11, 1.09] },
    { name: "breath_r", bone: "skull", offset: [-.29, -.11, 1.09] },
    { name: "overhead", bone: "skull", offset: [0, 1.50, -.45] },
    { name: "horn_l", bone: "horn_l", offset: [-.01, .55, 1.39] },
    { name: "horn_r", bone: "horn_r", offset: [.01, .55, 1.39] },
    { name: "horn_contact", bone: "skull", offset: [0, .79, 1.94] },
    { name: "seat", bone: "chest", offset: [0, 1.32, .37] },
    { name: "grip_l", bone: "chest", offset: [.19, 1.63, .64] },
    { name: "grip_r", bone: "chest", offset: [-.19, 1.63, .64] },
    // Shared saddle fitter targets the ankle joint. Separate sole sockets
    // witness the actual flat support plane for native foot-shape fitting.
    { name: "rest_l", bone: "chest", offset: [.42, 1.06, .75] },
    { name: "rest_r", bone: "chest", offset: [-.42, 1.06, .75] },
    { name: "sole_l", bone: "chest", offset: [.42, .947, .88] },
    { name: "sole_r", bone: "chest", offset: [-.42, .947, .88] },
    { name: "knee_l", bone: "chest", offset: [.48, 1.24, .64] },
    { name: "knee_r", bone: "chest", offset: [-.48, 1.24, .64] },
    // Toe heads are .095m above the actual flattened source sole after the
    // common ground shift. These sockets witness that plane, not below it.
    { name: "foot_l", bone: "front_toes_l", offset: [0, -.095, .10] },
    { name: "foot_r", bone: "front_toes_r", offset: [0, -.095, .10] },
    { name: "rear_foot_l", bone: "back_toes_l", offset: [0, -.095, .10] },
    { name: "rear_foot_r", bone: "back_toes_r", offset: [0, -.095, .10] },
    { name: "vent", bone: "pelvis", offset: [0, -.70, -1.24] },
  ],
  regions: [
    ...["Flank", "Throat and belly", "Back markings", "Frill", "Limbs", "Keratin"].map((name, i) => ({ name, sample: TRIKE_DYES[i]! })),
  ],
  materials: {
    trike_skin: { ...maps("trike_skin"), regions: { mask: "tex/trike_skin_mask.png", mask2: "tex/trike_skin_mask2.png" } },
    trike_frill: { ...maps("trike_frill"), regions: { mask: "tex/trike_frill_mask.png", mask2: "tex/trike_frill_mask2.png" } },
    // Keratin has no wound overlay; its broad decay mottling needs less
    // layer resolution than facial grain and the independently unwrapped roots.
    trike_horn: { ...maps("trike_horn"), regions: { mask: "tex/trike_horn_mask.png", mask2: "tex/trike_horn_mask2.png" }, tops: { normal: 512, layer: 256 } },
  },
  clips: [
    ...["idle", "walk", "run", "charge", "swim", "swim_idle", "fall", "torpor_idle"].map((name) => ({ name, source: name, loop: true })),
    ...["attack", "charge_windup", "charge_stop", "turn", "idle_look", "idle_graze", "call", "startled", "flinch", "land", "torpor_in", "torpor_eat", "torpor_out", "death"].map((name) => ({ name, source: name, loop: false })),
  ],
  feet: ["front_toes_l", "front_toes_r", "back_toes_l", "back_toes_r"],
  breath: ["breath_l", "breath_r"],
  ground: {
    maxTilt: 45, maxStep: .6, probe: 2.5,
    legs: [
      { upper: "front_upper_l", lower: "front_lower_l", end: "front_foot_l", socket: "foot_l" },
      { upper: "front_upper_r", lower: "front_lower_r", end: "front_foot_r", socket: "foot_r" },
      { upper: "back_upper_l", lower: "back_lower_l", end: "back_foot_l", socket: "rear_foot_l" },
      { upper: "back_upper_r", lower: "back_lower_r", end: "back_foot_r", socket: "rear_foot_r" },
    ],
  },
  gaits: { walk: { stride: 2.4, footfalls: [
    { foot: "front_toes_l", plant: 0, lift: .60 },
    { foot: "front_toes_r", plant: .5, lift: .10 },
    { foot: "back_toes_l", plant: .25, lift: .85 },
    { foot: "back_toes_r", plant: .75, lift: .35 },
  ] }, ...Object.fromEntries(["run", "charge"].map(name => [name, { stride: 4.8, footfalls: [
    { foot: "front_toes_l", plant: 0, lift: .39 },
    { foot: "front_toes_r", plant: .5, lift: .89 },
    { foot: "back_toes_l", plant: .38, lift: .77 },
    { foot: "back_toes_r", plant: .88, lift: .27 },
  ] }])),
    swim: { stride: 4.8, stated: "A 48-tick submerged paddling cycle at 3 m/s, with no planted ground contact." } },
  budgets: { triangles: [22000, 9000, 4000, 1400, 400, 96], texture: { top: 2048, megabytes: 60, layer: 512 } },
  // Level 2's flat study switched at 59px on medium, above the 48px criterion.
  // Keep its material surface; level 3 is the first flat silhouette.
  flat: 3,
  preserveBones: ["horn_l", "horn_r", "horn_nose", "frill_l", "frill_r", "tail_tip"],
  ragdoll: { limp: 24, contacts: ["pelvis", "flank_support_l", "flank_support_r", "frill_l", "frill_r", "frill_rim_l", "frill_rim_r", "horn_l", "horn_r", "tail_1", "tail_2", "tail_3", "front_pad_l", "front_pad_r", "back_pad_l", "back_pad_r"], bodies: [
    { bone: "body", mass: .60 },
    { bone: "skull", mass: .24, swing: 65, twist: 40 },
    // The sole spans the toe and pad contacts. Its mass lies between them.
    // Digit flexion and ankle travel retain every authored clip extremum.
    { bone: "front_upper_l", mass: .025, swing: 95, twist: 45 },
    { bone: "front_lower_l", mass: .010, swing: 125, twist: 25 },
    { bone: "front_foot_l", mass: .003, swing: 100, twist: 30 },
    { bone: "front_toes_l", mass: .002, massCentre: [0, -.007, .124], swing: 15, twist: 5 },
    { bone: "front_upper_r", mass: .025, swing: 95, twist: 45 },
    { bone: "front_lower_r", mass: .010, swing: 125, twist: 25 },
    { bone: "front_foot_r", mass: .003, swing: 100, twist: 30 },
    { bone: "front_toes_r", mass: .002, massCentre: [0, -.007, .124], swing: 15, twist: 5 },
    { bone: "back_upper_l", mass: .025, swing: 95, twist: 45 },
    { bone: "back_lower_l", mass: .010, swing: 140, twist: 25 },
    { bone: "back_foot_l", mass: .003, swing: 110, twist: 35 },
    { bone: "back_toes_l", mass: .002, massCentre: [0, -.010, .144], swing: 10, twist: 5 },
    { bone: "back_upper_r", mass: .025, swing: 95, twist: 45 },
    { bone: "back_lower_r", mass: .010, swing: 140, twist: 25 },
    { bone: "back_foot_r", mass: .003, swing: 110, twist: 35 },
    { bone: "back_toes_r", mass: .002, massCentre: [0, -.010, .144], swing: 10, twist: 5 },
  ] },
  worn: [{ item: "core:saddle_trike", object: "saddle", materials: { trike_saddle: maps("trike_saddle", false) }, flat: 2,
    budgets: { triangles: [2400, 1000, 400, 120] } }],
} satisfies CreatureAsset;
