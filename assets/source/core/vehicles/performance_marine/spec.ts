import { SMALL_CRAFT } from "../../../../../content/vehicles/small-craft.ts";
import type { MarineModel, MarinePoint } from "../../../../../content/vehicles/marine-model.ts";
import { shared, type CreatureAsset } from "../../../../../tools/art/spec.ts";

export function smallCraftAsset(id: string): CreatureAsset {
  const d: MarineModel = SMALL_CRAFT.find(model => model.id === id)!;
  const jets = d.family === "pwc";
  const order = ["chassis", "steering", "outboard"];
  if (!jets) order.push("propeller");
  if (d.secondOutboard) order.push("outboard_starboard", "propeller_starboard");
  const [x, y, z] = d.helm;
  const anchors: Record<string, MarinePoint> = {
    camera_driver: d.camera, boarding_water: d.boarding.water, boarding_ladder: d.boarding.ladder, boarding_deck: d.boarding.deck,
    engine: [0, d.beltline, -d.length * .40],
    wake_left: [d.beam * .30, d.draft, -d.length * .425], wake_right: [-d.beam * .30, d.draft, -d.length * .425],
    spray_left: [d.beam * .41, d.draft, d.length * .12], spray_right: [-d.beam * .41, d.draft, d.length * .12],
    helm_left: [x + d.grip, y, z], helm_right: [x - d.grip, y, z],
  };
  d.seats.forEach((at, i) => anchors[i === 0 ? "seat_driver" : `seat_${i}`] = at);
  const atlas = (name: string, span: number) => shared(import.meta.dir, `core:performance_marine/${name}`, {
    tiles: span, base: `tex/${name}-base.png`, normal: `tex/${name}-normal.png`, packed: `tex/${name}-packed.png`,
    regions: { mask: `tex/${name}-mask.png` }, height: `tex/${name}-height.png`,
    hurt: `tex/${name}-hurt.png`, decay: `tex/${name}-decay.png`,
  });
  return {
    kind: "creature", source: { scripts: ["model.py"] }, scale: 1, skeleton: { id, root: "chassis", order, bones: order.length },
    sockets: Object.entries(anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
    materials: { laminate: atlas("laminate", 5), hardware: atlas("hardware", 2) },
    regions: [{ name: "Paint", sample: d.paint }], clips: [], zones: [], feet: [], gaits: {},
    budgets: { triangles: [36000, 5000, 2200, 1100, 560, 280], texture: { top: 512, megabytes: 7, layer: 256 } },
    preserveBones: order.slice(1), flat: 2,
  };
}
