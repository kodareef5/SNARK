# Dodo hurt and decay

The test blobs are replaced with original injury and harvesting paint on the accepted dodo. The opaque pair is **1024 × 1024 RGBA8, sRGB**. The shared feather-card pair is **256 × 256 RGBA8, sRGB**, enabled by the two added `dodo_cards` material lines in `asset.ts`.

Open [REVIEW.jpg](REVIEW.jpg) for all seven stages in default, loud and dark dyes, at the actual 2 m and 10 m render sizes. Each row is **unhurt → hurt 1 → hurt 2 → hurt 3 / fresh corpse → decay 1 → decay 2 → decay 3**. The small 10 m row is repeated with nearest-neighbour enlargement. The complete six-view sheets are [default](look/review_default.jpg), [loud](look/review_loud.jpg) and [dark](look/review_dark.jpg).

## FEEDBACK_3

Only the opaque hurt **RGB** is repainted. All four alpha maps retain their exact FEEDBACK_2 bytes; `dodo_decay.png` and both complete card PNGs are byte-identical. Mark anchors, extents, arrival fields, fascia, bones, plucking and rot are unchanged. The corpse naturally inherits the revised hurt colour underneath the unchanged decay layer.

- **Blood in feathers:** crimson and maroon replace the orange-red mat. The accepted height map now supplies the broad vane crests and recessed overlaps, while the accepted base map supplies stronger barb/shaft drawing. The feather drawing continues through the blood instead of ending at the patch boundary. An additional comb follows the baked feather tangent, with a 4.8 mm cross-feather / roughly 22 mm along-feather pitch. Lighter crimson sits on the crests, darker maroon in the gaps. A narrow dark collar remains beside the opening; the outer margin becomes quieter red-brown. Gravity drains retain their original direction and placement. None of this paints a specular highlight or changes engine wetness.
- **Wing gap:** the previous enclosed slit and its flesh/skin banks are removed. A ragged notch reaches one edge of the same 108 × 64 mm blood footprint, exposing a roughly 20–30 × 44 mm dark gap. Unequal broken feather ends, around 4–8 mm long, intrude along one short edge. Matting spreads from the remaining long edge; there is no matching red rim across the gap. This changes RGB inside the existing growth field only.
- **Distance value:** variation is centred within each mat rather than darkening the entire mass. In the native 10 m size sheets, the mean linear luminance of the same injured pixels changes by **−0.65% to −1.97%** across hurt 1–3 and all three dyes; hurt 3 is within **0.7%**. These measurements support the visual comparison, not a claim that hue or texture is unchanged. Hurt 2 and 3 retain their red areas in the 10 m world shot.
- **Evidence:** [close before / after](FEEDBACK_3_REVIEW.jpg), [10 m before / after in all dyes](FEEDBACK_3_DISTANCE.jpg), and the refreshed [world review](WORLD_REVIEW.jpg). The world review includes belly-up carcasses. The renderer uses the game's 256-pixel stored layer, not the 1024-pixel painting directly.

Checks found **0 changed alpha texels**, **0 hurt/decay overlaps**, **0 changed unhurt pixels in 18 views**, and identical output hashes on a second paint run. Fine barb strands still merge at 2 m on oblique surfaces, especially in the world shot; the larger feather crests, dark gaps and crimson mass carry the material there. The unchanged surface normals and shared cards limit how physically torn the wing can look. This pass adds no generated images or external source material.

## FEEDBACK_2

This pass changes **RGB only**. All four alpha maps, all mark placements and dimensions, the belly continuation, and both complete feather-card images retain their FEEDBACK_1 bytes. [10 m before / after](FEEDBACK_2_DISTANCE.jpg) is the primary colour comparison: default, loud and dark dyes at native resolution and enlarged 4×. [Close comparison](FEEDBACK_2_REVIEW.jpg) and the refreshed [world review](WORLD_REVIEW.jpg) show the openings and the belly-up carcass.

