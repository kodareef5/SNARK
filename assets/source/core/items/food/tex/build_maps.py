"""Make the food swatches from the original color study and separate relief."""

from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image


HERE = Path(__file__).resolve().parent
SIDE = 128
OVERLAP = 24

# Each sampled finish has a cell, mean sRGB, and roughness.
SAMPLED = {
    "raw": (0, (0.61, 0.17, 0.18), 0.42),
    "cooked": (1, (0.45, 0.235, 0.14), 0.64),
    "dry": (2, (0.43, 0.235, 0.18), 0.83),
    "spoiled": (3, (0.445, 0.39, 0.30), 0.80),
}
FAT = {
    "raw_fat": ((0.88, 0.70, 0.55), 0.40),
    "cooked_fat": ((0.65, 0.42, 0.25), 0.63),
}


def noise(rng, grid):
    """Interpolate periodic control points, with grid spacing set per surface."""
    field = rng.standard_normal(grid, dtype=np.float32)
    for axis, size in enumerate(grid):
        at = np.arange(SIDE) * size / SIDE
        lo = at.astype(np.intp)
        fraction = at - lo
        ease = fraction * fraction * (3 - 2 * fraction)
        ease = ease[:, None] if axis == 0 else ease[None, :]
        field = np.take(field, lo, axis=axis) * (1 - ease) + np.take(field, (lo + 1) % size, axis=axis) * ease
    return field


def seamless(source, index):
    row, col = divmod(index, 2)
    width, height = source.size
    safe = (0.035, 0.965)
    box = tuple(((col + t) * width / 2, (row + t) * height / 2) for t in safe)
    tile = source.crop((*box[0], *box[1]))
    pixels = np.asarray(tile.resize((SIDE + OVERLAP,) * 2, Image.Resampling.LANCZOS), dtype=np.float32) / 255
    at = np.linspace(0, 1, OVERLAP, dtype=np.float32)
    ramp = (at * at * (3 - 2 * at))[:, None, None]
    for _ in range(2):
        joined = pixels[:SIDE].copy()
        joined[:OVERLAP] = pixels[:OVERLAP] * ramp + pixels[SIDE:] * (1 - ramp)
        pixels = joined.swapaxes(0, 1)
    return pixels


def color(source, name, rng):
    if name in SAMPLED:
        index, tone, _ = SAMPLED[name]
        sample = seamless(source, index)
        return (0.18 + 0.82 * sample / sample.mean(axis=(0, 1))) * tone

    tone, _ = FAT[name]
    # Lobules and browned spots stay in the albedo of the connective trim.
    lobules = np.tanh(noise(rng, (13, 10)))
    freckles = np.maximum(0, noise(rng, (29, 23)))
    tint = np.asarray(tone)
    if name == "raw_fat":
        return tint + lobules[..., None] * (0.047, 0.063, 0.069) - freckles[..., None] * 0.013
    return (tint + lobules[..., None] * (0.062, 0.055, 0.039) -
            freckles[..., None] * (0.045, 0.035, 0.021))


def relief(name, rng):
    fine = noise(rng, (63, 59))
    if name == "raw":
        muscle = np.tanh(noise(rng, (39, 7)) + 0.40 * noise(rng, (11, 5)))
        return 0.24 * muscle + 0.050 * fine
    if name == "cooked":
        crust = noise(rng, (19, 16))
        char_cracks = np.exp(-9 * crust * crust)
        return 0.24 * np.tanh(crust) - 0.27 * char_cracks + 0.11 * fine
    if name == "dry":
        grain = np.tanh(noise(rng, (35, 5)) + 0.60 * noise(rng, (16, 5)))
        tears = np.maximum(0, noise(rng, (27, 6))) ** 1.3
        return 0.31 * grain - 0.13 * tears + 0.065 * fine
    if name == "spoiled":
        stubble = np.maximum(0, fine)
        folds = np.tanh(noise(rng, (16, 9)))
        crust = np.clip(0.5 + 0.45 * noise(rng, (7, 8)), 0, 1)
        return 0.20 * folds + (0.055 + 0.17 * crust) * stubble
    pockets = np.tanh(noise(rng, (23, 18)))
    extent = 0.12 if name == "raw_fat" else 0.21
    return extent * pockets + 0.030 * fine


def image(values):
    return Image.fromarray(np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8))


def material(source, name, seed):
    base = color(source, name, np.random.default_rng(5207 + seed))
    rng = np.random.default_rng(27803 + seed)
    height = relief(name, rng)
    dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    normal = np.stack((-dx, dy, np.ones_like(dx) * 2.0), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)

    mean_roughness = SAMPLED[name][2] if name in SAMPLED else FAT[name][1]
    rough_field = noise(rng, (20, 17))
    roughness = mean_roughness + 0.065 * np.tanh(rough_field)
    if name == "spoiled":
        roughness += np.clip((base[:, :, 1] - base[:, :, 0]) * 1.6, -0.09, 0.10)
    cavity = np.minimum(height - height.mean(), 0)
    orm = np.stack((0.995 + 0.24 * cavity, roughness, np.zeros_like(height)), axis=-1)
    return {
        "base": image(base),
        "height": image(0.5 + 0.42 * height),
        "normal": image(0.5 + 0.5 * normal),
        "orm": image(orm).resize((SIDE // 2,) * 2, Image.Resampling.BOX),
    }


def write_maps():
    with Image.open(HERE.parent / "ref/material-source.png") as opened:
        source = opened.convert("RGB")
    with TemporaryDirectory(prefix=".food-maps-", dir=HERE) as work:
        ready = Path(work)
        for seed, name in enumerate((*SAMPLED, *FAT)):
            for role, picture in material(source, name, seed).items():
                picture.save(ready / f"{name}_{role}.png", optimize=True)
        for file in sorted(ready.iterdir()):
            file.replace(HERE / file.name)


if __name__ == "__main__":
    write_maps()
