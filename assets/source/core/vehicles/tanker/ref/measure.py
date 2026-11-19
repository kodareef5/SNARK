"""Bake map collision and the hand-built silhouette into the content and packing contracts."""

import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from geometry import ROOT, PIVOTS, STATES, model, posed, flat_paint
import numpy as np


def write(path, data):
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n")


write(ROOT / "ref/rig.json", PIVOTS)
levels = []
# Only the two coarsest levels are built by hand. The 9,800 and 3,750 triangle levels are made from the finest by the
# art build: its 1.1 cm and 3.9 cm against the hand-fitted shells' 8.9 cm and 16.3 cm (capped hub recesses, tank-end
# shoulders), so they are drawn from 37 m on medium where the shells waited until 312 m.
for geometry in [model(False), model(False, True)]:
    parts = []
    for v, f, t, g, b in flat_paint(geometry):
        parts.append([b, t, v.round(5).flatten().tolist(), f.flatten().tolist()])
    levels.append(parts)
write(ROOT / "ref/distance.json", levels)
bounds = {}
for state in STATES:
    sections = {}
    for v, f, t, g, b in posed(model(), state):
        if g == "wheel":
            g = b
        elif b.startswith("door"):
            g = b
        elif g == "hood" and np.ptp(v[:, 2]) > 2:  # separate the bonnet from the lower cab
            sections.setdefault("cab", []).extend(v[v[:, 2] < 3.12])
            v = v[v[:, 2] >= 3.12]
        sections.setdefault(g, []).extend(v)
    boxes = []
    for vs in sections.values():
        v = np.array(vs)
        lo = v.min(0)
        hi = v.max(0)
        boxes.append(
            {
                "at": ((hi + lo) / 2).round(4).tolist(),
                "half": np.maximum((hi - lo) / 2, 0.015).round(4).tolist(),
            }
        )
    bounds[state] = boxes
write(ROOT.parents[4] / "content/vehicles/tanker-wreck-bounds.json", bounds)
