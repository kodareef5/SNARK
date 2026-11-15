# Visual review and selection record

All twenty-seven generated paintings across both rounds were viewed. Final PNGs are exact copies of the selected native outputs. This record distinguishes visual judgement from numerical construction targets; no engine model or collision simulation was built in this task.

| Deliverable | What was challenged | Decision |
| --- | --- | --- |
| Fig lineup | v1 had oversized individual leaves, open pad-like foliage and very thick lower trunks relative to the person. v2 improved the domes and human scale but kept a 4–6 m apparent trunk. | v3 narrows the lower stems and their footprints while preserving crowns, swallowed objects, root windows and thin hanging roots. All three silhouettes remain separately readable. Use DESIGN.md for exact crown widths. |
| Fig trunk | Could the roots read as fused living tissue rather than separate rope strands? Could the base end without a huge buttress apron? | v1 retained. Broad smooth surfaces merge into a wall, narrow gaps expose the column, and root flares disappear into nearby paving joints. The old capital and concrete cracks remain angular against the organic surface. |
| Mangrove lineup | v1 showed good individual ages and curved roots, but its older root cages were too wide against the scale figure. | v2 narrows the cages, slightly adjusts human scale and fills the middle crowns. The young, rounded, leaning and old individuals remain distinct. Root-shoulder height must follow the explicit harvest rule in DESIGN.md. |
| Oak lineup | v1 exposed good sweeping wood but its foliage was too sparse and its lower stems too thick against the person. | v2 fills the crown lobes and narrows stems. The low left sweep, taller elder and broken right individual remain distinct. Retain the visible elbows and large sky windows when adding card clusters in 3D. |
| Oak trunk | Needed bark grain to flow into the fork, with fern on upper limb surfaces and moss below. | v1 retained. Dark relief, strong branch origins, wound collar and two kinds of epiphyte are legible. Fern dimensions are specified separately so the painterly tufts do not become oversized model assets. |
| Stumps | v1 had appropriate low remains and surviving root cages, but the oak cut still resembled a flat saw disk with a damaged centre. | v2 replaces the broad cut with overlapping angled hatchet facets and torn central fibres. Fig wood is also more visibly hacked around its concrete remnant. The mangrove remains a low-collared specimen with an intact cage. |
| Near forest | Needed all three species, the standing player's eye line, one close harvest target and an approachable trunk. | v1 retained. The pale fig anchors the left, dark moss-bearing oak sits behind, mangroves meet the water on the right, and palms rise through the background. The path stays open beside the root footprint. |
| Far forest | v1 made two figs enormous compared with multi-storey buildings and read as a close hero-tree vista. | v2 widens the view and replaces the enormous figs with smaller groups. The low mangrove edge, scattered pale fig forks, wider dark oak branches and projecting palms now carry the composition. Ruins remain scale anchors. |
| Flat far forest | v1 preserved landmarks but made nearly all crowns similar flat umbrellas. | v2 gives pale-stemmed figs rounded olive domes and dark-stemmed oaks cooler stepped crowns. The mangrove shore stays lowest and darkest. Main tree locations, buildings, palms and shoreline remain comparable with the painted view. |
| Leaves | v1 labels were correct, but fig edges looked too finely toothed and aerial-root tops ended in an artificial blurred cutoff. | v2 smooths fig margins and redraws a complete thin-root tuft with a defined top and tapering free tips. All five samples retain their centimetre labels and are usable as material-painting references. |

## Banyan round: nine generated paintings, five selected

