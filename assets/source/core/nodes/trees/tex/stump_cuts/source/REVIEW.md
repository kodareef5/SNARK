# Frozen painting sources

Four independent original images were generated with the built-in `image_gen` tool. Each returned **1254 × 1254** pixels; the files named `generated_*.png` are unchanged copies of those native outputs. Exact prompts are in `generation_prompts.json`. `manifest.json` records dimensions and SHA-256 hashes. No web references, downloaded photographs, or existing-game imagery were used.

The repository's broadleaf `stumps.png`, `banyan_stump.png`, and `DESIGN.md` were inspected, along with the palm cut and wood-plank material specified in the brief. They informed direction; their pixels are not in this atlas.

| Source | Accepted features | Corrections during material construction |
| --- | --- | --- |
| `generated_fig.png` | Opposed oblique bites, torn diagonal hinge, subdued incomplete rings, angular embedded concrete near the upper-left side. | Register the oversize disc; reconstruct a measured grey bark rim; remove broad warm source illumination; restore the concrete as a continuous mineral patch. |
| `generated_oak.png` | Dense interrupted rings, differently oriented wedge cuts, dark bark, pale sapwood and brown heartwood, offset splinter knot. | Heartwood is separately traced pigment, never a luminance-driven height depression. Reduce source shading and constrain the bark rim to 35 mm nominal. |
| `generated_mangrove.png` | Fewer large bites relative to trunk size, fine rings, a low offset torn hinge, reddish wood. | Restore grey-brown bark and the specified pale fresh-fibre colours. Restrict redder pigment to the interior. Use the 500 mm disc diameter when deriving normals. |
| `generated_banyan.png` | Multiple eccentric growth centres separated by wandering fused-root seams, large opposing cut groups and diagonal torn hinge. | Register seam relief with its pigment; remove broad source shading; use the fig palette and a 30 mm nominal bark rim. |

`structure.json` contains editable traces of the large facet supports, hinge paths, oak heartwood and banyan seams, in native source pixels. The builder registers them with the exact same radial warp as each painting. These traces govern broad relief; source-derived fine fibres and broken lips provide close detail. The final revision softened straight trace boundaries so they do not dominate the naturally ragged source features.

The generator did not obey its requested 84% source-disc diameter precisely. The builder does not depend on that request: it detects the source wood boundary and maps it to a measured inner cut, leaving a 2–4 cm bark band inside the exact 80% destination disc. The square outside that disc continues the same species' bark, assembled from its source corners and native lip.

`sRGB.icc` is frozen once to keep rebuild hashes independent of profile-creation timestamps. Generated images are retained in full; no image API fallback was used.


Round 2 source review (2026-11-14): the original plates above are retained unchanged. Four new **1254 × 1254** built-in imagegen edits are frozen as `round2_fig.png`, `round2_oak.png`, `round2_mangrove.png`, and `round2_banyan.png`. Exact per-species edit prompts are in `round2_prompts.json`; their hashes join the originals in `manifest.json`.

The new plates supply visible fine growth arcs, broad cut faces and grain changes across the banyan's fused lobes. Their overall lighting, exterior bark, approximate rim width and heartwood coverage are not used directly. The builder retains the original palette and exterior bark registration, restores the approved torn hinges and fig concrete, and supplies six authored planes and measured steps from `round2_structure.json` through `../round2_geometry.py`. The original partial facet traces and oak heartwood polygon no longer determine the revised cut.

Fine ring pigment and shallow relief share a band-pass field from each edited painting. Interior wood uses isotropic registration to keep the original bark-edge detector's angular variations out of the growth rings. The oak core boundary is traced along dark painted growth bands in a narrow eccentric annulus, with four branched radial checks. Three original banyan seam paths are curved and recessed, crossing the generated changes of grain. Bark notches and lifted flanges are authored within the unchanged outer disc footprint.

Visual review rejected the first colour-thresholded oak heartwood mask as too blotchy, removed excessive ring waviness caused by the old radial warp, and broadened the small mangrove's bark breaks to match its thicker rim in pixels. The delivered maps, current measurements, before/after comparison, and opposing-light views are recorded in `../REPORT.md` and `../checks/`.
