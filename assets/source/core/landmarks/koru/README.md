# Koru: editable native landmark

This is a full-scale, moored reconstruction of Oceanco's three-masted Koru, using the builder's published 125 m overall length and 17.2 m beam. The exterior follows six official photographs; hull sections, rig dimensions and deck elevations are inferred. The connected four-level interior is an original game interpretation, not a private floorplan. Reference images remain reference-only and are not baked into the artwork.

The single native `koru.snpk` contains all bounded module meshes and two shared-within-this-asset material sets. Modules are placed by the native content adapter from `content/landmarks/koru-layout.json`; no giant vehicle body or room portal system is added. Every module has six authored levels. Level0 is textured; levels1–5 use intentional semantic flat colours. Doors, real stairs, window apertures, open rails and the hull silhouette survive the near-flat fallback.

## Source and rebuild

- `author_layout.py` and `layout_details.py` emit the single shared JSON authority. Run these explicitly when changing geometry or room circulation. `model.py` only reads that contract.
- `model.py` and `parts.py` construct original closed solids in Blender, including a closed underwater hull, clear portholes/window frames, actual stair treads and landings, stepped deckhouses, sparse metal rails, furniture, coherent furled sail bundles, mast fittings and rigging.
- `materials.json`, `signs.json` and `tex/paint.py` define the original marine finish atlas and in-world plaques. Source photographs are never sampled. Fine deck surfaces subdivide at a 4 m repeat, giving teak boards a plausible physical scale.
- `build.ts` uses the repository's unmodified `buildAsset`, `packOf` and `checkAsset` pipeline. It saves only after conversion and all native art checks pass. This assembly has hundreds of pieces, so native scene review replaces the unwieldy single catalogue sheet.

```sh
python3 assets/source/core/landmarks/koru/author_layout.py
python3 assets/source/core/landmarks/koru/tex/paint.py
bun assets/source/core/landmarks/koru/build.ts
bun run art -- core:koru --check
bun tools/koru/review.ts
```

The regular `bun run art -- core:koru` command also works and generates the full per-piece catalogue. No new runtime dependencies are required. `ref/geometry-report.json` records the authored triangle counts; `ref/native-check.json` records the packed geometry/material gate. Native application screenshots, actual avatar clearance and traversal acceptance are reviewed separately with the combined scene.

## Intentional construction details

The moored hull's inaccessible volume below the lower floor is closed; all inhabited floors sit above sea level. Window glazing has thin safety collision but a truly clear modeled aperture, so the low-poly renderer does not replace a pane with an opaque slab. Furniture collision matches its meaningful occupied volumes; fine handles and panel details remain within each bounded piece. Wainscot/paint faces are partitioned; inset door panels and plaques stand off recessed substrates. The static bridge chart is fictional in-world decoration, not live navigation.

The source's generic dimensions were corrected with real native character evidence: doorways are 1.6 m clear, 2.6 m high, and stairs/turning landings are 1.6 m clear. Public circulation stays open; three independent doors support actual native E operation. See `ref/LAYOUT.md` for schema, coordinate frame, route meaning and the original wider-avatar witness.
