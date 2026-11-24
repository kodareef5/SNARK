import type { Ref } from "./catalogue.ts";
import { BASE } from "./html.ts";

export type GuidePart = string | Ref | { text: string; href: string };

export interface Guide {
  slug: string;
  title: string;
  summary: string;
  sections: readonly { id: string; title: string; steps: readonly (readonly GuidePart[])[] }[];
}

export const guidePath = (slug: string): string => `${BASE}guides/${slug}/`;

const ref = (name: string): Ref => ({ id: `core:${name}` });
const link = (text: string, path: string): GuidePart => ({ text, href: `${BASE}${path}` });
const guide = (text: string, slug: string): GuidePart => ({ text, href: guidePath(slug) });

export const GUIDES: readonly Guide[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "Find water, craft a stone pick and set a respawn point.",
    sections: [
      { id: "choose-a-world", title: "Choose a world", steps: [
        ["Open ", link("Maps", "maps/"), " to see the cities and their running worlds. On a city map, enable survivor spawns and nearby resources to see what is close to each spawn."],
        ["The controls below use keyboard and mouse. See ", link("Controls", "controls/"), " for gamepad bindings."],
      ] },
      { id: "food-and-water", title: "Find food and water", steps: [
        ["Look at a ", ref("bush"), " and press E to pick berries and fiber. Open Inventory with I and right-click a stack of ", ref("berry"), " to eat."],
        ["Walk into water and press E with no object in reach to drink. Later, use a ", ref("waterskin"), " while standing in shallow water to fill it."],
      ] },
      { id: "first-tools-and-shelter", title: "Make your first tools and shelter", steps: [
        ["Hit a tree and a rock by hand for the first materials. Press P, open Make and select the recipe for a ", ref("pick"), ". Assign the tool to a hotbar slot in Inventory and press its number to equip it."],
        ["Spend your first level-up point in Stats. Use Engrams to unlock more recipes. Follow ", guide("Gathering and crafting", "gathering-and-crafting"), " for the next tools, and ", guide("Building a base", "building-a-base"), " to set a respawn point."],
      ] },
    ],
  },
  {
    slug: "gathering-and-crafting",
    title: "Gathering and crafting",
    summary: "Choose the right gathering tool and work up to a crafting station.",
    sections: [
      { id: "pick-and-chop", title: "Use the right tool", steps: [
        ["Pick plants with E for materials such as ", ref("fiber"), ". Use a ", ref("pick"), " on a ", ref("rock"), " for stone and flint. A ", ref("hatchet"), " harvests wood and thatch from trees more efficiently than bare hands."],
        ["Open the ", link("resource directory", "resources/"), " to look up which tools work on a node and what each hit gives. Follow its map links to find it in your city."],
      ] },
      { id: "learn-and-make", title: "Learn a recipe and craft it", steps: [
        ["Open Character with P. Spend your engram points in Engrams, then open Make. An ", link("engram's level and cost", "engrams/"), " tell you when you can learn it. Its item page lists the ingredients and, where needed, the crafting station."],
        ["Bring ingredients to the station named in the recipe and transfer them into its inventory. Select the recipe at the station. If the recipe says the fire makes it, add fuel and light the station to start it."],
      ] },
      { id: "cook-and-smelt", title: "Cook food and smelt metal", steps: [
        ["Put ", ref("meat"), " and a fuel such as ", ref("wood"), " into a ", ref("piece_campfire"), ". Light the fire and leave it running until the meat cooks."],
        ["Gather ore with a pick from a ", ref("metal_rock"), ", smelt it in a ", ref("piece_forge"), " and use the ingots for recipes at a ", ref("piece_smithy"), "."],
      ] },
    ],
  },
  {
    slug: "building-a-base",
    title: "Building a base",
    summary: "Snap together a first shelter and place storage and a bed.",
    sections: [
      { id: "start-with-a-foundation", title: "Start with a foundation", steps: [
        ["Find clear ground near resources. Learn and make a ", ref("piece_foundation_thatch"), ", put it on your hotbar and select it to open the building preview. Aim at the ground, rotate with E and click to place."],
        ["Aim near an edge of the existing foundation to snap the next piece alongside it. Tap Q to cycle snap points or hold Q to toggle free placement. The ", link("building controls", "controls/#build"), " list the other preview controls."],
      ] },
      { id: "close-off-the-shelter", title: "Close off the shelter", steps: [
        ["Snap ", ref("piece_wall_thatch"), " pieces to the foundation. While previewing a wall, press R to cycle its variants and choose a doorway. Fit a ", ref("piece_door_thatch"), " in the doorway and place ", ref("piece_ceiling_thatch"), " above the walls."],
        ["Hold E on one of your structures to see its actions. Pieces need support. Taking out the base of a wall can bring the pieces it supports down with it."],
      ] },
      { id: "store-and-respawn", title: "Store supplies and choose where to respawn", steps: [
        ["Place a ", ref("piece_storage_box"), " for supplies. A ", ref("piece_sleeping_bag"), " gives the survivor who placed it a single respawn. Place a ", ref("piece_bed"), " on a floor for a reusable respawn point with a cooldown."],
      ] },
    ],
  },
  {
    slug: "taming-and-riding",
    title: "Taming and riding",
    summary: "Knock out a creature, keep it down and fit it with a saddle.",
    sections: [
      { id: "prepare", title: "Prepare food and equipment", steps: [
        ["Start with a passive creature such as the ", ref("dodo"), ". On its page, check where it lives and enter its wild level under Taming to estimate the food, time and doses your server requires."],
        ["Bring the food listed for that species, and pack ", ref("narcoberry"), " or ", ref("narcotic"), " if you need to keep it down. A ", ref("slingshot"), " works at a distance. A ", ref("club"), " builds torpor up close."],
      ] },
      { id: "knock-out-and-feed", title: "Knock it out and feed it", steps: [
        ["Stop hitting when the creature falls unconscious. Look at it, press F to open its inventory and transfer the food. It eats from its inventory as it gets hungry."],
        ["Watch the torpor in its inventory. To keep the creature unconscious, transfer a dose into its inventory and right-click the dose there to use it on the creature."],
      ] },
      { id: "fit-a-saddle", title: "Fit a saddle and mount up", steps: [
        ["For a rideable tame, make its matching saddle, such as a ", ref("saddle_raptor"), " for a ", ref("raptor"), ". Transfer the saddle into the grown creature's inventory and use it there to equip it. Press E while looking at the saddled creature to mount."],
        ["Use the creature inventory to set Follow, Stay or a combat stance. See ", link("flight controls", "controls/#flight"), " if you ride a ", ref("pteranodon"), "."],
      ] },
    ],
  },
  {
    slug: "breeding",
    title: "Breeding",
    summary: "Pair two adults, hatch a fertilized egg and feed the young.",
    sections: [
      { id: "choose-a-pair", title: "Pair two adults", steps: [
        ["Bring an adult male and an adult female of the same species and tribe close together. Check that the species breeds, then open each creature's inventory and turn on Mating. Set both to stay and keep them close until mating finishes."],
        ["The mother rests between matings. The creature's page shows incubation and maturation times for the world you're reading about."],
      ] },
      { id: "hatch-the-egg", title: "Hatch the egg", steps: [
        ["A fertilized egg begins incubating on the ground. Leave it there to hatch. Picking it up pauses incubation. Select it in Inventory and use Drop to set it down again."],
        ["Look at the hatchling and press E to claim it. Give it a name and put suitable food in its inventory."],
      ] },
      { id: "raise-the-young", title: "Raise and feed the young", steps: [
        ["Check the young creature's food and growth in its inventory until it matures. Keep food on hand while it's growing. A young creature can't wear a saddle."],
        ["The young inherits its base stats from its parents. Mutations can change stats and colors. Levels spent on a parent after taming don't pass down."],
      ] },
    ],
  },
];
