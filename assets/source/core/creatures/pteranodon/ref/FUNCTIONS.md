# Pteranodon: function list

Everything ARK's pteranodon does in the game, and what ours needs to do the same. It is written for the engine packages
of [flyers-plan.md](../../../../../../planning/reference/flyers-plan.md) (FL0 to FL7), the designer (PA1), the animators
(PA3a, PA3b, PA3c) and the content author (PA5).

- **Base game.** ARK: Survival Evolved (ASE). Where ARK: Survival Ascended (ASA) differs, the row says so, and whether
  the change fixed something players disliked (followed) or added something (not followed unless decided).
- **Numbers** are ARK's official 1x as the ARK wiki (ark.wiki.gg) gave them on 2026-11-15, from the Pteranodon page's
  stat block unless the row says otherwise. Distances and speeds are Unreal units: 1 unit is 1 cm.
- **Sources** are in [SOURCES.md](SOURCES.md), by the short names used here: [P] the Pteranodon page, [DV] the wiki's data
  module, [ASB] ARK Smart Breeding's values file, [WK] an ASA data site, other wiki pages by title, patch notes by number
  ("ASE 256.0", "ASA 65.3").
- **Where sources disagree.** The wiki's data module (Module:Dv/data) gives older values for several stats (stamina 300,
  weight 150, the tamed gains, the flying stamina 0.275). The page's stat block and ARK Smart Breeding agree with each
  other and with the ASA data site, and are taken; the module's values match the game before patches 252.9 and 256.0.
- **Needs** names one or more of: a **clip**, a **socket**, a **rule** (behaviour code or a content flag), a **number**
  (content), a **field** (a new place in content or state for a number), with the package that owns it.
- **Confidence of a clip:** *documented* (a page describes the function that needs it), *seen* (official pictures show
  the pose), *usual* (creatures in general have it; nothing confirms the motion for this one).

## In one paragraph

A fast, skittish, carnivorous pterosaur, ARK's first rideable flyer. Wild ones fly about the beaches, grassland and
redwoods, land now and then to rest, and fly away when attacked; they turn on a player who takes their egg. It is tamed by
knocking it out, usually once it has landed, and feeding it kibble or meat. With a saddle from level 38 it is ridden:
flown where the rider looks, fast when sprinting, with poor stamina that forces it down when spent; it bites, grabs and
carries small creatures and survivors, and does a barrel roll that hits what it passes and drops what it carries. Its
rider cannot use weapons. It takes half again as much from arrows and other non-bullet shots, and three times to the
head. It lays a small egg that hatches in 100 minutes and grows up in 37 hours. It has six colour regions.

## 1. Identity and spawning

| Function | ARK | Ours needs |
|---|---|---|
| Name and dossier | Pteranodon, *Pteranodon wyvernus*, Late Cretaceous, carnivore, temperament "Skittish", reptiles. "Capable of flying more quickly than any creature... relatively poor stamina... making frequent pit stops on the beaches before taking off again... flee at the slightest sign of trouble." [P] | Number: name, diet, temperament (our own dossier wording). FL0 |
| Where it lives | The Island: beach group weight 0.15, members at 100% and 50%, at most 25% of the beach's creatures; Damien's Atoll 0.15 (100, 70, 60, 25%), at most 20%; grassland 0.14 (same), 20%; redwoods 0.15 (same), 18% [Spawn entries, both games]. The beach is "the home for Pteranodon" [Biomes] | Number: an entry in `core:spawns_beach` (FL0); grassland and redwood tables when a map has them. Group offsets from the spawn data, as the dodo's were |
| Wild level | The shared wild level rule | Rule: shared |
| Sexes | Male and female; it breeds. No visible difference found [P, Breeding, Eggs] | Rule: sex flag. No second model |
| Size | Head about 1 to 1.2 survivor heights standing; span roughly 7 to 9 m by eye (TRAITS) | Number: measured from our model (PA5) |
| History | ASE 1.551, "the first rideable flying creature introduced" [P] | Nothing |
| ASA wild babies | Wild ones may spawn with babies since ASA 73.12, claimable [ASA 73.12, Imprinting]. An addition | Nothing (ASE) |

## 2. Wild behaviour

| Function | ARK | Ours needs |
|---|---|---|
| Wander | Flies about and lands to rest: "frequent pit stops on the beaches"; "wait for it to fly down"; "while they are trying to get their stamina up" [P]. The Stamina page says wild creatures do not normally lose or recover stamina, so whether the landing is stamina or plain behaviour is not settled | Rule: a mind that flies about home at a height over the ground, lands now and then on open ground, rests, and takes off again (FL3). Chosen: by the mind's own timing, not stamina. Clips: `fly`, `glide`, `hover`, `land`, `idle`, `take_off` |
| When hurt | "Skittish and not aggressive whatsoever, and will fly away when attacked" [P] | Rule: `temper: "flees"`, fleeing by air: takes off if landed and climbs away (FL3). Clips: `take_off`, `fly_fast` |
| Not spooked | "Will not get spooked even if the player is pointing point-blank with a Shotgun" [P] | Nothing: only harm frightens it |
| Its egg | Turns aggressive "with an average aggravation range" if its egg is stolen [P] | Rule: D388 angers wild creatures of the egg's species "unless the species flees"; the pteranodon flees and still defends its egg, so the rule needs an exception or a flag (FL3). Clips: `attack`, `attack_air` |
| Rare flower | Turns hostile if a player eats a Rare Flower [P] | Nothing until the rare flower exists |
| Scavenging | The dossier says it scavenges dead animals rather than fight. No mechanic found | Nothing |
| Water | Wild flyers fly out of water and head back to land, not drowning (ASE 214.0) | Rule: a wild flyer in water takes off for land (FL3). Clip: `swim_idle`, `take_off` |
| Flyer AI history | Aggroed flyers go straight for the target (ASE 218.0); they no longer circle upward attacking each other (279.275) | Rule: as above |

