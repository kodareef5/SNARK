This manual replay checks the stage3 closed AquaDome fit against the frozen
pre-fit native source geometry. It is outside routine CI and never writes the
supplied model directory. The baseline is commit `7a673712`, raw index
`495467641d3cd29dc0e53963a4fdafe90f761b6e1984e5668620a37dd1200e0c`;
regenerate it with that checkout's `census.py` in an isolated worktree if the
frozen raw directory is unavailable.

From the current repository root, replace `BASELINE_RAW_DIR` with that raw
directory. The current model source must contain the accepted fit.

```sh
blender --background --factory-startup --python-exit-code 1 --python tools/cruise/dome-fit/derive.py -- assets/source/landmarks/cruise var/cruise-preview/dome-fit-replay
bun tools/cruise/dome-fit/check.ts assets/source/landmarks/cruise BASELINE_RAW_DIR var/cruise-preview/dome-fit-replay
blender --background --factory-startup --python-exit-code 1 --python tools/cruise/dome-fit/metrics.py -- assets/source/landmarks/cruise var/cruise-preview/dome-fit-replay assets/source/landmarks/cruise/ref/dome-prior-visible-witnesses.json
```

The first step asserts exact unchanged geometry at the other authored stages
and the separate lower C rim, then emits only the 36 dome-containing cells.
The second replaces stage3 in the full retained-level population before real
native serialization, so every level supplies the shared quantization bounds.
It checks dome-owner P95, complete-cell counts and native topology. The last
step measures both directions independently, the crown transition, published
57×17m dimensions, all 3,148 prior visible witness records (1,680 unique
positions), and the real entrance's full capsule-center volume with an
explicit sampling-coverage reserve. Each step exits nonzero on a failed gate.

`native-check.json` and `metrics.json` are the replay outputs. This is P95
evidence, not a maximum-error bound: the crown sample maximum remains about
0.069004m. The normal full export, packed checks and native scene review are
still required. Replays against changed source must receive new identities;
the old failed visibility reports must not be relabelled as passes.
