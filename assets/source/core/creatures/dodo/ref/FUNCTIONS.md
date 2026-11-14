# Dodo: function list

Everything ARK's dodo does in the game, and what our dodo needs to do the same. It is written for the designer (D1), the animators (D3a, D3b, D3c) and the content author (D5).

- **Base game.** ARK: Survival Evolved (ASE) is the base. Where ARK: Survival Ascended (ASA) behaves differently, the row says so. The fidelity policy follows ASA only where ASA fixed something players disliked; the rows marked ASA say which kind each is.
- **Numbers** are ARK's official 1x rates as the ARK wiki (ark.wiki.gg) gives them on 2026-11-14. Distances and speeds are Unreal units: 1 unit is 1 cm.
- **Sources** are in [SOURCES.md](SOURCES.md). The stat and taming formulas are already in [round4-creatures.md](../../../../../../planning/reference/round4-creatures.md); this list gives the dodo's inputs to them.
- **Needs** names one or more of: a **clip** (a motion), a **socket** (a named point on the rig), a **rule** (behaviour code or content flag) or a **number** (a value in `content/creatures/dodo.ts` or `asset.ts`).
- **Confidence of each clip:** *documented* means a wiki or dev kit page describes the function that needs it; *seen* means official pictures show the pose; *usual* means ARK creatures in general have it, but no source confirms the motion for the dodo.

## In one paragraph

A slow, dim, flightless bird that waddles about beaches and grassland. It never fights back in ASE; when hit, it and nearby dodos try to run away. It is tamed by knocking it out and feeding it. It cannot be ridden and wears no saddle. A player can pick it up in both arms, carry it and throw it. Many flyers and some land creatures can carry it. Females lay eggs often, by a rule unique to the dodo. It hatches in 50 minutes and grows up in about 15.4 hours. Its head takes triple damage. It has six colour regions.

## 1. Identity and spawning

