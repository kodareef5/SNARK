import { MOTOR_YACHTS } from "../../../../../content/vehicles/motor-yachts.ts";
import { shared, type CreatureAsset, type Vec3 } from "../../../../../tools/art/spec.ts";
import { pictures, sharedWreck, wrecked, type WreckForm } from "../performance_marine/spec.ts";
import FORMS from "../marine/forms.json" with { type: "json" };

// The laid teak every yacht shares, tiled (palette.py).
const TEAK = shared(import.meta.dir, "core:yacht/teak", { ...pictures("teak"), tiles: 2.4 });
/** Each yacht's own pictures and their sides, as palette.py OWN lays them out, laid out and baked by ../marine. The last holds the panes, whose inner faces it cuts out. */
const OWN_SIZES: Record<string, Record<string, number>> = { solstice: { hull: 2048 }, meridian: { hull: 2048, house: 2048 }, belvedere: { hull: 2048, house: 4096 }, sovereign: { hull: 2048, house: 4096 } };

export function yachtAsset(name: string): CreatureAsset {
  const boat = MOTOR_YACHTS.find(b => b.id === `core:${name}`)!;
  const [x, y, z] = boat.helm;
  const anchors: Record<string, Vec3> = {
    camera_driver: boat.camera, helm_left: [x + boat.grip, y, z], helm_right: [x - boat.grip, y, z],
    boarding_water: boat.boarding.water, boarding_ladder: boat.boarding.ladder, boarding_deck: boat.boarding.deck,
    propeller: boat.propeller, propeller_starboard: boat.secondPropeller!,
    wake_left: [boat.beam * .31, boat.draft, -boat.length * .45], wake_right: [-boat.beam * .31, boat.draft, -boat.length * .45],
    spray_left: [boat.beam * .42, boat.draft, boat.length * .20], spray_right: [-boat.beam * .42, boat.draft, boat.length * .20],
    engine: [0, boat.draft + .28, -boat.length * .32],
  };
  boat.seats.forEach((seat, k) => anchors[k ? `seat_${k}` : "seat_driver"] = seat);
  return {
    kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
    skeleton: { id: boat.id, root: "chassis", bones: 4, order: ["chassis", "steering", "propeller", "propeller_starboard"] },
    zones: [], sockets: Object.entries(anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
    regions: [{ name: "Paint", sample: boat.paint }, { name: "Stripe", sample: 84 }, { name: "Upholstery", sample: 101 }],
    materials: { ...Object.fromEntries(Object.keys(OWN_SIZES[name]!).map((m, k, all) => [m, pictures(m, { cutout: k === all.length - 1 })])), teak: TEAK },
    clips: [], feet: [], gaits: {}, flat: 2, preserveBones: ["steering", "propeller", "propeller_starboard"],
    budgets: { triangles: [55000, name === "solstice" ? 14500 : 19000, 7600, 3100, 1250, 560], texture: { top: Math.max(...Object.values(OWN_SIZES[name]!)), megabytes: 96, layer: 2048 } },
  };
}

const TEAK_WRECK = { damaged: sharedWreck(import.meta.dir, "core:yacht/teak", "teak", "worn", 2.4), sunk: sharedWreck(import.meta.dir, "core:yacht/teak", "teak", "wrecked", 2.4) };

/** A yacht's wreck form (../marine/wreck.py): its rig and measures, drawn with the form's own pictures. */
export function yachtWreck(name: string, form: WreckForm): CreatureAsset {
  const intact = yachtAsset(name);
  const levels = (FORMS as unknown as Record<string, Record<string, { levels?: Record<string, number> }>>)[name]![form]!.levels ?? {};
  const triangles = intact.budgets.triangles.map((t, k) => levels[k] ?? t);
  return { ...intact, source: { scripts: ["model.py"] }, budgets: { ...intact.budgets, triangles }, materials: {
    ...Object.fromEntries(Object.keys(OWN_SIZES[name]!).map((m, k, all) => [m, wrecked(name, m, { cutout: k === all.length - 1 })])), teak: TEAK_WRECK[form],
  } };
}
