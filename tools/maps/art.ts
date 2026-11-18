// A city's one painted picture, the step before it is published: bun tools/maps/art.ts <city> [side]
//
// The map screen's art was Miami's alone: 85 painted tiles at four zooms, which the game never loaded and the points
// on the minimap hid. A map now has one picture, from the top, as wide and deep as the map and north up: this draws
// the reference it is painted over (the ground as the game colours it, from the built map) and a brief for artist, the
// art agent, into var/mapdata/<city>/current/art/. artist's picture, checked against the reference, is the one file
// the city keeps: assets/source/maps/<city>/art/map.png.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mapSizeX, mapSizeZ } from "../../shared/coords.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import { encodePng } from "../snap/png.ts";
import { ground } from "../wiki/atlas.ts";
import { cityFolder, workFolder } from "./work.ts";

const ROOT = resolve(import.meta.dir, "../..");
const [city, sideArg] = process.argv.slice(2);
if (!city) {
  console.error("bun tools/maps/art.ts <city> [pixels along the longer side, 2048]");
  process.exit(2);
}
const side = Number(sideArg ?? 2048);
const map = parseMap(new Uint8Array(readFileSync(join(ROOT, "var/maps", `${city}.snmap`))));
const picture = ground(defaultPalette(), map, side);
const out = join(workFolder(city), "art");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "reference.png"), encodePng(picture.width, picture.height, picture.rgba));

const settings = JSON.parse(readFileSync(join(cityFolder(city), "city.json"), "utf8")) as { label: string };
const [w, d] = [mapSizeX(map.dims) / 1000, mapSizeZ(map.dims) / 1000];
writeFileSync(join(out, "BRIEF.md"), `# ${settings.label}: the map screen's picture

One picture of the whole of ${settings.label} from straight above, for the map screen: ${picture.width} by
${picture.height} pixels, north up, covering ${w.toFixed(2)} by ${d.toFixed(2)} km exactly as \`reference.png\` does.

- Paint over \`reference.png\`: every coast, river, road and block where it stands there, so a survivor's marker on
  the picture is where the survivor is. Do not move, add or take away land or water.
- The city years after: streets broken and overgrown, roofs fallen in, the sea over the low ground the reference
  shows as shallow water. Painterly cartography, readable at a glance; the light from the north-west.
- No words, numbers, symbols, compass or border: the game draws its own marks over the picture.
- Deliver \`map.png\` at the same size. It goes to \`assets/source/maps/${city}/art/map.png\`.
`);
console.log(`${join(out, "reference.png")} (${picture.width} x ${picture.height}) and BRIEF.md`);
