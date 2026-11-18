import { SMALL_CRAFT } from "../../../../../content/vehicles/small-craft.ts";
import type { MarineModel, MarinePoint } from "../../../../../content/vehicles/marine-model.ts";
import { shared, type CreatureAsset, type MaterialSpec } from "../../../../../tools/art/spec.ts";

/** A material's pictures, `<name>_<role>.png` in `tex/`. */
export const pictures = (name: string, extra: Partial<MaterialSpec> = {}): MaterialSpec => ({
  base: `tex/${name}_base.png`, normal: `tex/${name}_normal.png`, packed: `tex/${name}_packed.png`,
  regions: { mask: `tex/${name}_mask.png` }, height: `tex/${name}_height.png`,
  hurt: `tex/${name}_hurt.png`, decay: `tex/${name}_decay.png`, ...extra,
});
/** The small fittings every craft of the family shares, tiled (finishes.py). */
const HARDWARE = shared(import.meta.dir, "core:performance_marine/hardware", { ...pictures("hardware"), tiles: 2 });

/**
 * A wreck form's pictures of one of its vessel's own materials, on the vessel's layout: its own colour, finish and dye
 * where the vessel's normal and height are kept (`vessel` is the vessel's folder).
 */
export const wrecked = (vessel: string, name: string, extra: Partial<MaterialSpec> = {}): MaterialSpec => ({
  base: `tex/${name}_base.png`, packed: `tex/${name}_packed.png`, regions: { mask: `tex/${name}_mask.png` },
  normal: `../${vessel}/tex/${name}_normal.png`, height: `../${vessel}/tex/${name}_height.png`, ...extra,
});
/** A shared tiled material as the family's damaged forms (`worn`) and sunk forms (`wrecked`) wear it. */
export const sharedWreck = (dir: string, id: string, name: string, state: "worn" | "wrecked", tiles: number): MaterialSpec => shared(dir, `${id}_${state}`, {
  base: `tex/${name}_${state}_base.png`, packed: `tex/${name}_${state}_packed.png`, regions: { mask: `tex/${name}_${state}_mask.png` },
  normal: `tex/${name}_normal.png`, height: `tex/${name}_height.png`, tiles,
});
export type WreckForm = "damaged" | "sunk";
const HARDWARE_WRECK = { damaged: sharedWreck(import.meta.dir, "core:performance_marine/hardware", "hardware", "worn", 2), sunk: sharedWreck(import.meta.dir, "core:performance_marine/hardware", "hardware", "wrecked", 2) };

/** A craft's wreck form (../marine/wreck.py): its vessel's rig and measures, drawn with the form's own pictures. */
export function smallCraftWreck(id: string, form: WreckForm): CreatureAsset {
  const vessel = id.slice("core:".length);
  return { ...smallCraftAsset(id), source: { scripts: ["model.py"] }, materials: { shell: wrecked(vessel, "shell"), hardware: HARDWARE_WRECK[form] } };
}

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
  return {
    kind: "creature", source: { scripts: ["model.py"] }, scale: 1, skeleton: { id, root: "chassis", order, bones: order.length },
    sockets: Object.entries(anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
    // The shell is the craft's own picture, laid out and baked by ../marine (each texel one place on it).
    materials: { shell: pictures("shell"), hardware: HARDWARE },
    // The jon boat's benches are bare metal: only the others' seats take a colour.
    regions: d.family === "jon" ? [{ name: "Paint", sample: d.paint }] : [{ name: "Paint", sample: d.paint }, { name: "Upholstery", sample: 104 }], clips: [], zones: [], feet: [], gaits: {},
    budgets: { triangles: [36000, 5000, 2200, 1100, 560, 280], texture: { top: 2048, megabytes: 48, layer: 2048 } },
    preserveBones: order.slice(1), flat: 2,
  };
}