- **Distance colour:** the larger feather mat is now a clearer, more saturated blood red. The near-black-red opening remains, with a narrow dark collar beside it; that collar no longer darkens most of the wound. The red mat occupies the existing 64–126 mm-wide main injury envelopes and keeps their feather grain and gravity drains. At 10 m, hurt 2 carries red on the neck/breast/wing and hurt 3 adds the larger lower-breast/flank mass. No footprint was enlarged to obtain this read.
- **One-sided tears:** cut and rolled banks have independent lengths, widths, edge noise and longitudinal offsets. Flesh appears along the shorter rolled bank only. Blood-soaked feather fragments intrude on the opposite cut bank. Lateral openings are displaced within their existing mats; the wing has a diagonal, widening wedge rather than a horizontal slit between paired red banks. The nominal focus dimensions and the reveal fields remain unchanged.
- **Fascia:** continuous cream perimeter bands are replaced by short, separated cream-pink fragments, approximately 3–6 mm wide. Where fascia is absent, the dark hide edge and meat meet directly. Pale skin at the outer primary-cut margin is interrupted too; the wing's narrow plucked margin has disconnected skin fragments instead of another pale ring. The underlying alpha supports stay unchanged.
- **Bone:** the ribs, keel and shank retain their anatomy and reveal clocks. Their pigment now varies across each bone from a darker tan side to a subdued ivory face, with warmer partly covered ends. Dark meat remains between ribs. There are no white specular lines painted into the bone.

The 2 m and 10 m world shots were regenerated, including the belly-up corpse. The distance comparison uses the actual 10 m renderer pixels, with every enlargement labelled. Tiny facial marks and individual ribs remain close-view details; hurt 1 is still intentionally a small signal at 10 m.

## FEEDBACK_1

The revision replaces the evenly mottled red patches with focused injuries, and the broad olive/umber decay fields with distinct cut surfaces. [Before / after](FEEDBACK_1_REVIEW.jpg) compares unhurt, hurt 3 and decay 3 in the same front view. [World review](WORLD_REVIEW.jpg) shows all four living stages and all four lying-corpse stages at 2 m and 10 m, including labelled pixel enlargements.

- **Living wounds:** a tapered, uneven near-black-red opening sits inside each accepted feather wound. Unequal red flesh banks and small torn-skin fragments interrupt its edge; there is no continuous bright oval rim. Dark blood sits against the opening, with quieter red-brown feather matting beyond. Unequal 6–9 mm drains run with projected standing gravity, and elongated detail follows the baked feather direction. A few pale down tufts lie at the torn margin. The original cheek, horn and scale injuries remain.
- **Carcass materials:** the flank and breast cuts have a dark hide lip, a broken cream fascia band, longitudinal red-brown muscle, deeper dark recesses and ivory ribs/keel. Plucking is pale pinkish grey with fine follicles. Green-grey bloom is restricted to late edge fragments. The back and cap carry limited plucking rather than large meat/rot fields.
- **Lying pose:** the breast harvest continues down onto the exposed belly, in the breast's existing reveal window. This is the only new painted envelope; the original marks are not moved. It fills previously unused texels and never replaces or retimes existing paint. The flank still supplies ribs; the ventral opening continues the breast's keel crest.
- **Plumage and cards:** broad secondary decay coverage is removed so the engine can grade the actual slate/dyed feathers between cuts. The accepted shared blood stains remain exactly unchanged. Card decay is reduced to sparse ash-grey frayed ends, retaining the bands and base colour across most of each card.
- **Preserved:** `source/marks.json` is byte-identical to round 1. Both living alpha maps are byte-identical, including the late breast drag. Every retained original decay texel has its original alpha. No accepted base, height, normal, region, mesh or animation file was changed by this revision.

The original generated-image count remains zero. [source/pigments.json](source/pigments.json) records the new palette, focus dimensions and belly continuation; [source/README.md](source/README.md) explains the sources. The shaders still supply wetness, drying and whole-corpse dulling.

## Visual progression

