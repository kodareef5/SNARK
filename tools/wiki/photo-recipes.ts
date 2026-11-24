// Camera and cast recipes for the wiki's photographs. Positions are metres and yaw is degrees.
import type { Actor, Prop, SceneBrief, View } from "./photo-recipe.ts";
import { FOUNDATION_THICK, WALL_HEIGHT } from "../../content/building.ts";
import { OPENING_SHOT, type TitleShot } from "../../shared/title-scene.ts";

export const PHOTO_SIZE = [1440, 810] as const;
export const CARD_SIZE = [640, 360] as const;
export const HOME_SIZE = [1600, 900] as const;
export const PORTRAIT_SIZE = [720, 1280] as const;
export const FOOTER_SIZE = [1600, 704] as const;
export const WIKI_HOME_SECONDS = 3;
export const WIKI_FOOTER_SECONDS = 8;

export const FOOTER_SHOT: TitleShot = {
  ...OPENING_SHOT,
  id: "wiki-footer",
  name: "Red tide across the bay",
  camera: { side: -1.9, back: 3.2, height: 0.35, pan: 5, tilt: 12.5, lens: 57, hour: 18.5 },
};
const FIELD: readonly Prop[] = [["palm", -7, 18], ["palm", 7, 23, 40], ["bush", -3, 6], ["rock", 4, 12], ["bush", 5, 15]];
const GROVE: readonly Prop[] = [["tree", -3, 5], ["palm", 5, 12], ["bush", 2, 3], ["rock", -2, 7], ["fern", -3, 7]];
const CAMP: readonly Prop[] = [
  ["foundation_wood", 0, 7], ["foundation_wood", 3, 7], ["foundation_wood", 0, 10], ["foundation_wood", 3, 10],
  ["wall_wood", 0, 11.5, 0, FOUNDATION_THICK], ["wall_wood", 3, 11.5, 0, FOUNDATION_THICK],
  ["windowframe_wood", 4.5, 10, 90, FOUNDATION_THICK], ["doorframe_wood", 4.5, 7, 90, FOUNDATION_THICK],
  ["ceiling_wood", 0, 10, 0, FOUNDATION_THICK + WALL_HEIGHT], ["ceiling_wood", 3, 10, 0, FOUNDATION_THICK + WALL_HEIGHT],
  ["storage_box", 2.7, 8.5, 0, FOUNDATION_THICK], ["campfire_lit", -2.3, 5.5],
];
const WORKSHOP: readonly Prop[] = [["forge_lit", -1.0, 5.5, 181], ["smithy", 0.54, 3.9, 164], ["storage_box", 2, 5.8, 20]];
const LOW: View = [0, 1.6, -6, 0, -2, 40];
const BENCH: View = [0, 2.25, 0, 0, -12, 42];
const SHORE: View = [0, 2.7, -5, 0, -7, 44];

const brief = (route: string, caption: string, alt: string, hour: number, view: View, actors: readonly Actor[], set: Partial<Pick<SceneBrief, "props" | "plants" | "landmark" | "absoluteHeight" | "eyeSeconds" | "time" | "city">> = {}): SceneBrief => ({
  route, caption, alt, hour, view, actors, ...set,
});


// These perspectives use the in-game gallery cameras and their absolute heights.
const DEG = 180 / Math.PI;
const flightHeading = Math.atan2(7672 - 6508, 8576 - 8352);
const birdBearing = flightHeading - 0.27;
const CITY = { absoluteHeight: true, city: true, eyeSeconds: 96, time: 18.9 } as const;
const aimed = ([dx, height, dz]: readonly [number, number, number], [x, y, z]: readonly [number, number, number], fov: number): View =>
  [0, height, 0, Math.atan2(x - dx, z - dz) * DEG, Math.atan2(y - height, Math.hypot(x - dx, z - dz)) * DEG, fov * DEG];

