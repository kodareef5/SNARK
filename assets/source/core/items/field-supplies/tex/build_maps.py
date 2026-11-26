"""Build the surface maps from the swatch board and independent relief fields."""

from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from PIL import Image


HERE = Path(__file__).resolve().parent
SIDE = 128
OVERLAP = 24
REPEAT_METRES = 0.115

# Base RGB, colour contrast, roughness, metalness, height in mm, and relief cells (vertical, horizontal).
SWATCHES = (
    ("currant", (170, 49, 55), 0.55, 0.29, 0, 0.085, (35, 36)),
    ("nightshade", (54, 50, 78), 0.58, 0.57, 0, 0.115, (24, 25)),
    ("snowberry", (220, 211, 173), 0.60, 0.46, 0, 0.085, (40, 40)),
    ("leaf", (81, 103, 50), 0.48, 0.53, 0, 0.185, (13, 41)),
    ("purple_stem", (79, 55, 72), 0.70, 0.71, 0, 0.325, (40, 7)),
    ("green_glass", (53, 110, 76), 0.55, 0.22, 0, 0.068, (10, 11)),
    ("wax_paper", (209, 184, 139), 0.81, 0.67, 0, 0.170, (24, 41)),
    ("seal", (163, 105, 46), 0.65, 0.51, 0, 0.110, (21, 22)),
    ("hide", (124, 72, 41), 0.79, 0.62, 0, 0.280, (26, 35)),
    ("twine", (169, 138, 86), 0.66, 0.84, 0, 0.260, (47, 20)),
    ("crystal", (117, 166, 167), 0.82, 0.34, 0, 0.075, (10, 14)),
    ("cement", (72, 91, 83), 0.57, 0.87, 0, 0.380, (34, 36)),
    ("polymer", (85, 105, 90), 0.65, 0.55, 0, 0.258, (39, 37)),
    ("steel", (147, 150, 150), 0.63, 0.37, 0.96, 0.100, (45, 6)),
    ("rubber", (47, 46, 44), 0.71, 0.76, 0, 0.205, (27, 33)),
    ("green_stem", (112, 105, 62), 0.58, 0.70, 0, 0.255, (35, 12)),
)


def encode(values):
    return Image.fromarray(np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8))


def periodic_swatch(image):
    """Blend the edge overlap and keep the source's undisturbed center."""
    width = SIDE + OVERLAP
    pixels = np.asarray(image.resize((width, width), Image.Resampling.LANCZOS), dtype=np.float32) / 255
    t = np.linspace(0, 1, OVERLAP, dtype=np.float32)
    ramp = (t * t * (3 - 2 * t))[:, None, None]
    for _ in range(2):
        blended = pixels[:SIDE].copy()
        blended[:OVERLAP] = blended[:OVERLAP] * ramp + pixels[SIDE:] * (1 - ramp)
        pixels = blended.swapaxes(0, 1)
    return pixels


def noise(rng, cells):
    value = rng.standard_normal(cells, dtype=np.float32)
    for axis, size in enumerate(cells):
        at = np.arange(SIDE) * size / SIDE
        left = at.astype(np.intp)
        step = at - left
        weight = step * step * (3 - 2 * step)
        weight = weight[:, None] if axis == 0 else weight[None, :]
        a = np.take(value, left, axis=axis)
        b = np.take(value, (left + 1) % size, axis=axis)
        value = a + weight * (b - a)
    return value


def relief(rng, name, cells):
    graining = noise(rng, cells)
    grain = noise(rng, (47, 49))
    y, x = np.indices((SIDE, SIDE), dtype=np.float32) * (2 * np.pi / SIDE)
    if name == "twine":
        # Two oblique strands and short fibres follow the tie's texture axis.
        return 0.55 * np.sin(13 * y + 5 * x + 0.22 * np.sin(5 * y - 2 * x)) + 0.31 * graining + 0.16 * grain
    if name == "hide":
        wrinkles = noise(rng, (8, 12))
        creases = -np.exp(-22 * np.square(wrinkles))
        return 0.38 * graining + 0.34 * creases + 0.28 * grain
    if name == "crystal":
        # The mineral inclusions in base colour sit under a mostly polished face.
        tool_marks = 0.11 * np.sin(28 * y + x)
        return 0.75 * graining + tool_marks + 0.12 * grain
    if name == "polymer":
        pebbles = np.maximum(0, graining)
        return 0.83 * np.tanh(pebbles * 2.2) + 0.17 * grain
    return 0.74 * graining + 0.26 * grain


def save(image, path):
    with NamedTemporaryFile(dir=path.parent, prefix=f".{path.stem}-", suffix=".png", delete=False) as scratch:
        temporary = Path(scratch.name)
    try:
        image.save(temporary, optimize=True)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def maps():
    with Image.open(HERE.parent / "ref/material-study.png") as original:
        source = original.convert("RGB")
    width, height = source.size
    for n, (name, rgb, contrast, roughness, metalness, amplitude, cells) in enumerate(SWATCHES):
        row, col = divmod(n, 4)
        bounds = ((col + 0.07) * width / 4, (row + 0.07) * height / 4,
                  (col + 0.93) * width / 4, (row + 0.93) * height / 4)
        color = periodic_swatch(source.crop(bounds))
        mean = np.mean(color, axis=(0, 1))
        base = encode(np.array(rgb) / 255 + contrast * (color - mean))

        rng = np.random.default_rng(73521 + n)
        height_mm = amplitude * np.clip(relief(rng, name, cells), -1.9, 1.9)
        step_mm = 1000 * REPEAT_METRES / SIDE
        dx = (np.roll(height_mm, -1, axis=1) - np.roll(height_mm, 1, axis=1)) / (2 * step_mm)
        dy = (np.roll(height_mm, -1, axis=0) - np.roll(height_mm, 1, axis=0)) / (2 * step_mm)
        vector = np.stack((-dx, dy, np.ones_like(dx)), axis=-1)
        vector /= np.linalg.norm(vector, axis=-1, keepdims=True)
        normal = encode(0.5 + 0.5 * vector)
        height_map = encode(0.5 + 0.24 * height_mm / amplitude)

        rough = roughness + 0.030 * noise(rng, (11, 14)) + 0.012 * noise(rng, (33, 33))
        occlusion = 0.991 + np.minimum(height_mm, 0) * 0.16
        packed = encode(np.stack((occlusion, rough, np.full_like(rough, metalness)), axis=-1))
        packed = packed.resize((SIDE // 2, SIDE // 2), Image.Resampling.BOX)
        for role, image in (("base", base), ("normal", normal), ("height", height_map), ("orm", packed)):
            save(image, HERE / f"{name}_{role}.png")


if __name__ == "__main__":
    maps()
