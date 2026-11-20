"""Park the donor's 40-foot dry van on its landing gear, centered on its box."""

import gzip, json
from build import HERE, body_parts, hull, box, shell
import numpy as np

out = HERE.parent / "box_trailer"
axles = json.loads((HERE.parents[4] / "content/vehicles/trailer-axles.json").read_text())
radius = axles["radius"]
donor = body_parts(HERE.parents[3] / "raw/grab3d/semi-truck.glb", -2.90, "_trailer")
for level, samples in enumerate([90, 35, 15, 8]):
    parts = []
    for i, v in enumerate(donor):
        dim = np.ptp(v, axis=0)
        if level > 0 and max(dim) < [0, 0.12, 0.24, 0.64][level]:
            continue
        if level == 3 and i not in [3, 4, 7, 10, 16, 24, 31, 55, 57]:
            continue
        tile = (
            1
            if i in [3, 15, 43]
            else 8
            if i in [18, 21, 59, 64]
            else 0
            if i in [8, 9, 70, 71]
            else 5
            if v[:, 1].mean() > 1.15
            else 2
        )
        result = hull(v, samples)
        if result:
            parts.append((*result, tile, "", ""))
    for z in axles["z"]:
        for s in [-1, 1]:
            n = [32, 20, 12, 8][level]
            parts.append(
                shell(
                    [
                        (s * 0.91 + dx, radius, z, r, r)
                        for dx, r in [(-0.28, 0.45), (-0.22, radius), (0.22, radius), (0.28, 0.45)]
                    ],
                    "x",
                    n,
                    4,
                    "",
                    "",
                )
            )
            parts.append(
                shell([(x, radius, z, 0.29, 0.29) for x in sorted([s * 1.193, s * 1.218])], "x", n, 5, "", "")
            )
    for s in [-1, 1]:
        # Extend the retractable feet to the same plane as the tyres.
        parts.append(box((s * 0.78, 0.11, 3.30), (0.15, 0.22, 0.15), 2, ""))
        parts.append(box((s * 0.78, 0.035, 3.30), (0.30, 0.07, 0.36), 5, ""))
        if level < 3:
            parts.append(box((s * 1.313, 1.81, 0), (0.022, 0.26, 11.97), 0, ""))
            for z in np.linspace(-5.91, 5.91, 18 if level < 2 else 8):
                parts.append(box((s * 1.31, 2.85, z), (0.022, 1.79, 0.034), 5, ""))
    records = [[b, t, v.round(5).flatten().tolist(), f.flatten().tolist()] for v, f, t, _, b in parts]
    (out / f"lod{level}.json.gz").write_bytes(
        gzip.compress(json.dumps(records, separators=(",", ":")).encode(), mtime=0)
    )
    print(level, sum(len(f) for _, f, *_ in parts))