export const WIKI_SCENE_BRIEFS: readonly SceneBrief[] = [
  brief("", "Rex and the Red Obelisk", "A survivor in Meridian armor rides a saddled Rex toward a red beam over Biscayne Bay.", 18.35, LOW, [["rex", 0, 0, 0]]),
  brief("guides/", "At camp", "Two survivors, a campfire and a wooden shelter.", 16.4, [1, 2.4, -2, 0, -8, 44],
    [["survivor", 2.4, 4.6, -130, "hatchet"], ["survivor", -1.2, 5.5, 130, "pick"]], { props: CAMP, plants: FIELD }),
  brief("guides/getting-started/", "First tools", "A survivor carrying a stone pick by a bush, dodo and rock.", 8.1, [0, 1.8, -1, 0, -8, 39],
    [["survivor", 0.6, 3, -135, "pick"], ["dodo", -1.1, 4, 110]], { plants: [["bush", 1.9, 4.3], ["rock", -1.8, 6], ["palm", 2.4, 11]] }),
  brief("guides/gathering-and-crafting/", "Harvesting a tree", "A survivor swings a stone hatchet toward a tree beside a rock and fern.", 10.2, BENCH,
    [["survivor", -1.8, 3.9, -46, "chop"]], { plants: GROVE }),
  brief("guides/building-a-base/", "A wooden shelter with a window and doorway", "A survivor beside a partly roofed shelter, storage box and fire.", 15.3, [-2.4, 3.2, -1.5, 24, -11, 46],
    [["survivor", -1.6, 4, 40, "hatchet"]], { props: CAMP, plants: FIELD }),
  brief("guides/taming-and-riding/", "A knockout tame", "A survivor beside a knocked-out dodo, with a saddled parasaur standing behind them.", 9.8, [0.7, 1.3, -4, 0, -3, 42],
    [["survivor", 0.4, 4, -40], ["dodo", -0.4, 3.1, 18, "out"], ["parasaur", -2.5, 9, -120, "saddle_parasaur"]], { plants: [["bush", 2.1, 6], ["palm", -3.5, 15]] }),
  brief("guides/breeding/", "A dodo pair and their hatchling", "Two adult dodos face a hatchling near a low bush.", 9.4, [0, 0.78, 0, 0, -9, 38],
    [["dodo", 0.75, 3, 135], ["dodo", -0.9, 3.45, -135], ["dodo", 0.04, 2.65, 195, "young"]], { plants: [["bush", -1.7, 5], ["fern", 1.7, 4.7]] }),
  brief("reference/", "A survey of life on the ground and in the air", "Triceratops, a raptor and a flying pteranodon among palms.", 9.5, [0, 2.1, -9, 0, 0, 46],
    [["trike", 2.6, 5, -140], ["raptor", -3.3, 3.5, -100], ["pteranodon", -1.2, 12, -130, "fly", 1.7]], { plants: FIELD }),
  brief("creatures/", "Three species in a clearing", "A triceratops and parasaur stand behind a dodo.", 8.6, [0, 1.45, -6, 0, -1, 36],
    [["trike", -1, 7, 135], ["parasaur", 3, 6, -130], ["dodo", 0.45, 2.1, 195]], { plants: FIELD }),
  brief("characters/", "Meridian armor", "A survivor wears the Meridian flight suit in Bayfront Park.", 15.8, [1.15, 1.6, 0.65, 0, -1, 39],
    [["survivor", 0.5, 3.1, 145, "kit"]]),
  brief("items/", "At the smithy", "A survivor in hide armor stands beside a smithy and stone refining forge in a coastal clearing.", 8.3, [0, 1.68, 0.35, 0, -9, 49],
    [["survivor", -0.63, 2.0, 17, "pick_metal", 0, undefined, undefined, "hide"]], { props: WORKSHOP, plants: [["palm", -4.5, 9.6], ["palmetto", 3.2, 7.5]] }),
  brief("resources/", "Plants, trees and a metal deposit", "A survivor in a grove with a palm, berry bush, fern and dark-veined rock.", 10.8, [0.2, 2.5, -2, 0, -9, 40],
    [["survivor", 0.6, 4.5, 100, "pick"]], { plants: [...GROVE, ["metal_rock", 1.1, 5.8]] }),
  brief("vehicles/", "Driving in Downtown Miami", "A Meridian-armored survivor drives an orange roadster on a downtown street.", 16.1, [-2.65, 1.27, -0.1, 57, -1, 36],
    [["veloce", 0, 2, 170, "drive"], ["survivor", 0, 2, 170, "driver", 0, 0]], { city: true }),
  brief("landmarks/", "Koru under the downtown towers", "Koru’s three masts and black hull across Biscayne Bay from the Miami skyline.", 7.9, aimed([6560, 9, 5035], [6712, 22, 5112], 0.85),
    [], { ...CITY, landmark: "koru" }),
  brief("statuses/", "Torpor", "A survivor kneels near an unconscious dodo in the grass.", 16.1, [0, 1.14, 0, 0, -12, 38],
    [["survivor", 0.6, 4.6, 150, "crouch"], ["dodo", -0.25, 2.6, 20, "out"]], { plants: [["fern", 1.9, 4], ["rock", -2, 5]] }),
  brief("maps/", "Sunrise over Wynwood", "A Meridian-armored survivor rides a pteranodon above Miami as the red Sextant fires.", 6.45,
    [0, 61, 0, (flightHeading - 0.08) * DEG, 0.15 * DEG, 0.86 * DEG],
    [["pteranodon", Math.sin(birdBearing) * 7.4, Math.cos(birdBearing) * 7.4, (birdBearing + 2.25) * DEG, "fly", 60.45, undefined, "saddle_pteranodon"],
      ["survivor", 0, 0, 0, "kit", 0, 0]], CITY),
  brief("engrams/", "A forge by the shore", "A survivor in cloth works between a hot refining forge and a smithy.", 17.2, [1.35, 1.84, 0.8, -16, -10, 52],
    [["survivor", -0.45, 3, 42, "hatchet_metal", 0, undefined, undefined, "cloth"]], { props: WORKSHOP, plants: [["palm", 5, 13.5], ["fern", -2.2, 5]] }),
  brief("levels/", "A Rex saddle in Bayfront Park", "A survivor with Meridian armor rides a saddled Rex beside Downtown Miami.", 7.9, aimed([6842, 2.6, 5188], [6858, 5.6, 5182], 0.85),
    [["rex", 16, -6, (-Math.PI / 2 - 0.75) * DEG, undefined, 2.3, undefined, "saddle_rex"], ["survivor", 0, 0, 0, "kit", 0, 0]], CITY),
  brief("controls/", "On foot and in flight", "A survivor holds a tool below a flying pteranodon.", 8.7, [0.5, 1.9, -5.5, 0, 1, 44],
    [["survivor", 1.2, 3, 155, "hatchet"], ["pteranodon", -1.8, 8.5, 135, "fly", 1.8]], { plants: FIELD }),
  brief("sounds/", "A call across the clearing", "A raptor calls, with a second raptor behind it.", 16.6, LOW,
    [["raptor", 0.6, 2, 160, "roar"], ["raptor", -3, 5.8, -115]], { plants: FIELD }),
  brief("music/", "Camp at dusk", "A campfire burns beside two survivors at a wooden shelter.", 17.85, [-2.4, 2.1, -3, 15, -5, 42],
    [["survivor", 0.6, 4, 55], ["survivor", -3.5, 5.5, 110, "kit"]], { props: CAMP, plants: FIELD }),
  brief("server/", "The Tide Eye over Virginia Key", "The blue transfer obelisk glows over Virginia Key at dusk.", 18, aimed([2900, 30, 2950], [3422, 330, 2742], 0.9),
    [], { absoluteHeight: true, eyeSeconds: 16, time: 18.9 }),
  brief("commands/", "A raptor on Flagler Street", "A raptor crosses the downtown road in front of a parked compact car.", 16.2, [-1.36, 1.53, -2.6, 12, -2, 52],
    [["compact", 2.2, 13, 135], ["raptor", -1.0, 4.4, 103], ["survivor", 4.2, 9, 150, "kit"]]),
  brief("settings/", "An established camp", "A larger shelter with a survivor and a tamed raptor outside.", 13.9, [0, 2.2, -6, 0, -7, 41],
    [["survivor", 3, 4, 190], ["raptor", -3, 5, -145]], { props: CAMP, plants: FIELD }),
  brief("about/", "Out across the water", "A survivor watches a boat from the shore at dusk.", 18.1, SHORE,
    [["survivor", 1.2, -1, 0, "pick"], ["jon_boat", -2, 10.5, -40]], {}),
  brief("credits/", "Art from the game", "A raptor, pteranodon and survivor posed together in sunlight.", 13.2, LOW,
    [["raptor", -2.1, 4, -145], ["survivor", 1.5, 2.8, 165, "kit"], ["pteranodon", 0, 7, 170, "fly", 2.5]], { plants: FIELD }),
  brief("footer", "Red tide at Wynwood", "From behind a Meridian-armored survivor on a Rex, the Red Obelisk lights the clouds over Miami.", 18.5, LOW, [["rex", 0, 0, 0]]),
];


