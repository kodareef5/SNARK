// Optical roles in the shipped art. A placed wreck can share a material atlas with a road vehicle.
import trailer from "./vehicles/trailer-axles.json" with { type: "json" };
import { GRATE, UTILITY_ENAMEL } from "./colours.ts";

export const PAINT = 1, FITTINGS = 2, BURNT_SHEET = 3, LENS = 4, ENAMEL_ARMOR = 5, EXHAUST = 6, INSTRUMENT = 7, CHANNEL = 8;
/**
 * A supply drop's own light (client/core/render/supply-light.ts): the lit strips of its capsule, which are a surface,
 * and its shaft, halos, figure and jets, which are light with none and are blended. Each is worked out from the draw's
 * effect and reads no texture.
 */
export const DROP_LIGHT = 9, DROP_GLOW = 10;
const materials = new Map<string, number>();
for (const part of [
  "berlinetta/coachwork", "bus/livery", "compact/body", "compact_abandoned/body", "concept003/coachwork",
  "fastback/enamel", "monster_truck/livery", "muscle_car/livery", "patrol_jeep/patrol", "patrol_sedan/cruiser",
  "road_van/coach", "semi/livery", "tanker/livery", "tanker_wrecks/livery", "taxi/livery", "veloce/coachwork",
  "zephyr/coachwork",
]) materials.set("core:" + part, PAINT);
// The fleet's abandoned statics (assets/source/core/vehicles/<vehicle>_abandoned): the live vehicles' atlases, weathered.
for (const part of [
  "berlinetta_abandoned/coachwork", "bus_abandoned/livery", "fastback_abandoned/enamel", "monster_truck_abandoned/livery",
  "muscle_car_abandoned/livery", "patrol_jeep_abandoned/patrol", "patrol_sedan_abandoned/cruiser", "road_van_abandoned/coach",
  "semi_abandoned/livery", "taxi_abandoned/livery", "veloce_abandoned/coachwork",
]) materials.set("core:" + part, PAINT);
// The looks salvage leaves (<vehicle>_salvaged) are drawn with the abandoned looks' pictures under materials of their own.
for (const part of [
  "berlinetta_salvaged/coachwork", "bus_salvaged/livery", "fastback_salvaged/enamel", "monster_truck_salvaged/livery",
  "muscle_car_salvaged/livery", "patrol_jeep_salvaged/patrol", "patrol_sedan_salvaged/cruiser", "semi_salvaged/livery",
  "taxi_salvaged/livery", "veloce_salvaged/coachwork",
]) materials.set("core:" + part, PAINT);
materials.set("core:compact_wreck/body", BURNT_SHEET);
materials.set("core:human-bodies/meridian", ENAMEL_ARMOR);
// The Miami instruments: glazed ceramic and fired enamel under a clear coat, cast and brushed metal that keeps its own colour, cut glass.
for (const atlas of ["instrument", "livery"]) materials.set("core:tide-eye/" + atlas, INSTRUMENT);
// The capsule is the instruments' kin: the same ceramic, bronze and glass, and its own two lights.
materials.set("core:supply-capsule/capsule", INSTRUMENT);
materials.set("core:supply-capsule/light", DROP_LIGHT);
materials.set("core:supply-capsule/glow", DROP_GLOW);
for (const part of [
  "compact/cabin", "compact/trim", "compact_abandoned/cabin", "compact_abandoned/trim", "compact_wreck/cabin",
  "compact_wreck/trim", "fastback/detail", "road_van/cabin", "road_van/fittings", "street/street", "street/street_cut",
  "fastback_abandoned/detail", "road_van_abandoned/cabin", "road_van_abandoned/fittings", "fastback_salvaged/detail",
]) materials.set("core:" + part, FITTINGS);

export function streetMaterial(id: string, wheeledRig = false): number {
  // Undeclared wheel rigs still pick up exposed metal from their authored metallic and roughness maps.
  return materials.get(id) ?? (wheeledRig ? FITTINGS : 0);
}

