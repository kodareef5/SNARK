// Items: anything that is carried. What a weapon or a round has besides is in weapons.ts.

import { TICK_RATE } from "../../coords.ts";
import { GAME_HOUR_TICKS } from "../../sim/lazy.ts";
import { validateSeats, type Seat } from "../../sim/seats.ts";
import type { StatName } from "../../sim/genome.ts";
import type { Content } from "../defs.ts";
import { f, f32, i8, icon, list, mesh, row, stub, u16, u32, u8, type Fields, type Kind, type Named } from "../kind.ts";
import { MAX_BURN_SECONDS } from "./stations.ts";
import { WEAPON_FIELDS, ammoFaults, weaponFaults, type WeaponFields } from "./weapons.ts";

/** The most an optic may magnify (OpticFacet): the Meridian visor's digital zoom is the far end (D1076). */
export const MAX_ZOOM = 2000;
/** The longest an item may keep before it spoils, in game hours. The spoil clock holds this with room to spare. */
export const MAX_SPOIL_HOURS = 1e6;
/** The stats a use may change at once, and the ones it may change over time, which buffs carry (server/use.ts). */
export const USE_AT_ONCE: readonly string[] = ["health", "stamina", "oxygen", "food", "water", "torpidity"];
export const USE_OVER_TIME: readonly string[] = ["health", "torpidity"];
export const WEAR_SLOTS: readonly string[] = ["head", "torso", "hands", "legs", "feet"];

export interface ItemDef extends Named, WeaponFields {
  readonly type: "item";
  readonly class: "resource" | "consumable" | "weapon" | "ammo" | "attachment" | "armor" | "saddle" | "structure" | "vehicle" | "egg" | "feces" | "shield" | "costume" | "skin" | "dye" | "artifact" | "glider" | "ball" | "instrument";
  readonly id: string;
  /** Largest stack. 1 for things that carry their own quality and durability. */
  readonly stack: number;
  /** Kilograms each. Defaults to 0.1. */
  readonly weight?: number;
  /** In-game hours one lasts before it spoils. Omitted for things that keep. */
  readonly spoilHours?: number;
  /** In-game hours one lies on the ground before it is gone (the reference's "decomposes in"). Omitted, as long as any dropped stack. */
  readonly decomposeHours?: number;
  /** A young body gives this in place of the item named, as a young creature gives prime meat in place of meat. */
  readonly youngFor?: string;
  /** What eating one restores, in points. */
  readonly eat?: { readonly food?: number; readonly water?: number; readonly health?: number };
  /** Seconds one of it keeps a fire going. */
  readonly fuel?: number;
  /** When one piece of it has burnt out in a fire, the fire gets one of this, as wood leaves charcoal (M4); with no room it is lost. */
  readonly burnsInto?: string;
  /**
   * The species it fits, the armor it gives the creature that wears it (the reference's rating), and the seats it puts on
   * that creature (shared/sim/seats.ts): the rider's, who steers, and any passengers'. Each names the socket of the
   * creature's rig it moves with, and its anchor is that socket at rest.
   */
  readonly saddle?: { readonly fits: string; readonly armor: number; readonly seats: readonly Seat[] };
  /** Fed to an unconscious creature, it adds this much torpor over this many seconds. */
  readonly dose?: { readonly torpor: number; readonly seconds: number };
  /** Over a fire it becomes `into` after `seconds`. */
  readonly cooks?: { readonly into: string; readonly seconds: number };
  /** Name shown in the interface. Defaults to the id without its namespace. */
  readonly label?: string;
  /** Palette index of its swatch in the interface. */
  readonly color?: number;
  /** What it works on ("wood", "stone"), how many times stronger than bare hands it is, and how many uses it lasts. */
  readonly tool?: { readonly on: string; readonly power: number; readonly uses: number };
  readonly wear?: WearFacet;
  /**
   * A weapon lists the attachment items it takes in `fits`. What each does (planning/reference/weapons-plan.md, M10): a
   * scope zooms about 3 times with a reticle and sways the weapons that sway; a holo-scope zooms about 1.25 times with a
   * night tint and a crosshair coloured by what it is on (its view is built; no item is one until the fabricator's wave);
   * a silencer hides the shot's flash and, from a survivor it hits, its side; a light and a laser are switched on and off
   * (FLAG_ON), the laser drawing a dot where the weapon points and the light waiting for local lights (D436).
   */
  readonly attachment?: "scope" | "silencer" | "light" | "laser" | "holo";
  /** A sight, glass or visor looked through: how many times it magnifies the view (OpticFacet, D1076). */
  readonly optic?: OpticFacet;
  /** The structures it may be set down as. The first is the usual form. The rest are other forms (a wall as a doorframe), chosen as it is placed. */
  readonly places?: readonly string[];
  /** A completed vehicle assembly. Deployment consumes one only after the named vehicle fits on a supporting surface. */
  readonly deploys?: string;
  /** How it is made. An item without this cannot be crafted. */
  readonly craft?: CraftFacet;
  // Stubs, read by nothing yet.
  readonly description?: string;
  /** Where it sits in the inventory and crafting lists: "Structures/Wood". */
  readonly folder?: string;
  /** The item a spoiled one becomes, one for one, as ARK's meat becomes spoiled meat (server/items.ts). Omitted, it is gone. */
  readonly spoilsInto?: string;
  /**
   * Whether it may be a blueprint: a slot flagged FLAG_BLUEPRINT (shared/sim/items.ts) that crafts it at the blueprint's
   * quality, from the blueprint's own ingredients, with no engram and at any level, as often as wanted, and is never used up
   * (ark.wiki.gg Blueprint, 2026-11-15: unlimited uses, except ARK's fishing rod and Tek blueprints, 3 each). Omitted, an
   * item that is crafted may be one; false keeps it from ever being one; only an item with `craft` may be.
   */
  readonly blueprint?: boolean;
  /** What using one does beyond what eating gives (planning/reference/items-plan.md, task C). */
  readonly use?: UseFacet;
  /** A glider, flown from anywhere in the bag (planning/workstreams/glider.md). */
  readonly glide?: GlideFacet;
  /**
   * A soul ball (planning/workstreams/soul-ball.md): on the empty one, `full` names the item it becomes when a tame is
   * kept in it; on the full one, `empty` names the item it is again once the tame is loosed or lost. A full one stands
   * for its tame's record (Inventory.ref) and stacks to 1.
   */
  readonly ball?: { readonly full?: string; readonly empty?: string };
  /**
   * Its spoil clock is a charge: where it lies does not stretch it (a structure's `keeps`), a structure that `charges`
   * holds it full, and taken out of one it runs down from full. Only an item that spoils and stacks to 1 has one.
   */
  readonly charge?: boolean;
  /**
   * False for a thing that may not leave its server, as ARK's Element, tributes and boss trophies may not: a survivor carrying
   * one is refused travel until it puts it down (ark.wiki.gg CrossARK Transfers, 2026-11-15). Omitted, it travels.
   */
  readonly travels?: boolean;
}

