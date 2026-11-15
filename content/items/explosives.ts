import type { Def } from "../../shared/content/defs.ts";
import { crafting, making } from "../craft.ts";

// The weapons program's thrown things: the explosives, the bola and later the clouds (planning/reference/weapons-plan.md,
// W4 to W6), with how each is made. The grenade moved here from content/core.ts unchanged by W0: it still does 788 to bodies and structures
// alike, ARK's figure against wood, until W6 gives it ARK's 175 to bodies and a structure factor of 4.5. Its live prop
// (core:grenade_live) stays in content/core.ts with the other projectile props.

const id = (name: string): string => `core:${name}`;
const needs = (list: readonly (readonly [string, number])[]): { item: string; count: number }[] => list.map(([item, count]) => ({ item: id(item), count }));

export const EXPLOSIVES: readonly Def[] = [
  // ark.wiki.gg, Grenade, infobox and text, 2026-11-15: weight 0.5, stacksize 10; it "detonates 5 seconds after the pin is
  // pulled". Its damage and reach (175 within 6 m to bodies) are W6's, with the structure factor of D435; until then the
  // 788 within 5 m stands (DEV31).
  { type: "item", class: "weapon", id: id("grenade"), stack: 10, weight: 0.5, color: 7, weapon: { kind: "thrown", damage: 788, type: "explosive", speed: 18, fuse: 5, blast: 5, uses: 1, mesh: id("grenade"), hold: "tool" } },

  // From the same infobox on 2026-11-15: requiredlevel 38, engrampoints 20, the ingredients and the Crafting XP shown (its
  // craftingxp 11.4 times the global 4 of patches 253.0 and 313.5). Its 4 oil wait for oil (DEV140); it is made at the smithy,
  // not built (DEV136); the page gives no craftingtime (DEV135). The level, points and oil were in its revision of 2018 too.
  ...making("grenade", "Grenade", 38, 20, 1, 8, [["fiber", 15], ["stone", 20], ["gunpowder", 30], ["hide", 5], ["ingot", 2]], 45.6),

  // The bola (W4; ark.wiki.gg Bola, read 2026-11-15): thrown, not lobbed. Its ammo facet is its own, so it flies as an arrow
  // does and hits the first body or the world (M5). No harm, but a hit provokes as any does; stack 10, weight 0.5, single
  // use; made in the hand at level 9 for 8 points of 10 thatch, 3 stone, 15 fiber and 3 hide. "The minimum holding duration
  // is roughly 0.4 seconds" and "charging up the Bola will increase its velocity, but not its immobilization time": a
  // quarter of the 1.6 s draw is 0.4 s (DEV127), and the draw buys speed only. Its speed, the craft's 3 s and a miss being
  // lost are ours (DEV131). It is held and lies as `core:bola` (core:thrown, D445); in flight it is the thrown grenade's mesh
  // until that asset gives it a `core:bola_thrown`.
  {
    type: "item", class: "weapon", id: id("bola"), label: "snare stones", stack: 10, weight: 0.5, color: 15,
    weapon: { kind: "thrown", draw: 1.6, uses: 1, mesh: id("bola"), hold: "tool" },
    ammo: { damage: 0, type: "melee", speed: 28, gravity: 9.81, buff: id("entangled"), mesh: id("grenade_thrown") },
  },
  // Rooted 30 s, a survivor 25 s (Bola). The species are ARK's list by our ids (D434): of its 67 the Human, Dodo, Parasaur and
  // Raptor are ours, and the grazer, which is no ARK creature, is not on it. The rest, for when the other team adds them:
  // Achatina, Araneo, Archaeopteryx, Beelzebufo, Bulbdog, Castoroides, Compy, Daeodon, Deinonychus, Dilophosaur,
  // Dimorphodon, Diplocaulus, Direwolf, Dung Beetle, Equus, Featherlight, Glowbug, Glowtail, Hyaenodon, Ichthyornis,
  // Iguanodon, Jerboa, Jug Bug, Kairuku, Lymantria, Lystrosaurus, Megalania, Megaloceros, Mesopithecus, Microraptor,
  // Moschops, Otter, Oviraptor, Ovis, Pachy, Pegomastax, Pelagornis, Phiomia, Pteranodon, Pulmonoscorpius, Ravager,
  // Sabertooth, Shinehorn, Tapejara, Terror Bird, Troodon, Tropeognathus, Unicorn, Vulture, Yeti, and the page's event,
  // Tek, ghost and machine variants (Bunny and Party Dodo, Zomdodo, Tek Parasaur, Tek Raptor, Bulbdog Ghost, Direwolf
  // Ghost, Desert Titan Flock, Enforcer, Scout, Macrophage, Noglin).
  { type: "buff", id: id("entangled"), label: "Entangled", color: 15, seconds: 30, survivorSeconds: 25, root: true, only: [id("dodo"), id("parasaur"), id("raptor"), id("survivor")], after: id("entangle_spent") },
  // "A 10 second grace period after being released before a player can be Bola'd again" (patch 240.5): survivors only.
  { type: "buff", id: id("entangle_spent"), label: "Free of the snare", color: 15, seconds: 10, only: [id("survivor")] },
  ...making("bola", "Snare stones", 9, 8, 1, 3, [["thatch", 10], ["stone", 3], ["fiber", 15], ["hide", 3]]),

  // W5's clouds (server/clouds.ts, client/core/render/clouds.ts). Each grenade does no harm of its own and goes off on its
  // fuse into a cloud that stays where it went off.
  //
  // ark.wiki.gg/wiki/Smoke_Grenade (2026-11-15): "Instead of dealing damage", a cloud that obscures what is inside it for
  // "around 40 seconds", "a radius of roughly 3 foundations" (a foundation is 3 m: 9 m), and it does not hide its thrower
  // from wild creatures; a 5 s fuse; weighs 0.5, stacks to 10; level 24 for 18 points; craftingxp 11.35, shown times the
  // global 4 as the grenade's is (45.4); made in the inventory of 1 metal ingot, 10 charcoal, 2 wood, 6 hide, 3 flint, 15
  // fiber, 5 thatch and 5 sparkpowder, after Sparkpowder. Its height and its making time are on no page: 5 m, so it stands
  // over a survivor, and the grenade's 8 s. Charcoal waits for its item (items-ark.md), so the recipe leaves it out (DEV143).
  { type: "item", class: "weapon", id: id("grenade_smoke"), label: "smoke grenade", stack: 10, weight: 0.5, color: 2, weapon: { kind: "thrown", speed: 18, fuse: 5, uses: 1, mesh: id("grenade"), hold: "tool", cloud: { prop: id("cloud_smoke"), seconds: 40 } } },
  { type: "prop", class: "cloud", id: id("cloud_smoke"), mesh: "box", color: 2, radius: 9, height: 5 },
  crafting(id("grenade_smoke"), { needs: needs([["ingot", 1], ["wood", 2], ["hide", 6], ["flint", 3], ["fiber", 15], ["thatch", 5], ["sparkpowder", 5]]), seconds: 8, xp: 45.4 }),
  { type: "engram", id: id("engram-grenade_smoke"), label: "Smoke grenade", level: 24, cost: 18, item: id("grenade_smoke"), requires: [id("engram-sparkpowder")] },

  // ark.wiki.gg/wiki/Poison_Grenade (2026-11-15): narcotic gas that "rapidly increases the Torpor of enemy survivors";
  // "creatures are completely immune"; a 2.5 s fuse; in PvE only its thrower and the thrower's tribe (228.2); weighs 1.5,
  // stacks to 10; level 40 for 18 points; craftingxp 8.25 (33 shown); made at the fabricator of 10 narcotic, 14 charcoal, 5
  // metal ingot, 18 sparkpowder, 12 gunpowder, 5 crystal, 20 fiber and 5 flint, after the smoke grenade and the tripwire
  // narcotic trap. Its torpor, harm, time and reach are on no page (217.2 made it last 15% longer, 218.3 gave 25% more
  // torpor and 20% more reach): 25 torpor a second and no harm, 20 s, 6 m and 4 m high, chosen (DEV144). The gas mask that
  // stops it (Gas Mask) is not built. The fabricator is not built, so it is made in the hand; charcoal and crystal wait for their items (DEV143).
  { type: "item", class: "weapon", id: id("grenade_poison"), label: "poison grenade", stack: 10, weight: 1.5, color: 17, weapon: { kind: "thrown", speed: 18, fuse: 2.5, uses: 1, mesh: id("grenade"), hold: "tool", cloud: { prop: id("cloud_poison"), seconds: 20, buff: id("poisoned") } } },
  { type: "prop", class: "cloud", id: id("cloud_poison"), mesh: "box", color: 17, radius: 6, height: 4 },
  // Given for a little over half a second at a time by the cloud a survivor stands in (server/clouds.ts CLOUD_HOLD).
  { type: "buff", id: id("poisoned"), label: "Poisoned", color: 17, seconds: 0.7, torpor: 25 },
  crafting(id("grenade_poison"), { needs: needs([["narcotic", 10], ["ingot", 5], ["sparkpowder", 18], ["gunpowder", 12], ["fiber", 20], ["flint", 5]]), seconds: 8, xp: 33 }),
  { type: "engram", id: id("engram-grenade_poison"), label: "Poison grenade", level: 40, cost: 18, item: id("grenade_poison"), requires: [id("engram-grenade_smoke")] },
];
