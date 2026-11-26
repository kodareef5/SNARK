"""Derive the three game maps from the material study in ref/."""

from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
TILE = 128
GRID = 4

# Roughness, metalness, height amplitude, and relief grid in reading order.
SURFACES = (
    (0.76, 0.00, 0.28, (50, 54)), (0.92, 0.00, 0.12, (26, 68)),
    (0.39, 0.00, 0.04, (54, 54)), (0.41, 0.80, 0.14, (16, 84)),
    (0.48, 0.00, 0.11, (58, 58)), (0.77, 0.00, 0.17, (56, 56)),
    (0.86, 0.00, 0.36, (66, 72)), (0.90, 0.00, 0.23, (55, 63)),
    (0.24, 0.00, 0.09, (18, 27)), (0.35, 0.00, 0.10, (54, 58)),
    (0.40, 0.00, 0.07, (48, 48)), (0.83, 0.00, 0.38, (70, 74)),
    (0.20, 0.00, 0.07, (16, 20)), (0.42, 0.00, 0.20, (28, 64)),
    (0.84, 0.00, 0.09, (46, 54)), (0.65, 0.00, 0.19, (56, 60)),
)


def image(values):
    return Image.fromarray(np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8))


def noise(rng, grid):
    field = Image.fromarray(rng.standard_normal(grid, dtype=np.float32))
    return np.asarray(field.resize((TILE, TILE), Image.Resampling.BILINEAR))


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
    base = Image.new("RGB", (GRID * TILE, GRID * TILE))
    normal = Image.new("RGB", base.size)
    packed = Image.new("RGB", (base.width // 2, base.height // 2))
    for index, (roughness, metalness, strength, grid) in enumerate(SURFACES):
        row, col = divmod(index, GRID)
        x0, y0 = (col + 0.04) * source_width / GRID, (row + 0.04) * source_height / GRID
        x1, y1 = (col + 0.96) * source_width / GRID, (row + 0.96) * source_height / GRID
        tile = source.crop((x0, y0, x1, y1)).resize((TILE, TILE), Image.Resampling.LANCZOS)
        base.paste(tile, (col * TILE, row * TILE))

        # Color specks stay in albedo while microdetail and roughness come from separate fields.
        rng = np.random.default_rng(67102 + index)
        height = strength * noise(rng, grid)
        dy, dx = np.gradient(height)
        vector = np.stack((-dx, dy, np.ones_like(dx)), axis=-1)
        vector /= np.linalg.norm(vector, axis=-1, keepdims=True)
        normal.paste(image(0.5 + 0.5 * vector), (col * TILE, row * TILE))

        cavity = np.minimum(0, height)
        channels = np.stack((0.985 + cavity * 0.14, roughness + 0.026 * noise(rng, (15, 18)),
                             np.full_like(height, metalness)), axis=-1)
        half = image(channels).resize((TILE // 2, TILE // 2), Image.Resampling.BOX)
        packed.paste(half, (col * TILE // 2, row * TILE // 2))

    for role, atlas in (("base", base), ("normal", normal), ("orm", packed)):
        save(atlas, HERE / f"supplies_{role}.png")
        side = atlas.width // GRID
        # The first swatch of the bottom row has its own emissive finish.
        save(atlas.crop((0, 3 * side, side, 4 * side)), HERE / f"gel_{role}.png")


if __name__ == "__main__":
    maps()
