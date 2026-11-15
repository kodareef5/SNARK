import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";

// The weapons program's thrown things: the explosives, the bola and later the clouds (planning/reference/weapons-plan.md,
// W4 to W6), with how each is made. The grenade moved here from content/core.ts unchanged by W0: it still does 788 to bodies and structures
// alike, ARK's figure against wood, until W6 gives it ARK's 175 to bodies and a structure factor of 4.5. Its live prop
// (core:grenade_live) stays in content/core.ts with the other projectile props.

const id = (name: string): string => `core:${name}`;

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
];
