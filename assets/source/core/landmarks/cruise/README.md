# Icon cruise prototype

This is the first native prototype gate for a full-scale, moored Icon of the Seas reconstruction. It contains the measured hull/deck envelope, repeated balcony banks, two continuous public stair cores, the aft launch stair, a furnished repeated cabin section, clear AquaDome framing, twin aft funnels and a decorative elevated basin. It is **not the finished public-room or exterior-detail batch**. The Pearl, fitted neighborhoods, lifeboats, full slide system, venue signage and detailed bow/stern finish remain subsequent production work after the native capacity and walkthrough review.

The builder supplies 365 m overall length, 48.5 m waterline beam, 57.8 m deckhouse width and 65.8 m bridge width. Actual photographs and the frozen Profile2250 visitor plan guide the reconstruction. Floor elevations, hull cross-sections, provisional −9.3 m keel and 75 m funnel-top height are explicitly inferred. The bridge, hull and deckhouse carry independent measurement tags. See [reference provenance](ref/REFERENCES.md) and the [shared metre contract](ref/LAYOUT.md).

`author_layout.py` and `layout_geometry.py` generate the single JSON authority. Prototypes own bounded collision and visual geometry; instances reuse those definitions at stable transforms. `model.py` generates six native levels using the accepted closed-solid primitive infrastructure in `parts.py`. Near-flat levels preserve real cabin windows, door openings, stairs and landings. Dome panes are clear framed apertures; imported transparent materials are not assumed to work in the native renderer. The pool has a shallow basin, exit steps and a contained decorative surface, with 2.66 m beneath its real slab above the occupied room. It does not create map water.

`tex/paint.py` authors the original marine enamel, wood, textile, tile and metal atlas. Reference pixels are never sampled. Fine rectangular deck surfaces repeat the atlas within 4 m spans. Intentional semantic materials provide native flat colours; the source sets actual Principled base colours so flat fallback is not unpainted gray. `build.ts` keeps native measured surface errors and adds the accepted cumulative 8 mm appearance-loss floor for nearby finishes.

Rebuild from the repository root:

```sh
python3 assets/source/core/landmarks/cruise/author_layout.py
python3 assets/source/core/landmarks/cruise/tex/paint.py
bun assets/source/core/landmarks/cruise/build.ts
bun test tests/unit/cruise-art.test.ts
```

The ordinary Blender/native pack pipeline writes `cruise.snpk`, `lod-errors.json`, `ref/geometry-report.json` and `ref/native-check.json`. App/Harness reviews measure the complete placed ship alongside the port and comparison vessels; prototype triangle totals alone do not certify frame cost. No renderer budgets or runtime dependencies are increased.