/**
 * What using an item does to the body that uses it, as ARK's UseItemAddCharacterStatusValues and the buffs a consumable gives
 * (server/use.ts). Using one burns it, after what eating it gives, unless it is a vessel, which is kept.
 */
export interface UseFacet {
  /**
   * A stat changed by `amount`: at once (health, stamina, oxygen, food, water, torpidity), or spread over `seconds`
   * (health and torpidity only, and only adding, carried by a buff as a meal's health and a dose's torpor are).
   */
  readonly adds?: readonly { readonly stat: StatName; readonly amount: number; readonly seconds?: number }[];
  /** Buffs given on use. */
  readonly buffs?: readonly string[];
  /**
   * A vessel that holds water: `water` points when full, `each` drunk a use, filled again by a use while standing in water
   * and not swimming. It stacks to 1 and holds its water as the slot's durability. Made, it is empty.
   */
  readonly holds?: { readonly water: number; readonly each: number };
}

/**
 * A glider (planning/workstreams/glider.md), which stands where ARK's Parachute does and flies as no parachute does. The
 * best serviceable one a survivor carries, anywhere in its inventory, is the one it flies: opened in the air with Crouch, or
 * with Jump out of the cuirass, and flown by the numbers of its grade (shared/sim/character.ts). It wears as it is flown
 * and is charged as it folds, never in the air: one use for each `seconds` it was open, and at least one a flight.
 */
export interface GlideFacet {
  /** 1 to 3. Only 1, the frond glider's, has numbers today. */
  readonly grade: number;
  readonly uses: number;
  readonly seconds: number;
}

/**
 * What looking through an item does to the view (client/core/optics.ts): the view narrows on the tangent of its half,
 * `min` times at first, as far as `max` for one that zooms. A fixed sight gives `min` alone. `steps`, inside the two in
 * order, are the magnifications one that clicks stops at; one with none zooms smoothly.
 */
