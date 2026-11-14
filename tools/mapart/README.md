# Miami map-art tools

Offline source/art tools only. They add no dependency to the engine or its build.

## Current delivery: round two

The original geographic pipeline below remains authoritative for source layers. The current art finish is **round2.py**, followed by **round2_balance.py**. Do not use the old `finish.py` entry point to export the round-two delivery: its all-features-at-all-scales treatment is the artistic behavior replaced in this round. Its registration/overlap helpers are still used for the close original paintings.

Saved originals are sufficient to reproduce the current artwork; no image calls or downloads are needed when the base vectors and PNGs are present:

```sh
tools/mapart/.venv/bin/python tools/mapart/reference.py
tools/mapart/.venv/bin/python tools/mapart/round2_restore.py
tools/mapart/.venv/bin/python tools/mapart/round2.py finish 0
tools/mapart/.venv/bin/python tools/mapart/round2.py finish 1
tools/mapart/.venv/bin/python tools/mapart/round2.py finish 2
tools/mapart/.venv/bin/python tools/mapart/round2.py finish 3
tools/mapart/.venv/bin/python tools/mapart/round2_balance.py
tools/mapart/.venv/bin/python tools/mapart/round2_measure.py
tools/mapart/.venv/bin/python tools/mapart/audit.py
```

Close-tile registration additionally needs the native 64-pixel geometry contexts. `round2_restore.py` reconstructs these for z2/z3 without altering the historical used prompts; run it immediately after `reference.py`, as above. Contexts used for registration contain geometry, not the parent painting, so the generation-time parent is not needed to re-finish saved originals. The context-generation tools listed below are for commissioning new paintings and can overwrite prompts; they are not part of the reproduction sequence.

| Round-two tool | Purpose |
|---|---|
| round2.py generalized 0 | Rebuild the overview's generalized plan from native vectors and spaced footprint anchors. The exact generation-time reference is also preserved as paintings/z0/geometry-input.png. |
| round2.py contexts 1 | Prepare four generalized district references, parent crops and prompts for **new** image generation. Overwrites the z1 queue/prompts; not necessary for reproduction. |
| round2_close_contexts.py | Prepare sixteen native neighborhood references and new district-parent crops; writes round2-queue.json. The accepted outputs replace z2 originals in place. |
| round2.py finish Z | Continuous native canvas, scale-selected roads, geography-constrained coast, exposed rag paper, data-clipped architecture and district treatments. Keeps z3's original room paintings. Writes an ignored unbalanced-master.png and provisional final-master/tiles. |
| round2_balance.py | Share broad RGB wash corrections across all four independent paintings without moving any ink geometry; cut final 1,024² tiles only after the continuous-canvas adjustment. |
| round2_symbols.py | Called by the balance/export pass: draw legible z0/z1 wreck symbols at the four saved world positions and directions. Symbol size is not a new world footprint. |
| round2_measure.py | All 140 separate tile joins, zero-loss reconstruction, adjacent-zoom RGB/8-pixel broad comparison, explicit limited pigment-boundary diagnostic, selected road support, and retained SHA-256 inventory. |
| round2_restore.py | Recreate native registration contexts and review sheets from kept layers/originals/tiles. |

Measurements, production notes and delivery audit are retained under `assets/source/maps/miami/reports/`, and interpreted in `REPORT.md`. `checks/` contains only regenerable review pictures, external comparison copies, and experiments. Raw downloads, references, warped copies and continuous finishing masters are ignored. No runtime/engine package or map file is produced.

The built-in image tool was used for every new raster painting. Exact prompts are beside the originals. The corrected z1 northeast original also has a correction prompt and its preceding source under `paintings/z1/studies/`. The first new overview study is retained under `style/` because it supplied art direction to the accepted overview. Foreign comparison images were inspected only, never passed to image generation. Generation itself is nondeterministic; the saved originals make finishing reproducible.

## Original geographic preparation and round-one tools

From the repository root, create the isolated environment:

```sh
python3 -m venv tools/mapart/.venv
tools/mapart/.venv/bin/pip install -r tools/mapart/requirements.txt
```

The frozen bounds, projection and sample conventions are in `assets/source/maps/miami/map.json`. Python 3.9 was used; exact package versions are pinned. Raw data and the virtual environment are ignored by git.

