# Berry bush atlas — round 2

Rebuilt the six berried sprays, their six picked twins and both inner sprays as
broad, forked branch ends. The active files in this folder now build round 2.
The previous sources, built maps, layout, scripts and checks are preserved in
`source/round1/`. No `REPORT.md` was present when this round began, so this file
records the revision and its validation.

The supplied [engine comparison](checks/round1_in_game.png) showed why the first
set failed: isolated leaves on long narrow stems produced a transparent broom.
The new sources use overlapping foliage on three or four spreading shoots,
with irregular leafy shoulders and a short exposed stem foot. I reread both
briefs and the chosen Forkleaf direction, and inspected `above.png`, `twig.png`,
`direction_a.png` and the project's wood layer example. No external reference
images or existing game artwork were used.

[Old/new atlas comparison](checks/round2_comparison.jpg) ·
[New elements, red fruit and material lighting](checks/round2_elements.jpg) ·
[All layers](checks/layers.jpg)

| Change | Delivered result and reason |
| --- | --- |
| Broad branch ends | All fourteen broad cards are **33.79–36.57 cm long and 31.62–32.00 cm wide**, at **1300 px/m**. Anchors are at the bottom middle. These shapes contribute leafy masses to the assembled crown. |
| Foliage density | Alpha-weighted coverage of the convex silhouette envelope is **66.34–74.46%**, including picked twins and inner sprays. The checker enforces 60–75%. Small gaps and irregular lobes remain. |
| Fruit visibility | **18 bunches, 507 berries**: two to four bunches per berried spray, 26–30 berries per bunch. Actual bunch spans are **9.18–10.25 cm** and individual berry diameters **1.124–1.384 cm**. Bunches sit at shoot ends and outer sides. |
| Green leaves | Removed the old blue-channel boost. New leaves retain saturated deep green. Exposed outer leaf roughness is **0.588–0.612**; inner leaves are **0.639**. Ripe berry roughness is **0.400**, unripe **0.435**. |
| Better packing | Four broad columns replace the narrow six-column arrangement. Visible plant coverage, excluding bark, rises from **10.08% to 37.71%** of the sheet. All named elements retain separate rectangles and required padding. |
| Exact twins | Both states share the same generated foliage, placement, anchor and growth tip. Picking removes every ripe and unripe berry, retains attachment stalks with snapped ends, and makes small annotated leaf tears. Unchanged visible pixels and materials match exactly. |
| Retained elements | `dead1`, `fallen1`, `stripped1`, `stripped2` and bark are **pixel-identical in all five layers** after allowing translation into tighter cells. No resampling of these cutouts. The three loose leaves were enlarged to about **8.0–8.3 cm**. |

The new botanical cutouts were generated individually at native **1254 × 1254**
using the **built-in image generation tool**. Eight initial sources and one
targeted inner-spray density edit are retained at full resolution. Exact prompts
are in [source/prompts.json](source/prompts.json) and
[source/inner1_edit.json](source/inner1_edit.json); the superseded dense inner
source remains in `source/superseded/`.

