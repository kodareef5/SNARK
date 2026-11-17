These diagnostics measure layout `4bd7249e428cf3e2d88e49e8279cae148d6b67fc148c814d6c286548127ee5b6`
and frozen raw index `495467641d3cd29dc0e53963a4fdafe90f761b6e1984e5668620a37dd1200e0c`.
They do not replace the normal export, packed-art checks, or native visual review.

`aquatheater-final-certificate.json` passes for all six pods at X ±13,
Z 93/109/128. Its stage3 claim is a finite bidirectional exterior-visible P95
bound with a 0.5 mm quantization reserve. The recorded visible maximum is
0.113335 m; it is not a 0.06 m maximum-error claim. Native fixture topology and
whole-object errors pass their separate checks. Complete affected-cell stage
2/3/4/5 peaks are 2,536 / 826 / 294 / 294 triangles.

`dome-census.json` records every one of the 36 actual dome cells. It measures
both whole-cell and dome-owner-only native P95 after serialization, with the
same shared native bounds. All 36 require the separate visibility check; 33
exceed 0.06 m for dome geometry alone. Selection also verifies every scanned
raw geometry and clear-material byte, rather than relying only on index IDs.

`dome-visibility-diagnostic.json` is an **unsuccessful sufficient proof**, not
dome acceptance. Only cells 226, 227, 346, and 347 meet the conservative
constructive bound. The other 32 need further assessment using the actual
exported sample population or a geometry correction. There are no unresolved
rays, every reverse sample is within 0.06 m, and the observed forward visible
maximum is 0.098965 m. The good lower bound counts each verified geometric
corner once per cell plus guaranteed triangle centroids; the bad upper bound
retains all raw corner/centroid occurrences. No assumption is made that raw
corner multiplicity survives exported vertex sharing. The compact report
retains all per-cell results and representative witnesses, and hashes the full
replay report, whose complete ray witnesses remain reproducible.

Run from the repository root, with Blender and Bun on PATH. To regenerate raw
geometry from the matching source, run the authoring census first (it also
updates the source census tables):

```sh
blender --background --factory-startup --python-exit-code 1 --python assets/source/landmarks/cruise/census.py
bun tools/cruise/dome-census.ts --raw assets/source/landmarks/cruise/ref/raw-cells --layout content/landmarks/cruise-layout.json --out var/cruise-preview/dome-census.json
bun tools/cruise/dome-error.ts --raw assets/source/landmarks/cruise/ref/raw-cells --source assets/source/landmarks/cruise --layout content/landmarks/cruise-layout.json --census var/cruise-preview/dome-census.json --out var/cruise-preview/dome-error.json
bun tools/cruise/aquatheater.ts assets/source/landmarks/cruise var/cruise-preview/aquatheater-final --capacity
```

The dome command intentionally exits nonzero on this snapshot. The old
`dome-error.json` two-cell evidence is historical and cannot establish full
dome coverage. Raw generation, exported topology, and final rendered
appearance remain separate checks. Diagnostic elapsed times are not game
performance measurements.
