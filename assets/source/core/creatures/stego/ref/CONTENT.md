# Stego content: sources, native measurements and chosen tuning

This registration is an integration checkpoint. The original art is not accepted for delivery. Facial anatomy, leg/plate forms, rider mesh clearance, swimming, lifecycle motion, audio/effects and native gameplay review remain open. No ARK asset is included.

## Evidence and exact reference values

The factual subset in `reference-values.json` identifies the ordinary blueprint `/Game/PrimalEarth/Dinos/Stego/Stego_Character_BP.Stego_Character_BP`, rather than a mission or summoned variant. It pins [ARK Smart Breeding base values](https://raw.githubusercontent.com/cadon/ARKStatsExtractor/f03495cec4fa0d43581261b3b78d1ac03a3fff85/ARKBreedingStats/json/values/values.json) at commit `f03495cec4fa0d43581261b3b78d1ac03a3fff85` (version 358.17.12291776), including download SHA-256. This is evidence from a community-maintained calculator dataset, not a claim of auditing Wildcard's executable.

The corresponding [ASA data](https://raw.githubusercontent.com/cadon/ARKStatsExtractor/f03495cec4fa0d43581261b3b78d1ac03a3fff85/ARKBreedingStats/json/values/ASA-values.json), version 97.0.1, contains only `skipWildLevelStats: 512` and region intensities for this ordinary blueprint. It supplies no replacement taming/stat values. That observation alone is not independent verification of every current ASA mechanic. SNARK retains its established ASE stat-point rules; ASA's disabled wild-speed allocation is not silently claimed.

| Property | Source value | SNARK representation |
| --- | --- | --- |
| Health / stamina / oxygen / food / weight / torpor | 650 / 300 / 150 / 6000 / 500 / 500 | Matching bases |
| Wild gains | .2 / .1 / .1 / .1 / .02 / .06 | Matching curves; torpor counts all wild levels |
| Raw tame health / melee gain | .27 / .1 | .054 / .017 after existing default multipliers .2 / .17 |
| Speed tame addition | .964 | Preserved as source metadata; effective tame movement includes it once |
| Knockout affinity | 6000 + 300 × level | Exact source coefficients |
| Food base × unconscious multiplier | .005341 × 208.0343 | 1.1111111963 food/s before server multipliers |
| Taming ineffectiveness / base torpor drain | .1 / .3 per second | Exact source coefficients |
| Incubation / maturation | 9999.20006 / 185185.185 seconds | Converted to simulation ticks |
| Head / central spine damage | 1.67 / .7 | Head and torso zones; not a claim of exact per-bone equivalence |

[Stegosaurus](https://ark.wiki.gg/wiki/Stegosaurus) and [base creature speeds](https://ark.wiki.gg/wiki/Base_creature_speeds) supply attack damage 42 and distinguish wild walk/run/swim 1.7/6.077/3 m/s from tamed bases .765/2.104/1.35. Applying a fresh tame's .964 speed addition gives 1.50246/4.132256/2.6514. These are community reference values. Zero jump is explicit; the species must never pay jump stamina or briefly leave the ground on a jump input.

The [Stego Saddle](https://ark.wiki.gg/wiki/Stego_Saddle) reference supplies level 26, 15 engram points, armor 25, weight 20, 200 hide/110 fiber/35 wood, and 125.6 crafting XP. Ten seconds is a SNARK crafting choice. The [Stego Egg](https://ark.wiki.gg/wiki/Stego_Egg) supplies medium size, weight 12, food/health 55, stack 100, eight-day spoil and thirty-minute ground decomposition. The shared egg item has no stamina restoration field, so the reference's 55 stamina is not implemented here.

## TLC behavior and explicit choices

Wildcard's [TLC 3 release](https://steamcommunity.com/ogg/346110/announcements/detail/2940248818748830997) establishes three visible plate modes: hardened damage reduction/wood, heavy slow/thatch, sharpened piercing/berries; impaling small creatures/players; rider dismount protection; berry weight reduction. It does not establish every numeric parameter below. The release, rather than an earlier preview's narrower wording, is the protection baseline. Protection is not immunity to all crowd control.

Mode order is **0 hardened, 1 heavy, 2 sharpened**. Current SNARK tuning is .5 incoming damage in hardened, .5 movement for ten seconds after heavy contact, full armor bypass in sharpened, 3× preferred and .5× other harvest yields, .25 berry carried weight, and a thirty-tick visible switch. Tail swing is 42 damage/12 stamina/35 ticks; secondary is 22 damage/20 stamina/31 ticks with a ninety-tick cooldown. Secondary uses a .45 m volume on the actual distal spike, first at torso height and then lifting through its hold clip. Impale eligibility currently requires drag ≤200 and health ≤50%, lasts up to six seconds, drains fifteen stamina/s and deals eight damage/s. These are deliberately reviewable initial tuning, not verified ARK constants.

Turn rate 65°/s, mass 5000 kg, drag 250, sight/leash/alarm, inventory, corpse yield, kill XP, camera framing and action timings are SNARK choices pending play review. Do not present the selected drag value as independently source-verified. Generic berries represent the existing 20-food/20-affinity food; absent kibble/crops/mejoberries are not fabricated as new items.

## Native geometry and contact contract

The current checkpoint has six body LODs 31816/14000/6200/2600/1000/340 triangles, 45 bones, closed geometry, at most four skin weights, and no native topology/UV/skin validation faults. Bounds are 2.50 × 4.12 × 9.15 m, with top at 4.120 m and honest collision height 4.13 m; walk/run authored strides 1.8/2.4 m measure 1.78/2.39 m. These checks do not constitute an art pass.

Primary contacts use the posed `tail_tip`, radius .8 m, ticks 14–21; primary clips are left `attack` and mirrored `attack_right`. AI aims at a 150° rear quarter, 5.3 m away with a 20° tolerance. Only tail_1…tail_7, neck_1…neck_3, skull and jaw are action-layer bones; all pelvis/chest/limb gait rotations continue. Native tests verify mirrored rear arcs remain inside reach. Secondary uses the identical physical `impale` socket for striking and attachment; tick23 and first hold both place it at [-3.15693,1.15698,-5.05934] m before its half-second lift to about1.72 m.

The seat is [0, 2.59, 1.17] m. Palm targets relative to it are [±.17, .31, .27]; ankle targets [±.29, −.49, .30]. Independent native HUMAN IK tests cover 158 poses across both sexes and extreme proportions with sub-micrometre skeleton residuals and preserved pelvis/limb lengths. This does **not** clear rider skin against hide, plates or stirrups: those actual meshes still require gait/attack/mode-extrema review. The physical tread is below/ahead of the ankle, not coincident with it.

## Open integration gaps

- `tameBonus` is presently registered as a stub; `server/survival.ts` derives speed ratios from genome curves without adding .964. Source bases and the factor are named separately in content, and effective tame movement is 1.50246/4.132256/2.6514 before domestic level modifiers. A regression checks the actual movement values and fresh genome ratios together to catch double application when the global feature is implemented. Other tame-add/affinity stat bonuses remain unsupported; this registration does not activate them for unrelated species.
- Ground eye1.32 m is unchanged. Measured `swimDepth:1.75` and awake-only `swimEyeHeight:1.95` follow raised lower nostrils at1.96364 m and a trunk-only displaced-volume check; paired `breath_l/r` witnesses are documented in `breath-landmarks.json`. Native tests cover blended water-specific startle/land/recovery poses. KO retains ordinary submersion rules.
- No ambient spawn-table change is included. The combined native review course supplies deliberate test animals first.
- Native source/rendered pack equality is re-established for this integration checkpoint. Actual gameplay, rider skin/soles/gear, material/anatomy quality and hurt/death/decay/effects playback remain gates. Cue sources and existing audio names are bound, but their actual audiovisual timing still needs review.