| File or directory | How it was made |
| --- | --- |
| `bush_base.png` | 2048², 8-bit sRGB RGBA. Clean generated cutouts projected into atlas cells, with a slight foot-centering shear. Low-opacity background residues and isolated specks are removed. Deep interior leaf pixels are opaque. Local contact darkening is partly separated into AO. Ripe berries are neutral RGB 200 except their small darker calyx scars; unripe fruit stays green/yellow-green. Each element's edge RGB extends **40 px**, with its mean colour beyond that. |
| `bush_height.png` | 2048², **16-bit grayscale**, full range **16 mm**. Leaf regions inferred from colour boundaries receive local domes, layer offsets and fine vein relief; wood receives cylindrical relief. Berries are explicit spheres at their physical radii. Alpha-zero pixels have zero height. Retained materials use their frozen original heights. |
| `bush_normal.png` | 2048², RGB tangent-space **OpenGL, +Y upward**. Calculated from the final quantized height at **0.76923 mm/pixel** for cards. Bark uses 0.76923 mm/pixel horizontally and **600/2048 mm/pixel** vertically, with periodic vertical derivatives. |
| `bush_orm.png` | 2048², linear RGB: red contact AO, green roughness, blue zero metalness. Leaf contact shadows and wood junctions contribute AO; berry contact concavity contributes cluster AO. Roughness values are listed above. |
| `bush_regions.png` | 2048², hard pure-red/pure-black RGB. Generated from the visible ripe berry ID raster, excluding unripe berries and stalks. No region pixels occur outside alpha. |
| `layout.json` | Exclusive pixel rectangles, physical lengths, centered stem anchors, shared twin growth tips and twin names. Bark remains `[1952, 0, 2048, 2048]`, with `metres: 0.6`. |
| `source/` | Full native originals, exact prompts, berry/tear annotations, preserved material crops, generated element masks and build metadata. See its README for the input/output ledger. |
| `build_atlas.py` | Deterministic offline assembly, cleanup, packing, material construction, picking, berry rasterization and normal derivation. Dependencies are recorded in `source/requirements.txt`. |
| `check_atlas.py` | Independent delivered-file validation plus all required review images. Also verifies round-2 size, density, fruit, roughness and preservation requirements. |
| `checks/` | Layer contact sheet; three backgrounds at 2048 and 256; layout overlay; every element lit from two directions; region overlay; all six mean-normalized berry dyes; measurements; comparison sheets and rebuild hashes. |

Validation completed with `python3 build_atlas.py` and
`python3 check_atlas.py`. [measurements.json](checks/measurements.json) reports
**passed: true**, no errors, exact 32-pixel edge-colour extension, no overlapping
rectangles, connected cutouts, correct PNG formats and zero region leaks. Ripe
berry RGB is neutral, and recolouring remains confined to ripe fruit. All six
twins have zero unchanged base, height, ORM and stable-normal mismatches. Normal
comparison excludes only the one-pixel derivative neighborhood of a picking
edit; base/height/ORM equality does not need that exclusion.

Physical height/normal disagreement is **0.1766° mean on surfaces**, **0.3178°
at the surface 99th percentile**, and **0.3828° maximum** anywhere, within 8-bit
normal quantization. All five bark seam endpoint errors are zero. A second full
build produced **identical SHA-256 hashes for all five maps and layout**; see
[rebuild_verification.json](checks/rebuild_verification.json).

Visual review covered full-size elements and normal-lit examples, the full
layout, all six fruit dyes, and the 256-pixel dark-grey, white and green
composites. The sprays now read as broad leafy groups, and the bunches remain
visible in the small atlas preview. I saw no dark or grey mip fringes. Fractional
alpha occupies about **2.01–2.75% of the broad-card rectangles**, principally
their fine antialiased edges and stalks, rather than a translucent backdrop.

The remaining limitation is the actual assembled game view: these checks are
texture-space diagnostics, and **I have not rerendered the new atlas in the game**.
The supplied round-one capture remains untouched. Leaf relief is inferred from
the generated image, not measured 3D geometry; tight overlaps remain an
approximation. Near-black fruit naturally has the weakest unlit contrast,
although the larger outer bunches and spherical normals improve its definition.

Production time: **18.5 minutes**, from 2026-11-14 23:42:04 UTC to 2026-11-15 00:00:37 UTC, including image generation, build revisions, visual review, checks and the repeat-build verification.

## Round 3 — packed material only

Rebuilt all five layers from `source/` with `python3 build_atlas.py`. Of the
atlas layers, **only `bush_orm.png` changed**. The base (including alpha), regions,
16-bit height and normal PNGs are byte-identical to round 2. Layout, sprites,
anchors, growth tips, berry placement, picking damage and all existing source
images and masks are also unchanged. The original source documentation above
describes round 2; the material values below supersede its roughness/AO values.

