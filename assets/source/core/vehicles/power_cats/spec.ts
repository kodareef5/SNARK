import { POWER_CATS } from "../../../../../content/vehicles/power-cats.ts";
import type { MarineModel, MarinePoint } from "../../../../../content/vehicles/marine-model.ts";
import { shared, type CreatureAsset, type SocketSpec } from "../../../../../tools/art/spec.ts";
import { pictures, sharedWreck, wrecked, type WreckForm } from "../performance_marine/spec.ts";

// The laid teak both boats share, tiled (palette.py).
const TEAK = shared(import.meta.dir, "core:power_cats/teak", { ...pictures("teak"), tiles: 2.4 });
/** Each boat's own pictures and their sides, as palette.py OWN lays them out, laid out and baked by ../marine. */
const OWN_SIZES: Record<string, Record<string, number>> = { manta: { hull: 2048 }, lagoon: { hull: 2048, house: 4096 } };

export function catamaranAsset(name: "lagoon" | "manta"): CreatureAsset {
  const m: MarineModel = POWER_CATS.find(m => m.id === `core:${name}`)!;
  const bones = m.outboard
    ? ["chassis", "outboard", "propeller", "outboard_starboard", "propeller_starboard", "steering", "canopy"]
    : ["chassis", "propeller", "propeller_starboard", "steering", "canopy"];
  const root = (name: string, offset: MarinePoint): SocketSpec => ({ name, offset, bone: "chassis" });
  const sockets: SocketSpec[] = [
    ...m.seats.map((at, i) => root(i === 0 ? "seat_driver" : `seat_${i}`, at)),
    root("camera_driver", m.camera), root("boarding_water", m.boarding.water),
    root("boarding_ladder", m.boarding.ladder), root("boarding_deck", m.boarding.deck),
    root("wake_left", [m.sponsonX!, m.draft, name === "manta" ? -4.38 : -8.26]),
    root("wake_right", [-m.sponsonX!, m.draft, name === "manta" ? -4.38 : -8.26]),
    root("spray_left", [m.sponsonX! + (name === "manta" ? .45 : .70), m.draft, name === "manta" ? 2.10 : 4.28]),
    root("spray_right", [-m.sponsonX! - (name === "manta" ? .45 : .70), m.draft, name === "manta" ? 2.10 : 4.28]),
    root("engine", [m.sponsonX!, name === "manta" ? 1.36 : 1.39, name === "manta" ? -4.97 : -5.39]),
    root("helm_left", [m.helm[0] + m.grip, m.helm[1], m.helm[2]]),
    root("helm_right", [m.helm[0] - m.grip, m.helm[1], m.helm[2]]),
    { name: "propeller", offset: [0, 0, 0], bone: "propeller" },
    { name: "propeller_starboard", offset: [0, 0, 0], bone: "propeller_starboard" },
  ];
  return {
    kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
    skeleton: { id: m.id, root: "chassis", bones: bones.length, order: bones },
    sockets, zones: [], clips: [], feet: [], gaits: {}, preserveBones: bones.slice(1),
    regions: [{ name: "Hull", sample: m.paint }, { name: "Boot stripe", sample: m.trim![0] },
      { name: "Upholstery", sample: m.trim![1] }],
    materials: { ...Object.fromEntries(Object.keys(OWN_SIZES[name]!).map(m => [m, pictures(m)])), teak: TEAK },
    flat: 2,
    budgets: { triangles: [45000, 11000, 5400, 2300, 1100, 440], texture: { top: Math.max(...Object.values(OWN_SIZES[name]!)), megabytes: 96, layer: 2048 } },
  };
}

const TEAK_WRECK = { damaged: sharedWreck(import.meta.dir, "core:power_cats/teak", "teak", "worn", 2.4), sunk: sharedWreck(import.meta.dir, "core:power_cats/teak", "teak", "wrecked", 2.4) };

/** A catamaran's wreck form (../marine/wreck.py): its rig and measures, drawn with the form's own pictures. */
export function catamaranWreck(name: "lagoon" | "manta", form: WreckForm): CreatureAsset {
  return { ...catamaranAsset(name), source: { scripts: ["model.py"] }, materials: { ...Object.fromEntries(Object.keys(OWN_SIZES[name]!).map(m => [m, wrecked(name, m)])), teak: TEAK_WRECK[form] } };
}
