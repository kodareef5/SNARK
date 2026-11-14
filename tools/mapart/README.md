# Miami map-art tools

Offline source/art tools only. They add no dependency to the engine or its build.

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