Roughness now gives berries a soft satin surface and leaf faces a matte surface.
Both ripe and unripe berries are adjusted, along with leaves on every cutout,
including the loose leaves, dead/fallen sprays and stripped tips. **All stem and
stalk roughness is unchanged; the complete bark column is unchanged.** Metalness
remains zero, and packed pixels outside alpha are unchanged.

Occlusion follows crown depth, overlapping leaf contacts, lower stem forks and
the foliage pockets beneath bunch attachments. Berry neighbours and contact
creases receive their own occlusion. Deep interiors reach approximately
**0.55–0.70**, while open outer tips reach **1.0**. The lower central stem/fork
areas are darker than the upper tips on every broad spray. The underlying
foliage/stalk field is shared by each full/picked pair, preserving exact material
equality wherever picking does not change the surface.

| Measurement, linear 0–1 | Round 2 mean | Round 3 mean | Round 3 range |
| --- | ---: | ---: | ---: |
| Occlusion, all drawn pixels including bark | 0.949126 | **0.792176** | 0.549020–1.000000 |
| Occlusion, fourteen broad sprays/twins | 0.949202 | **0.767006** | 0.549020–1.000000 |
| Roughness, all drawn pixels including wood/bark | 0.632263 | **0.746423** | 0.639216–0.909804 |
| Roughness, all berries | 0.400986 | **0.661998** | **0.639216–0.698039** |
| Roughness, all exposed leaf faces | 0.606997 | **0.733014** | **0.701961–0.776471** |

Means use pixels with nonzero base alpha, without alpha weighting; the all-drawn
alpha-weighted occlusion mean is **0.791155**. Ripe berry roughness averages
**0.661441**, unripe **0.681396**. The AO floor of 0.549020 is the 8-bit encoding
of the requested approximate 0.55 minimum. Roughness bounds are checked after
8-bit quantization, so all leaf faces and berries remain inside their requested
ranges. Around **42.4%** of broad-spray pixels have AO at or below 0.70, and
**8.7%** have AO at or above 0.98.

Material settings live in [source/packed_materials.json](source/packed_materials.json).
The pre-edit [hash record](source/round3_baseline.json) and
[packed-layer reference](source/preserved/round2_orm.png) make preservation checks
repeatable. `check_atlas.py` now checks the new material ranges and means,
occlusion variation, protected stem roughness and the original file hashes.
Its lighting previews apply AO only to ambient light, leaving direct light
unattenuated, as specified for the game.

**Validation:** `python3 check_atlas.py` completed with **passed: true** and no
errors. All **270 protected file hashes** match. All six twin checks report zero
unchanged base, height, ORM and stable-normal mismatches. There are zero changed
stem-roughness pixels, zero AO changes outside the broad sprays, zero packed
background changes and zero region leaks. Height/normal agreement remains
**0.176640° mean on surfaces**, with **0.382805° maximum** error.

[Measurements](checks/measurements.json) ·
[Before/after AO and roughness](checks/round3_materials.jpg) ·
[Updated lit elements](checks/round3_elements.jpg)

Visually inspected the material comparison and the updated lit sprays. The
interiors now have depth while the outer leaves remain exposed. These are
texture-space previews; this round has not been rerendered in the game.

## Round 4 — ripe berry base colour only

All **493 ripe berries** now have neutral, unshaded body greys of **82, 84 or
86/255**, with small deterministic variation between berries. Their darker
calyx dots remain in the same places at **70, 71 or 73/255**. Including those
dots, ripe-pixel mean RGB falls from **199.1995 to 83.6667** in every channel,
approximately **0.42×** its previous value. Settings live in
[source/berry_base.json](source/berry_base.json); the original generated images
remain untouched. All **14 unripe green berries** retain their exact colours.