export interface OpticFacet {
  readonly min: number;
  readonly max?: number;
  readonly steps?: readonly number[];
  /**
   * The share of the screen's height its window spans at its least zoom and at its most, tightening between them; the
   * rest is masked and not drawn (D1077). A whole height, [1, 1], where it gives none.
   */
  readonly window?: readonly [number, number];
  /** One round lens, two merged side by side, or a visor's wide window. Round where it gives none. */
  readonly shape?: "round" | "twin" | "visor";
  /** A scope's reticle: the German post (the default), or lines marked in milliradians that grow with the zoom (D1083). */
  readonly reticle?: "post" | "mil";
}

/** How an item is made. ARK keeps this on the item too. */
export interface CraftFacet {
  /** What one crafting uses up. */
  readonly needs: readonly { readonly item: string; readonly count: number }[];
  /** Seconds to make one. */
  readonly seconds: number;
  readonly xp: number;
  /** How many one crafting makes. One, where not given. */
  readonly count?: number;
  /**
   * The station it is made at: only there, from what lies in the station, and the product lands there. Omitted, it is made
   * in the hands from the survivor's own inventory.
   */
  readonly at?: string;
  /** The level below which it cannot be made, engram or no. */
  readonly level?: number;
  /**
   * Made by the fire it is `at` while that burns and its ingredients lie in it, with no job, engram or experience
   * (planning/reference/stations-plan.md, M3). Only at a station that `lights`.
   */
  readonly fired?: boolean;
}

export interface WearFacet {
  /** A closed helmet includes its own neck seal and conceals the face and beard while its mesh is loaded. */
  readonly sealed?: boolean;
  /** Optional artwork deployed by an airborne torso piece, under the same fitted model directory. */
  readonly vents?: string;
  readonly slot: "head" | "torso" | "hands" | "legs" | "feet";
  /** Armor rating at primitive quality. Damage is multiplied by 100 / (100 + armor). */
  readonly armor: number;
  /** Durability at primitive quality. */
  readonly uses: number;
  /** Mesh set drawn in place of the body's slot. Its meshes are "<body>/armor/<set>/<slot>". */
  readonly set: string;
  /** Palette colours of its three colour regions: main, second, trim. */
  readonly colors: readonly [number, number, number];
  /** A piece of a flight suit: worn and not worn out, it lends its slot's part of flight (shared/sim/character.ts). */
  readonly jet?: boolean;
}

const FIELDS = {
  stack: f("number", "MaxItemQuantity"),
  weight: f("number", "BaseItemWeight"),
  spoilHours: f("number", "SpoilingTime"),
  decomposeHours: f("number", "the time a dropped item decomposes in"),
  youngFor: f("text", "prime meat from the young in place of raw meat", { refs: { "": "item" } }),
  eat: f("facet", "UseItemAddCharacterStatusValues"),
  fuel: f("number"),
  // The stations wave's (planning/reference/stations-plan.md, S0, read since S1): what a piece of fuel leaves when it burns out.
  burnsInto: f("text", "the charcoal a fire leaves for each piece of wood burnt out", { refs: { "": "item" } }),
  saddle: f("facet", "equipment type DinoSaddle", { refs: { fits: "species/creature" } }),
  dose: f("facet", "UseItemAddCharacterStatusValues"),
  cooks: f("facet", "", { refs: { into: "item" } }),
  label: f("text", "DescriptiveNameBase"),
  color: f("number"),
  tool: f("facet"),
  ...WEAPON_FIELDS,
  wear: f("facet", "equipment type and ItemStatInfos"),
  attachment: f("text", "item type WeaponAttachment"),
  optic: f("facet", "the scope's zoom (ScopeOverlay, FOV)"),
  places: f("list", "StructureToBuild", { refs: { "[]": "structure" }, open: true }),
  deploys: f("text", "the vehicle an assembly deploys", { refs: { "": "species/vehicle" } }),
  craft: f("facet", "BaseCraftingResourceRequirements, BlueprintTimeToCraft, BaseCraftingXP", { refs: { "needs[].item": "item", at: "structure/station" } }),
  description: stub("polish", "text", "ItemDescription"),
  folder: stub("polish", "text", "DefaultFolderPaths"),
  spoilsInto: f("text", "SpoilingItem", { refs: { "": "item" } }),
  blueprint: f("switch", "whether it may be a blueprint (a crafted item may, unless false)"),
  use: f("facet", "UseItemAddCharacterStatusValues and the buffs a consumable gives", { refs: { "buffs[]": "buff" } }),
  glide: f("facet", "none of its own: the Parachute's slow fall and the Glider Suit's glide, as one thing carried"),
  ball: f("facet", "PrimalItem_WeaponEmptyCryopod and the creature it holds", { refs: { full: "item", empty: "item" } }),
  charge: f("switch", "a cryopod's charge, which only a powered cryofridge holds"),
  travels: f("switch", "bPreventUpload, inverted"),
} satisfies Fields<ItemDef>;