## 3. Movement

| Function | ARK (1x) | Ours needs |
|---|---|---|
| Walk | 260 units/s, ridden the same [P, DV] | Number: `walkSpeed` 2.6. Clip: `walk` (loop, on all fours), stride-locked |
| Run on the ground | None: no ground sprint in the speed table [Base creature speeds] | Number: `sprintMul` 1 on the ground. The class asks for a `run` clip; it falls back to `walk` |
| Fly | 600 units/s, ridden the same [P, DV] | Field: `fly.speed` 6 (FL0). Clip: `fly` |
| Fly sprinting | Wild 1,650 units/s; tamed 1,897.5; 2,561.6 with the full taming bonus (speed Ta 0.35) [P, DV] | Field: `fly.sprintMul` 2.75 wild, 3.1625 tamed (FL0). The taming bonus waits for the tameBonus feature, as for every species. Clip: `fly_fast` |
| Hover | "With no forward command... they will eventually stall to a halt and hover in mid-air" [P]. Brake (X on PC) stops it at once and holds it still [Flying, Controls] | Rule: no forward input slows it to a hover; brake holds it (FL1). Clip: `hover` |
| Which way it flies | Forward along the camera; it moves forward only on command [P, Flying] | Rule: flight along the look, pitch included, as a swimmer moves (FL1) |
| Climb and descend | No ascend or descend key is listed: jump is land and take-off, crouch the barrel roll [Controls, Flying, P]. It climbs and dives by where the rider looks | Rule: climb and dive by the look only (FL1, FL2). Clips: `fly` and `dive` blended by pitch |
| Swim | Swim speed 300 is listed, but flyers "are unable to go under water" [Flying] | Rule: floats at the surface (FL1). Clips: `swim_idle`, `swim` (optional) |
| Turning | Not documented; ASE 259.0 made tames turn faster in combat | Field: `fly.turn` (chosen, FL0) |
| Speed levelling | No speed levels for flyers since ASE 256.0 (points refunded; wild speed points do not count; imprinting gives none). A server may allow it (`bAllowFlyerSpeedLeveling`, 321.1); in ASA only if `bAllowSpeedLeveling` is on too [Server configuration]. ASE 252.9 had cut tamed speed per level by 20% | Number: speed gains 0, wild and tamed. The setting already exists as planned (`server/settings/rows-mode.ts`); raw tamed gain 0.02 [ASB] when it is on |
| Wind | The Island's wind changes flyers' speed (ASE 256.0) | Nothing: no wind |

## 4. Flight: taking off, landing, stamina, and where it may not fly