Rebuilt every layer from `source/` with `python3 build_atlas.py`. Among the five
atlas maps, **only `bush_base.png` changed**. Regions, height, normal and packed
material are byte-identical to round 3, as are layout, sprites, picking damage,
all masks and the picked twins. Alpha and every visible pixel outside ripe
fruit are unchanged. The colour pass also updates the ripe berries' existing
40-pixel transparent edge extension; unrelated transparent RGB, including the
far-background fill, stays unchanged. There are **111,457 changed ripe pixels**
and **51,140 changed transparent padding pixels**.

**Validation:** `python3 check_atlas.py` completed with **passed: true** and no
errors. All **267 protected file hashes** match the pre-edit
[round-4 baseline](source/round4_baseline.json). The checker verifies each ripe
berry's flat body and darker calyx, zero changed unripe pixels, zero alpha
changes, zero RGB changes outside ripe fruit and its padding, and zero region
leaks. All six twin checks retain zero unchanged-surface mismatches. Normal and
material measurements are unchanged. The frozen
[round-3 base reference](source/preserved/round3_base.png) is for comparison,
not a build input.

The dyed previews in `checks/` now use plain **`base * dye / 255`**, replacing
the checker's previous mean normalization. They therefore show fruit **darker
than the dye**, including grey-looking white fruit, because they omit the
game's scaling to the desired mean colour. This is expected; the base was not
brightened to compensate. Visually reviewed the base atlas and all six dyed
previews. These remain texture-space diagnostics; no new in-game distance test
was performed in this round.

[Measurements](checks/measurements.json) · [Dyed previews](checks/dyes.jpg) ·
[Current lit elements](checks/round4_elements.jpg)

## Round 5 — hanging berry bunch cards

Replaced only the unused `dead1` rectangle `[976, 1524, 1170, 2048]` with three
downward-hanging bunches. The first two cells are 194 × 174 pixels; the last is
194 × 176, using the full former rectangle. Each stalk begins at the cell's
horizontal centre, six pixels below its top edge. Each tip is the lowest
occupied berry pixel. `layout.json` records these anchors, tips and their
measured distances at the unchanged **1300 px/m** scale.

| Element | Berries | Shape | Width | Stalk-to-lowest height | Layout metres |
| --- | ---: | --- | ---: | ---: | ---: |
| `bunch1` | 18 | Fuller, rounder, overlapping | 6.23 cm | 7.77 cm | 0.077829 |
| `bunch2` | 14 | Longer, looser oval | 5.08 cm | 9.08 cm | 0.090851 |
| `bunch3` | 10 | Smaller, with two partly hidden rear berries | 5.15 cm | 7.08 cm | 0.071036 |

All **42 new berries** are ripe, with diameters of **1.02–1.18 cm**, approximately
**13–15 pixels**. Their unshaded body colours are **82, 84 or 86** in every RGB
channel. Forward-facing berries have darker calyx dots at **70, 71 or 73**;
turned-away rear fruit has no visible calyx. Region 0 covers every visible
berry pixel, including its antialiased edge, and no exposed stalk. Stalks and
unequal pedicels use the sprays' **RGB 105, 110, 53**. Berries reuse the existing
roughness settings; their measured range is **0.639–0.678**. Physical spherical
height, overlap depth and the derived OpenGL normal map supply the lighting;
the base contains no directional highlights or shadows. Alpha is opaque
inside the combined silhouette, with antialiasing only along its edges.

