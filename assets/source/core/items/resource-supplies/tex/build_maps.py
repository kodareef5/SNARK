"""Derive seamless surface maps from the material study in ref/."""

from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
TILE = 128
GRID = 4
OVERLAP = 24

# Roughness, metalness, height amplitude, and relief grid in reading order.
SURFACES = (
    ("mortar", 0.76, 0.00, 0.28, (50, 54)), ("kraft", 0.92, 0.00, 0.12, (26, 68)),
    ("board", 0.39, 0.00, 0.04, (54, 54)), ("brass", 0.41, 0.80, 0.14, (16, 84)),
    ("red", 0.48, 0.00, 0.20, (35, 53)), ("rubber", 0.77, 0.00, 0.23, (37, 36)),
    ("powder", 0.86, 0.00, 0.12, (60, 64)), ("canvas", 0.90, 0.00, 0.12, (55, 63)),
    ("tar", 0.24, 0.00, 0.09, (18, 27)), ("enamel", 0.35, 0.00, 0.10, (54, 58)),
    ("ivory", 0.40, 0.00, 0.07, (48, 48)), ("spark", 0.83, 0.00, 0.38, (70, 74)),
    ("gel", 0.20, 0.00, 0.07, (16, 20)), ("shell", 0.42, 0.00, 0.20, (28, 64)),
    ("paper", 0.84, 0.00, 0.09, (46, 54)), ("strap", 0.65, 0.00, 0.19, (56, 60)),
)


def image(values):
    return Image.fromarray(np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8))


def noise(rng, grid):
    field = rng.standard_normal(grid, dtype=np.float32)
    for axis, size in enumerate(grid):
        at = np.arange(TILE) * size / TILE
        lo = at.astype(np.intp)
        fraction = at - lo
        weight = fraction * fraction * (3 - 2 * fraction)
        weight = weight[:, None] if axis == 0 else weight[None, :]
        field = np.take(field, lo, axis=axis) * (1 - weight) + np.take(field, (lo + 1) % size, axis=axis) * weight
    return field


def seamless(tile):
    """Blend the swatch's overlapping edges while retaining its unshifted center."""
    width = TILE + OVERLAP
    pixels = np.asarray(tile.resize((width, width), Image.Resampling.LANCZOS), dtype=np.float32) / 255
    at = np.linspace(0, 1, OVERLAP, dtype=np.float32)
    ramp = (at * at * (3 - 2 * at))[:, None, None]
    for _ in range(2):
        mixed = pixels[:TILE].copy()
        mixed[:OVERLAP] = pixels[:OVERLAP] * ramp + pixels[TILE:] * (1 - ramp)
        pixels = mixed.swapaxes(0, 1)
    return pixels


def weave():
    y, x = np.indices((TILE, TILE), dtype=np.float32) * (2 * np.pi / TILE)
    warp = np.cos(38 * x)
    weft = np.cos(34 * y)
    return 0.055 * (warp + weft) + 0.035 * (warp - weft) * np.cos(19 * x + 17 * y)


def save(picture, path):
    with NamedTemporaryFile(dir=path.parent, prefix=f".{path.stem}-", suffix=".png", delete=False) as scratch:
        temporary = Path(scratch.name)
    try:
        picture.save(temporary, optimize=True)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def maps():
    source = Image.open(HERE.parent / "ref/material-source.png").convert("RGB")
    source_width, source_height = source.size
    for index, (name, roughness, metalness, strength, grid) in enumerate(SURFACES):
        # The powder item is sealed in a charcoal-dyed woven sack.
        source_index = 7 if name == "powder" else index
        row, col = divmod(source_index, GRID)
        x0, y0 = (col + 0.04) * source_width / GRID, (row + 0.04) * source_height / GRID
        x1, y1 = (col + 0.96) * source_width / GRID, (row + 0.96) * source_height / GRID
        color = seamless(source.crop((x0, y0, x1, y1)))
        if name == "powder":
            color *= np.array((0.38, 0.39, 0.43))
        base = image(color)

        # Color specks stay in albedo while microdetail and roughness come from separate fields.
        rng = np.random.default_rng(67102 + index)
        height = strength * noise(rng, grid)
        if name in ("powder", "canvas"):
            height += weave()
        dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) / 2
        dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) / 2
        vector = np.stack((-dx, dy, np.ones_like(dx)), axis=-1)
        vector /= np.linalg.norm(vector, axis=-1, keepdims=True)
        normal = image(0.5 + 0.5 * vector)

        cavity = np.minimum(0, height)
        channels = np.stack((0.985 + cavity * 0.14, roughness + 0.026 * noise(rng, (15, 18)),
                             np.full_like(height, metalness)), axis=-1)
        packed = image(channels).resize((TILE // 2, TILE // 2), Image.Resampling.BOX)
        for role, picture in (("base", base), ("normal", normal), ("orm", packed)):
            save(picture, HERE / f"{name}_{role}.png")


if __name__ == "__main__":
    maps()
