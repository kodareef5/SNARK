// The tools as a client lists them: what each takes, what it answers and how it behaves. agent/tools.ts carries them out.

import { MAX_CHAT_CHARS, MAX_NAME_BYTES } from "../shared/net/protocol.ts";
import type { ToolAnnotations, ToolDef } from "./mcp.ts";

export const INSTRUCTIONS =
  "You play one survivor in SNARK, a survival game, through these tools. You can do what a player can and no more. " +
  "Places are x and z in metres (north is +z, east is -x), or lat and lon as the map screen gives them, a unit 102.4 m. Things have ids from observe: n12.3 a tree, rock or bush, s65539 something built, e7 a creature, a player, a car, a dead body, an egg or a bag. " +
  "Every answer has a state: done, running (still going; status waits for it), blocked (it stopped short, and reason says why), danger (it stopped because you are in danger) or refused (nothing was done). " +
  "go_to, harvest, attack, open, craft at a station, place, mount, structure and use_item on a creature take time, and only one of them runs at once. An answer lists dangers while there are any. " +
  "Read snark://guide for taming, riding, flying, driving, building, stations and shooting, and snark://recipes for what is made of what.";

const STATES = ["done", "running", "blocked", "danger", "refused"];
const wait = (seconds: number) => ({ type: "number", minimum: 0, maximum: 50, description: `Seconds to wait for it to finish before answering running. Default ${seconds}.` });
const thing = (what: string) => ({ type: "string", description: `${what}, by its id from observe.` });
const place = {
  x: { type: "number", description: "Metres. Give x and z, or lat and lon, or an id." },
  z: { type: "number" },
  lat: { type: "number", minimum: 0, description: "Latitude as the map screen gives it: units of 102.4 m south of the map's top, ten a sector." },
  lon: { type: "number", minimum: 0, description: "Longitude as the map screen gives it: units of 102.4 m east of the map's left side, ten a sector." },
};
const vitals = { type: "array", items: { type: "number" }, description: "[now, most]" };
const self = {
  type: "object",
  description: "You: where (x, z, y, lat, lon, floor), facing, vitals as [now, most], level, what is in hand, what you ride.",
  properties: { x: { type: "number" }, z: { type: "number" }, y: { type: "number" }, alive: { type: "boolean" }, health: vitals, food: vitals, water: vitals, oxygen: vitals, stamina: vitals },
};

/** An answer's schema: the state every answer has, and the fields this tool adds. */
function answer(fields: Record<string, unknown> = {}): ToolDef["outputSchema"] {
  return {
    type: "object",
    properties: {
      state: { type: "string", enum: STATES },
      reason: { type: "string", description: "Why it stopped short or was refused." },
      dangers: { type: "array", items: { type: "string" }, description: "What threatens you now." },
      task: { type: "string", description: "The task this answer is about." },
      ...fields,
    },
    required: ["state"],
  };
}

const LOOK: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const ACT: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const HARM: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

function tool(name: string, title: string, description: string, properties: Record<string, unknown>, required: string[], annotations: ToolAnnotations, fields: Record<string, unknown> = {}): ToolDef {
  return { name, title, description, inputSchema: { type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false }, outputSchema: answer(fields), annotations: { title, ...annotations } };
}

