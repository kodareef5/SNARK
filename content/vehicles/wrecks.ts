// The road fleet as a ruined city leaves it in its streets: statics drawn as the vehicles' own posed meshes
// (assets/source/core/vehicles/compact_abandoned and compact_wreck, the fleet's <vehicle>_abandoned, the tanker's
// salvage), each a shape of boxes in the vehicle's frame: origin on the ground under its middle, +Z its nose, +Y up. A map
// sets one down with y the ground and its yaw along the street (tools/mapworld/ruins.ts).
import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../../shared/content/defs.ts";
import { COMPACT_SPECIES } from "./compact.ts";
import { rungsOf, wreckFormDef, wreckSalvage, wreckWhole, type Rung, type WreckSize } from "./salvage.ts";
import fitted from "./abandoned-bounds.json" with { type: "json" };
import tanker from "./tanker-wreck-bounds.json" with { type: "json" };

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): ShapeBox => ({
  at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2],
});

/**
 * Each look is a mesh of the pack and the boxes bodies meet. `painted` looks keep the vehicle's paint, which the kind's
 * colour dyes as the species' does the car's: one kind a colour. A burnt look has no paint left, so it is one kind.
 */
export const WRECK_LOOKS = [
  // Abandoned where it stopped: dust, faded paint, a few knocks, settled on soft tyres.
  { mesh: "core:compact_abandoned", painted: true, boxes: [box(-.92, .92, 0, .8, .75, 2), box(-.92, .92, 0, 1, -2, .75), box(-.72, .72, 1, 1.46, -1.25, .45)] },
  // Its wheels, steering wheel and driver's door taken, down on its sills, the other door ajar.
  { mesh: "core:compact_abandoned_stripped", painted: true, boxes: [box(-.9, .9, 0, .8, .75, 2), box(-.9, .9, 0, .92, -2, .75), box(-.72, .72, .92, 1.41, -1.25, .45), box(-1.34, -.9, .15, 1.05, -1.05, .1)] },
  // On its roof, its cabin crushed, as a flood or a storm left it.
  { mesh: "core:compact_abandoned_roof", painted: true, boxes: [box(-.76, .72, 0, .32, -1.1, .5), box(-.95, .92, .32, 1.39, -2, 2)] },
  // Burnt out, sunk on its rims, the driver's door ajar.
  { mesh: "core:compact_wreck", painted: false, boxes: [box(-.92, .92, 0, .82, .75, 2), box(-.92, .92, 0, 1.02, -2, .75), box(-.72, .72, 1.02, 1.44, -1.25, .4), box(.9, 1.28, .2, 1.1, -.85, .45)] },
  // Burnt out and on its passenger side.
  { mesh: "core:compact_wreck_tipped", painted: false, boxes: [box(-1, 0, 0, 1.86, -2, 2), box(-1.5, -1, .15, 1.6, -1.1, .45)] },
] as const satisfies readonly { mesh: string; painted: boolean; boxes: readonly ShapeBox[] }[];

const NAMES: Record<number, string> = { 232: "white", 90: "silver", 230: "black", 233: "red", 22: "maroon", 29: "navy", 41: "blue", 136: "green", 124: "beige", 28: "teal", 213: "mustard", 226: "copper" };
/** The compact's own paints, as its species rolls them, with a name each for the kinds' ids. */
export const WRECK_PAINTS = COMPACT_SPECIES.regions![0]!.colors.map(([color]) => ({ color, name: NAMES[color] ?? `paint${color}` }));
/**
 * Every paint a street's cars come in: the compact's, the greys a real street holds a quarter of, colours the sun has
 * faded, and the sports cars' own (content/vehicles/road-fleet.ts).
 */
export const STREET_PAINTS: readonly { color: number; name: string }[] = [...WRECK_PAINTS,
  { color: 85, name: "charcoal" }, { color: 231, name: "grey" }, { color: 110, name: "faded_red" }, { color: 236, name: "faded_blue" },
  { color: 139, name: "faded_green" }, { color: 46, name: "scarlet" }, { color: 34, name: "crimson" }, { color: 47, name: "orange" },
  { color: 48, name: "yellow" }, { color: 49, name: "lime" }];