Three transparent originals were generated with the **built-in image_gen**
tool after inspecting the repository's berry twig concept. They remain intact
as [bunch1_original.png](source/bunch1_original.png),
[bunch2_original.png](source/bunch2_original.png) and
[bunch3_original.png](source/bunch3_original.png). Their exact prompts are saved
in [bunch_prompts.json](source/bunch_prompts.json).
[bunch_annotations.json](source/bunch_annotations.json) traces berry positions,
radii, facing and depth. The build samples the generated stalk silhouettes,
projects them into the cells and reconstructs the annotated berries as round
physical relief. Bunch 2's vertical projection gathers its loose generated
fruit into a more compact cluster without flattening its spheres. The small
bunch's rear fruit is adjusted for overlap. Generated colour shading is not
carried into the final berry albedo. Prepared stalks, final sprites, berry IDs
and stalk masks are regenerated in `source/`; each new element also has a
`berries` entry in `source/berries.json`. Historical `dead1` source and exports
remain untouched for provenance but are no longer used by the active build.

Rebuilt all five layers with `python3 build_atlas.py`, then ran
`python3 check_atlas.py`: **passed: true, no errors**. Every pixel outside the
former `dead1` rectangle is identical to the round-4 delivery in **all five
maps**, including transparent RGB and normals next to its boundaries. Every
other layout, geometry, packing and berry record is unchanged, as are all six
twins and all prior source images, annotations, material settings and prompts.
The checker verifies **273 protected starting-state file hashes**, the five
outside-rectangle pixel hashes, and **257 remaining historical round-4 file
hashes**. New checks independently verify sphere height to one 16-bit unit,
berry ownership, neutral flat colours, calyx dots, roughness, physical size,
overlap, compactness, connected alpha, padding and downward anchors/tips.

The initial checker run, before rebuilding, already reported a `sprites.json`
hash mismatch against the historical round-4 baseline. This task leaves that
file exactly as found and checks it against its frozen round-5 starting hash;
the historical baseline is unchanged. Aggregate files and the five atlas maps
are checked by their unchanged records/pixels instead of obsolete whole-file
hashes. The new [round-5 baseline](source/round5_baseline.json) and
`source/preserved/round4_*.png` are validation references only, not build inputs.

Visually reviewed the bunches under opposing lights in neutral grey, red,
near-black and white. The dedicated bunch sheet approximates the game's dye
mean scaling to expose sphere highlights and darker undersides; historical
whole-atlas dye sheets retain plain multiplication. These are texture-space
previews; the crossed cards have not been rerendered in the game here.

[Measurements](checks/measurements.json) ·
[Bunch lighting and dye review](checks/round5_bunches.png) ·
[Updated layout](layout.json)

## Round 6 — berry bloom, tiny white catchlights and final-only sources

All **535 ripe berries** on the six sprays and three hanging bunches now have
painted spherical albedo. The neutral body stays around **78–82**, a soft bloom
across the upper part reaches **140–144**, and the lower rim falls to **58–62**.
The full visible body range is **58–144**. Existing calyx dots remain exactly
**70, 71 or 73**, and all **14 unripe berries** retain their original colours.
`source/berry_base.json` records the finish settings; the deterministic builder
applies them to the visible berry owner after overlaps have been resolved.

Each of the **530 forward-facing ripe berries** has one **three-texel** upper-left
catchlight: a 2 × 2 L-shaped footprint with values **242, 234, 234**. Five
turned-away bunch berries receive the bloom but no catchlight. The **1,590
catchlight pixels** remain inside fully opaque berry silhouettes and are removed
from region 0, keeping them white under every dye. Their packed roughness is
**89/255 = 0.349020**; every other berry retains its existing roughness within
0.62–0.70. The region still includes the unchanged calyx dots.

A one-time pixel audit against the files present at the start of this task
confirmed the exact scope:

| Check | Result |
| --- | ---: |
| Changed ripe body pixels, excluding catchlights | 111,269 |
| Changed catchlight pixels | 1,590 |
| Base changes outside visible ripe fruit | 0 |
| Changed calyx pixels | 0 |
| Changed alpha or transparent RGB pixels | 0 |
| Packed-material changes outside catchlights | 0 |
| AO and metalness changes | 0 |
| Height and normal PNGs | Byte-identical |
| Layout and existing sprite metadata | Byte-identical |
| Retained generated originals | All 18 byte-identical |