const exposure = new Map<string, number>();
for (const [age, models] of [
  [0.32, ["box_trailer"]],
  [0.55, ["compact_abandoned", "compact_abandoned_roof", "compact_abandoned_stripped", "tanker_abandoned",
    "concept003_abandoned", "concept003_abandoned_stripped",
    "berlinetta_abandoned", "bus_abandoned", "caravan_abandoned", "caravan_abandoned_stripped", "fastback_abandoned",
    "fastback_abandoned_roof", "fastback_abandoned_stripped", "monster_truck_abandoned", "muscle_car_abandoned",
    "panel_van_abandoned", "panel_van_abandoned_stripped", "patrol_jeep_abandoned", "patrol_sedan_abandoned", "semi_abandoned",
    "taxi_abandoned", "veloce_abandoned",
    // A stripped look only salvage leaves weathers as its body's street looks do.
    ...["berlinetta", "bus", "monster_truck", "muscle_car", "patrol_jeep", "patrol_sedan", "semi", "taxi", "veloce"].map((body) => `${body}_abandoned_stripped`)]],
  [0.78, ["tanker_impact", "tanker_rear_crush", "tanker_rollover", "tanker_separated", "tanker_stripped", "tanker_cistern"]],
  // A shell is as far gone as a burnt wreck: the table's most.
  [1, ["compact_wreck", "compact_wreck_tipped", "tanker_burnout",
    ...["berlinetta", "bus", "caravan", "compact", "concept003", "fastback", "monster_truck", "muscle_car", "panel_van", "patrol_jeep", "patrol_sedan", "semi", "taxi", "veloce"].map((body) => `${body}_abandoned_shell`)]],
] as const) for (const model of models) exposure.set("core:" + model, age);
export const vehicleWeather = (model: string): number => exposure.get(model) ?? 0;
export const crownedSpokes = new Set(["core:compact"]);

export const FIXTURE_PAINT = 1, FIXTURE_IRON = 2, SIGN_ENAMEL = 3;
const fixtures = new Map<string, number>([
  ["core:zruin_zutility_concrete", FIXTURE_PAINT], ["core:zruin_zdrain_concrete", FIXTURE_IRON], ["core:box_trailer", 4],
]);
for (const color of ["blue", "clay", "mint", "rose"]) fixtures.set("core:zruin_zsign_" + color, SIGN_ENAMEL);
export const fixtureKind = (model: string): number => fixtures.get(model) ?? 0;

// Each palette rule names the face outside a wheel and, optionally, the face inside the trailer axle envelope.
export interface FixtureRule { palette: readonly number[]; face: number; wheel?: number }
export const fixtureFaces: readonly (readonly FixtureRule[])[] = [
  [], [{ palette: [UTILITY_ENAMEL], face: FIXTURE_PAINT }], [{ palette: [GRATE], face: FIXTURE_IRON }],
  [{ palette: [], face: SIGN_ENAMEL }],
  [{ palette: [82], face: 0, wheel: 5 }, { palette: [102, 86], face: 6, wheel: 4 }, { palette: [41, 214], face: 7 }],
];
export const axleEnvelope = { z: trailer.z, top: 2 * trailer.radius + 0.04, reach: trailer.radius + 0.03 };

const priorities = new Map<string, number>();
for (const [id, age] of exposure) priorities.set(id, 0.85 - 0.5 * age);
for (const [id, kind] of fixtures) if (!priorities.has(id)) priorities.set(id, kind === SIGN_ENAMEL ? 0.5 : 0.42);
for (const variant of ["concrete", "limestone", "rose", "mint", "clay", "steel", "rust", "blue"]) {
  for (const wall of ["zstore", "zstorecut", "zstorecutl", "zwin", "zwintop", "zwin4", "zwin4top", "zcurt", "zcurttop", "zcurt4", "zcurt4top"])
    priorities.set("core:zruin_" + wall + "_" + variant, 0.85);
  priorities.set("core:zruin_zshutter_" + variant, 0.42);
}
for (const piece of ["lamp", "lamp_lit", "lamp_leaning", "lamp_fallen", "signal", "signal_bent", "hydrant", "shelter", "shelter_wrecked",
  "mailbox", "meter", "meter_broken", "paystation", "paystation_broken", "bollard", "fence", "fence_sagging", "fence_down",
  "rail", "rail_bent", ...["", "_low", "_mid", "_small"].flatMap((board) => [`billboard${board}`, `billboard${board}_bare`]), "newsbox"]) priorities.set("core:zzstreet_" + piece, 0.4);
export const streetPriority = (id: string): number => priorities.get(id) ?? 0;
