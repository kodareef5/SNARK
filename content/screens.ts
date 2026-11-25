// Screens on props: TVs and laptops a world's rooms hold, each with a broken form of its own kind. The tek workstation,
// a station built round a laptop, is with the stations (content/items/stations.ts). Each screen's face is where the
// client draws the picture its type shows (shared/video/face.ts). The models are assets/source/core/props/screens,
// whose faces.json holds the boxes and faces written here; tests/world/screen-props.test.ts holds the two together.
//
// The TVs and laptops are a map's statics, as street lamps are: nobody makes them. Until world gen sets them in rooms an
// admin stands one with `place`. A broken form has no face: its glass is smashed and dark.

import type { Def, StructureDef } from "../shared/content/defs.ts";
import type { ScreenFace } from "../shared/video/face.ts";

// Palette colours far off: black plastic, a tube set's grey, a laptop's beige.
const BLACK = 11, GREY = 84, BEIGE = 15;
// Plastic and glass are harmed as wood is (chosen).
const PLASTIC = "core:mat_wood";

/** One prop and its broken form: its box, and its face in the whole one. */
function prop(name: string, color: number, hp: number, half: readonly [number, number, number], broken: readonly [number, number, number], screen: ScreenFace): StructureDef[] {
  const of = (id: string, h: readonly [number, number, number], hp: number): StructureDef => ({ type: "structure", class: "static", id, mesh: "box", half: h, color, hp, material: PLASTIC, near: true });
  return [{ ...of(`core:${name}`, half, hp), screen }, of(`core:${name}_broken`, broken, Math.round(hp / 2))];
}

export const SCREEN_PROPS: readonly Def[] = [
  // A 55-inch panel on a wall bracket, its back against the wall, and on a pedestal.
  ...prop("tv_flat", BLACK, 150, [0.6215, 0.3605, 0.0443], [0.6604, 0.4332, 0.0443], { type: "tv", face: [-0.6048, 0.6048, -0.3365, 0.3439, 0.0472] }),
  ...prop("tv_flat_stand", BLACK, 160, [0.6215, 0.403, 0.13], [0.6215, 0.3964, 0.1527], { type: "tv", face: [-0.6048, 0.6048, -0.294, 0.3864, 0.0435] }),
  // A 14-inch tube set: its picture stops short of the glass's rounded edge.
  ...prop("tv_crt", GREY, 250, [0.1999, 0.2057, 0.1715], [0.1999, 0.2057, 0.1715], { type: "tv", face: [-0.1503, 0.1503, -0.0575, 0.1637, 0.1658], crt: true }),
  // An old laptop open square, its lid at the back.
  ...prop("laptop", BEIGE, 80, [0.1793, 0.1493, 0.1336], [0.1793, 0.1351, 0.1896], { type: "laptop", face: [-0.1218, 0.1218, -0.0668, 0.1318, -0.1113] }),
];