All leaves, stalks, picked twins and other non-fruit pixels remain unchanged.
The existing transparent berry colour extension is deliberately retained as
well: it contains the established neutral body/calyx colours, without added
bloom or glints. The finish therefore changes only visible ripe albedo,
catchlight region membership and catchlight roughness. No new image generation
was required; the existing sphere annotations supply the geometry.

[Six-dye review](checks/berry_dyes.png) shows **red, deep blue, violet,
yellow-orange, near-black and white** on all three bunches and `spray1`, against
darkened accepted leaf artwork. Bunches are enlarged 2× with nearest sampling;
the spray is shown at atlas scale. Dye is multiplied under region 0 and scaled
by its mean before clipping and lighting. The checker records both pre-clip
and post-clip means: bright dyes, especially white, clip in the bloom. Glints
are excluded from the mean and the dye operation. Visually reviewed the sheet;
near-black fruit has a blue-grey upper sheen, a darker underside and a small
white glint. These are texture-space previews with approximate material
lighting, not a new capture of the game's sun/sky/exposure renderer.

`check_atlas.py` now validates the **final atlas independently**, with no input
from any earlier round. It checks PNG size/type/bit depth, exclusive rectangles,
alpha and padding, anchors and physical scale, hard region membership,
independently reconstructed berry ownership and sphere height, calyx/bloom/
catchlights, roughness, derived normals, bark seams and all six twins. Sparse
fractional pixels at accepted stalk intersections are measured separately;
the compact bunch interiors must remain opaque. The check then copies only
**32 active input files** into an empty temporary directory, runs
`build_atlas.py`, and compares all **100 generated files** byte for byte,
including the five maps, layout, metadata, prepared cutouts, sprites and masks.
It also rejects unused files in `source/`, except retained prompts and docs.

Removed **163 unused source files (66,378,258 bytes, about 63.3 MiB)**:
archived deliveries and their generated outputs, historical baselines and
preserved full-atlas layers, the unused `dead1` original/materials/exports,
the superseded inner cutout, unused preserved bark/normal/region crops and old
timestamps. `preserved/` now contains only the **nine actively read base,
height and ORM crops** for `fallen1`, `stripped1` and `stripped2`, plus their
placement geometry. All **18 active/provenance originals** remain. The original
prompt record was moved out of the deleted archive to
[source/original_prompts.json](source/original_prompts.json); all other prompt
records remain. Updated [source/README.md](source/README.md) and
[checks/README.md](checks/README.md) describe the current inputs, output contract,
colour padding and review formula. Earlier report sections describe historical
deliveries; their deleted baseline/archive links are no longer active inputs.

**Validation:** rebuilt every layer with `python3 build_atlas.py`, then ran
`python3 check_atlas.py`: **passed: true, no errors**. The clean rebuild matches
all **100 files** and reports **zero unused source files**. Region leaks and
unchanged-twin mismatches are zero. Height/normal agreement is **0.176637° mean
on surfaces**, **0.317755° at the 99th percentile**, and **0.382805° maximum**.
`git diff --check` also passes.

[Final measurements](checks/measurements.json) ·
[Exact rebuild verification](checks/rebuild_verification.json) ·
[Six-dye berry review](checks/berry_dyes.png)

## Round 7 — leaf roughness only

Raised leaf-face roughness on all six sprays and their picked twins, both inner
sprays, the stripped and fallen sprays, and all three single leaves. The face
settings are **0.91**, or **0.92** for inner sprays. Existing source-driven
variation remains, with grain strength reduced from 0.10 to 0.06 to fit the
narrower range; preserved stripped/fallen leaves retain their small variations.
Both build paths constrain quantized leaf values to the requested **0.88–0.94**.

