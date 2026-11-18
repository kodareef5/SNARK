# Weathering masks for an 8 m × 4 m wall bay

All four masks are single-channel, 8-bit greyscale PNGs. I checked their PNG headers, dimensions (2048 × 1024), linear gamma tag (1.0) and decoded range (0–255). Each texel covers 3.906 mm in both directions. The shapes were generated at this resolution.

## Runoff · runs.png

Four slab-edge drainage points feed overlapping stains. Each has a wandering centre, two uneven banks and thinner trails that can separate from the main track. Smaller clusters between them carry a lighter wash. I softened the lower part of the longest track after it stood out in the first tiled proof.

About 22 cm below the slab, the four main tracks measure 7–16 cm across at half their local peak. The average mask value drops from 50 at the slab to 1.3 halfway down. A few faint traces reach the floor, where the strongest pixel is 9. The spacing of the heads is still the easiest feature to recognise in an unshifted repeat.

## Rising damp · damp.png

Overlapping wet blooms form the broad field. Smaller displacements break up their edges, and narrow deposits follow portions of three drying fronts. I rank-ordered the result into 256 levels. Every level contains exactly 8,192 texels.

At the four tested thresholds, wet pockets grow necks, join and leave small dry islands behind. On the wall, this gives the damp foot an uneven upper edge with a few detached blooms. The finest salt rims are visible at source scale and become hard to distinguish at street distance.

## Peeling plaster · peel.png

A broad adhesion field groups the losses. Local offsets across three sizes of irregular fracture cell give each flake a few flat facets, nicked corners and small neighbouring chips. I varied the fracture directions after the first version produced long diagonal sweeps. This field also has exactly 8,192 texels at each level.

At the 80% cut, the largest connected loss spans 80.1 cm along its longer image axis, including connections across tile boundaries. At lower cuts, neighbouring losses meet and thin tongues of paint survive between them. The tiniest satellites merge into a stippled fringe in the reduced wall view.

## Formwork · joints.png

The joint centrelines follow a 512-texel pitch in both directions. Small lateral deviations, variable widths and short deposits of escaped grout interrupt their edges. Each panel has nine tie holes on a nominal 62.1 cm pitch. I measured 72 distinct holes at half intensity, with a median equivalent diameter of 2.53 cm. The nearest hole centre sits 37 cm from a joint.

The median joint width at half intensity is three texels (1.17 cm). The lines crossing the tile edges have the same single core as the interior joints when tiled. The pitch stays readable across the wall, although the small differences between tie-hole collars mostly disappear at that scale.

## Scale · material.json

I wrote and parsed the two metre dimensions and checked them against the mask resolution and panel pitch. Four panel widths fill the bay and two panel heights fill the storey.

## Visual checks

- [Tiled sheet](checks/tiled.png) shows literal 3 × 3 repeats, without offsets or mirroring, viewed at half source resolution. I inspected the joins and compared adjacent texels numerically. For damp, mean changes across the horizontal and vertical wraps are 4.94 and 4.91 grey levels, against 4.70 and 4.77 in the interior. For peel the corresponding figures are 10.05 and 9.66, against 8.68 and 9.91. This check caught a vertical wrap error in an earlier peel field. The exact repeats are easiest to trace in the runoff panel.
- [Threshold sheet](checks/thresholds.png) uses a strict greater-than test on the saved bytes at 51, 102, 153 and 204. White occupies 79.7%, 59.8%, 39.8% and 19.9% of each row's four panels. Zooming in shows the difference between ragged damp contours and chipped plaster facets. At fit-to-window size some of the narrow surviving bridges disappear.
- [Wall proof](checks/wall.png) covers 24 × 12 m on an evenly lit pale grey base. I shifted and mirrored the weather fields between bays, blended their values at joins, and kept the formwork aligned. The peel cutoff varies with a broad sample of the damp mask and falls under runoff and near the foot. The ground-height comparison confines the green-grey staining to the lowest 0.8 m. At reduced size I can distinguish all three slab edges and the damp foot, with clearer areas between the losses. The proof uses a flat base, so it tests the scale of the weathering separately from the game's close-up material grain.

The fixed-seed source is in [make_masks.py](make_masks.py). [make_checks.py](make_checks.py) reads the saved PNGs to rebuild the three proofs.

## Round two

A 10–40 cm wash feeds five heavy runs, with finer paths that fork and rejoin between them. At 26 cm below the slab, the five runs measure 6–18 cm across at half peak. Stain covers 35.3% of the bay, with a median nonzero value of 29/255. Three tracks reach the floor line. The strongest texel in the bottom 5% is 7/255.

At 10% loss, three peel cores open at different heights, each 1.6–1.8 m across its longest image axis. At 30%, separate flakes open around them. At 60%, losses join across 59.8% of the tile. Rank ordering preserves exactly 8,192 texels per grey level. [Threshold sheet](checks/thresholds.png)

The wraps show no visible joins. The close pair of runoff heads is still recognisable in literal repeats. Shifting and mirroring the bays breaks up that spacing on the wall. SHA-256 checks confirmed that the damp and joint files match their first-round bytes. [Tiled sheet](checks/tiled.png) · [Wall proof](checks/wall.png)
