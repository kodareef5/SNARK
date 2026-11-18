# Tyrannosaurus rex

[Native model and saddle review sheet](native-review.png)

The adult stands 4.25 m tall in the neutral rig. Its 12.09 m outline balances the roughly 2 m cranial region against a tapering tail and a broad hip. The belly has space for the gastral basket, with the ribcage narrowing into the neck ahead of the shoulders. The Field Museum’s SUE mount and its documented gastralia informed those proportions. [SUE, FMNH PR 2081](https://www.fieldmuseum.org/collection-item-iconic/sue) · [The Field Museum on SUE’s remount](https://www.fieldmuseum.org/blog/fresh-science-makeover-sue)

The textured hide carries small scales across the flanks and neck. The head adds larger coalescing scutes around the orbit and nostril. This is an original interpretation at game resolution. Bell and colleagues documented pebbly scales in preserved patches of adult tyrannosaur skin. The lip margins take their closed profile from the soft-tissue reconstruction discussed by Cullen and colleagues. The game’s long roar opens the lower jaw to expose the tongue, palate and fifty tapering teeth carried by the two jaws. [Bell et al., 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5493735/) · [Cullen et al., 2023](https://pubmed.ncbi.nlm.nih.gov/36996202/)

Studio Wildcard’s original TLC comparison was the game-art reference for the muscular hip, raised brow and dominant head silhouette. Its Survival Ascended launch artwork also shows the shoulder-mounted rider above the body silhouette and the open jaws in a frontal encounter. The short arms have two separate clawed digits. Each load-bearing foot has three spread toes and a smaller elevated hallux. The nearby Quaternius CC0 comparison has 912 source vertices, no UV set and six actions. The sources here create every vertex, joint, animation and material map for this animal. [Wildcard’s original Rex comparison](https://steamcommunity.com/sharedfiles/filedetails/?id=1267375377) · [Wildcard’s Survival Ascended launch presentation](https://www.youtube.com/watch?v=0gLODoXanog) · [Quaternius Animated Dinosaur Pack](https://quaternius.com/packs/animateddinosaurs.html)

## Native asset

Build with `bun tools/art.ts core:rex --no-sheet`. The authoring pass writes the resting mesh and its UV layout under `var/rex`. To repaint, run `tex/paint.py` with NumPy, SciPy and Pillow after building, then rebuild the pack. Reproduce the pictured frames with `bun tools/rex/review.ts bc` and `bun tools/rex/review.ts astc`. The renderer decodes the production block encoders’ complete mip chains. The left face closeup on the sheet uses BC and the roaring face uses ASTC. The captures use the game’s noon lighting.

| Feature | Native measurement or implementation |
|---|---|
| Geometry | 35,576 triangles at the finest level. Seven body and four worn-saddle levels. All eleven are closed, consistently oriented meshes. |
| Rig | 29 bones, 25 hit capsules, 17 sockets and 19 clips at 30 Hz. The throat, palate, orbital rims, changing lid and tooth rows have separate physical surfaces. |
| Pigment | Six dye channels over the two 2K main materials. The eyes, teeth, tongue and 1K saddle preserve their own colours. Separate 256-pixel hurt and decay pictures supply the combined damage texture. |
| Motion | 3.36 m per walk cycle and 6.16 m per run cycle. At their authored 2.8 and 8.4 m/s rates, the native checker measures 2.7 cm and 0.2 cm of planted toe travel. The swim covers 3.8 m per cycle at 3 m/s. |
| Bite | Frames 8–11 of 23 lower the upper bite socket from 2.77 m to 2.22 m. Its forward reach stays between 4.64 and 4.72 m from the animal origin. |
| Riding | A leather pad follows vertical casts onto the actual back. Two girths follow radial skin samples. The saddle tree, grips and stirrup irons share the chest’s frame with the seat, hand and foot targets. |

## Ground contact

The death animation hands off at frame 50. The torso, skull, two tail sections, hands, shanks and toes supply ten physical bodies. The transverse pelvis describes the combined support of the two hips. Across every frame of the five collapse, unconscious, eating, recovery and death clips, the finest skinned point stays between 6.1 mm below and 4.5 mm above the ground. In the unconscious idle it stays 0.8 mm above ground.

Run `bun tools/rex/contact.ts` to measure the packed vertices after the native solver settles. The probe tests eight yaws at each grade and keeps the original 60 Hz simulation step. On a level floor the lowest skin point is 2.5 cm below the surface across those yaws. The corresponding worst point is 2.9 cm below at 12% grade and 6.1 cm below at 35% grade. All 24 falls sleep within 2.47 seconds. The body uses simple capsules, so individual scutes and toes can pass through terrain by the measured amounts.

The complete native pack for these measurements has SHA-256 `5a990153f6c87427f4b6e9e6eab70d6518693f532af0cc044dacc5394da7cb97`.