// Stage offsets are relative to these locations on the cooked Miami map.
const CAMPS = {
  shallows: [2506.5, 2429.9, -18], smithy: [1226, 5699, 80], forge: [1198, 5692, -88], park: [6858, 5182, 48], beach: [1178, 5688, 72],
  key: [2512, 2412, -18], road: [7186, 5160, -88], armor: [6840, 5175, 108], breed: [1185, 5705, 95],
  skyline: [6508, 8352, 0], marina: [6560, 5035, 0], deck: [2900, 2950, 0], rex: [6842, 5188, 0],
} as const;
const LOCATIONS: Readonly<Record<string, keyof typeof CAMPS>> = {
  "guides/": "key",
  "guides/getting-started/": "beach",
  "guides/gathering-and-crafting/": "key",
  "guides/building-a-base/": "key",
  "guides/taming-and-riding/": "key",
  "guides/breeding/": "breed",
  "reference/": "beach",
  "creatures/": "key",
  "characters/": "armor",
  "items/": "smithy",
  "resources/": "key",
  "vehicles/": "road",
  "landmarks/": "marina",
  "statuses/": "key",
  "maps/": "skyline",
  "engrams/": "forge",
  "levels/": "rex",
  "controls/": "beach",
  "sounds/": "key",
  "music/": "key",
  "server/": "deck",
  "commands/": "road",
  "settings/": "key",
  "about/": "shallows",
  "credits/": "beach",
};
export function photoPosition(route: string): readonly [x: number, z: number, yaw: number] {
  const set = LOCATIONS[route];
  if (!set) throw Error("No Miami stage for " + route);
  return CAMPS[set];
}

export const photoName = (route: string): string => route.replace(/\/$/, "").replaceAll("/", "-") || "home";
export const photoSize = (route: string) => route === "" ? HOME_SIZE : route === "footer" ? FOOTER_SIZE : PHOTO_SIZE;
