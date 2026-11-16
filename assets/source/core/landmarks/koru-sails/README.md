# Koru sail art

Five original, photograph-informed technical-canvas sails add controlled hoisting to the accepted moored yacht: three quadrilateral gaff mains and two triangular headsails. The primary silhouette reference is [Oceanco's official under-sail profile](../koru/ref/photos/01-profile.jpg); source provenance remains in [the yacht reference dossier](../koru/ref/REFERENCES.md). Sail dimensions, reinforcement patterns, cloth panels and mechanical details are original interpretations. No reference photograph pixels or external meshes enter the production assets.

The public exterior control is a bronze-and-ivory winch pedestal beside the port arrival. Its in-world plaque reads **SAILS**. The authored standing point stays on the existing clear gangway route. The vessel's hull, interiors and mooring remain static while the five sails share an 18-second reversible command. The runtime owns authority, synchronization, persistence and prompts.

## Measured source

`author.py` writes `content/landmarks/koru-sails.json`: ship-local anchors, right-handed sail frames, four-corner main and three-corner jib outlines, exact bone order, contiguous folds and rigid gaff endpoints. Mains use 75 cm horizontal folds; headsails use 50 cm folds across their inclined luff. Main luff cars connect the cloth to the existing mast track. Headsail luffs follow the existing forestays with 10 cm radial clearance and 60 cm terminal insets to clear mast and bowsprit fittings. The outer and inner headsails furl to opposite sides of their stays.

`model.py` creates six levels for each of the five native skinned assets. Every cloth band is a closed 3 mm-thick solid with a restrained 12 mm crown and straight shared hinge boundaries. Fine cloth carries original two-metre repeating woven/panel maps, edge tapes, battens and corner stitching. Coarser authored levels retain the complete outline, all fold bones and rigid head spar. Fine and flat fallback colors remain warm ivory and restrained gray reinforcement.

The existing native skinned path poses each fold with rotations and translations. Adjacent hinge positions accumulate through one chain. A smoothstep of authoritative progress eases the visual motion without changing its 18-second duration. The gaff rotates and uniformly retracts as the sail lowers, so its peak stays aligned with the folded cloth; at full hoist it returns exactly to its full-size rest geometry. This intentionally simplified transition preserves correct normal transforms and avoids a projecting head-cloth neck. Cloth near the whole finite head edge shares its gaff bone, including the leech beyond the peak's chord coordinate. Peak halyards join fixed masthead fairleads to the moving head spars using the same existing bones. This is a coordinated visual hoist, not a cloth or sailing-physics simulation. Static boom meshes contain no permanent duplicate sail bundles.

## Rebuilding and review

From the repository root, with the existing Blender/Bun/Python authoring tools on PATH:

```sh
python3 assets/source/core/landmarks/koru-sails/author.py
python3 assets/source/core/landmarks/koru-sails/tex/paint.py
bun assets/source/core/landmarks/koru-sails/build.ts
```

The five `koru_sail_*` folders are ordinary discoverable native assets. Their explicit `authoredLevels:true, flat:1` preserves authored coarse geometry and bone ownership; the default creature conversion is unchanged. The finest surface still receives the normal native tangent and palette-fallback bake. Native geometric errors are measured conservatively; the delivered coarse errors all exceed the accepted 8 mm appearance floor. Rebuilding the whole yacht's changed booms/control separately uses `bun assets/source/core/landmarks/koru/build.ts`.

`build.ts` runs native conversion/material/topology checks and then `audit.ts`. The latter reads actual decoded pack vertices and all nonzero skin influences at all six levels, derives per-bone source boxes, and applies the production `sailPose` over 1,025 phases. A conservative derivative allowance covers intervals between samples; the swept sphere additionally reserves 2 m. The bounds certificate includes each pack's SHA-256, triangle/error counts and the interval allowance. In isolated author worktrees only, `KORU_SAIL_POSE_SOURCE` can point to the identical production helper before integration; normal builds use `client/core/render/sails.ts`.

`tests/unit/koru-sails-art.test.ts` checks delivered topology, six-level budgets, palette fallback, rig identity/bone order, every vertex's culling-box coverage and gaff peak attachment. The converter's small independent fixture also proves authored silhouette/bones survive while the ordinary automatic path retains its previous behavior. Native application review covers lowered, partial and raised states, both light directions, flat tiers, reversed motion and multiple placements.

`bun tools/koru-sails/clearance.ts` independently poses actual weighted vertices and clips triangles against the authored walking corridors and full sun/aft upper decks. The delivered [clearance evidence](ref/clearance.json) covers 129 phases, all six levels and the finest flat fallback. No tested headroom prism is penetrated: minimum headroom is 3.345 m over the sun deck, 4.393 m over the aft upper deck and 3.985 m over the foredeck walking route. This sampled acceptance audit is separate from the continuous culling-bound certificate; it does not claim continuous-phase collision certification.