const ITEM_SLOTS = { icon, dropped: mesh("may", "{id}/dropped", "core:bag") };
/**
 * An item in the hand that is not a weapon (whose held mesh is its `weapon.mesh`): a pieces asset's held piece, named for
 * its item (tools/art/build.ts, heldOn). ARK holds a shield in the other hand; anything else on the hotbar is taken in
 * hand here when chosen (CMD_SELECT), so a food, a drink or an egg chosen shows in the hand when it has a piece.
 */
const HELD = mesh("may", "{id}", "none");
const ANY_ITEM = ["weight", "label", "color", "craft", "description", "folder", "blueprint", "decomposeHours", "travels"] as const;

/** Every definition by its id. */
const defsById = (input: readonly Content[]): Map<string, Content> => new Map(input.map((d) => [d.id, d]));
/** The item given in place of each, of those met so far (ItemDef.youngFor). */
const youngItems = (): Map<string, string> => new Map();

const columns = (n: number) => ({
  /** Item columns, zero for content that is not an item. See shared/sim/items.ts. */
  stack: u16(n),
  weight: f32(n),
  spoilTicks: u32(n),
  /** Per item: 1 where its spoil clock is a charge (ItemDef.charge). A structure that holds one full has `charges`. */
  charge: u8(n),
  /**
   * Soul balls (ItemDef.ball): per item, the item an empty one becomes when it holds a tame, and the item a full one is
   * again when it holds none. 0 for anything else.
   */
  ballFull: u16(n),
  ballEmpty: u16(n),
  /** The armor slot an item is worn in (0 head, 1 torso, 2 hands, 3 legs, 4 feet), or -1. */
  wearSlot: i8(n, -1),
  /** Per item: 1 for a worn piece that flies (WearFacet.jet). */
  wearJet: u8(n),
  /** Per item: a glider's grade, 0 for anything else, and the ticks in the air that cost it one use (GlideFacet). */
  glide: u8(n),
  glideTicks: u32(n),
  /** Uses a tool, weapon or worn piece has at primitive quality. 0 for things that do not wear out. */
  uses: u16(n),
  /** Armor rating of a worn piece at primitive quality. */
  armor: f32(n),
  /** Per placeable item: the structures it may be set down as, the usual one first. Null for everything else. */
  places: list<Uint16Array>(n),
  /** Per assembly item: deployed vehicle kind, or 0. */
  vehicleDeploy: u16(n),
  /** Per item: the species it is a saddle for (0 if it is no saddle), and the armor it gives. */
  saddleFits: u16(n),
  saddleArmor: f32(n),
  /** Per item: the seats a saddle puts on the creature that wears it, or null for an item that is no saddle. */
  saddleSeats: list<readonly Seat[]>(n),
  /** Per item: the torpor a dose gives and the seconds it takes (0 if it is no dose). */
  doseTorpor: f32(n),
  doseSeconds: f32(n),
  /** Per item: the ticks one burns (0 if it is no fuel), what it becomes over a fire (0 for nothing), and the ticks that takes. */
  fuelTicks: u32(n),
  cooksInto: u16(n),
  cookTicks: u32(n),
  /** Per item: what it becomes when it spoils (ItemDef.spoilsInto), or 0 for nothing. */
  spoilsInto: u16(n),
  /** Per item that can be made: the ingredients as pairs of item and count, and how many one crafting makes. Null for everything else. */
  recipeOf: list<Uint16Array>(n),
  recipeMakes: u16(n),
  /** Per item: the station it is made at (a structure's content index), or 0 for one made in the hands. */
  craftAt: u16(n),
  /** Per item: 1 if it may be a blueprint (ItemDef.blueprint), which takes a craft facet. */
  blueprints: u8(n),
  /**
   * Per item: the ticks one lies on the ground before it is gone, or 0 for as long as any dropped stack; and what a young
   * body gives in its place (0 for itself).
   */
  decomposeTicks: u32(n),
  youngItem: u16(n),
  /** Per item: what one piece leaves in the fire when it has burnt out (0 for nothing). */
  burnsInto: u16(n),
});