- **Hurt 1:** a short breast split, a smaller folded-wing tear and an abrasion across the back; a cheek scratch/bruise, worn hook and a low shank gash support the close view. The large body marks carry the gameplay signal.
- **Hurt 2:** the early wounds spread into surrounding feather groups; a long neck rake opens, with a damaged brow, cracked horn and a small crown abrasion. Blood remains red on every dye.
- **Hurt 3:** a late blood-matted extension runs down the breast; larger flank and rump injuries join the breast, neck, wing and back damage. Dark off-centre openings sit inside crimson/maroon feather matting, with flesh on short rolled banks on the body. The wing has an open notch with broken coverts and no paired flesh rims. Shared fringes acquire sparse blood staining.
- **Decay 1:** cut breast, belly and flank flesh becomes visible, with small plucked margins around existing wounds. A fresh corpse already retains every living injury, so harvest occupies the remaining texels.
- **Decay 2:** the breast/belly opening and lateral rib field expand, with an exposed keel crest and a stripped section of shank. A limited amount of plucking appears over the back, wing and neck.
- **Decay 3:** cut hide, pale fascia, deep meat and exposed bone identify the worked carcass. Local edge bloom and frayed card ends support the rot signal while substantial plumage remains. The engine supplies the whole-body warm-grey dulling, darkening and drying.

## Placement, physical sizes and arrival

Coordinates and axes are in [source/marks.json](source/marks.json), in millimetres in the bird's rest frame. Each anchor is snapped to the current named mesh piece on every run. The dimensions below are the full nominal tangent-frame brush extents; curvature, torn edges and occlusion change the final surface footprint. `checks/manifest.json` records the snapped points and measured texel sizes.

The time range is the **start of reveal at the seed → start of reveal at the outer edge**, within that layer's three stages. A texel finishes approximately 0.25 stage later. These are continuous alpha fields, not three flat alpha bands. The `surround` fields start immediately outside the permanent injury footprint. Hidden surfaces are delayed slightly using the covered bake.

### Living injury

| Mark | Nominal size, mm | Reveal start range | Treatment |
|---|---:|---:|---|
| breast split | 127 × 113 | 0.02–2.72 | One joined midline injury; torn red flesh and clumped contour feathers. |
| late breast drag | 106 × 126 | 2.03–2.73 | Extends the breast injury downward at the worst living step; carries the 10 m front-view distinction. |
| neck rake | 124 × 68 | 1.06–2.73 | Oblique longitudinal split, broken feather banks and dragged blood. |
| wing tear | 108 × 64 | 0.12–2.65 | Open, ragged missing-covert notch at one edge; crimson matting spreads from the other. |
| back rake | 139 × 105 | 0.40–2.72 | One connected dorsal abrasion across several bars, avoiding a pair of mirrored spots. |
| low flank | 157 × 105 | 1.98–2.73 | Broad late trauma below/behind the folded wing. |
| rump blow | 101 × 91 | 1.93–2.73 | Joined rear injury visible from behind and in the lying carcass. |
| crown abrasion | 56 × 19 | 1.55–2.60 | Small strip of damaged cap feathers; preserves the hood silhouette. |
| cheek bruise | 31 × 23 | 0.24–2.58 | Muted rose/plum bruising on bare skin. |
| cheek scratch | 25 × 6 | 0.15–1.42 | Narrow red scratch through the bruise. |
| brow scrape | 20 × 10 | 1.12–2.57 | Scraped skin on the projecting brow. |
| hook scuff | 39 × 15 | 0.40–2.53 | Pale worn horn and a darker chip near the hook edge. |
| beak crack | 39 × 7 | 1.24–2.49 | Irregular split in the side of the horn. |
| shank gash | 31 × 18 | 0.30–2.67 | Low gash through the existing scale drawing. |
| toe scrape | 23 × 10 | 1.66–2.69 | Scraped upper surface of one toe family, away from the claw. |

### Carcass