| Tool | Purpose |
|---|---|
| fetch.py | Download intersecting NOAA DEM tiles, county TIGER ZIPs, NLCD coverage and paginated FEMA footprints. Write exact request URLs and SHA-256 checksums to downloads.json. Reuses existing downloads. |
| prepare.py | Clip/reproject vectors, reproject bare-earth height, rasterize 4,065 vertex samples, preserve NLCD codes, author explicit succession and low-street flooding. Checks FEMA pages against the complete object-ID inventory. |
| future.py | Freeze four missing bridge spans and four submerged wrecks as shared world geometry; mark tunnels as subterranean. Run after prepare.py. |
| reference.py [zooms...] | Render geographic references afresh from the vector data at each native zoom, with water/road/building masks. Default: all four zooms. |
| contexts.py Z | Build each tile's 64 px neighboring overlap, parent-paint context, exact prompt and queue.json for the built-in image tool. |
| finish.py Z | Similarity registration, local shoreline registration, class-constrained pigment and architectural detail, overlapping assembly, parent-color matching, exact cutting into 1,024 px PNGs. Requires every original painting for that zoom. |
| finish.py Z --partial | Pilot only: export already-painted tiles while keeping explicitly provisional parent proxies under checks/partial_zZ.png. Never use partial images as a completed delivery. |
| alignment.py | Position-constrained SIFT/RANSAC registration of original ink against geographic corners, with multistart main-water-silhouette similarity fitting for sparse scenes. Used by finish.py; cache metadata retains fit residuals and transforms. |
| preregister.py Z --watch | Populate registration caches as originals arrive. Stops when that zoom is complete; does not export tiles. |
| author_canopy.py | Freeze vegetation crowns from the complete registered zoom-3 painting as shared fictional world layers. Run once, then finish zooms 0 through 3 in order. |
| canonical.py | Save 8,192 px canonical water/road/building masks; repair classifications at inclusive outer grid samples and preserve surface roads over tunnels. Run after native references. |
| measure.py | Independently classify visible features from exported RGB; measure IoU, symmetric boundary distances, exact tile reconstruction, seam jumps, and parent-scale color differences. |
| grid_check.py | Quantify the difference between the engine's 2 m vertex samples and the finest native vector masks, independently of artwork. |
| review.py Z reference/raw/final [--row R] | Labeled contact sheets for review, under checks; never adds labels to game tiles. |
| audit.py | Assert tile count, RGB format, original-paint presence, base dimensions and bit depth; hash delivery artifacts. |

Build sources and references:

```sh
tools/mapart/.venv/bin/python tools/mapart/fetch.py
tools/mapart/.venv/bin/python tools/mapart/prepare.py
tools/mapart/.venv/bin/python tools/mapart/future.py
tools/mapart/.venv/bin/python tools/mapart/reference.py
tools/mapart/.venv/bin/python tools/mapart/canonical.py
```

Image generation is an explicit art-production step using the **built-in image tool**, not an API-key script. The overview prompt is under paintings/z0; later queues are made by contexts.py. Each queue entry lists its geometry reference, accepted parent, original style sheet and output filename. Inspect inputs, issue the prompt with those local references, then copy the returned original PNG to `paintings/zZ/C_R.raw.png`. Preserve supplementary prompt files. Do not resize or overwrite the raw originals. The tool returned 1,254 px squares during this run. The finishing code maps each to its 1,152 px overlap region (or 1,024 px overview).

After a complete zoom is painted:

```sh
tools/mapart/.venv/bin/python tools/mapart/finish.py 1
tools/mapart/.venv/bin/python tools/mapart/measure.py
tools/mapart/.venv/bin/python tools/mapart/contexts.py 2
```

Review the full map, representative full-resolution tiles, and joined boundaries. Exact geometry measurements do not establish artistic quality. Never accept solely on an RGB-mask score.

The offline viewer is `assets/source/maps/miami/checks/viewer.html`; open it directly in a browser. It reads the actual PNG tiles, supports pan/zoom and a fixed-camera painting comparison, and draws optional diagnostic overlays independently. No server or dependencies are required.

For final acceptance after every original exists, run `finish.py 3`, `author_canopy.py`, then `finish.py 0`, `finish.py 1`, `finish.py 2`, `finish.py 3`, `measure.py`, `grid_check.py` and `audit.py`. Preserve the frozen canopy during later finishing runs. `contexts.py` leaves prompts and reference crops for already-painted tiles intact. Exact fresh image generation is nondeterministic; the saved originals make subsequent finishing reproducible.

Do not change map.json after downloading and preparing an accepted map. To explore different bounds, use a separate destination and manifest: the download cache filenames describe this frozen square. See SOURCES.md and base/VALUES.md for source limits, licensing and authored-world conventions.