The new leaf roughness mean is **0.911454**, up from **0.732967** in round 6.
The measured range is **0.890196–0.937255** (227–239/255). These statistics use
all **1,342,120 exposed leaf-face mask pixels**, without alpha weighting.
`check_atlas.py` now enforces the new range and records overall and per-element
leaf roughness in [measurements.json](checks/measurements.json).

The [round-6 comparison](checks/round7_changes.json) confirms that only the
green roughness channel of `bush_orm.png` changed: **1,343,542 leaf pixels**,
including 1,422 surviving torn leaf-edge pixels outside the exported face masks.
There are **zero changes** to berries, catchlights, stalks, stems, bark,
background packed pixels, AO or metalness. Base (including alpha), height,
normal and region maps are byte-identical, as are layout, sprite metadata,
originals, prepared cutouts and all element images and masks.

**Validation:** `python3 build_atlas.py` and `python3 check_atlas.py` completed
successfully: **passed: true, no errors**. The isolated clean rebuild matches
all **100 generated files**. All six twin checks retain zero mismatches.

## Round 8 — broader berry bloom inside region 0

Broadened the soft pale cap on all **535 ripe berries**, across the six sprays
and three bunches, including the five turned-away berries. The cap spans the
upper **48% of the berry diameter**, with a broad, gently rounded upper area
and a smooth falloff into the existing shoulder/body shading. Sampled peaks
are **159–164**. The middle stays around **78–82**, and the lower rim stays
**58–62**. The mean of the berries' upper-half greys rises from **105.21 to
133.34**, excluding calyx and catchlight pixels. Every lower-half pixel is
unchanged. The finish remains neutral RGB, preserving the shading ratios under
the game's mean-scaled dye.

The change is controlled by [source/berry_base.json](source/berry_base.json)
and applied by [build_atlas.py](build_atlas.py) after berry ownership and colour
padding. The broad cap takes the maximum of the new bloom and the existing
finish, so its fade retains the accepted body below it. Catchlight generation,
calyx colour, material values and geometry are unchanged.

A pixel audit against the round-7 files present at the start of this task is
recorded in [checks/round8_changes.json](checks/round8_changes.json):

| Check | Result |
| --- | ---: |
| Ripe berries receiving a broader cap | 535 / 535 |
| Changed base RGB pixels | 41,672 |
| Changes outside region 0 | 0 |
| Changed catchlight, calyx or unripe pixels | 0 |
| Changed lower-half pixels | 0 |
| Changed alpha or transparent RGB pixels | 0 |
| Height, normal, ORM and region maps | Byte-identical |
| Layout, sprite metadata, originals, prepared cutouts and masks | Byte-identical |

Leaves, stalks, bark, picked twins and all other non-fruit pixels therefore
remain as round 7 left them. Leaf roughness still averages **0.911454**.

[Six dyes at full and quarter size](checks/berry_dyes_distance.png) shows red,
deep blue, violet, yellow-orange, near-black and white on all three bunches and
`spray1`, against darkened accepted leaf artwork. Each dye has a **1× native
atlas-scale** scene beside the identical scene at **0.25× width and height**.
The smaller view BOX-averages the full composite, including the existing
catchlights and leaf background, with no sharpening or extra highlight. This
is the requested **~7 m size proxy**, using the established approximate
material lighting; it is not a new game-renderer capture. The near-black pair
is in the bottom middle for distance judgement. The previous
[enlarged bunch/spray review](checks/berry_dyes.png) is also regenerated.

**Validation:** `python3 build_atlas.py` and `python3 check_atlas.py` completed
successfully: **passed: true, no errors**. The checker now checks broad cap
coverage, peaks of 150–170 and upper/lower contrast as well as the retained
body/rim, calyx, catchlight and material requirements. All **100 generated
files** match an isolated clean rebuild, all six twins have zero mismatches,
and region leaks remain zero. Visually reviewed the six-dye distance sheet.
`git diff --check` passes.