| Deliverable | What was challenged | Decision |
| --- | --- | --- |
| Banyan lineup | v1 established the grove anatomy and raised car, but B2 was too narrow, the main trunks too broad and the person too large. v2 widened B2 and improved trunk proportions but left B3 too tall. v3 lowered B3; its scale figure still read too large. | v4 retained. The person is now approximately one ninth of B1's height. B1 has nine secondary posts, B2 three, and B3 a high eastern crown, broken western limb and lifted car. All three full silhouettes remain separated. The B3 construction has a seventh rear pillar that can be occluded in side view. |
| Banyan hall | Needed one coherent tree, visible limb-to-pillar connections and genuinely open space between columns at player height. | v1 retained. Six secondary columns are visible around the dominant main trunk, with clear paving routes and thin backlit free roots. Smooth pale bark and cool shade match the original fig material. Remaining B1 posts lie outside or behind the view. |
| Banyan far | Needed a few additions to the existing hammock rather than a new scene or an all-banyan forest. | v1 retained. The portico, midrise, road, bay and other tree families persist. Three pale plaza openings reveal the banyan posts beneath broad roofs; adjacent single-trunk fig domes provide the comparison. Camera distance is a brief, not an engine measurement; retain written model dimensions. |
| Banyan far flat | Needed the same three banyans and recognizable old landmarks after foliage detail disappears. | v1 retained. Shallow olive canopy volumes and pale upright posts distinguish banyans from pale single-stem fig domes, cooler dark-forked oak terraces and the low mangrove shore. Simple coloured planes establish the low-detail construction; the picture is not an exported mesh or exact unlit palette test. |
| Banyan stump | v1 had the correct nine surrounding stumps, but the main stump stood too high and carried an oversized spear of splinters. | v2 retained. The main base is now low and broad, its short torn fibres and irregular chop facets remain readable, and all nine separate pillar stumps retain their original picture locations. No standing pillars, canopy, hanging roots or phantom canopy shadow remain. |

The banyan ground plans in DESIGN.md specify the three-dimensional construction; paintings are not surveyed maps. The stump view uses a different camera from the standing lineup and hall. Match each pillar and stump by the documented local coordinates when modelling rather than matching screen positions across pictures. All solid outboard structures must clear 2.3 m in the eventual model; the raised car uses 2.6 m minimum clearance. No collision runtime was implemented or tested here.

All nine banyan outputs are archived, including the four superseded images. Only the existing original paintings and successive banyan paintings were supplied as image inputs. No photographs, outside game art or web searches were used, and no git commands were run.

## What the set establishes

- Near identity comes from different wood anatomy, bark character, root construction and epiphytes.
- Distant identity comes from crown envelope, branching silhouette, stem value and height relative to the shore.
- The lineups supply three figs, four mangroves, three oaks and three banyans with different histories and branch arrangements.
- The far pair is a direct original-image edit chain, preserving the composition rather than inventing an unrelated flat scene.
- Stumps retain recognisable species structure while showing irregular pale wood exposed by chopping.

## Construction limits to retain

These are paintings rather than metrically calibrated model turnarounds. The written dimensions take precedence over pixel measurements. Numerical collar height is particularly important for the mangrove: preserving a 1.5–2 m tall cage and simultaneously cutting above it at 1 m is geometrically incompatible. The chosen stump uses the low-collared solution described in DESIGN.md, and its standing counterpart must be authored consistently.

The image tool's native resolution is roughly 1.57 megapixels per output, with aspect ratios appropriate to the subject. Requests for larger dimensions did not change the returned native resolution. No enlargement was performed or described as additional detail.

The full-colour pictures include lighting and contact shadows. The leaf sheet is a reference, not a production-ready unlit texture atlas or alpha mask. The flat painting is a visual target for low-detail models, not evidence of an engine's triangle count or performance. Full-rotation clearance and distant silhouette should be checked when the scripted models exist.

## Archive map

- `generation_manifest.json`: exact prompt strings and image inputs for the original eighteen calls.
- `banyan_generation.json`: exact prompt strings and image inputs for the nine banyan calls.
- `selected.json`: the original ten final filenames mapped to selected version names.
- `banyan_selected.json`: the five banyan final filenames mapped to selected version names.
- `deliverables.json`: native sizes, byte counts and SHA-256 hashes of the original ten final files.
- `banyan_deliverables.json`: the same integrity data for the five banyan final files.
- `validation.json`: original-round integrity and archive-completeness checks.
- `banyan_validation.json`: banyan file integrity, archive completeness, exact-prompt preservation and numerical ground-plan checks.
- `record_prompts.py`: reproduces the human-readable prompt ledger from the manifest.
- `*_v*.png`: every native generated output, including selected and superseded versions.

Only word-generated paintings from this task were used as edit inputs. No outside images were consulted.
