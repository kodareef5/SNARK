Painted `beak`, `jaw`, `beak_palate`, `jaw_floor` and `tongue` onto the supplied
2048-square layout. The upper and lower beak reuse the accepted round-4 horn;
the three mouth pieces have their own dull pink-grey colours. All 468,537
assigned texels are covered, with zero alpha and zero layer data elsewhere.

Rebuilt after the shared position-map correction. The painter now uses the
positive-X left-side coordinates directly, and the checker no longer reflects
the baked object normals. The widened position range is decoded from the
current `pieces.json`; no old bounds are hard-coded. Coverage and region bytes
are unchanged. Ring, channel, nostril and wear mask centres shift less than
0.005 mm, and the scratch field centre shifts 0.011 mm. The small resampling
changes are at most three base-colour byte levels and 0.0198 mm of height.
The five pieces reach only Y=610.503 mm, below the previous crown clipping
height. Placement parameters therefore remain unchanged. The corrected-map
measurements and before/after comparison are in `checks/position_correction.json`.
The refreshed head, front/side/back and open-mouth previews confirm the bands,
low nostril, hook and edge wear, palate ridges and tongue groove remain in place.

`paint.py` samples the accepted `horn_base.png`, `horn_height.png` and
`horn_packed.png` at their original 256 mm tile span. These carry the generated
fine drawing, quiet longitudinal drift and varied craters from
`tex/studies/beak/source/horn_r2b_generated.png`. No new generation was needed,
and the accepted study was not changed. The painter reads the current piece IDs,
16-bit positions, local texel sizes and baked regions on every run. It never
uses a saved list of texels or rescales an image to an island's bounding box.

Grain follows forward Z and bends down the hook. Symmetric X coordinates make
the drawing meet the mirrored half smoothly. Native pits, incidental scratches
and their intrinsic values remain coupled to the accepted height. A second
sample adds only crater concavities near the base and hook. The new anatomy and
wear are measured in millimetres in the bird's rest space:

| Feature | Placement and physical size |
| --- | --- |
| Three growth bands | First channel 4 mm forward of the visible skin junction; three 5.797 mm rounded bands, 0.65 mm proud, with 0.15 mm-deep narrow channels. The curved junction is recorded in `layers.json`. Pale crowns and darker floor pigment accompany the relief. |
| Nostril | Low on each side, centred at Y=553, Z=247 mm; approximately 23 × 3 mm envelope, 1.2 mm depth, with a soft 0.085 mm rim. |
| Dorsal ridge | Additional 0.16 mm relief along the model's crest; turns down into the hook. |
| Hook wear | Follows the dorsal arc to the tip near (0, 498.5, 333.5) mm, with a soft 16 mm falloff and strongest polishing at the tip. |
| Cutting edges | Narrow pale, smoother wear follows the actual upper and lower cutting boundaries; jaw tip also polished. |
| Three crossing scratches | Tapered, curved 14–18 mm marks at differing angles, 0.05–0.07 mm deep; small keratin lips. |
| Palate | Soft transverse ridges at 5.4 mm intervals, rising 0.27 mm; fade toward the root, tip and horn junction. |
| Mouth floor | Smooth, with only about 0.006 mm fine relief. |
| Tongue | Paler and pinker; filtered fine papillae, approximately 0.35–0.65 mm across, plus a dark median groove with 1.1 mm width sigma and 0.24 mm maximum depth. |

The literal root of the beak island extends inside the head. The initial band
placement was hidden by the face; the final bands follow the visible junction
measured through the position maps. Broad horn and mouth volume comes from the
model. Base colour contains intrinsic material drawing and wear, with no form
lighting or baked form AO. Only one global horn mean correction is applied;
the intentional pale tip remains lighter than the root.

The delivered files in `layers/` are RGBA8 sRGB `dodo_base.png`, linear grey16
`dodo_height.png`, linear grey8 `dodo_rough.png` and `dodo_occlusion.png`, and
categorical RGB8 `dodo_regions.png`. The full height range is **4 mm**, with a
1.7 mm working datum. `compose.py` supplies the normal map and multiplies the
model's AO into the material AO. Five additional masks retain wear, bands,
channels, nostril and scratches for inspection. `layers.json` records dimensions,
parameters, coverage and hashes of the accepted study inputs.