export const items: Kind<ItemDef, ReturnType<typeof columns>> = {
  type: "item",
  fields: FIELDS,
  rows: [
    row("item", "item", FIELDS, { abstract: true, ark: "PrimalItem", shelf: "items", doc: "Anything that is carried." }),
    row("item/resource", "item", FIELDS, { parent: "item", ark: "PrimalItemResource_", shelf: "items/resources", must: ["stack"], may: [...ANY_ITEM, "fuel", "burnsInto", "spoilHours", "spoilsInto", "youngFor", "ammo"], slots: { shot: { ...mesh("may", "{ammo.mesh}", "core:tracer"), when: "ammo" }, ...ITEM_SLOTS }, doc: "A material: gathered, stacked, and spent in crafting. One a weapon fires, as a slingshot fires stone, has an ammo facet." }),
    row("item/consumable", "item", FIELDS, { parent: "item", ark: "PrimalItemConsumable_", shelf: "items/consumables", must: ["stack"], may: [...ANY_ITEM, "eat", "dose", "spoilHours", "spoilsInto", "cooks", "fuel", "burnsInto", "youngFor", "use"], any: ["eat", "dose", "use"], slots: { held: HELD, ...ITEM_SLOTS }, doc: "Something eaten, drunk or fed for what it does to a body." }),
    row("item/weapon", "item", FIELDS, { parent: "item", ark: "PrimalItem_Weapon", shelf: "items/weapons", must: ["stack", "weapon"], may: [...ANY_ITEM, "tool", "ammo", "optic"], slots: { held: mesh("must", "{weapon.mesh}", "none"), shot: { ...mesh("may", "{ammo.mesh}", "core:tracer"), when: "ammo" }, ...ITEM_SLOTS }, doc: "Held in the hand to strike, shoot or throw. A hatchet or pick is a weapon that is also a tool. A thrown one with an ammo facet of its own flies and hits as an arrow does (the bola)." }),
    row("item/ball", "item", FIELDS, { parent: "item/weapon", ark: "PrimalItem_WeaponEmptyCryopod", shelf: "items/balls", must: ["stack", "weapon", "ball"], may: [...ANY_ITEM, "spoilHours", "spoilsInto", "charge"], slots: { held: mesh("must", "{weapon.mesh}", "none"), ...ITEM_SLOTS }, doc: "Held in the hand: a click keeps the tame looked at in it, or looses the one it holds." }),
    row("item/ammo", "item", FIELDS, { parent: "item", ark: "PrimalItemAmmo_", shelf: "items/ammo", must: ["stack", "ammo"], may: [...ANY_ITEM, "spoilHours", "spoilsInto"], slots: { shot: mesh("may", "{ammo.mesh}", "core:tracer"), ...ITEM_SLOTS }, doc: "What a bow or gun fires." }),
    row("item/attachment", "item", FIELDS, { parent: "item", ark: "item type WeaponAttachment", shelf: "items/attachments", must: ["stack", "attachment"], may: [...ANY_ITEM, "optic"], slots: ITEM_SLOTS, doc: "Fitted to a weapon that takes it. A sight has an optic facet: how many times it magnifies." }),
    row("item/equipment", "item", FIELDS, { parent: "item", abstract: true, ark: "item type Equipment", shelf: "items/equipment", doc: "Worn by a body, in a slot." }),
    row("item/armor", "item", FIELDS, { parent: "item/equipment", ark: "PrimalItemArmor_, hat to boots", shelf: "items/armor", must: ["stack", "wear"], may: [...ANY_ITEM, "optic"], slots: { worn: mesh("must", "{body}/armor/{wear.set}/{wear.slot}", "{body}/{wear.slot}"), vents: mesh("may", "{body}/armor/{wear.set}/{wear.vents}", "none"), ...ITEM_SLOTS }, doc: "A piece worn on the head, torso, hands, legs or feet." }),
    row("item/saddle", "item", FIELDS, { parent: "item/equipment", ark: "PrimalItemArmor_, DinoSaddle", shelf: "items/saddles", must: ["stack", "saddle"], may: ANY_ITEM, slots: { worn: mesh("may", "{id}/worn", "none"), ...ITEM_SLOTS }, doc: "Worn by a tamed creature so that it can be ridden. Drawn as its worn mesh on the creature's bones, unless the creature has a saddled model, which is drawn in place of both." }),
    row("item/structure", "item", FIELDS, { parent: "item", ark: "PrimalItemStructure_", shelf: "items/structures", must: ["stack", "places"], may: ANY_ITEM, slots: { preview: mesh("may", "{id}/preview", "#mesh"), ...ITEM_SLOTS }, doc: "Set down as a structure." }),
    row("item/vehicle", "item", FIELDS, { parent: "item", ark: "a deployable vehicle assembly", shelf: "items/vehicles", must: ["stack", "deploys"], may: ANY_ITEM, slots: { preview: mesh("may", "{deploys}", "box"), ...ITEM_SLOTS }, doc: "A completed assembly placed as a vehicle on a clear supporting surface." }),
    row("item/egg", "item", FIELDS, { parent: "item/consumable", ark: "PrimalItemConsumable_Egg_", shelf: "items/eggs", must: ["stack"], may: [...ANY_ITEM, "eat", "spoilHours", "spoilsInto"], slots: { held: HELD, ...ITEM_SLOTS }, doc: "An egg in the hand, eaten or set down. A fertilised one stacks to 1, keeps its young and does not hatch while held." }),
    row("item/feces", "item", FIELDS, { parent: "item/resource", ark: "the feces items, small to massive", shelf: "items/feces", must: ["stack"], may: [...ANY_ITEM, "spoilHours", "spoilsInto", "fuel"], slots: ITEM_SLOTS, doc: "What a creature leaves when it defecates, a size for each kind of creature." }),
    row("item/glider", "item", FIELDS, { parent: "item", ark: "PrimalItemConsumable_Parachute, and the Glider Suit skin", shelf: "items/gliders", must: ["stack", "glide"], may: ANY_ITEM, slots: { held: HELD, wing_r: mesh("may", "{id}/wing_r", "none"), wing_l: mesh("may", "{id}/wing_l", "none"), ...ITEM_SLOTS }, doc: "Carried anywhere in the bag, and opened in the air to glide: a wing for each hand, and folded in the hand when chosen." }),
    row("item/shield", "item", FIELDS, { parent: "item/equipment", ark: "equipment type Shield", status: "stub", waits: "cosmetics", shelf: "items/shields", must: ["stack"], may: ANY_ITEM, slots: { held: HELD, ...ITEM_SLOTS }, doc: "Held in the other hand to block." }),
    row("item/costume", "item", FIELDS, { parent: "item/equipment", ark: "equipment types Costume and Trophy", status: "stub", waits: "cosmetics", shelf: "items/costumes", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Worn for its look alone." }),
    row("item/skin", "item", FIELDS, { parent: "item", ark: "PrimalItemSkin_", status: "stub", waits: "cosmetics", shelf: "items/skins", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Changes the look of the item it is put on." }),
    row("item/dye", "item", FIELDS, { parent: "item", ark: "PrimalItemDye_", status: "stub", waits: "cosmetics", shelf: "items/dyes", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Colours a region of what it is used on." }),
    row("item/instrument", "item", FIELDS, { parent: "item", ark: "PrimalItem_WeaponSpyglass, _WeaponCompass, _WeaponGPS, _WeaponMagnifyingGlass, PrimalItemRadio", status: "partial", waits: "instruments", shelf: "items/instruments", must: ["stack"], may: [...ANY_ITEM, "optic"], slots: { held: HELD, ...ITEM_SLOTS }, doc: "Held to look through or to read. Blocked out: it is made, carried and dropped, and does nothing in the hand yet." }),
    row("item/artifact", "item", FIELDS, { parent: "item", ark: "PrimalItemArtifact_", status: "stub", waits: "bosses", shelf: "items/artifacts", must: ["stack"], may: ANY_ITEM, slots: ITEM_SLOTS, doc: "Found once in its place and spent to call a boss." }),
  ],
  check(d, cx) {
    const { errors, positive, once } = cx;
    if (!(Number.isInteger(d.stack) && d.stack >= 1 && d.stack <= 65535)) errors.push(`${d.id}: stack must be a whole number from 1 to 65535`);
    if (d.deploys !== undefined && (d.stack !== 1 || d.places !== undefined || d.weapon !== undefined || d.eat !== undefined)) errors.push(`${d.id}: a vehicle assembly stacks to 1 and has no other use`);
    if (d.craft) {
      if (d.craft.count !== undefined) positive(d, "craft.count", d.craft.count, 1000);
      positive(d, "craft.seconds", d.craft.seconds, 86400);
      if (!Array.isArray(d.craft.needs) || d.craft.needs.length === 0) errors.push(`${d.id}: craft needs at least one ingredient`);
      if (d.craft.level !== undefined) positive(d, "craft.level", d.craft.level, 1000);
    }
    if (d.weight !== undefined && !(d.weight >= 0)) errors.push(`${d.id}: weight must not be negative`);
    if (d.saddle) {
      try {
        validateSeats(d.saddle.seats, 0, "saddle");
      } catch (e) { errors.push(`${d.id}: ${(e as Error).message}`); }
    }
    if (d.optic) {
      // At least 1x, at most MAX_ZOOM; a zooming one's steps rise inside its range.
      const { min, max = min, steps = [] } = d.optic;
      if (!(min >= 1 && max >= min && max <= MAX_ZOOM)) errors.push(`${d.id}: optic must magnify from at least 1 to at most ${MAX_ZOOM}, min first`);
      if (steps.some((z, k) => !(z >= min && z <= max && (k === 0 || z > steps[k - 1]!)))) errors.push(`${d.id}: optic.steps must rise from optic.min to optic.max`);
      if (d.optic.window && !d.optic.window.every((w) => w > 0 && w <= 1)) errors.push(`${d.id}: optic.window must be two shares of the screen's height, above 0 and at most 1`);
    }
    if (d.fuel !== undefined) positive(d, "fuel", d.fuel, MAX_BURN_SECONDS);
    if (d.cooks !== undefined) positive(d, "cooks.seconds", d.cooks.seconds, MAX_BURN_SECONDS);
    if (d.spoilHours !== undefined && !(d.spoilHours > 0 && d.spoilHours <= MAX_SPOIL_HOURS)) errors.push(`${d.id}: spoilHours must be above 0 and at most ${MAX_SPOIL_HOURS}`);
    if (d.decomposeHours !== undefined && !(d.decomposeHours > 0 && d.decomposeHours <= MAX_SPOIL_HOURS)) errors.push(`${d.id}: decomposeHours must be above 0 and at most ${MAX_SPOIL_HOURS}`);
    // Anything that wears out, holds rounds or takes an attachment cannot stack.
    if ((d.weapon || d.wear || d.tool) && d.stack !== 1 && d.weapon?.kind !== "thrown") errors.push(`${d.id}: a tool, weapon or worn piece must have stack 1`);
    if (d.glide) {
      if (!(Number.isInteger(d.glide.grade) && d.glide.grade >= 1 && d.glide.grade <= 3)) errors.push(`${d.id}: glide.grade must be 1, 2 or 3`);
      positive(d, "glide.uses", d.glide.uses, 60000);
      positive(d, "glide.seconds", d.glide.seconds, 3600);
      // Its wear is the slot's durability, which one of a kind has.
      if (d.stack !== 1 || d.weapon || d.wear || d.tool || d.use?.holds) errors.push(`${d.id}: a glider stacks to 1 and wears no other durability`);
    }
    if (d.charge && (d.spoilHours === undefined || d.stack !== 1)) errors.push(`${d.id}: only an item that spoils and stacks to 1 has a charge`);
    if (d.ball) {
      // An empty ball names its full form and a full one its empty, and each is the other's.
      const other = d.ball.full ?? d.ball.empty;
      const o = other === undefined ? undefined : once(defsById).get(other);
      if ((d.ball.full === undefined) === (d.ball.empty === undefined)) errors.push(`${d.id}: a ball names its full item or its empty one, and not both`);
      else if (o?.type !== "item" || !o.ball || (d.ball.full !== undefined ? o.ball.empty : o.ball.full) !== d.id) errors.push(`${d.id}: ${other} is not the ball that names it back`);
      if (d.stack !== 1 || d.weapon?.kind !== "thrown") errors.push(`${d.id}: a ball stacks to 1 and is thrown`);
      if (d.ball.empty !== undefined && (!d.charge || d.spoilsInto !== d.ball.empty || d.craft)) errors.push(`${d.id}: a full ball has a charge, spoils into its empty item and is never made`);
    }
    weaponFaults(d, cx);
    if (d.wear) {
      if (!WEAR_SLOTS.includes(d.wear.slot)) errors.push(`${d.id}: wear.slot must be one of ${WEAR_SLOTS.join(", ")}`);
      if (!(d.wear.armor >= 0)) errors.push(`${d.id}: wear.armor must not be negative`);
      positive(d, "wear.uses", d.wear.uses, 60000);
    }
    if (d.spoilsInto !== undefined && (d.spoilsInto === d.id || d.spoilHours === undefined)) errors.push(`${d.id}: spoilsInto names another item, and only something that spoils has it`);
    // A blueprint crafts what it is of, so only an item that is crafted may be one.
    if (d.blueprint === true && !d.craft) errors.push(`${d.id}: only an item that is crafted may be a blueprint`);
    // What using one does (server/use.ts). Over time only health and torpor, which buffs carry; the rest at once.
    const use = d.use;
    for (const a of use?.adds ?? []) {
      const timed = a.seconds !== undefined;
      if (!(timed ? USE_OVER_TIME : USE_AT_ONCE).includes(a.stat)) errors.push(`${d.id}: use.adds may change ${(timed ? USE_OVER_TIME : USE_AT_ONCE).join(", ")}${timed ? " over time" : ""}, not "${a.stat}"`);
      if (!(Number.isFinite(a.amount) && a.amount !== 0 && (!timed || a.amount > 0))) errors.push(`${d.id}: use.adds amount must be a number other than 0, and above 0 over time`);
      if (timed) positive(d, "use.adds seconds", a.seconds!, MAX_BURN_SECONDS);
    }
    if (use?.holds) {
      positive(d, "use.holds.water", use.holds.water, 60000);
      positive(d, "use.holds.each", use.holds.each, use.holds.water);
      // The water is held as the slot's durability, which one of a kind has.
      if (d.stack !== 1 || d.eat || d.dose || d.weapon || d.wear || d.tool) errors.push(`${d.id}: a vessel stacks to 1, wears no durability of its own, and is drunk from, not eaten`);
    }
  },
  among(d, cx) {
    const { errors, once } = cx;
    if (d.places && d.places.length === 0) errors.push(`${d.id}: places must name at least one structure`);
    ammoFaults(d, cx);
    if (d.youngFor !== undefined) {
      const young = once(youngItems);
      const other = young.get(d.youngFor);
      if (other !== undefined) errors.push(`${d.id}: ${other} is already given in place of "${d.youngFor}"`);
      young.set(d.youngFor, d.id);
    }
  },
  columns,
  fill(d, i, reg) {
    reg.stack[i] = d.stack;
    reg.weight[i] = d.weight ?? 0.1;
    // At least 1 tick, because 0 means the item never spoils.
    reg.spoilTicks[i] = d.spoilHours !== undefined ? Math.max(1, Math.round(d.spoilHours * GAME_HOUR_TICKS)) : 0;
    reg.decomposeTicks[i] = d.decomposeHours !== undefined ? Math.max(1, Math.round(d.decomposeHours * GAME_HOUR_TICKS)) : 0;
    if (d.charge) reg.charge[i] = 1;
    if (d.wear) reg.wearSlot[i] = WEAR_SLOTS.indexOf(d.wear.slot);
    if (d.wear?.jet) reg.wearJet[i] = 1;
    reg.uses[i] = d.wear?.uses ?? d.weapon?.uses ?? d.tool?.uses ?? d.glide?.uses ?? 0;
    if (d.glide) {
      reg.glide[i] = d.glide.grade;
      reg.glideTicks[i] = Math.max(1, Math.round(d.glide.seconds * TICK_RATE));
    }
    reg.armor[i] = d.wear?.armor ?? 0;
  },
  link(d, i, reg) {
    if (d.places) {
      reg.places[i] = Uint16Array.from(d.places, (id) => reg.index.get(id)!);
      // Every form of a piece maps back to the one item.
      for (const s of reg.places[i]!) if (reg.pieceItem[s] === 0) reg.pieceItem[s] = i;
    }
    if (d.youngFor !== undefined) reg.youngItem[reg.index.get(d.youngFor)!] = i;
    if (d.saddle) {
      reg.saddleFits[i] = reg.index.get(d.saddle.fits)!;
      reg.saddleArmor[i] = d.saddle.armor;
      reg.saddleSeats[i] = d.saddle.seats;
    }
    if (d.deploys !== undefined) reg.vehicleDeploy[i] = reg.index.get(d.deploys)!;
    if (d.dose) {
      reg.doseTorpor[i] = d.dose.torpor;
      reg.doseSeconds[i] = d.dose.seconds;
    }
    // At least 1 tick, because 0 means it is no fuel.
    reg.fuelTicks[i] = d.fuel !== undefined ? Math.max(1, Math.round(d.fuel * TICK_RATE)) : 0;
    if (d.cooks) {
      reg.cooksInto[i] = reg.index.get(d.cooks.into)!;
      reg.cookTicks[i] = Math.max(1, Math.round(d.cooks.seconds * TICK_RATE));
    }
    if (d.spoilsInto !== undefined) reg.spoilsInto[i] = reg.index.get(d.spoilsInto)!;
    if (d.ball?.full !== undefined) reg.ballFull[i] = reg.index.get(d.ball.full)!;
    if (d.ball?.empty !== undefined) reg.ballEmpty[i] = reg.index.get(d.ball.empty)!;
    if (d.burnsInto !== undefined) reg.burnsInto[i] = reg.index.get(d.burnsInto)!;
    if (d.craft) {
      reg.recipeOf[reg.index.get(d.id)!] = Uint16Array.from(d.craft.needs.flatMap((need) => [reg.index.get(need.item)!, need.count]));
      reg.recipeMakes[reg.index.get(d.id)!] = d.craft.count ?? 1;
      if (d.craft.at !== undefined) reg.craftAt[reg.index.get(d.id)!] = reg.index.get(d.craft.at)!;
      // What a fire makes by itself is made from no blueprint.
      if (d.blueprint !== false && !d.craft.fired) reg.blueprints[reg.index.get(d.id)!] = 1;
    }
  },
};
