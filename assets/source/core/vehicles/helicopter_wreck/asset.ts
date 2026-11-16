import { helicopterAsset } from "../helicopter/asset.ts";
import { shared } from "../../../../../tools/art/spec.ts";

const intact = helicopterAsset();
const maps = (name: string, cutout = false) => shared(import.meta.dir, `core:helicopter_wreck/${name}`, {
  tiles: name === "body" ? 11.0469 : name === "trim" ? 8.2517 : 12.7851,
  base: `tex/${name}_base.png`, normal: `../helicopter/tex/${name}_normal.png`, packed: `tex/${name}_packed.png`,
  regions: { mask: `tex/${name}_mask.png` }, height: `../helicopter/tex/${name}_height.png`, ...(cutout ? { cutout: true } : {}),
});

/** Same rigid bones and sockets, so a wreck retains its complete final attitude when the authoritative body settles. */
export default { ...intact, source: { scripts: ["wreck.py"] }, materials: {
  body: maps("body"), trim: maps("trim"), cabin: maps("cabin", true),
} };