| Piece | Texels | Median mm/texel | Used height, mm | Mean roughness | Mean fine AO |
| --- | ---: | ---: | ---: | ---: | ---: |
| beak | 338,180 | 0.214 | 0.475–2.513 | 0.436 | 0.990 |
| jaw | 107,720 | 0.239 | 1.547–1.716 | 0.451 | 0.998 |
| beak_palate | 9,621 | 0.563 | 1.689–1.978 | 0.283 | 0.976 |
| jaw_floor | 5,142 | 0.642 | 1.693–1.709 | 0.263 | 1.000 |
| tongue | 7,874 | 0.454 | 1.439–1.750 | 0.324 | 0.994 |

Both horn pieces are exactly neutral RGB, with combined region-2 linear mean
**0.500033**. Region colours match the bake exactly: blue horn, black mouth.
Strongly worn horn averages 0.8607 linear value and 0.2700 roughness, against
0.4655 and 0.4560 on unworn horn. Interior mean sRGB colours are approximately
(137,111,114), (144,117,120) and (176,136,142), respectively. Dye never changes
those interior colours.

`check.py` passed coverage, dimensions, bit depth, neutrality, regional mean,
region agreement, source hashes, height bounds, wear contrast and lower mouth
roughness. Independently reconstructed normal X/Y correlations against the
composed normal are **0.99933 / 0.99872**, with maximum encoded unit-length error
0.00597. The compositor reports all beak texels painted, a 1.000 mean correction
factor and no illegal region contacts. Measurements are in `checks/metrics.json`.

Inspected the layout, unlit and opposite-light close-ups, all seven design beak
colours plus lime, near-white and near-black, the front/side/back projections,
and a 38-degree open-mouth view. The comparison preserves the actual mesh's
silhouette at the same apparent beak width as the concept. At 200 pixels tall
the bird keeps a pale hook, low nostril and banded root; individual pits and
scratches disappear. At 128 pixels the rings group together; at 50 pixels the
beak reads mainly through shape and broad value. The 25 mm source comparison
shows the original fine drawing surviving the accepted study and bird sampling.

These Python previews project the actual baked positions and composed maps.
Positions and object normals now both describe the +X left side and are used
directly. The preview duplicates that half only to display the whole bird.
Open-mouth previews
rotate jaw, floor and tongue around the jaw hinge; they use fine AO on the
mouth because closed-pose form AO cannot represent an opened jaw. They are
inspection projections, not the game's renderer, and omit feather cards.
Other groups' work can change the surrounding head between compositions.

Remaining limits: the mesh silhouette is more angular and deeper than the
concept; paint cannot change that. The accepted horn's fine network remains
softer than the reference. The palate and tongue have comparatively few texels,
so papillae are filtered into fine velvet rather than isolated visible bumps.
Near-black suppresses fine pigment, and near-white clips some pale wear under
dye multiplication. The game renderer remains the final test of highlights and
the animated mouth. No layout issue prevented painting the assigned pieces.

Rebuild from the dodo folder:

```sh
python3 -I tex/paint/beak/paint.py
python3 -I tex/paint/compose.py --out tex/paint/beak/checks/composed
python3 -I tex/paint/beak/check.py
```

Moved all generated layers aside and rebuilt from an empty `layers/` directory,
including a fresh verification after the position-map correction.
SHA-256 comparison matched **all 11 files byte for byte**, including the five
required maps, five feature masks and metadata. Position, density and study
inputs were unchanged across the test. The shared region-bake file changed
during verification, but its current pixels still exactly match every owned
texel; `checks/rebuild.json` records this and the output hashes. The scripts require NumPy,
Pillow and SciPy. `layers/` and `checks/` are ignored and rebuildable. Work took
approximately 25 minutes for the original paint pass, including placement revisions, composition, visual
checks and the clean rebuild.

- [Concept / unlit / relit comparison](checks/concept_comparison.png)
- [Head context](checks/head_context.png)
- [Open mouth](checks/mouth_open.png)
- [Dyed horn](checks/dyes.png)
- [Layout](checks/layout.png)
- [Front, side and back](checks/views.png)
- [Whole-bird read sizes](checks/read_sizes.png)
- [Original / accepted horn / painted fine drawing](checks/source_preservation.png)
