# Face painting — round 5: margin value and stray tips

The two detached marks in front of and above the mouth corner have been removed. The two lone feathers remaining beside the continuous neck margin are narrower, pointed vanes following the feather-direction field. The connected ragged margin keeps its accepted shape. Its pigment now references the adjoining neck and includes a small correction for the dark creases mixing into feather colour as the texture reduces.

## Value measured in the composed maps

`margin_audit.py` measures only body-red texels, using the position maps to pair the face and pouch feathers with the neighbouring body neck. It reads the composed base, regions and packed maps, rather than a preview palette. The before and after measurements are in [margin_value_before.json](checks/margin_value_before.json) and [margin_value_after.json](checks/margin_value_after.json).

The previous face margin's native linear base mean was already close to the neck: 0.50035 versus 0.49259. The narrow undyed creases lowered its value on reduction. The new painter first matches each margin's mean to its neighbouring neck samples, then compensates for that reduction. It includes the composer's UV padding in this calculation, especially important on the narrow pouch. The correction is a constant neutral material-value adjustment; it contains no light direction or painted highlights. The accepted feather drawing remains.

Delivered composed-map measurements:

| Sampling footprint | Face feathers / adjoining neck | Pouch feathers / adjoining neck |
| --- | --- | --- |
| Native texels | 0.50536 / 0.49247 | 0.57020 / 0.50008 |
| 2-texel box | 0.50033 / 0.49246 | 0.54474 / 0.49996 |
| 8-texel box | 0.49217 / 0.49239 | 0.50003 / 0.49964 |

The 8-texel box is a representative reduced footprint, not a claim about the renderer's exact mip filter. At that footprint both margins agree with the neck within 0.1%. The narrow pouch feather cores are intentionally brighter at full resolution to compensate for their larger proportion of dark boundary. At very close range this can read slightly brighter than the neck; the game views are included for judging that tradeoff.

The new body-red mean over this painter's pieces is **0.512476**, within the shared 5% allowance and still neutral in all three channels. The face-skin and cyan means remain **0.500050** and **0.500265**. The shared composer holds the final region mean at 0.50.

## Removing spots without redrawing the margin

Connected components are measured in the bird's physical space. A lone feather is removed if any of it lies more than **10 mm from the continuous feathered margin**. The two removed cheek islands were approximately **26–38 mm** from that margin. Their original pebbled skin is restored, including height and roughness.

Only the surviving isolated components receive the pointed silhouette; connected feather tips keep the accepted outline. The two remaining vanes measure approximately **4.91 × 1.61 mm** and **4.21 × 1.77 mm**. They lie **1.85–4.48 mm** and **3.57–6.16 mm** from the continuous plumage, respectively. Their axes follow the same physical direction field used for the neck margin.

The **36,502 texels** of the connected face-feather component retain their region shape, height and roughness exactly against round 4. See [round4_margin_preserved.json](checks/round4_margin_preserved.json). The pouch's feather silhouette and pleats are unchanged. The maps contain **41,438 red feather texels** and **8,064 black crease texels**. The minimum red-to-skin centre distance remains **5 texels**, leaving at least four black texels between non-neighbouring dye regions. The natural dark crease colour and width are unchanged.

## Renderer review and limits

The [round 4 / round 5 comparison](checks/margin_before_after.png) includes side and front-left head views, whole-bird views and loud dyes from the actual game renderer. The [concept comparison](checks/concept_comparison.png) is also refreshed. Individual unretouched renders are in [round5_final](checks/round5_final/).

The front cheek is clear of spots. The remaining small tips are confined to the ragged feather boundary. A faint diagonal shading line can still be seen at the original join in the side view; the base-value match does not remove every shading difference across that join. The four-texel undyed outlines also soften the apparent point of a very small feather when viewed from a distance. No mesh, card geometry, shared bake or other painter's files were changed.

## Validation and reproducibility

The existing five map names, 2048-square dimensions, **8 mm** height range and **4 mm** nominal plane remain. Coverage is exactly **475,084 owned texels**, with zero data outside them. `check.py` passes the ownership, neutral dye, physical tip-distance and aspect-ratio checks, four-texel buffers, existing fold contacts and pouch pitch checks. The composer reports **zero colour-ring violations**.

`preservation_check.py` confirms the accepted treatments outside the margin's local filtering reach are byte-identical across **392,253 texels**, including the restored cheek locations. The entire brow and inner pouch remain identical in every map. Fold placement and profile code is unchanged. [Metrics](checks/metrics.json) and [preservation results](checks/preservation.json) record the checks.

A clean rebuild matched **all six delivered files byte for byte**, including `layers.json`; this round required no provenance exception. All input hashes were current. See [rebuild.json](checks/rebuild.json).

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -I tex/paint/face/paint.py
PYTHONDONTWRITEBYTECODE=1 python3 -I tex/paint/face/check.py
PYTHONDONTWRITEBYTECODE=1 python3 -I tex/paint/face/preservation_check.py
PYTHONDONTWRITEBYTECODE=1 python3 -I tex/paint/face/rebuild.py
PYTHONDONTWRITEBYTECODE=1 zsh tex/paint/look.sh "$PWD/tex/paint/face/checks/round5_final"
PYTHONDONTWRITEBYTECODE=1 python3 -I tex/paint/face/margin_audit.py --composed /private/tmp/dodo-look/tree/core/creatures/dodo/tex --out tex/paint/face/checks/margin_value_after.json
PYTHONDONTWRITEBYTECODE=1 python3 -I tex/paint/face/margin_review.py
```

The painter still reads the accepted body's sixteen generated feather sources and the body's current neck fields and delivered layers. No new generated images were needed. Round 4's scripts and layers are retained under ignored `checks/round4/`. All source edits stay in `tex/paint/face/`; built packs remain outside the repository under `/private/tmp/dodo-look/`.