| Function | ARK | Our dodo needs |
|---|---|---|
| Name and dossier | Dodo, *Raphus replicare*, Late Holocene, herbivore, temperament "Oblivious". Groups: terrestrial, birds. | Number: name, diet, temperament text (our own dossier wording). |
| Where it lives | Beaches, hills and forests; "aimlessly waddle". It is the commonest early prey. | Rule: spawn zones on beaches and grassland. Number: spawn weight and group size (ARK's not found; chosen). |
| Wild level | The shared wild level rule; nothing dodo-specific found. | Rule: shared. |
| Sexes | Male and female. No visible difference found between them. | Rule: sex flag. No second model or clip. |
| Size | About knee to mid-thigh height on an adult human (by eye from screenshots and the official model sheet's scale box). | Number: overall height, measured from our model. |

## 2. Wild behaviour

| Function | ARK | Our dodo needs |
|---|---|---|
| Wander | Wanders slowly, stops, stands about. | Clips: `idle` (loop), `walk` (loop), idle variants. Rule: wander AI. |
| Ambient call | "Makes chirping noises as it strolls." The wiki's one sound file is the dodo's "mumble". | Clip: `call` (one-shot). Sound: ambient call at random intervals. |
| Reaction to attack (ASE) | Never fights back. It and any dodos near it flee. Taking its egg does not provoke it. | Rule: flee on damage, with a group alarm to nearby dodos. Clips: `startled`, then `run`. |
| Startle | A pose named "Startled" in an official forum screenshot of the ASE model: beak wide open, head thrown up, both wings flung out. One wiki screenshot shows the same wings-out pose among wild dodos, and an ASA photo shows a dodo with wings out as a predator swoops. ARK names "startled" sounds for other species. | Clip: `startled` (one-shot). Sound: startle call. |
| Reaction to attack (ASA) | Flees, and now and then pecks the attacker for 5. | Rule: optional peck while fleeing. Clip: `peck`. This is a change, not a fix; follow ASE unless decided otherwise. |
| Early ASE (removed) | Dodos used to fight back. Removed long ago. | Nothing. |
| Wild babies (ASA only) | A wild dodo may spawn with babies: up to 40% matured; 15% chance of one baby, 5% of two. Babies stay within about two foundations of the parent. If either is attacked, the parent fights, even though dodos normally flee. When the parent dies the baby flees. | Rule, if we follow ASA here: baby spawn, follow-parent, parent-defends. Clips: none new (`peck`, `run`). This is an ASA addition, not a fix. |

## 3. Movement

| Function | ARK (1x) | Our dodo needs |
|---|---|---|
| Walk | 65 units/s (0.65 m/s). "An encumbered, injured beginner can easily keep pace." Stamina while walking 0.025 (wiki data). | Clip: `walk` (loop), stride-locked. Number: walk speed 65, stride length from our model. |
| Run | Wild 136.5 units/s. Tamed 95.55 units/s. Running costs 4 stamina (wiki data). | Clip: `run` (loop), stride-locked. Numbers: both speeds. |
| Swim | Swims at the surface. Base swim speed 300 units/s; the wiki calls it "decent" and "remarkably quick" on the surface. Can drown (oxygen 150). | Clips: `swim` (loop, moving) and `swim_idle` (loop, treading water). Rule: surface swimming, oxygen drain when submerged. |
| Fall | Falls when dropped by a carrier or thrown by a player; takes the shared falling damage. | Clip: `fall` (loop). Clip: `land` (one-shot, optional). Rule: shared fall damage. |
| Jump | No jump found. | Nothing. |
| Turning | Not documented. | Clip: `turn` (optional; only if the stride lock shows feet sliding when it turns on the spot). |

## 4. Stats and per-level gains

From the wiki's data module (raw values) and its "Base creature statistics" table (displayed gains). Wild gain is per wild level point; tamed gain is per point spent after taming, as a share of the value at taming.

| Stat | Base (level 1) | Wild per level | Tamed per level | Raw taming bonus, add (Ta) | Raw taming bonus, mult (Tm) |
|---|---|---|---|---|---|
| Health | 40 | +8 (raw 0.2) | +5.4% (raw 0.27) | 0.5 | 0 |
| Stamina | 100 | +10 (raw 0.1) | +10% (raw 0.1) | 0 | 0 |
| Oxygen | 150 | +15 (raw 0.1) | +10% (raw 0.1) | 0 | 0 |
| Food | 450 | +45 (raw 0.1) | +10% (raw 0.1) | 0 | 0.15 |
| Weight | 50 | +1 (raw 0.02) | +4% (raw 0.04) | 0 | 0 |
| Melee damage | 100% (peck 5) | +5% (raw 0.05) | +1.7% (raw 0.1) | 1 | 0.4 |
| Movement speed | 100% | none | see conflicts below | 2 | 0 |
| Torpidity | 30 | +1.8 (raw 0.06) | none | 0.5 | 0 |

The displayed tamed gains are the raw values times ARK's default tamed multipliers: 0.2 for health (0.27 x 0.2 = 5.4%), 0.17 for melee (0.1 x 0.17 = 1.7%), 1 for the others.

Other numbers from the wiki's data module: kill XP base 0.5 (the infobox shows 2 XP); drag weight 25; mass 50; can suffocate; not radiation immune; feces size small.

Needs: numbers, as above, into the shared stat formula.

## 5. Combat and damage

| Function | ARK (1x) | Our dodo needs |
|---|---|---|
| Peck | The only attack. 5 damage. Range 110 units (wiki data). Usable every 0.5 s. Stamina cost 5 on the wiki page, 0 in the wiki's data module. Used by tames on order or when set aggressive, and in ASA by wild dodos now and then. | Clip: `peck` (one-shot, no longer than 0.5 s, hit frame early). Socket: `beak_tip` (hit origin). Numbers: damage, range, interval. |
| Peck while held | A held dodo can still peck "from the player's hands if it has range". | Rule: allow attack while held. Clip: `peck` must layer over `held`. |
| Damaging structures | Its attacks can damage thatch and greenhouse structures only. | Rule: structure damage limited to those tiers. |
| Hit zones | Head takes x3 damage. The calculator data names two bones at x3: the head and the top neck bone. Everything else x1. | Hit zones: head and upper neck x3, body x1. Fitted from our rig by `tools/fit-zones.ts`. |
| Damage types | The wiki shows the shared herbivore table (fire x0.375, explosives x0.6). | Number: shared herbivore damage table. |
| Getting hit | No source describes a dodo hit reaction. | Clip: `flinch` (one-shot, additive). Usual, not confirmed. |
| Dying | ASE drops into a ragdoll. ASA records ragdoll deaths into clips: five directions when standing or knocked out, one when falling, one when swimming. | Clip: `death` (one-shot, then ragdoll over the rig's capsules). Directional versions are optional. |
| Immobilised | Bola, bear trap, Plant Species Y trap and net projectile all hold it. | Rule: immobilised state. Clip: none found; it keeps its idle. |
| C4 | C4 can be stuck to a dodo, which players then fly or throw into bases. | Rule: shared stick-to-creature. No socket; C4 sits where it hits and follows the nearest bone. |

## 6. Taming

Knockout taming. Not a passive tame.

| Function | ARK (1x) | Our dodo needs |
|---|---|---|
| Knock out | Fists, a slingshot to the head or a wooden club. Anything stronger is likely to kill it (head x3, health 40). At level 1: wooden club 3 hits, slingshot 2, any tranquilliser dart or arrow 1. | Clips: `torpor_in` (one-shot), `torpor_idle` (loop). Numbers: torpor 30 +1.8 per level. |
| Stay asleep | Torpor drains at 0.3/s at level 1 (0.5 at 30, 0.66 at 60, 0.79 at 90, 0.92 at 120, 1.04 at 150). Narcoberries and narcotics top it up. | Number: torpor drain base 0.3. |
| Feeding | The player puts food in its inventory; it eats one item at a time. ASA has a "torpid eat" motion: a head and neck movement layered on the lying pose. The dev kit documentation uses the dodo's own torpid idle as its example. | Clip: `torpor_eat` (one-shot, additive on head and neck). Confidence: documented for ASA. |
| Foods, best first | Basic Kibble (food 53.28, affinity 400); crops (40, 40); mejoberry (30, 30); other berries (20, 20). Stimberries are eaten but count against it (food -15, affinity 1.5). | Number: food list and values. |
| Taming inputs | Affinity needed 450 + 22.5 per level. Taming ineffectiveness 1.333333. Food consumption base 0.000868, multiplier 2880.184. | Numbers: `[A0, A1, T1, D0, foodBase, proneMult, k]` = 450, 22.5, 30, 0.3, 0.000868, 2880.184, 1.333333. |
| Wake up | Wakes when its torpor runs out, or as soon as the tame completes. | Clip: `torpor_out` (one-shot, gets up). |

Test values from the wiki's taming table (pieces and time, no narcotics needed unless stated):

| Level | Basic Kibble | Crops | Mejoberry | Berries |
|---|---|---|---|---|
| 1 | 1, 0:22 | 3, 0:49 | 4, 0:49 | 6, 0:48 |
| 30 | 1, 0:22 | 8, 2:09 | 10, 2:01 | 15, 2:00 |
| 60 | 2, 0:43 | 12, 3:13 | 15, 3:01 | 23, 3:04 |
| 90 | 2, 0:43 | 16, 4:17 (2 narcoberries) | 21, 4:13 (1) | 31, 4:08 (1) |
| 120 | 2, 0:43 | 20, 5:21 (5) | 27, 5:25 (6) | 40, 5:20 (5) |
| 150 | 3, 1:04 | 24, 6:25 (10) | 32, 6:25 (10) | 48, 6:24 (10) |

These agree with the round 4 formulas: level 1 needs 472.5 affinity; berries give 20 x 4 = 80 each, so 6 pieces; 6 x 20 / (0.000868 x 2880.184) = 48 s.

## 7. Tamed behaviour and orders

| Function | ARK | Our dodo needs |
|---|---|---|
| Orders and stances | The shared set: follow, stay, wander, attack this target; passive, neutral, aggressive and so on. Players set dodos aggressive as base alarms and indoor guards; "10 to 15 can kill a raptor". | Rule: shared tame orders. Clips: `walk`, `run`, `peck`. |
| Inventory | Carries 50 weight (+4% per point). Players use it as an early storage box they can carry around. | Number: weight. Rule: inventory. |
| Eating | Eats from its inventory, and from troughs once a juvenile. No eating motion found for an awake tame. | Rule: shared hunger. No clip. |
| Riding | Cannot be ridden. No saddle, so it also cannot wear the dino hat skins that hang on saddles. | Nothing. |
| Shoulder pet | No. | Nothing. |
| Levelling | 88 tame levels, shared rule. Torpidity cannot be levelled. | Rule: shared. |

## 8. Carrying and being carried

| Function | ARK (1x) | Our dodo needs |
|---|---|---|
| Held by a player | Since ASE patch 241.0: "You can now pickup and toss Dodos & Dung Beetles." The player holds it in both arms and cannot use tools or weapons (a known trick gets a weapon out first). A held dodo takes no damage unless the player dies or throws it. Its inventory weighs half on the player (mounted weight multiplier 0.5). The wiki notes a player lying down can pick one up and holds it through the floor. | Clip: `held` (loop). Socket: `hold_point` (where the arms take it). Rules: hold, drop, throw, half weight, no damage while held. |
| Thrown | The player tosses it. It flies in an arc and lands, taking fall damage if far. | Clip: `fall` while airborne, `land` or `death` after. Rule: throw impulse. |
| Carried by creatures | ASE list: Argentavis, Pteranodon, Quetzal, Tek Quetzal, Tapejara, X-Tapejara, Tropeognathus, Griffin, the wyverns, Kaprosuchus, Megalosaurus and Aberrant Megalosaurus, Mammoth, Procoptodon (pouch), Tusoteuthis, X-Argentavis. ASA adds at least Desmodus and Karkinos. Drag weight 25 is what a carrier checks against its limit. Players fly dodos loaded with C4 over enemy bases and drop them. | Clip: `carried` (loop; may share the `held` pose). Socket: `carry_point` on the back over the centre of mass. Number: drag weight 25. |
| Dragged | The ASA dev kit describes dead bodies being dragged by the hip bone, with the limbs and tail conforming to the ground. | Rule: drag the ragdoll by the pelvis. No clip. |

## 9. Drops and harvesting

| Function | ARK | Our dodo needs |
|---|---|---|
| Corpse harvest | Raw meat and hide. Amounts not found on the wiki; an ASA data site says a hatchet gives the most hide and a pick the most meat. | Number: yield table (ours, flagged as chosen). |
| Young dodos | Any non-adult creature yields raw prime meat in place of raw meat. Players breed dodos and harvest them as juveniles for prime meat. | Rule: shared non-adult prime meat. |
| Feces | Small animal feces. | Socket: `vent`. Rule: shared defecation. |
| Gathering by pecking | The wiki data lists what a dodo gathers when it attacks plants: berries and their seeds, thatch, wood, rare flowers and mushrooms, cactus sap and others. | Rule: peck counts as a harvest hit. Number: gather rates (not found; chosen). |

## 10. Eggs, mating and breeding

| Function | ARK (1x) | Our dodo needs |
|---|---|---|
| Unfertilised eggs | Unique to the dodo: a female has a 13% chance to lay an egg in place of feces each time she defecates, about every 100 to 300 s. Other species use a 17-minute mate-boost timer. The dodo page also says a male nearby is needed for "an acceptable rate" and a wandering Oviraptor raises it further. Wild females lay too. | Rule: egg-in-place-of-feces chance. Socket: `vent`. Clip: none; no laying motion was found. |
| Egg item | Dodo Egg, an extra small egg. Food 20, weight 3, stack 100. Spoils in 8 days in inventory and 30 minutes on the ground. At most 6 eggs lie in one area. Ingredient of Basic Kibble. | Number: egg item. |
| Mating | Tamed male and female, both on wander or mating, not following, not overloaded, within a mating range set by adult size. A red heart icon shows over them while the bar fills. Then the female drops one fertilised egg. | Rule: shared mating. Socket: `overhead` for the heart icon. Clip: none; no mating motion was found. |
| Female cooldown | 64,800 to 172,800 s (18 to 48 hours). Males have none. | Number. |
| Twins | 10% twins, 2% triplets, shared rule. | Rule: shared. |
| Incubation | 2,999.76 s (49 min 59.76 s) at 22 to 30 °C (72 to 86 °F). Outside that range the egg loses health. An incubator at 26 °C can cut the time by up to 20%. | Numbers. |

## 11. Growth stages and babies

| Stage | Maturation | Time at 1x | What changes |
|---|---|---|---|
| Baby | 0 to 10% | 5,555.6 s (1 h 32 min 36 s) | Hand-fed from its inventory. Follows the nearest survivor. Cannot breed. |
| Juvenile | 10 to 50% | 22,222.2 s (6 h 10 min 22 s) | Can eat from troughs. |
| Adolescent | 50 to 100% | 27,777.8 s (7 h 42 min 58 s) | As juvenile. |
| Adult | 100% | total 55,555.6 s (15 h 25 min 56 s) | Can breed. Yields raw meat, not prime. |

- Health, food capacity and carrying capacity grow with maturation. Baby food use is high and falls as it grows; the wiki notes the rate changes by stage "at least for wolves and dodos".
- Imprinting asks for one of cuddle, walk or a named kibble every 8 hours. A dodo grows up in about 15.4 hours, so it gets very few requests.
- Babies use the adult clips at a smaller size. No baby proportions and no size curve were found. **Needs:** a size curve (chosen), the same clips.

## 12. Diseases

| Function | ARK | Our dodo needs |
|---|---|---|
| Swamp fever and mega rabies | The dodo is the only creature besides humans that catches and spreads them. Since ASE 242.3 only tamed dodos can be infected. Spread is airborne in PvP. Dead infected dodos still carry it. A cure gives humans and dodos 3 minutes of immunity. No visible symptom on the dodo is documented. | Rule, if and when we have diseases. No clip, no socket. |

## 13. Colour regions

Six regions. Where each sits comes from the wiki's region pictures of both games' models.

| Region | Name | Where it sits |
|---|---|---|
| 0 | Body | All the body and neck feathers, and the inner part of the wing. The main colour. |
| 1 | Face | The bare skin of the face, from the base of the beak back around the eye to the gape. |
| 2 | Beak | The whole beak, both halves. |
| 3 | Forehead, Neck and Feet | A strip over the eye, a patch on the throat, and the scaly legs and toes. |
| 4 | Head | The hood of feathers on the crown and the back of the head. |
| 5 | Wings and Patterning | The wing's flight feathers, and a faint pattern over the back and tail. Aberrant dodos glow here. |

Natural colours the wiki and the calculator list per region (ASE names):

| Region | ASE natural colours |
|---|---|
| 0 Body | Black, Dark Grey, Dino Dark and Light Blue, Brown (dark, medium, light), Green (dark, medium, light), Orange (dark, light), Purple (dark, light), Red (dark, light), Yellow (dark, light), Dino Darker Grey, Light Grey |
| 1 Face | Black, Dino Light Brown, Dino Medium Brown, Dino Light Orange, Dino Light Yellow, Light Grey |
| 2 Beak | Black, Dark Grey, Dino Darker Grey, Dino Dark Brown, Dino Medium Brown, Dino Dark Green, Dino Medium Green, Dino Dark Orange, Dino Dark Red, Dino Dark Yellow |
| 3 Forehead, Neck and Feet | Same as Beak |
| 4 Head | As Body, plus Dino Albino |
| 5 Wings and Patterning | Black, Light Grey, and the light tones: blue, brown, green, orange, purple, red, yellow; Dino Medium Brown, Dino Medium Green |

ASA narrows these to browns, greys, creams and a few warm tones (its list is in the wiki's ASA tab). Our colour set is ours; D5 picks it. **Needs:** a region mask with six regions in this layout; the colour set as content.

## 14. Sounds by occasion

Only one dodo sound is named in a public source: the ambient "mumble". ASE patch 256.0 gave the dodo new sounds; ASA's set is not documented. The other occasions are those ARK uses for creatures in general (the wiki's creature sound files are named idle, mumble, startled, attack, torpid out wild, torpid out tamed, cuddle and so on). We make our own sounds.

| Occasion | Confirmed for the dodo | Plays with |
|---|---|---|
| Ambient call while wandering | Yes (file name "dodo voc mumble"; "chirping noises as it strolls") | `call` |
| Pain | Usual | `flinch` |
| Death | Usual | `death` |
| Peck | Usual | `peck` |
| Startled, starts to flee | Pose seen for the dodo; the sound is usual for other species | `startled` |
| Knocked out | Usual | `torpor_in` |
| Waking, wild and tamed | Usual for other species | `torpor_out` |
| Footsteps | Usual | `walk`, `run` (foot sockets) |
| Imprint cuddle | Usual for some species; not found for the dodo | none |
| Laying an egg, defecating | Not found | none |

## 15. Left out on purpose

These exist in ARK but are other creatures, other editions or mods. None goes on our dodo.

- Variants: Aberrant Dodo (glowing wings, Aberration), Bunny Dodo and Party Dodo (event hats), Zomdodo (Halloween), Dodo (Arctic) and Dodo (Ocean) (Genesis colour sets), Pirate Dodo, DodoRex, Dodo Wyvern, Eerie Dodo, Chibi-Dodo (a cosmetic pet).
- Mobile-only equipment (Dodo Cultivator Bit, Dodo Decimation Bit) and mobile-only rideable dodos.
- Primitive Plus drops and foods (feathers, fresh poultry, wheat seed).
- Costumes (the animated-series costume). A costume swaps the whole look; nothing to build now.

## 16. Conflicts and unknowns

- **Tamed speed per level.** The ASE wiki page shows +3% (raw 0.03). The wiki's data module has 0.025. The calculator data and an ASA data site have 0.01 (+1%). I could not settle it. Suggest +1% from the calculator, which matches ASA, and flag it as chosen.
- **Peck stamina cost.** 5 on the wiki page, 0 in the wiki's data module.
- **Egg laying.** The Eggs page gives the 13% per defecation rule. The dodo page adds that a male nearby is needed for "an acceptable rate". Whether the mate boost and the Oviraptor change the 13% or the 100 to 300 s interval is not stated.
- **Kill XP.** Data base 0.5; infobox shows 2. The level scaling is the shared rule.
- **Not found at all:** corpse yields, gather rates, spawn group sizes, the baby size curve, any visible difference between sexes, and the exact motions of the held, carried, thrown, fleeing and idle states. I found no public video description or write-up that describes them, and I did not watch gameplay video.
- **Wings out.** The wings-out pose is confirmed as "Startled" (see section 2). Whether the wings also flap through `run` and `fall` is not confirmed; I treat it as likely.

## 17. The clip list

Nineteen clips, plus two optional (`turn`, `land`). "Additive" means it layers on top of whatever is playing.

| Clip | Loops | Motion | Plays when | Confidence |
|---|---|---|---|---|
| `idle` | yes | Stands with weight on both feet. Slow breathing in the chest, small head shifts, a blink. | Standing still, wild or tame. | Usual |
| `idle_look` | no | Lifts the head, turns it to one side, then the other, with the dim stare; settles back. | Random, from `idle`. | Usual |
| `idle_peck` | no | Bends the neck down and pecks the ground two or three times, then straightens. | Random, from `idle`. | Usual; the dossier says it pecks berries off bushes |
| `call` | no | Lifts the head, opens the beak wide, throat pulses through the mumble, closes. | With the ambient call sound. | Documented sound; motion usual. Official renders show the beak wide open. |
| `walk` | yes | Slow waddle. The body rolls side to side over each planted foot, the head bobs, the wings stay folded. | 0 to 65 units/s. | Documented ("waddle") |
| `startled` | no | Jerks upright, throws the head up, opens the beak wide and flings both wings out from the sides; then drops into `run`. | First hit or alarm, before fleeing. | Seen (official pose named "Startled") |
| `run` | yes | Faster waddle with a higher step. The body leans forward; the wings come out from the sides and flap. | Up to 136.5 (wild) or 95.55 (tame) units/s; fleeing. | Documented need; flapping unconfirmed |
| `turn` | no | Small stepping turn on the spot. | Optional; only if turning in place slides the feet. | Usual |
| `swim` | yes | Floats with the body level at the surface, head up, feet paddling behind; wings tucked. | Moving in water. | Documented need |
| `swim_idle` | yes | Floats in place, slow paddle, bobbing. | Still in water. | Documented need |
| `fall` | yes | Legs dangle and kick, wings flap fast, neck stretched up. | Airborne after a drop or a throw. | Documented need; motion usual |
| `land` | no | Short squat on impact, wings settle. | Optional; landing without dying. | Usual |
| `peck` | no | A quick lunge: the neck draws back, then the beak strikes forward and down, then recovers. No longer than 0.5 s, hit early. | Attack on order, aggressive tame, ASA wild flee, held peck. | Documented |
| `flinch` | no | Additive. The body jerks away from the hit, the head pulls in, a feather ruffle. | Taking damage. | Usual |
| `held` | yes | Held in a player's arms: legs hang, feet twitch, wings tucked, head looks about. | Picked up by a player. | Documented need; motion not found |
| `carried` | yes | Hangs from a carrier: legs dangle, wings half out, a slow struggle. May share the `held` pose. | Carried by a creature. | Documented need; motion not found |
| `torpor_in` | no | Knees give, it sinks to its belly and rolls onto its side, head down on the ground, eyes closed. | Knocked out. | Documented (ASA dev kit names Torpid-In) |
| `torpor_idle` | yes | Lies unconscious on its side, slow breathing; ground-conformed. | While knocked out. | Documented (the dev kit's example is the dodo's own) |
| `torpor_eat` | no | Additive on the head and neck: small lift and a gulp while lying. | Each item eaten while knocked out. | Documented for ASA |
| `torpor_out` | no | Rolls up onto its belly, gets its feet under it, stands, shakes its feathers. | Waking. | Documented (ASA dev kit names Torpid-Out) |
| `death` | no | Collapses forward and to one side, then hands over to the ragdoll. | Death. | Documented (ASA records directional deaths; ASE ragdolls) |

Not on the list, because no source shows a motion for them in ARK: laying an egg, defecating, mating, eating while awake, being cuddled, being dragged (ragdoll), being immobilised (keeps `idle`), any baby-only clip.

## 18. Sockets

| Socket | Where | Used for |
|---|---|---|
| `beak_tip` | Tip of the upper beak | Peck hit origin; eating point |
| `head` | Centre of the skull | Look target; head hit zone centre |
| `overhead` | A little above the crown | Mating heart, name and status icons |
| `carry_point` | On the back over the centre of mass | Talons, jaws, tentacles, pouch |
| `hold_point` | Under the chest, between the wings | A player's arms |
| `vent` | Under the tail | Eggs and feces appear here |
| `foot_l`, `foot_r` | Under each foot | Footsteps, planted-foot targets for the stride lock |

## 19. How elaborate the skeleton needs to be

Simple. About 26 to 32 deforming bones are enough for every clip above, and no face rig or blend shapes are needed. The count below is 26 before the optional bones.

- **Spine:** root, pelvis and two spine bones (belly, chest), so the body can roll in the waddle and lean in the run.
- **Neck:** four bones. The peck, the S-curve, the ground peck and the look-around all bend the neck in more than one place, and ARK's own hit data names a third neck bone, so its rig has at least three.
- **Head:** a head bone and a jaw for the lower beak (the call opens the beak wide). Eyelids are optional; closed eyes when knocked out can be a texture or a simple lid bone.
- **Legs:** a bird leg each side: thigh, shin, the long foot bone and one bone for the toes, so the feet can plant and roll. Separate toe bones and the hind toe are optional.
- **Wings:** three bones each (upper arm, forearm, hand), for the flaps in `run` and `fall` and folding at rest.
- **Tail:** two bones for the plume.
- **Optional helper:** one bone for the head hood to ruffle in `flinch` and `torpor_out`.
- **Non-deforming:** the sockets above.
- **Ragdoll bodies:** pelvis, chest, two neck pieces, head, both thighs and both shins; wings can ride along.
