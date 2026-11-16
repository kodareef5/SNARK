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

The source's generic dimensions were corrected with real native character evidence: doorways are 1.6 m clear, 2.6 m high, and stair flights are 1.6 m clear and turning landings are 4.0×2.0 m clear. Public circulation stays open; three independent doors support actual native E operation. See `ref/LAYOUT.md` for schema, coordinate frame, route meaning and the original wider-avatar witness.

`lod-errors.json` records per-piece stated appearance errors. The native build recomputes geometric surface error and takes a cumulative maximum with an 8 mm floor for texture/lettering loss. Thus geometry-identical flat decks, wall panels and upholstery still retain their textured representation nearby. No measured geometric error is reduced and no global renderer tier is overridden. Native check reports both stated and measured errors.

The final circulation proof is recorded by `tools/art/koru-fit.evidence.json` and the native Koru traversal/fit tests. It covers the complete 22-slider creator interval, both body sexes, all 40 finest body/armor/hair meshes and the stated native locomotion/head-look domains. Exact posed meshes are additionally checked at every enclosed-room doorway and both turning-landing points on all eight stairs. The derived lateral bound is about 0.775 m, leaving about 22 mm after the native 3 mm allowance within a centered 1.6 m opening. This is the tested domain, not a claim about future animation or armor additions.

`ref/review/` contains the native application review and selected images. Review specifically checked the formerly overlapping brass/wood window reveals, readable side-wall plaques, textured interiors at close range, intentional flat colours, open window/stair apertures, the moored exterior and far-distance ownership. Room plaques map U along the wall and V upward; each visible window jamb is partitioned into disjoint wood/brass solids.
