# Frozen fern sources

The `*_original.png` images are unmodified, full-resolution outputs from the built-in image generation tool. Eleven were selected: six green fronds, two dry fronds, two young crosiers, and a crown-surface swatch. `frond3_revision_original.png` replaced a first version whose damaged tip was too subtle.

`prompts.json` contains every exact prompt and the tool output path. Reference images were only the project-owned fern concepts; no outside images were searched or downloaded. Originals are 724 × 2172 pixels, except `frond5_original.png` and `frond6_original.png`, which are 887 × 1774.

`build_spec.json` specifies packing, physical dimensions, surface kind, roughness, and source selection. `build_metadata.json` records source SHA-256 hashes, source crops, fitted dimensions, placements, means, and the physical normal-map convention. `session.json` records timing and tool provenance.

The selected tip revision contains a translucent white matte. The builder uses its leaf/stalk chroma to remove that matte, then extends interior colours to the cut edges. Other masks derive from generated alpha. All source masks are made opaque inside and antialiased only at their final 1–2 pixel edges.

Rebuild from the parent folder:

```sh
python3 build_atlas.py
python3 check_atlas.py
```

Dependencies used: Pillow 11.3.0, numpy 2.0.2, scipy 1.13.1. Python 3.9 or later. The rebuild uses only local files and does not call an image model.