| Function | ARK (1x) | Ours needs |
|---|---|---|
| Take off | Jump (Space). "Will cause the creature to launch and hover a few feet above ground... unless you are too heavy" [Controls, P] | Rule: jump on the ground takes off unless too heavy (FL1). Clip: `take_off` (one-shot) |
| Land | Jump in the air "near the ground": it moves to the ground and lands "on a suitable, horizontal surface", where it "folds its wings" [P, Controls] | Rule: jump in the air descends to walkable ground below and lands (FL1). Clip: `land` (one-shot) |
| Mounting does not take off | ASE 312.65; it may be ridden walking on the ground (213.0) | Rule: mounting leaves it on the ground (FL2) |
| Flying stamina | 0.325 a second while flying (the page; the data module's older 0.275); sprint 6 a second; walking 0.025. The page gives no units; read as per second | Field: `fly.stamina` (FL0). Number: 0.325, 6, 0.025 (flagged in §19) |
| Hovering stamina | "Even while not moving Pteranodons lose a small bit of stamina just to stay aloft" [P] | Rule: hovering costs the flying rate (chosen; no rate given) |
| Recovery | Flyers' stamina "regenerates much more slowly" and "takes ~10 seconds to begin regenerating" (ASE 256.0). Not in the air while ridden | Rule: none comes back while flying; on the ground, after 10 s, at the species' regeneration (chosen rate) (FL1) |
| None left | "It will force-land if it runs out of Stamina" [P]; "your mount will quickly land no matter what, even near dangerous creatures or over water" [Flying]. It no longer throws its rider off (ASE 171.3, 173.0, 214.0) | Rule: at none it descends quickly and lands under it, keeping its rider (FL1). Not a fall: no harm |
| Unridden tames | "Tamed and unridden Pteranodons do not lose stamina while sprinting to keep up with a player" [P]; "unridden tamed creatures don't lose stamina by attacking or running" [Stamina] | Rule: an unridden tame spends no stamina in the air (FL3) |
| Stimberries in flight | A "minor at best" gain [P] | Nothing new: eating works as it does |
| Too heavy | Cannot take off when too heavy [Controls]; encumbered (85% of weight) it cannot barrel roll (ASE 203.1) | Rule: `MF_NO_JUMP` from its load means no take-off (FL1). What a too-heavy one does in the air is not found; chosen: it is force-landed as at no stamina |
| Load | What it carries and what stands on it counts in full (ASE 256.0: other creatures on its back 100%); a carried creature's inventory weighs on it (177.0, 218.8) | Rule: the carried body's inventory adds to its load (FL6) |
| Water | Touching the water's surface, the mount "will throw you off as soon as it touches water"; flyers cannot go under water [Flying, ASE]. ASA has a server key `bAllowFlyerDinoSubmerging` (66.0), default not found | Rule: a ridden flyer that touches water puts its rider off and floats (FL1, FL2) |
| Caves | No flyer may be mounted in ARK's caves; one brought in cannot be ridden; a rider entering is put off (ASE 237.0, 251.3; Caves). Custom maps allow it by default; `-ForceAllowCaveFlyers` | Rule, with map zones (later): no riding a flyer inside a no-fly zone; entering one puts the rider off. The flag exists as planned |
| Maps that forbid it | Genesis: Part 1 forbids riding flyers on the whole map; `bForceCanRideFliers` [Server configuration] | Nothing for our maps. The setting exists as planned |
| Ceiling | A flight ceiling exists (ASE 254.3); its height is not found | Number: chosen, the world's top (`WORLD_MAX_Y`, 3,072 m) |
| C4 | Flyers but the Quetzal and wyverns are grounded while C4 is stuck to them (ASE 252.83) | Nothing until C4 sticks to creatures |
| Whistle to land | A whistle lands flyers (ASE 288.113) | Rule: a whistle order "land" (FL3; a key and an order code in FL0) |

## 5. Combat and damage

| Function | ARK (1x) | Ours needs |
|---|---|---|
| Bite | Primary (left mouse). 18 damage, every 0.67 s, 5 stamina, by rider and AI [P]. The data module gives range 500 from a point not given. Ridable flyers have ground attacks since ASE 256.3 | Number: `fists` 18, `bite` timing 20 ticks. Clips: `attack` (ground), `attack_air` (in flight). Socket: `beak_tip` |
| Barrel roll | Crouch (C on PC), in the air only. A roll that "spirals forward", "a short speed boost", 50 damage "to all enemies it hits", 90 stamina, every 7 s by rider and AI [P]. It drops anything carried, and is not possible encumbered (ASE 203.1) or carrying explosives (253.98). History: added 202.0; damage -33% and stamina +90% in 213.0; damage +40% in 231.7; a 3 s cooldown in 256.0. ASA 65.3 fixed it sometimes not gaining forward momentum | Rule: a roll with a burst of speed, hitting what it passes for 50, 7 s apart, dropping its load (FL1 for the burst, FL2 for the key, FL4 for the pose, combat for the hits). Cue: `CUE_ROLL` (FL0). Clip: `barrel_roll` |
| Grab | Secondary (right mouse), in the air, 40 stamina, range 500, no damage [P, DV] | See §6 |
| Hit zones | Head x3, both games [P, ASB]. ASA adds the jaw x3 and lets body multipliers apply to a survivor's melee (additions) | Hit zones: head (skull, jaw, crest) x3; the rest x1 (PA5 with `tools/fit-zones.ts`) |
| Damage it takes | Half again from non-bullet projectiles: arrows, darts, stones (ASE 231.4: "1.5x Non-Bullet Projectile Damage vs Flyers"; [P]: "very easy to accidentally kill one with a Tranq arrow or even a stone"). Earlier larger multipliers were removed (180.0 to 231.3) | Rule: a flyer takes 1.5 times from rounds that are not bullets. In the damage function, the weapons team's; a species flag from FL0 |
| Damage types | The page gives only the head row | Number: the shared carnivore table, as the raptor has |
| Structures | Damages thatch, wood and greenhouse [DV]; flyers deal 60% less to structures (ASE 177.0) | Number: structure damage by the material table, times 0.4 |
| Getting hit | No source describes a reaction | Clip: `flinch` (additive, ground and air). Usual |
| Dying | Falls if killed in flight; if it was carrying, "both the victim and the rider fall" [P] | See §9. Clips: `death`, `death_air` |
| Immobilised | Bola, chain bola, bear trap, large bear trap, Plant Species Y trap, net [DV, ASB] | Rule: the bola's species list gains it (the weapons team's file). See §9 |

## 6. Carrying and being carried

