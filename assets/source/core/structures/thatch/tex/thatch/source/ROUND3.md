# Round 3 source record

The four maps are rebuilt from the original full-size generated images and the
unchanged `round2_palette.json`, placed on the supplied round 3 guides. No image
was generated, searched for or downloaded for this revision. Repository-owned
`house_hero.png`, `piece_wall.png` and `DESIGN.md` are the only references consulted.

`build_material.py` reads rod heights from `guide/LAYOUT.json`, derives the opaque
lower-tier sampling row from the upper envelope, and reads the actual pixel
intervals from `guide/bundles.png`. There are 14 upper and 12 lower intervals.
The one interval crossing the horizontal repeat is treated as a single sheaf.
Both generated source warps and analytic stem fans use zero bundle-axis lean;
the model supplies lean. Fine reed wander and occasional crossing strays remain.
The original gathering/flare profile now expands below the new tie positions.

The accepted appearance recipe and independent geometry/appearance seeds remain.
`round3_placement.json` assigns the existing +7 tone endpoint to lower sheaf 4,
placing a fresher handful between two similarly aged neighbours. This makes the
boundary legible without an edge shadow or line. All other random tone choices
are retained. Bundle counts and widths change the sampling and stem placement;
the old masks are deliberately replaced with ragged tips inside the new limits.

`upper_master.png`, `lower_master.png`, `relief_layers.npz` and `build_manifest.json`
are reproducible intermediates. The height map contains only local reed, node,
stray and cord-pressure relief over a full 16 mm range. Geometry depth is used
only for AO and preview lighting. Normal computation uses the delivered 16-bit
height and the 3 m physical scale.

Earlier sources are frozen in `round1/` and `round2/`; their SHA-256 inventories
are checked on each validation run. Round 2's unchanged historical guides were
recovered from round 1, because the working guide folder was already round 3.
`round3_guides_sha256.json` records the supplied new guides before any build.

The checker reads delivered RGB to locate each boundary independently of the
manifest, then compares it with the guide. A bounded search spans a quarter of
the smaller neighbouring bundle width, and integrates squared RGB differences over
the opaque body. Local peaks within 5% of the strongest response are candidates;
the nearest is matched, and all candidates are retained for review. The
construction intervals must match exactly; the RGB candidate may sit up to
four texels away where an individual reed crosses the edge. The
JSON records every error, including rejected shifted copies and the old layout.
The overlay preserves unmarked RGB alongside the marked evidence. This does
not treat every dark reed as another bundle boundary.

Rebuild: `python3 build_material.py`.
Validate: `python3 check_material.py`.
Rebuild proof: `python3 check_material.py --rebuild`.