const STREET = ["white", "silver", "black", "charcoal", "grey", "red", "maroon", "navy", "blue", "green", "beige", "teal", "mustard", "copper", "faded_red", "faded_blue", "faded_green"];
// A burnt look's one colour: what the far city averages it under (client/core/render/far.ts), one of the paints.
const BURNT = 230;

/**
 * The fleet's bodies besides the compact, as the street holds them: each look's mesh (`<body>_abandoned`, and its
 * `_stripped` and `_roof`), the paints a painted body comes in, or the one colour the far city draws an unpainted one
 * in (its livery's). The tanker's are its salvage (content/vehicles/tanker-wrecks.ts), whose kinds are its own.
 * The taxi and the bus are listed yellow (48), not orange (3), which is the wood pieces': far blocks draw every kind
 * listed in a colour in the one mean of them all (far.ts farColours), and two yellow liveries moved far wood.
 */
const BODIES: readonly { body: string; looks: readonly string[]; paints?: readonly string[]; color?: number }[] = [
  { body: "concept003", looks: ["", "_stripped"], paints: ["silver"] },
  { body: "fastback", looks: ["", "_stripped", "_roof"], paints: STREET },
  { body: "caravan", looks: ["", "_stripped"], paints: STREET },
  { body: "panel_van", looks: ["", "_stripped"], paints: ["white", "silver", "grey", "charcoal", "red", "navy", "beige", "faded_blue"] },
  { body: "veloce", looks: [""], paints: ["orange", "yellow", "lime", "white", "black", "scarlet"] },
  { body: "berlinetta", looks: [""], paints: ["scarlet", "crimson", "yellow", "silver", "black"] },
  { body: "taxi", looks: [""], color: 48 },
  { body: "muscle_car", looks: [""], color: 203 },
  { body: "monster_truck", looks: [""], color: 28 },
  { body: "patrol_sedan", looks: [""], color: 83 },
  { body: "patrol_jeep", looks: [""], color: 84 },
  { body: "bus", looks: [""], color: 48 },
  { body: "semi", looks: [""], color: 41 },
];
const TANKER_LOOKS = ["abandoned", "stripped", "burnout", "rollover"];

/** A look the street sets down: its mesh, the body it is of, whether its kinds are painted, and its boxes. */
export interface StreetLook { readonly mesh: string; readonly body: string; readonly painted: boolean; readonly boxes: readonly ShapeBox[] }
const triple = (v: readonly number[]): [number, number, number] => [v[0]!, v[1]!, v[2]!];
const boxesOf = (rows: readonly { at: readonly number[]; half: readonly number[] }[]): ShapeBox[] => rows.map((b) => ({ at: triple(b.at), half: triple(b.half) }));
export const STREET_LOOKS: readonly StreetLook[] = [
  ...WRECK_LOOKS.map((l) => ({ ...l, body: "compact" })),
  ...BODIES.flatMap((b) => b.looks.map((look): StreetLook => {
    const mesh = `core:${b.body}_abandoned${look}`;
    const rows = (fitted as Record<string, { at: number[]; half: number[] }[]>)[mesh];
    if (!rows) throw new Error(`no boxes fitted to ${mesh} (abandoned-bounds.json)`);
    return { mesh, body: b.body, painted: b.paints !== undefined, boxes: boxesOf(rows) };
  })),
  ...TANKER_LOOKS.map((state): StreetLook => ({ mesh: `core:tanker_${state}`, body: "tanker", painted: false, boxes: boxesOf((tanker as Record<string, { at: number[]; half: number[] }[]>)[state]!) })),
];