export const DEFS: ToolDef[] = [
  tool(
    "observe",
    "Look around",
    "A map of the floor you stand on in letters, north up, and the nearest things by kind with their ids: trees, rocks and bushes, boxes, stations, doors, beds, stairs, creatures, cars, bodies, eggs, players. At the usual size the answer is about 2 to 3 KB. In a building it shows your storey, and stairs that lead up or down.",
    {
      radius: { type: "number", minimum: 8, maximum: 96, description: "Metres each way. Default 32." },
      cell: { type: "integer", enum: [1, 2, 4], description: "Metres a letter covers. Default 2. A letter shows the most solid thing in its square, so a doorway may only show at 1. At 1 m it shows at most 32 m each way, and at 2 m at most 64." },
      list: { type: "integer", minimum: 1, maximum: 40, description: "The most things listed of each kind, nearest first, and half as many of each kind of tree, rock or plant. Default 10." },
    },
    [],
    LOOK,
    { self, legend: { type: "string" }, map: { type: "string" }, grid: { type: "array", items: { type: "string" } } },
  ),
  tool(
    "status",
    "How you are",
    "How you are and how the running task is doing: where you are, vitals, level and engram points, what you carry and wear, what you ride, the box, station or creature you have open (a station's fire and queue, a creature's taming and torpor), what you are making, and chat heard since you last asked. With no body, `choosing` lists where you may rise.",
    { wait_s: { ...wait(0), description: "Seconds to wait for the running task to end before answering. Default 0." } },
    [],
    LOOK,
    { self, inventory: { type: "array", description: "[slot, item, count, and uses left or rounds loaded]" }, worn: { type: "object" }, box: { type: "object" }, heard: { type: "array", items: { type: "string" } } },
  ),
  tool(
    "go_to",
    "Go somewhere",
    "Go to a place, or up to a thing, round whatever is in between: walking, climbing stairs and ramps, crossing bridges and swimming where it must. Riding a creature it rides; on a flyer it flies, over the skyline, and lands there; in a car it drives. It answers blocked with the reason when there is no way.",
    {
      ...place,
      id: thing("A thing to go up to"),
      y: { type: "number", description: "Metres up, to choose a storey of a building at x and z. Left out: the ground, or the thing's own floor." },
      within: { type: "number", minimum: 0.3, maximum: 50, description: "How near to come, in metres: to the place, or to the thing's side. Default 0.6, or 4 flying or driving." },
      run: { type: "boolean", description: "Sprint, which spends stamina. Default false." },
      swim: { type: "boolean", description: "Swim across water on the way where that is shorter. Default true." },
      fly: { type: "boolean", description: "On a flyer: false to walk it on the ground. Default true." },
      land: { type: "boolean", description: "Flying: false to stay in the air at the end. Default true." },
      wait_s: wait(25),
    },
    [],
    ACT,
    { left_m: { type: "number" }, at: { type: "array", items: { type: "number" } } },
  ),
  tool(
    "harvest",
    "Gather",
    "Gather from a tree, a rock or a bush, or a dead body: walk to it, then strike it, or pick it, until it is used up or you have enough. It stops after a minute.",
    {
      id: thing("A tree, rock, bush or dead body"),
      until: { type: "object", description: "Stop once this many more of an item are carried. Left out: when it is used up.", properties: { item: { type: "string" }, count: { type: "integer", minimum: 1 } }, required: ["item", "count"] },
      tool: { type: "string", description: "An item you carry to take in hand first, such as hatchet for wood or pick for stone." },
      wait_s: wait(25),
    },
    ["id"],
    HARM,
    { gathered: { type: "object", additionalProperties: { type: "integer" } } },
  ),
  tool(
    "attack",
    "Attack",
    "Fight a creature or a player: with a melee weapon or bare hands it walks up and strikes; with a bow, crossbow, slingshot or gun it loads ammunition you carry, keeps its distance, aims ahead of the target and shoots, reloading as it goes. It keeps after the target until it is gone from sight (dead, most often) or, with until out, knocked out and ready to tame. Riding, your mount bites. It stops after a minute, for a new danger, or when your health is under two thirds and still falling.",
    {
      id: thing("A creature or a player"),
      with: { type: "string", description: "A weapon you carry to take in hand first, such as club, bow or crossbow. Left out: what you hold, or bare hands." },
      ammo: { type: "string", description: "For a ranged weapon, the ammunition to load, such as tranquilizer arrow. Left out: what it holds, else the first it takes that you carry." },
      until: { description: "\"out\" for knocked out, \"dead\" (the default), or an item and a count to gather from the body.", oneOf: [{ type: "string", enum: ["out", "dead"] }, { type: "object", properties: { item: { type: "string" }, count: { type: "integer" } }, required: ["item", "count"] }] },
      wait_s: wait(25),
    },
    ["id"],
    HARM,
    { target: { type: "string" }, shots: { type: "integer" }, hits: { type: "integer" } },
  ),
  tool(
    "open",
    "Open",
    "Walk to a box, a bag, a station, a door or a creature and use it: a box, a bag or a station opens (what it holds is in the answer, and move_item moves things in and out); a door swings; a knocked-out creature or one of your tribe's opens its inventory, for feeding it to tame it or putting on a saddle. It shuts when you walk away.",
    { id: thing("A box, bag, station, door or creature"), pin: { type: "integer", minimum: 0, maximum: 9999, description: "The PIN of a locked thing that is not your tribe's." }, wait_s: wait(25) },
    ["id"],
    ACT,
    { box: { type: "object" }, station: { type: "object" }, creature: { type: "object" } },
  ),
  tool(
    "move_item",
    "Move items",
    "Move a stack between your inventory (self), the box, station or creature you have open (box), and the ground (ground, which drops it). Name the stack by its slot or by its item.",
    {
      from: { type: "string", enum: ["self", "box"] },
      slot: { type: "integer", minimum: 0, description: "The slot, as status lists it." },
      item: { type: "string", description: "Or the item: the first stack of it there." },
      to: { type: "string", enum: ["self", "box", "ground"] },
      to_slot: { type: "integer", minimum: 0, description: "Left out: onto a stack of the same item, else the first empty slot." },
      count: { type: "integer", minimum: 1, description: "Left out: the whole stack." },
    },
    ["from", "to"],
    ACT,
    { moved: { type: "string" }, to_slot: { type: "integer" }, left: { type: "integer" } },
  ),
  tool(
    "craft",
    "Craft",
    "Make an item you know the engram for: in your hands from what you carry, or at a station from what lies in it (give at, and it walks there and opens it). snark://recipes says what each takes and where.",
    {
      recipe: { type: "string", description: "The item, such as hatchet." },
      count: { type: "integer", minimum: 1, maximum: 100, description: "Default 1." },
      at: thing("The station to make it at"),
      learn: { type: "boolean", description: "Spend engram points to learn it first if you do not know it." },
      wait_s: wait(20),
    },
    ["recipe"],
    ACT,
    { item: { type: "string" }, made: { type: "integer" }, needs: { type: "object" } },
  ),
  tool(
    "use_item",
    "Use an item",
    "Use something you carry. Food is eaten; a water skin is drunk from, or filled standing in water; item water drinks from the lake or sea you stand or swim in; armour is worn; a weapon or tool is taken in hand; ammunition is loaded into the weapon in hand; a scope or other attachment goes on it. With on, a creature: food goes into a knocked-out creature's inventory for it to eat while it is tamed, a narcotic keeps it under, and a saddle is put on one of your tribe's.",
    {
      item: { type: "string", description: "The item, or water." },
      on: thing("A creature to use it on"),
      count: { type: "integer", minimum: 1, description: "With on: how many to give. Default all of the stack, or 1 for a narcotic." },
      wait_s: wait(25),
    },
    ["item"],
    ACT,
    { used: { type: "string" }, self },
  ),
  tool(
    "mount",
    "Get on or off",
    "Get on a saddled creature of your tribe, or into a car (the driver's seat if it is free): walk to it and get on. With off, get off or out. Once on, go_to rides, flies or drives, and attack fights from the saddle.",
    { id: thing("A saddled creature or a car"), off: { type: "boolean", description: "Get off what you ride." }, wait_s: wait(25) },
    [],
    ACT,
    { riding: { type: "string" } },
  ),
  tool(
    "carry",
    "Carry",
    "Pick up a small creature in your arms, or an egg into your inventory: walk to it and take it. With put, set down what you hold, or throw it where you look.",
    { id: thing("A small creature or an egg"), put: { type: "string", enum: ["down", "throw"] }, wait_s: wait(25) },
    [],
    ACT,
    { holding: { type: "string" }, took: { type: "string" } },
  ),
  tool(
    "order",
    "Order a tame",
    "Order a tamed creature of your tribe, or with no id every one within earshot, as a whistle does. Also: name it, land a flyer, take its saddle off, or spend one of its levels.",
    {
      id: thing("A creature of your tribe. Left out, or all: every one in earshot"),
      order: { type: "string", enum: ["follow", "stay", "wander", "passive", "neutral", "aggressive", "attack_my_target", "attack", "land", "mate", "no_mating", "unsaddle", "name", "level"], description: "attack needs a target; name a name; level a stat. wander, mate, no_mating, unsaddle, name and level need an id." },
      target: thing("For attack: the creature or player to go for"),
      name: { type: "string", maxLength: MAX_NAME_BYTES, description: `For name: at most ${MAX_NAME_BYTES} letters.` },
      stat: { type: "string", enum: ["health", "stamina", "oxygen", "food", "weight", "melee", "speed"], description: "For level." },
    },
    ["order"],
    ACT,
    { ordered: { type: "string" }, who: { type: "string" } },
  ),
  tool(
    "place",
    "Build",
    "Set down a building piece or a thing from what you carry. A foundation, or a thing that stands by itself (a bed, sleeping bag, box, campfire, station), goes on the ground at x and z, or on a floor of your tribe's with on. A wall, doorframe, ceiling, ramp, stairs or pillar joins a piece of your tribe's on one of its sides; a door goes into a doorframe. It walks near first, and answers the new piece's id.",
    {
      item: { type: "string", description: "What you carry to set down, such as wood foundation or wood wall." },
      ...place,
      on: thing("A piece of your tribe's to build on"),
      side: { type: "string", enum: ["north", "east", "south", "west", "top", "bottom"], description: "Which side of on: an edge for a wall or a foundation beside it, top for a ceiling over a wall's room or a wall on a wall. Left out: its only place, such as a door's in its frame, else top." },
      as: { type: "string", description: "Another form the item takes, such as doorframe or windowframe for a wall." },
      facing: { type: "number", minimum: 0, maximum: 360, description: "Degrees, for a piece on open ground. Default 0." },
      wait_s: wait(25),
    },
    ["item"],
    ACT,
    { placed: { type: "string" }, id: { type: "string" } },
  ),
  tool(
    "structure",
    "Act on something built",
    "Walk to something of your tribe's that is built and act on it: light or put out a fire or station; lock or unlock it, or set its PIN; pick it up into your inventory; demolish or repair it; name a bed; travel from a bed to another of your tribe's, leaving your body and all you carry there, and choose where to rise with rise.",
    {
      id: thing("Something built"),
      do: { type: "string", enum: ["light", "put_out", "lock", "unlock", "pin", "pick_up", "demolish", "repair", "name", "travel"] },
      pin: { type: "integer", minimum: 0, maximum: 9999, description: "For pin." },
      name: { type: "string", maxLength: MAX_NAME_BYTES, description: `For name: at most ${MAX_NAME_BYTES} letters.` },
      wait_s: wait(25),
    },
    ["id", "do"],
    HARM,
  ),
  tool("rise", "Rise", "While you have no body, after a death or travelling from a bed: rise at one of the places status lists under choosing, by its number or its name. A place that still waits refuses until it is ready.", { place: { description: "A number or a name from status's choosing.", oneOf: [{ type: "integer" }, { type: "string" }] } }, ["place"], ACT, { rose_at: { type: "string" } }),
  tool(
    "level_up",
    "Level up",
    "Spend one of your unspent level points on a stat of your own.",
    { stat: { type: "string", enum: ["health", "stamina", "oxygen", "food", "water", "weight", "melee", "speed", "fortitude", "crafting"] } },
    ["stat"],
    ACT,
  ),
  tool("say", "Chat", "Say a line of chat. Five at once, then one every two seconds.", { channel: { type: "string", enum: ["global", "local", "tribe"], description: "Everyone, those within 60 m, or your tribe." }, text: { type: "string", maxLength: MAX_CHAT_CHARS, description: `At most ${MAX_CHAT_CHARS} characters.` } }, ["channel", "text"], { ...ACT, openWorldHint: true }, { said: { type: "string" } }),
  tool("cancel", "Stop", "Stop the running task where it is.", {}, [], { ...ACT, idempotentHint: true }, { cancelled: { type: ["string", "null"] } }),
  tool("console", "Console", "Type a line at the server's console, as a player does with the backquote key. Most commands need admin rights.", { line: { type: "string" } }, ["line"], { ...ACT, destructiveHint: true, openWorldHint: true }, { lines: { type: "array", items: { type: "string" } } }),
];

/** The tools on offer. `console` is among them only if asked for. */
export function toolDefs(withConsole: boolean): ToolDef[] {
  return DEFS.filter((d) => withConsole || d.name !== "console");
}
