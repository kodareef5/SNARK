"""Lifts the flint's roughness after build_material.py, from the asset maker, not the image model.

In the game's light (one sun, GGX, the sky reflected) the flint as made, roughness about 0.41 at its median, read as
rippled steel on a hatchet held or lying: its face caught the sky at every angle. Knapped flint is glassy only at a
glance. This keeps every ripple of the roughness map and lifts it toward rough, 0.41 to 0.62, leaving 1 at 1:
r' = 1 - (1 - r) * KEEP. Occlusion and metalness are untouched, and the 1,024 map stays the 2,048 shrunk.

    python3 tune_flint.py    (after build_material.py)

The map build_material.py wrote is kept as flint_orm_made*.png and the tuned one written as flint_orm*.png. A map
newer than its kept one is a fresh build's, and is kept in its place.
"""

import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
KEEP = (1 - 0.62) / (1 - 0.41)

for suffix in ("", "_1024"):
    made = os.path.join(HERE, f"flint_orm_made{suffix}.png")
    out = os.path.join(HERE, f"flint_orm{suffix}.png")
    if not os.path.exists(made) or os.path.getmtime(out) > os.path.getmtime(made):
        os.replace(out, made)
    orm = np.asarray(Image.open(made).convert("RGB")).astype(np.float64) / 255
    orm[..., 1] = 1 - (1 - orm[..., 1]) * KEEP
    Image.fromarray(np.round(orm * 255).clip(0, 255).astype(np.uint8), "RGB").save(out, optimize=True)
    g = orm[..., 1]
    print(f"{os.path.basename(out)}: roughness median {np.median(g):.3f}, 5th to 95th {np.percentile(g, 5):.3f} to {np.percentile(g, 95):.3f}")
