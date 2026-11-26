"""Derive the three game maps from the material study in ref/."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
TILE = 128
GRID = 4

# Roughness, metalness, and bump strength in reading order.
SURFACES = (
    (0.78, 0.00, 5.0), (0.92, 0.00, 2.0), (0.39, 0.00, 1.7), (0.41, 0.80, 2.0),
    (0.48, 0.00, 2.2), (0.77, 0.00, 2.4), (0.86, 0.00, 6.0), (0.90, 0.00, 4.0),
    (0.24, 0.00, 2.1), (0.38, 0.50, 3.3), (0.40, 0.00, 1.5), (0.83, 0.00, 5.5),
    (0.20, 0.00, 1.8), (0.42, 0.00, 3.3), (0.84, 0.00, 1.9), (0.65, 0.00, 3.7),
)


def image(values):
    return Image.fromarray(np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8))


def maps():
    source = Image.open(HERE.parent / "ref/material-source.png").convert("RGB")
    source_width, source_height = source.size
    base = Image.new("RGB", (GRID * TILE, GRID * TILE))
    normal = Image.new("RGB", base.size)
    packed = Image.new("RGB", (base.width // 2, base.height // 2))
    for index, (roughness, metalness, strength) in enumerate(SURFACES):
        row, col = divmod(index, GRID)
        x0, y0 = (col + 0.04) * source_width / GRID, (row + 0.04) * source_height / GRID
        x1, y1 = (col + 0.96) * source_width / GRID, (row + 0.96) * source_height / GRID
        tile = source.crop((x0, y0, x1, y1)).resize((TILE, TILE), Image.Resampling.LANCZOS)
        base.paste(tile, (col * TILE, row * TILE))

        gray = tile.convert("L")
        height = np.asarray(gray, dtype=np.float32) / 255
        broad = np.asarray(gray.filter(ImageFilter.GaussianBlur(5)), dtype=np.float32) / 255
        relief = height - 0.8 * broad
        dy, dx = np.gradient(relief)
        vector = np.stack((-strength * dx, strength * dy, np.ones_like(dx)), axis=-1)
        vector /= np.linalg.norm(vector, axis=-1, keepdims=True)
        normal.paste(image(0.5 + 0.5 * vector), (col * TILE, row * TILE))

        cavity = np.minimum(0, height - broad)
        channels = np.stack((0.97 + cavity * 0.8, roughness - 0.45 * (height - broad),
                             np.full_like(height, metalness)), axis=-1)
        half = image(channels).resize((TILE // 2, TILE // 2), Image.Resampling.BOX)
        packed.paste(half, (col * TILE // 2, row * TILE // 2))

    for role, atlas in (("base", base), ("normal", normal), ("orm", packed)):
        atlas.save(HERE / f"supplies_{role}.png", optimize=True)
        side = atlas.width // GRID
        # The first swatch of the bottom row has its own emissive finish.
        atlas.crop((0, 3 * side, side, 4 * side)).save(HERE / f"gel_{role}.png", optimize=True)


if __name__ == "__main__":
    maps()