| Function | ARK (1x) | Ours needs |
|---|---|---|
| Grab | Right mouse while flying or hovering over the target: "the Pteranodon will swing its legs forward and you will hear a click"; the target's name and level show; the carried creature hangs behind [P]. Press again to let go | Rule: a ridden flyer grabs the body under it within reach (FL6). Key: secondary while flying (FL2). Clips: `grab`, `carry` (legs forward, held), `release`. Sockets: `grab` on it; `carry_point` on the carried |
| What it may lift | The most drag weight it lifts is 50 [DV]; "75% of the current Weight stat value is also factored in as additional drag weight" [Drag Weight]. The page's list: Achatina, Archaeopteryx, Bulbdog, Compy, Dilophosaur, Diplocaulus, Dodo, Enforcer, Ferox (small), Glowtail, Hesperornis, Human, Hyaenodon, Jerboa, Kairuku, Leech, Lystrosaurus, Megalania, Mesopithecus, Otter, Oviraptor, Pegomastax, Shinehorn, Super Turkey, Titanomyrma drone, Trilobite, Troodon, Zomdodo. Drag weights: human 35, dodo 25, raptor 85 (not liftable) | Field: `grab.drag` 50 (FL0). Rule: the target's drag plus three quarters of its weight stat, against 50 (FL6). Of ours: the dodo and survivors; not the raptor or parasaur |
| Survivors | Survivors may be grabbed. In PvE it cannot grab another tribe's players (ASE 172.3). Wild creatures in PvE only with `AllowFlyerCarryPvE` (253.31) | Rule: as ARK (FL6). The setting exists as planned |
| A carried survivor | Can attack the pteranodon while carried, "potentially killing it and causing both the victim and the rider to fall" [P]; aiming while carried fixed in 202.0 | Rule: she is pinned to the carrier, her client stops moving her, and she may use what she holds (FL6) |
| A carried creature | Cannot attack while carried, but "can land a hit when picked up or dropped"; the pteranodon cannot attack what it holds [P] | Rule: no bite from the carried creature in the air; the carrier's bite is off while it carries (FL6) |
| What ends a carry | Letting go; the barrel roll (203.1); the line between them blocked; it cannot carry through structures (177.0); landed flyers cannot hold players (214.0); its death; 312.65: it picks up friendly creatures before dismounting friendly riders | Rule: each of these sets the body down or drops it in the air, never inside anything (FL6, by D390's rules) |
| Dropped from high | Players drop survivors "high up into the air... and let fall damage take care of them" [P, Roles] | Nothing new: a dropped body falls and lands hurt (D385) |
| Unridden | Carrying on command, unridden: not found | Nothing |
| It being carried | Carried only by the Megalosaurus and Aberrant Megalosaurus [DV]. Drag weight 149, mass 190 | Number: `drag` 149, `mass` 190. Socket: `carry_point`. Clip: `carried` (later, when a carrier exists) |
| Picked up by a survivor | No | Nothing: not `carriable` |

## 7. Taming

Knock-out taming. Not passive.

| Function | ARK (1x) | Ours needs |
|---|---|---|
| Bringing it down | It flees when hit. "Wait until they land... while they are trying to get their stamina up"; "a Bola makes this easier"; snipe it in the air with a head shot; an electric prod to the head knocks out one of level 120 or less [P] | Rules of §2 and §9: it lands by itself; a bola holds it; knocked out in the air it falls |
| Knock out | Tranquiliser arrows and darts; it takes extra from non-bullet rounds, so a tranquiliser arrow or "even a stone" can kill it. Hits to knock out at level 1: club 12, slingshot 5, bow tranquiliser 2, crossbow 1, dart 1, shock dart 1 [P] | Number: torpor 120, +7.2 a level (0.06). The 1.5x of §5 applies to the damage, not the torpor (not found; chosen) |
| Over water | "Can accidentally fall into deep water and drown... do not knock it out over bodies of water" [P] | Nothing new: a knocked-out body under water drowns (D385) |
| Stay asleep | Torpor drains at 0.3 a second at level 1 (0.5 at 30, 0.66 at 60, 0.79 at 90, 0.92 at 120, 1.04 at 150); asleep 6:40 at level 1 [P] | Number: `torporDrain` 0.3 |
| Taming inputs | Affinity 1,200 + 60 a level; food consumption base 0.001543, multiplier 216.029373 (about 0.333 food a second); taming ineffectiveness 3.125 [TamingTable/creatures, DV] | Number: `taming: { a0: 1200, a1: 60, foodBase: 0.001543, proneMult: 216.029373, k: 3.125 }` |
| Foods, best first (food, affinity) | Regular Kibble 53.28, 400; Raw Mutton 50, 187.5; Cooked Lamb Chop 49.945, 101.25; Raw Prime Meat 50, 150; Cooked Prime Meat 49.945, 75; Raw Prime Fish Meat 25, 60; Raw Meat 50, 50; Cooked Prime Fish Meat 25.686, 30; Cooked Meat 25, 25; Raw Fish Meat 25, 20; Cooked Fish Meat 12.5, 10 [TamingTable/food]. Regular Kibble since ASE 293.100 (Kibble (Dodo Egg) before) | Number: `eats` of those that exist: raw prime meat, cooked prime meat, raw meat, cooked meat. Kibble and mutton wait for their items |
| Wake up | When its torpor runs out, or as the tame completes | Clip: `torpor_out` |

Test values from the page's taming table (ASE): pieces, then narcoberries / narcotics / bio toxins if any are needed, then
time.

| Level | Regular Kibble | Raw Mutton | Raw Prime Meat | Raw Meat |
|---|---|---|---|---|
| 1 | 1, 2:40 | 2, 5:01 | 3 (2/1/1), 7:31 | 7 (24/5/3), 17:31 |
| 30 | 2, 5:20 | 4, 10:01 | 5 (6/2/1), 12:31 | 15 (89/19/10), 37:31 |
| 60 | 3, 8:00 | 7 (15/4/2), 17:31 | 8 (26/6/3), 20:01 | 24 (191/40/20), 1:00:01 |
| 90 | 5, 13:20 | 9 (31/7/4), 22:31 | 11 (55/12/6), 27:31 | 33 (318/68/34), 1:22:31 |
| 120 | 6, 16:00 | 12 (66/15/8), 30:01 | 14 (93/20/10), 35:01 | 42 (467/102/51), 1:45:01 |
| 150 | 7, 18:39 | 14 (93/21/11), 35:01 | 17 (137/30/15), 42:31 | 51 (635/140/70), 2:07:31 |

These agree with the round 4 formulas: level 1 needs 1,260 affinity; raw meat gives 50 x 4 = 200 a piece, so 7 pieces;
7 x 50 / (0.001543 x 216.029373) = 1,050 s.

## 8. Tamed behaviour, riding and the saddle

| Function | ARK | Ours needs |
|---|---|---|
| Orders and stances | The shared set (follow, stay, wander, attack this target; the stances) | Rule: shared, in the air too: a follower flies after a flying leader and walks after one on foot (FL3) |
| Land on a whistle | ASE 288.113 added a whistle that lands flyers; ASA 34.49 fixed them walking on after it | Rule: an order "land" (FL0 code, FL3) |
| Stay in the air | Not documented | Chosen: a tame told to stay in the air hovers where it is (FL3) |
| Inventory | Carries 120 weight (+3% a point) | Number: weight |
| Levelling | 88 tame levels, shared; no speed levels (§3) | Rule: shared |
| The saddle | Pteranodon Saddle: level 38 (raised in ASE 259.0), 15 engram points; 230 hide, 125 fiber, 75 chitin or keratin; made in the inventory in 10 s for 43 XP; armour 25; weight 20 [Pteranodon Saddle]. A torch can be fitted to it. Blueprints of better quality come from supply crates [Saddles] | Number: item `core:saddle_pteranodon` (`fits`, `armor` 25, weight 20), its recipe (hide, fiber, chitin), engram at 38 for 15 (FL0). Mesh: `core:saddle_pteranodon/worn` on its bones (PA2, FL5). The torch waits for lights |
| What a saddle does | Lets it be ridden; armour as all saddles: damage x 100 / (100 + armour x 2) for a creature [Saddles]; ASE saddles have no durability (ASA's launch durability was removed: a fix) | Nothing new: built |
| Rider weapons | No ([P] infobox; `ballowmountedweaponry` no) | Rule: the rider's hands stay empty (built for every mount today) |
| Passenger | None found | Nothing |
| Controls | Left mouse bite; right mouse grab and let go; C the barrel roll; Space take off and land; X brake; E dismount; Shift sprint; the look steers [Controls, Flying, P] | Rule: those keys while riding a flyer (FL2) |
| Dismount in the air | "Doing this in the air will cause your character to jump off of the creature" [Flying]; "a dino that was ridden will now take fall damage once if it was unboarded in mid-air" (ASE 203.1) | Rule: the rider is set off and falls; the pteranodon no longer flies and falls, hurt once (FL1, FL2). Reading of 203.1, flagged |
| Fall damage of a rider | Shared | Nothing new (D385) |
| Imprinting | Babies are imprinted; mountable flyers get no speed from it | Nothing new |

## 9. Brought down: knocked out, killed and caught in the air

| Function | ARK | Ours needs |
|---|---|---|
| Knocked out in flight | It falls: the page's advice not to knock it out over water, where it falls in and drowns [P] | Rule: an unconscious flyer stops flying and falls (FL1); it lands hurt by D385 (Ptera-specific fall damage not found); its rider is put off as now. Clips: `torpor_fall` (limp in the air), then `torpor_idle` |
| Killed in flight | It falls; what it carries and its rider fall [P] | Rule: the body falls to the ground before it lies and is harvested there (FL7). Clip: `death_air`, then the ragdoll |
| Bola | It is on the bola's list [DV, Bola]: rooted 30 s (25 s on a survivor; the Status effects page says 20 s for a creature), cannot be mounted while held. What a bola does to it in flight is not found; the Quetzal page says a chain bola or a net "will immobilize the Quetzal and bring it to the ground temporarily" | Rule: a flyer rooted in the air stops flying and comes down; its rider stays on (D450) (FL1). Number: the bola's own (the weapons team's) |
| Net, chain bola, whip | Net: 1 minute, then 30 s immune (332.13), no attack or riding while netted; chain bola about 15 s; the whip forces flyers to land [Net Projectile, Chain Bola, Whip] | Nothing until those weapons exist; the same rule as the bola |
| Other groundings | Velonasaur spines knock flyers down; ASA's Tesla coil no longer grounds them (68.12) | Nothing |

## 10. Stats and per-level gains

From the page's stat block and ARK Smart Breeding, which agree. Wild gain is per wild point; tamed gain is per point
spent after taming, raw, then as ours stores it (the raw gain times ARK's default tamed multiplier: health 0.2, melee
0.17, others 1). Ta and Tm are the taming bonuses, which no species uses yet.

| Stat | Base | Wild | Tamed (raw, ours) | Ta | Tm |
|---|---|---|---|---|---|
| Health | 210 | +42 (0.2) | 0.15, 0.03 | 0.5 | 0 |
| Stamina | 150 | +7.5 (0.05) | 0.04, 0.04 | 0 | 0 |
| Oxygen | 150 | +15 (0.1) | 0.1, 0.1 | 0 | 0 |
| Food | 1,200 | +120 (0.1) | 0.1, 0.1 | 0 | 0.15 |
| Weight | 120 | +2.4 (0.02) | 0.03, 0.03 | 0 | 0 |
| Melee | 100% (bite 18, roll 50) | +5% (0.05) | 0.075, 0.01275 | 0.65 | 0.4 |
| Speed | 100% | none | none (raw 0.02 when allowed) | 0.35 | 0 |
| Torpidity | 120 | +7.2 (0.06) | none | 0.5 | 0 |

- A tame's base health is 0.9 of the wild one's (TamedBaseHealthMultiplier; the page names the pteranodon among the
  species with it) [Creature stats calculation]. Needs: a field, with the taming bonuses (later).
- Kill XP: data base 3; the infobox shows 12. Number: `killXp` 12, as the dodo takes the infobox's.
- Drag weight 149; mass 190; the most it lifts 50; feces small; can drown; not immune to radiation or torpor.
- A rider's weight counts 0.85 on it (passengerweightmultiplier) [DV]. Needs: a number, with riding's load (FL2).
- Imprinting raises health, torpidity, food, weight and melee by 0.2 of the imprint; stamina, oxygen and speed not [ASB].
- ASA: no wild speed levels; otherwise ARK Smart Breeding's ASA values change nothing of these.

## 11. Drops and harvesting

| Function | ARK | Ours needs |
|---|---|---|
| Corpse | Hide and raw meat [P, DV]. Amounts not on the wiki; the ASA data site gives about 5 hide and 6 meat to a pick, 7 hide and 4 meat to a hatchet, harvest health 120 (unverified) | Number: `drops` hide and meat, `corpse` health and roll chosen to give those, as the dodo's were (PA5) |
| Young | Prime meat in place of raw from any young body | Rule: shared |
| What it gathers | Its bite gathers meat (3 of 5), chitin (3), hide (2), organic polymer (2), prime meat (1), keratin (1) [P] | Rule: a bite on a corpse harvests (later, with creatures that harvest) |
| Feces | Small | Number: `feces` `core:feces_small` |
| Ground into kibble | It is among the creatures that drop simple kibble when ground up [P] | Nothing until the grinder |

## 12. Eggs and breeding

| Function | ARK (1x) | Ours needs |
|---|---|---|
| Egg item | Pteranodon Egg, a small egg: weight 7, stack 100, spoils in 28,800 s (8 h), decomposes on the ground in 1,800 s; eaten, 35 food, 35 health, 35 stamina; makes Simple Kibble [Pteranodon Egg, Eggs, 293.100] | Number: `core:pteranodon_egg` and its fertilised twin (as the raptor's, which has the same numbers); the egg prop on `core:egg_s` |
| Unfertilised eggs | Wild and tame females lay them when mate-boosted [Eggs] | Rule: the mate boost (tameBonus feature, later). Not the dodo's rule |
| Taken egg | Its parents attack the thief (§2) | Rule of §2 |
| Mating | Shared; flyer breeding added in ASE 220.0. Interval 64,800 to 172,800 s [DV] | Rule: shared |
| Incubation | 5,999.52 s at 29 to 32 °C; an incubator at 31 °C [DV, P] | Number: `incubate` 5999.52 |
| Maturation | 133,333.33 s: baby 3 h 42 min 13 s, juvenile 14 h 48 min 53 s, adolescent 18 h 31 min 7 s [P] | Number: `mature` 133333.33 |

## 13. Growth stages and babies

Shared stages (baby to 10%, juvenile to 50%, adolescent to 100%). Babies use the adult clips at a smaller size.
Whether a baby flies: not found. Chosen: a young one is not ridden (shared) and flies once grown past baby; ASA 63.6
fixed "baby flyers never attempting to land after being forced to fly when entering water", so ASA's babies fly.
Needs: a rule (FL3) and the size curve (shared).

## 14. Colour regions

Six regions, the same names in both games [P, Module:Dv/paintRegions, ASB]. Where each sits is from the wiki's region
pictures; [TRAITS.md](TRAITS.md) describes them.

| Region | Name | Where it sits |
|---|---|---|
| 0 | Patterning | The stripes over neck, back, flanks, belly, crest spike and cheek; the eye ring |
| 1 | Wing Base | A wash on the inner membrane by the body; the folded far wing's tip |
| 2 | Face, Crest and Hands | The beak, the crest's sails, the claws of hands and feet |
| 3 | Inner Crest | The cells inside the sails |
| 4 | Wing Membrane | The whole membrane |
| 5 | Body | The skin between the stripes, the crest spike, the wing bones' leading edge |

ASE natural colours by region: 0, seventeen (light, dark and darker grey, black, the light and dark reds, oranges,
yellows and greens, medium green, the three browns, albino); 1, 3 and 4, eleven (light grey, black, light red, light
orange, light yellow, light and medium green, light blue, light purple, light and medium brown); 2, twelve (dark grey,
black, dark red, dark orange, dark yellow, medium and dark green, dark blue, dark purple, medium and dark brown, darker
grey); 5, ten (dark grey, black, dark red, dark orange, dark yellow, medium and dark green, medium and dark brown, darker
grey). ASA's sets are wider (48 colours on regions 0, 1, 4 and 5; 19 on 2; 38 on 3) and draw region 4 at twice the
intensity. Our colour set is ours (PA5). Needs: a region mask with these six regions; the colour set as content.

## 15. The clip list

Thirty-one clips, three of them optional (`turn`, `swim`, `carried`). "Additive" means it layers on whatever plays. FL4 decides which the engine blends
and which are poses for a blend.

| Clip | Loops | Motion | Plays when | Confidence |
|---|---|---|---|---|
| `idle` | yes | Sits up on all fours, wings folded, neck in an S, slow breathing, small head turns | Standing | Seen (the pose); motion usual |
| `idle_look` | no | Turns the head and its long beak slowly one way, then the other | Now and then from `idle` | Usual |
| `idle_stretch` | no | Lifts and half opens the wings, shakes them, folds them back | Now and then from `idle` | Usual |
| `call` | no | Head up, beak open, a call | With its sound | Documented sound; motion usual |
| `walk` | yes | Walks on all fours on its hands and feet, wings folded, the body rolling a little | 0 to 2.6 m/s on the ground | Documented need |
| `turn` | no | Steps round on the spot | Optional, if feet slide when it turns | Usual |
| `take_off` | no | Crouches, kicks with the legs, vaults on the arms, the wings snap open and give the first downstroke, rising to a hover | Take-off | Documented |
| `hover` | yes | Body upright, deep slow flaps, legs hanging | Hovering and braking | Documented |
| `fly` | yes | Level flight, steady full flaps, legs trailing | Flying at 6 m/s | Documented need |
| `fly_fast` | yes | Faster, shallower flaps, wings swept a little | Sprinting | Documented need |
| `glide` | yes | Wings flat and still, tips a little drooped, small corrections | Level or descending without sprint | Seen |
| `dive` | yes | Head down, wings swept up and back, legs trailing | Steep descent | Seen (ASA renders) |
| `land` | no | Stalls with the wings, legs forward, heels down, a skid, then the hands down, the wings fold | Landing | Documented |
| `swim_idle` | yes | Floats with the wings spread on the water | In water | Documented need |
| `swim` | yes | Paddles with wings and feet | Moving in water | Optional |
| `fall` | yes | Tumbles, wings flailing and half closed | Falling awake: let go by its rider in the air, caught by a bola | Documented need |
| `attack` | no | Bites forward and down on the ground, under 0.67 s | Bite on the ground | Documented |
| `attack_air` | no | Bites forward from flight, neck and head only | Bite in the air | Documented |
| `barrel_roll` | no | A full roll about its length with a lunge forward, wings spread through it | The roll | Documented |
| `grab` | no | Swings the legs forward, the talons close | Grabbing | Documented |
| `carry` | yes | Legs forward and bent, talons closed round the load; additive on the legs over the flight clips | Carrying | Documented need |
| `release` | no | Talons open, legs swing back | Letting go | Usual |
| `flinch` | no | Additive: the body jerks, the head pulls in, a wing twitch | Taking damage, ground or air | Usual |
| `torpor_in` | no | Sinks, sprawls on its side or belly, the wings loose on the ground | Knocked out on the ground | Documented (shared) |
| `torpor_fall` | yes | Limp in the air, wings trailing up, head hanging | Knocked out in flight, until it lands | Documented need |
| `torpor_idle` | yes | Lies out cold, slow breathing | Knocked out | Documented (shared) |
| `torpor_eat` | no | Additive on the neck and head: a lift and a gulp | Each item eaten while out | Documented (shared) |
| `torpor_out` | no | Gathers the wings, pushes up on its hands, sits up | Waking | Documented (shared) |
| `death` | no | Collapses, then the ragdoll | Death on the ground | Documented (shared) |
| `death_air` | no | Goes limp in flight, then the ragdoll falls | Death in the air | Documented need (ASA records a falling death) |
| `carried` | yes | Hangs from a carrier's jaws | Carried by a Megalosaurus | Optional, later |

Not on the list, because no source shows a motion for them: eating while awake, mating, laying, scavenging, being
cuddled, being immobilised (keeps `idle` on the ground).

## 16. Sockets

| Socket | Where | Used for |
|---|---|---|
| `beak_tip` | Tip of the upper beak | Bite origin |
| `head` | Middle of the skull | Look target; head zone |
| `overhead` | Above the crest | Marks over it |
| `seat` | On the saddle, over the shoulders behind the neck | Where the rider sits (TRAITS: upright, astride the shoulders) |
| `grip_l`, `grip_r` | The saddle's grips or reins | Where the rider's hands are |
| `grab` | Between the feet as they close | Where a carried body hangs |
| `carry_point` | Over the back or neck, where a large carrier's jaws take it | Being carried (later) |
| `vent` | Under the tail | Eggs and feces |
| `foot_l`, `foot_r`, `hand_l`, `hand_r` | Under each foot and each wing's hand | Footsteps on all four; dust at take-off and landing |

## 17. Sounds by occasion

The wiki has one pteranodon sound (`Pteranodonsound.ogg`, the infobox's) and its data names a "mumble" file
(`PW_ptera_vox_mumble`); ASE 256.0 gave it new sounds. We make our own.

| Occasion | Confirmed for it | Plays with |
|---|---|---|
| Call | Yes | `call` |
| Wing beats | Usual | `fly`, `hover`, `take_off` |
| Grab click | Yes ("you will hear a click noise") | `grab` |
| Bite, roll, pain, death, knocked out, waking | Usual | their clips |
| Footsteps | Usual | `walk` |

## 18. Left out on purpose

Variants: Corrupted (Extinction), Eerie (event), Lightning (Astraeos, ASA), Revenant and its outpost miniboss (Lost
Colony, ASA), the Genesis minions, escorts and summons, the "Bog" colour set. Costumes. The Enigmasaur trait it grants.
Wind. ASA's wild babies. The torch on the saddle until lights exist.

## 19. Conflicts, unknowns and what was chosen

- **Stamina units.** The page gives 0.325 flying, 6 sprinting, 0.025 walking with no unit. Read as per second, as the
  dodo's run of 4 was. At 150 stamina that is about 460 s of cruising and 25 s of sprinting. Hovering's "small bit" is
  given no rate; chosen: the flying rate.
- **Regeneration** after ASE 256.0 is "much more slowly" with no number; chosen: the shared rate, after 10 s on the
  ground, until a number is found.
- **Barrel roll's interval:** 7 s on the page against 3 s in 256.0's note. Taken: the page's 7 s, which describes the game as it is now; the 3 s may be the cooldown alone after the roll's own length. Its stamina:
  90 on the page, 85 in the data module; taken 90.
- **Climbing and descending.** No key for either is listed; Space is take-off and landing, C the roll. Taken: the look.
- **A bola in flight** is not described anywhere for the pteranodon. Taken: it comes down, as the Quetzal page says of a
  chain bola or net, and as the weapons plan's M6 expects; its rider stays on (D450).
- **Bola times** conflict (30 s for a creature on the Bola page, 20 s on Status effects): the weapons team took 30.
- **Dismounting in the air:** ASE 203.1 is read as "the pteranodon falls and is hurt once". It may instead mean only that
  it takes fall damage when it next lands. The reading is simpler for us and matches "unboarded in mid-air".
- **Too heavy in the air:** not found; chosen: forced down as at no stamina.
- **Wild landing:** by the mind's timing, not by stamina (the Stamina page says wild creatures neither lose nor recover
  stamina; the page's advice speaks of them landing to rest).
- **A tame told to stay in the air:** chosen, it hovers.
- **The ceiling:** exists, height not found; chosen, the world's top.
- **Tamed speed per level:** 0 shown on the page, raw 0.02 in ARK Smart Breeding, used only where flyer speed levelling
  is allowed.
- **Not found:** corpse yields (only the ASA site's estimate), turning rate, acceleration, how a baby flies, what the
  roll's hit area is, whether the roll knocks off a grappling hook, a message on entering a no-fly zone, any visible
  difference between the sexes.

## 20. How elaborate the skeleton needs to be

About 45 deforming bones, no face rig and no blend shapes.

- **Spine:** root, pelvis, two spine bones (belly, chest), one short tail bone.
- **Neck:** four or five bones, for the S, the bite and the look.
- **Head:** skull (the crest rides on it), jaw (the beak opens to call, bite and eat).
- **Each arm:** upper arm, forearm, the long metacarpal, the hand's fingers as one bone, the wing finger in four bones,
  so the finger can fold back through about 175 degrees along the arm and the tip can curve.
- **Each membrane:** two or three helper bones along the trailing edge between the wing finger and the ankle, so the
  skin stays taut spread and draws in folded. Optional: a pteroid bone for the front membrane.
- **Each leg:** thigh, shin, foot, toes; the talons close with the toes for `grab` and `carry`.
- **Non-deforming:** the sockets above.
- **Ragdoll bodies:** pelvis, chest and skull, with the two upper arms so the wings splay as it falls. The rest follows.
- **Hit capsules:** the head's bones x3; the body, neck, arm bones, legs x1. Whether a hit on the membrane between the
  bones counts is not found; chosen: capsules along the bones only (PA5).
