"""Derive the mineral maps from the diffuse ImageGen swatches with NumPy and Pillow."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


HERE = Path(__file__).resolve().parent
SIDE = 128
# The entries follow the atlas in reading order: brightness lift, bump strength and roughness.
SWATCHES = {
    "stone": (0.00, 4.0, 0.84),
    "flint": (0.04, 2.1, 0.43),
    "crystal": (0.00, 0.9, 0.19),
    "obsidian": (0.04, 1.1, 0.15),
    "ore": (0.02, 3.6, 0.68),
    "ingot": (0.07, 1.9, 0.33),
    "silica_pearls": (0.00, 0.5, 0.26),
    "charcoal": (0.06, 3.9, 0.92),
}


def image(values):
    return Image.fromarray(np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8))


def swatch(atlas, column, row):
    width, height = atlas.size
    cell_width, cell_height = width / 4, height / 2
    x, y = (column + 0.5) * cell_width, (row + 0.5) * cell_height
    radius = (cell_width - 16) / 2
    square = atlas.crop(tuple(round(n) for n in (x - radius, y - radius, x + radius, y + radius)))
    return np.asarray(square.resize((SIDE, SIDE), Image.Resampling.LANCZOS), dtype=float) / 255


def finish(name, base, lift, bump, roughness):
    dest = HERE / "tex"
    dest.mkdir(exist_ok=True)

    if name == "silica_pearls":
        # The round pearls wrap this swatch at the back, so blend its edges to the same colour.
        distance = np.minimum(np.arange(SIDE), np.arange(SIDE)[::-1])
        fade = np.sin(np.minimum(distance / 12, 1) * np.pi / 2)
        base = base.mean(axis=(0, 1)) + (base - base.mean(axis=(0, 1))) * fade[None, :, None]

    luma = base @ np.array([0.2126, 0.7152, 0.0722])
    blurred = np.asarray(image(luma).filter(ImageFilter.GaussianBlur(radius=3)), dtype=float) / 255
    relief = (luma - blurred) * 0.75 + (luma - luma.mean()) * 0.25
    dy, dx = np.gradient(relief * bump)
    normal = np.stack((-dx, dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)

    cavity = np.clip(-relief * 3, 0, 0.35)
    ao = 1 - cavity * min(bump / 4, 1)
    rough = np.clip(roughness - relief * 0.65, 0.08, 0.98)
    metal = np.zeros_like(rough)
    if name == "ore":
        # The silvery grains reflect light. The dark matrix and rust remain dielectric.
        chroma = base.max(axis=-1) - base.min(axis=-1)
        metal = np.clip((luma - 0.36) * 5, 0, 1) * np.clip((0.17 - chroma) * 12, 0, 1) * 0.86
        rough -= metal * 0.34
    if name == "ingot":
        metal = np.clip(0.85 - cavity * 0.35, 0, 1)

    image(base + lift).save(dest / f"{name}_base.png", optimize=True)
    image(normal * 0.5 + 0.5).save(dest / f"{name}_normal.png", optimize=True)
    orm = image(np.stack((ao, rough, metal), axis=-1))
    orm.resize((SIDE // 2, SIDE // 2), Image.Resampling.BOX).save(
        dest / f"{name}_orm.png", optimize=True,
    )


with Image.open(HERE / "ref" / "mineral-atlas.png") as source:
    atlas = source.convert("RGB")
    for i, (name, surface) in enumerate(SWATCHES.items()):
        finish(name, swatch(atlas, i % 4, i // 4), *surface)
