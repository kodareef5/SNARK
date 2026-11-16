import { boatAsset } from "../boat/asset.ts";
import { shared } from "../../../../../tools/art/spec.ts";
const intact = boatAsset();
const maps = (name: string, cutout = false) => shared(import.meta.dir, `core:boat_wreck/${name}`, {
  tiles: name === "body" ? 9.2261 : name === "trim" ? 6.1395 : 11.9680,
  base: `tex/${name}_base.png`, normal: `../boat/tex/${name}_normal.png`, packed: `tex/${name}_packed.png`,
  regions: { mask: `tex/${name}_mask.png` }, height: `../boat/tex/${name}_height.png`, ...(cutout ? { cutout: true } : {}),
});
/** The same skeleton retains the final vehicle orientation and the outboard's final steering angle. */
export default { ...intact, source: { scripts: ["wreck.py"] }, materials: { body: maps("body"), trim: maps("trim"), cabin: maps("cabin", true) } };