| Mark | Nominal size, mm | Reveal start range | Treatment |
|---|---:|---:|---|
| breast harvest | 203 × 184 | 0.08–2.73 | Cut breast and lower-front hide; short pale keel crest. |
| rib flank | 194 × 233 | 0.26–2.73 | Broad opening below the wing; four curved, partly fleshed rib cues. |
| wing pluck | 157 × 89 | 0.65–2.74 | Hide/plucking damage expands outside the permanent covert tear. |
| back hide | 182 × 189 source envelope | 0.30–2.74 | Only plucked fragments within 13 mm of the dorsal wound; most of this envelope is now transparent. |
| neck pluck | 127 × 96 source envelope | 1.25–2.74 | Narrow pink-grey skin margins within 10 mm of the neck rake. |
| hind rot | 176 × 150 source envelope | 1.59–2.74 | Only late, local edge bloom within 8 mm of the rear injury; broad field removed. |
| cap loss | 69 × 61 source envelope | 1.46–2.73 | Small central plucked area, roughly 32 × 28 mm. |
| face mottling | 55 × 48 source envelope | 1.60–2.73 | Small pale-grey discoloration beside the cheek injury. |
| shank strip | 84 × 39 | 0.35–2.73 | Lengthwise stripped hide and pale bone beside/above the living gash. |
| breast underside continuation (FEEDBACK_1) | 238 × 280 | 0.08–2.73 | Continues the breast opening onto the exposed belly, with a partly fleshed ventral keel and short inward-turning rib ends. Fills unused texels only. |

Rib cues are approximately 6–8 mm wide, separated by about 28 mm and partly exposed over 60–90 mm. The keel crest is roughly 14–30 mm across the full mirrored bird where exposed; the underside continuation exposes up to 110 mm of its length with flesh over the ends. The shank bone is about 9–13 mm wide before tapering. Fascia fragments are about 3–6 mm wide, present on selected edges only. These are restrained surface cues, not a complete diagram of the skeleton. Living openings use nominal focus envelopes roughly 20–40 mm wide and 55–85 mm long inside their larger blood-mat footprints; their two banks occupy different lengths and widths within those envelopes. The wing instead exposes a roughly 20–30 × 44 mm notch at one edge of its blood footprint, without paired flesh banks. The small crown focus is about 7 × 28 mm. Torn skin/down fragments are about 4–10 mm. Small grain follows the existing accepted drawing.

### Shared feather cards

All seven rectangles are painted in their own physical proportions, read from the current card metadata. The body, trousers, mane, hood and forehead get irregular tip staining mainly during hurt 3 (earliest starts 2.0–2.35); the wing fingers start around late hurt 2 and the tail receives a smaller late smear. FEEDBACK_1 keeps that blood image byte-for-byte and restricts decay to sparse ash-grey terminal fragments, retaining the surviving texels' original reveal times. These are diffuse feather stains, with no repeated isolated wounds, rib marks or little cuts on every card. The accepted cutout alpha and geometry remain the source of the outline. The card hurt/decay alpha supports are disjoint too.

## How it is painted

`paint.py` reads the current piece IDs, corrected 16-bit position maps and bounds, physical texel metric, normal bake, feather direction, covered bake, card rectangles, and accepted base/height/region maps each time. It transforms the UV feather direction through the position derivatives into a physical tangent. The original mathematical brushes are placed and sized in that frame; the accepted vane/scale grain anchors their colour detail. FEEDBACK_3 also extracts the broader feather crests and overlaps from the accepted height map for blood matting, separately from the unchanged carcass grain. It retains the base-map barbs and combines them with physical feather-aligned clumping; no dye colour is copied. There is no copied game imagery, generated raster dependency, painted specular reflection, or baked whole-body decay grade.

Growth comes from a continuous, irregular physical-distance field: seed alpha decreases towards torn feather edges. Broader seeds establish the first injury step, and later fields add larger neck/flank damage. RGB at a texel is fixed. Decay is explicitly cut out wherever hurt alpha is nonzero, after gutter extension as well. Four source pixels of nearest-surface gutter protect UV boundaries; unused pixels are transparent black.

Only the four layer PNGs, this `tex/layers/` work, and the two card-layer material entries were changed for the overall task. All feedback passes leave `asset.ts` unchanged. FEEDBACK_2 leaves both card PNGs byte-identical; FEEDBACK_3 also preserves the entire opaque decay PNG. Existing base colour, height, normal, region maps, mesh, clips and pack are not rewritten by these scripts.

## Rebuild and review

From the dodo directory:

```sh
python3 -B tex/layers/paint.py
bun tex/layers/look.ts --out tex/layers/look
bun ref/world/snap.ts hurt_2m hurt_10m decay_2m decay_10m --tier medium --out tex/layers/world
python3 -B tex/layers/review.py
python3 -B tex/layers/feedback_review.py --round 3
```

Python dependencies: NumPy, SciPy and Pillow. No network, Blender or image-generation call is needed. `source/marks.json`, `source/pigments.json` and the brush code are the original sources. The scripts have no clock-dependent output or unseeded randomness. The paint manifest records all input/output SHA-256 hashes and surface-weighted coverage; the review manifest verifies PNG format, sRGB chunks, alpha overlap and renderer identity. Optional `checks/round1/`, `checks/round2/` and `checks/round3/` snapshots enable before/after and alpha comparisons; they are not inputs to painting. The feedback review defaults to round 3; explicit earlier round numbers compare against those earlier snapshots.

## Final validation

- The supplied game renderer completed all seven stages in six views plus the 2 m / 10 m sheets, in all three dyes (21 output images).
- The supplied world renderer completed `hurt_2m`, `hurt_10m`, `decay_2m` and `decay_10m` on the medium tier, plus its two 10 m enlargements. The lying view informed the breast/belly continuation.
- All 18 close-view unhurt columns are pixel-identical to the pre-paint baseline (maximum channel difference **0**).
- All four PNGs pass RGBA8, square-size and sRGB-chunk checks. Hurt/decay overlap is **0 texels** for each material.
- FEEDBACK_3 comparison finds **0 changed alpha texels across all four PNGs**, with the complete opaque decay and both card images byte-identical. `marks.json`, the focus configuration, belly continuation, carcass palette and `asset.ts` are unchanged. The close and distance sheets were regenerated in all three dyes.
- FEEDBACK_2 comparison finds **0 changed alpha texels across all four PNGs**. Both card PNGs are entirely byte-identical. `marks.json`, the focus dimensions, the belly continuation and `asset.ts` are unchanged.
- Comparison against round 1 finds **0 changed living-alpha texels** and **0 changed reveal times on retained decay texels**. Opaque decay withdraws 59,661 source texels and adds 24,849 for the belly continuation; card decay withdraws 21,145. The complete card hurt PNG is byte-identical. These are source-atlas counts, including gutters, not square millimetres.
- A second complete execution of `paint.py` produced **identical SHA-256 hashes for all four PNGs**.
- Surface-weighted opaque coverage is approximately **1.4%, 4.8%, 15.4%** at hurt 1/2/3, with an additional **2.8%, 10.8%, 18.3%** at decay 1/2/3. Round 1 had 22.7% additional decay coverage at stage 3. This is a bake-area measurement, not screen coverage.
- `git diff --check` passed for the authorized work. No pack rebuild or full game test suite was needed for these texture-only changes; the preview repacks in memory and writes only its output folder.

## Limits that remain

- These are pigment layers on the existing surface. They cannot remove feather cards, change the silhouette, recess a cut or replace the existing feather/scale normal under exposed skin and bone. Some original relief remains visible in closeups.
- Mirroring is inherent. Central breast, back and rump injuries are joined across the centreline; lateral injuries stay on surfaces rarely seen together. A direct, carefully aligned front/back inspection can still reveal symmetry.
- At 10 m red blood matting and the contrast between openings and surviving plumage carry the message. The cheek scratches, horn crack, down fragments and individual ribs are close-view details. Hurt 2 versus hurt 3 is clearest at 2 m; at 10 m their distinction is primarily the extra lower-breast and flank/rump coverage. On the exaggerated pink dye, the red hue contrast is smaller than on slate or dark plumage, though the injury masses remain visible.
- The most exaggerated bright dye retains strong colour in unpainted feathers even at decay 3; the engine controls whole-body desaturation. That surviving colour is intentional in this revision.
- The standing sheets expose the ribs more clearly than the lying-world view; the folded wing and body roll can hide some rib detail. The underside cut is judged in the actual lying pose as well. At the world's 10 m size, separate bones and material bands merge into a few contrasting pixels.
