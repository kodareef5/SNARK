"""Tones the steel's metalness and roughness down after build_material.py, from the asset maker, not the image model.

In the game's light (one sun, GGX, the sky reflected: client/core/render/surface.ts `lit`) a fully metallic surface
has no colour of its own under the sky, only the sky's reflection tinted by its base colour. The dark steel face as
made, metalness 1 and roughness about 0.5, read as blue on every gun held or lying: it mirrored the blue sky. Browned
and oiled steel is a dull metal. This keeps every scratch and pit of both maps and, band by band (BANDS), scales the
metalness down and lifts the roughness toward rough, r' = 1 - (1 - r) * keep: the dark face most, the worn bright edge
less, the brass least, so the face reads dark grey, the edges pale grey and the brass warm. Occlusion is untouched,
and the 1,024 map stays the 2,048 shrunk. (materials.ts warms the base colour a little too, with a tint.)

    python3 tune_steel.py    (after build_material.py)

The map build_material.py wrote is kept as steel_orm_made*.png and the tuned one written as steel_orm*.png. A map in
place that is fully metallic is a fresh build's, and is kept in its place; run again, it changes nothing.
"""

import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
# (metalness factor, roughness kept) for the brass (rows 0 to 1/8 from the top), the bright edge (1/8 to 1/4) and the
# face (1/4 to 1).
BANDS = [(0.80, 0.85), (0.45, 0.60), (0.35, 0.70)]
RAMP = 1 / 64  # the bands' soft joins, in fractions of the picture's height, as build_material.py blends them


def factors(height):
    """Per row, the bands' factors blended across each join, wrapping at the picture's top and bottom."""
    y = (np.arange(height) + 0.5) / height
    # The face's join with the brass is moved a little up the face, off the picture's edge, so that the rows either side
    # of the wrap take the same factors and the packed map wraps as smoothly as the image model's did.
    edges = [-2 * RAMP, 1 / 8, 1 / 4, 1.0 - 2 * RAMP]
    weight = np.zeros((3, height))
    for k in range(3):
        lo, hi = edges[k], edges[k + 1]
        # The picture wraps: the face's bottom runs into the brass's top.
        for yy in (y - 1, y, y + 1):
            weight[k] = np.maximum(weight[k], np.minimum(np.clip((yy - lo) / RAMP + 0.5, 0, 1), np.clip((hi - yy) / RAMP + 0.5, 0, 1)))
    weight /= weight.sum(axis=0, keepdims=True)
    metal = sum(weight[k] * BANDS[k][0] for k in range(3))
    keep = sum(weight[k] * BANDS[k][1] for k in range(3))
    return metal[:, None], keep[:, None]


def tuned(path):
    orm = np.asarray(Image.open(path).convert("RGB")).astype(np.float64) / 255
    metal, keep = factors(orm.shape[0])
    orm[..., 1] = 1 - (1 - orm[..., 1]) * keep
    orm[..., 2] = orm[..., 2] * metal
    return np.round(orm * 255).clip(0, 255).astype(np.uint8)


for suffix in ("", "_1024"):
    made = os.path.join(HERE, f"steel_orm_made{suffix}.png")
    out = os.path.join(HERE, f"steel_orm{suffix}.png")
    if not os.path.exists(out):
        continue
    # build_material.py makes every texel fully metallic, and a tuned map has none so.
    if not os.path.exists(made) or np.asarray(Image.open(out).convert("RGB"))[..., 2].mean() > 250:
        os.replace(out, made)
    Image.fromarray(tuned(made), "RGB").save(out, optimize=True)
    orm = np.asarray(Image.open(out).convert("RGB")).astype(np.float64) / 255
    rows = orm.shape[0]
    for name, (a, b) in (("brass", (0, rows // 8)), ("bright", (rows // 8, rows // 4)), ("face", (rows // 4, rows))):
        print(f"steel_orm{suffix}: {name} roughness {orm[a:b, :, 1].mean():.2f}, metalness {orm[a:b, :, 2].mean():.2f}")
