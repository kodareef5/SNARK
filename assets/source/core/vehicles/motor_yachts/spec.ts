import { MOTOR_YACHTS } from "../../../../../content/vehicles/motor-yachts.ts";
import type { CreatureAsset, MaterialSpec, Vec3 } from "../../../../../tools/art/spec.ts";

const material = (name: string, tiles: number, cutout = false): MaterialSpec => ({
  id: `core:yacht/${name}`, dir: import.meta.dir, tiles, cutout,
  base: `tex/${name}-base.png`, packed: `tex/${name}-packed.png`, normal: `tex/${name}-normal.png`,
  height: `tex/${name}-height.png`, regions: { mask: `tex/${name}-mask.png` },
  hurt: `tex/${name}-hurt.png`, decay: `tex/${name}-decay.png`,
});

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
    materials: { yacht: material("yacht", 8, true), cabin: material("cabin", 2), teak: material("teak", 2.4) },
    clips: [], feet: [], gaits: {}, flat: 2, preserveBones: ["steering", "propeller", "propeller_starboard"],
    budgets: { triangles: [55000, name === "solstice" ? 14500 : 19000, 7600, 3100, 1250, 560], texture: { top: 512, megabytes: 16, layer: 256 } },
  };
}