/** A new kind's id sorts after every core id there was (`core:zzzz...`), so no index moves; the compact's first kinds keep theirs. */
const later = (mesh: string, paint?: string): string => `core:zzzzroad_${mesh.slice("core:".length)}${paint ? `_${paint}` : ""}`;
const paintsOf = (l: StreetLook): readonly string[] => l.body === "compact" ? STREET : BODIES.find((b) => b.body === l.body)!.paints!;
/** Every kind of each look, by its mesh, with the paint each is: one a paint for a painted look, one for any other. */
export const STREET_KINDS: Readonly<Record<string, readonly { id: string; paint?: string }[]>> = Object.fromEntries(STREET_LOOKS.map((l) => {
  if (!l.painted) return [l.mesh, [{ id: l.body === "compact" || l.body === "tanker" ? l.mesh : later(l.mesh) }]];
  const old = new Set(l.body === "compact" ? WRECK_PAINTS.map((p) => p.name) : []);
  return [l.mesh, paintsOf(l).map((paint) => ({ id: old.has(paint) ? `${l.mesh}_${paint}` : later(l.mesh, paint), paint }))];
}));
/** Every kind of each look, by its mesh. */
export const WRECK_KINDS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(Object.entries(STREET_KINDS).map(([mesh, kinds]) => [mesh, kinds.map((k) => k.id)]));

const LOOK_OF = new Map<string, StreetLook>(STREET_LOOKS.flatMap((l) => WRECK_KINDS[l.mesh]!.map((kind) => [kind, l] as const)));
const PAINT_OF = new Map<string, string>(Object.values(STREET_KINDS).flatMap((kinds) => kinds.flatMap((k) => (k.paint ? [[k.id, k.paint] as const] : []))));
/** The look a street car's kind is drawn as, or undefined for any other kind. */
export const wreckLook = (kind: string): StreetLook | undefined => LOOK_OF.get(kind);
/** The paint a street car's kind is, or undefined for an unpainted one. */
export const paintOf = (kind: string): string | undefined => PAINT_OF.get(kind);

const shapeOf = (l: StreetLook): string => (l.body === "compact" ? l.mesh.replace("core:", "core:shape_") : later(l.mesh.replace("core:", "core:shape_")));
const colourOf = (l: StreetLook, paint?: string): number => paint ? STREET_PAINTS.find((p) => p.name === paint)!.color : l.body === "compact" ? BURNT : BODIES.find((b) => b.body === l.body)!.color!;
// The tanker's salvage is its own content; the street only sets it down.
const OURS = STREET_LOOKS.filter((l) => l.body !== "tanker");
const SHAPES: readonly ShapeDef[] = OURS.map((l) => ({ type: "shape", id: shapeOf(l), role: "thing", boxes: l.boxes }));

/** Bodies larger than a car, which give and take more (salvage.ts). */
const SIZES: Readonly<Record<string, WreckSize>> = { caravan: "van", panel_van: "van", patrol_jeep: "van", monster_truck: "van", bus: "heavy", semi: "heavy" };
/** The rungs a look has left: a burnt one is the compact's unpainted. */
const rungs = (l: StreetLook): readonly Rung[] =>
  rungsOf(l.body === "compact" && !l.painted ? "burnt" : l.mesh.endsWith("_stripped") ? "stripped" : l.mesh.endsWith("_roof") ? "roof" : "stopped");
/** The look a salvaged one takes once stripped: its body's stripped look, where it stands where it stopped and has one. */
const strippedOf = (l: StreetLook): StreetLook | undefined => OURS.find((o) => o.mesh === `${l.mesh}_stripped`);

const STATICS: readonly StructureDef[] = OURS.flatMap((l) => STREET_KINDS[l.mesh]!.map(({ id, paint }): StructureDef => ({
  type: "structure", class: "static", id, mesh: l.mesh, shape: shapeOf(l), half: shapeHalf(l.boxes),
  color: colourOf(l, paint), hp: l.body === "bus" || l.body === "semi" ? 16000 : 8000, material: "core:mat_metal",
  breaks: wreckWhole(l.mesh), salvage: wreckSalvage(rungs(l), SIZES[l.body] ?? "car"),
})));
/** A look's lesser looks, each one kind whatever the paint (salvage.ts). */
const FORMS: readonly StructureDef[] = OURS.flatMap((l) => {
  const to = strippedOf(l);
  return to ? [wreckFormDef(l.mesh, "stripped", { mesh: to.mesh, shape: shapeOf(to), half: shapeHalf(to.boxes), color: colourOf(l, l.painted ? paintsOf(l)[0] : undefined) })] : [];
});
export const WRECKS: readonly Def[] = [...SHAPES, ...STATICS, ...FORMS];
