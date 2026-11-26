"""Make the food swatches from the original color study and separate relief."""

from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from steaks import COOKED_SCALE, CUTS, LIP_SCALE, SPAN, smooth_outline


SIDE = 128
OVERLAP = 24
ATLAS = 256

# Each sampled finish has a cell, mean sRGB, and roughness.
SAMPLED = {
    "raw": (0, (0.61, 0.17, 0.18), 0.42),
    "cooked": (1, (0.45, 0.235, 0.14), 0.64),
    "dry": (2, (0.43, 0.235, 0.18), 0.83),
    "spoiled": (3, (0.445, 0.39, 0.30), 0.80),
}
def noise(rng, grid, side=SIDE):
    """Interpolate periodic control points, with grid spacing set per surface."""
    field = rng.standard_normal(grid, dtype=np.float32)
    for axis, size in enumerate(grid):
        at = np.arange(side) * size / side
        lo = at.astype(np.intp)
        fraction = at - lo
        ease = fraction * fraction * (3 - 2 * fraction)
        ease = ease[:, None] if axis == 0 else ease[None, :]
        field = np.take(field, lo, axis=axis) * (1 - ease) + np.take(field, (lo + 1) % size, axis=axis) * ease
    return field


def swatch(source, index):
    row, col = divmod(index, 2)
    width, height = source.size
    safe = (0.035, 0.965)
    box = tuple(((col + t) * width / 2, (row + t) * height / 2) for t in safe)
    return source.crop((*box[0], *box[1]))


def seamless(tile):
    pixels = np.asarray(tile.resize((SIDE + OVERLAP,) * 2, Image.Resampling.LANCZOS), dtype=np.float32) / 255
    at = np.linspace(0, 1, OVERLAP, dtype=np.float32)
    ramp = (at * at * (3 - 2 * at))[:, None, None]
    for _ in range(2):
        joined = pixels[:SIDE].copy()
        joined[:OVERLAP] = pixels[:OVERLAP] * ramp + pixels[SIDE:] * (1 - ramp)
        pixels = joined.swapaxes(0, 1)
    return pixels


def relief(name, rng, side=SIDE):
    fine = noise(rng, (63, 59), side)
    if name == "raw":
        muscle = np.tanh(noise(rng, (39, 7), side) + 0.40 * noise(rng, (11, 5), side))
        return 0.24 * muscle + 0.050 * fine
    if name == "cooked":
        crust = noise(rng, (19, 16), side)
        char_cracks = np.exp(-9 * crust * crust)
        return 0.24 * np.tanh(crust) - 0.27 * char_cracks + 0.11 * fine
    if name == "dry":
        grain = np.tanh(noise(rng, (35, 5)) + 0.60 * noise(rng, (16, 5)))
        tears = np.maximum(0, noise(rng, (27, 6))) ** 1.3
        return 0.31 * grain - 0.13 * tears + 0.065 * fine
    stubble = np.maximum(0, fine)
    folds = np.tanh(noise(rng, (16, 9)))
    crust = np.clip(0.5 + 0.45 * noise(rng, (7, 8)), 0, 1)
    return 0.20 * folds + (0.055 + 0.17 * crust) * stubble


def image(values):
    return Image.fromarray(np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8))


def maps(base, height, roughness, packed_side):
    dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    normal = np.stack((-dx, dy, np.ones_like(dx) * 2.0), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)

    cavity = np.minimum(height - height.mean(), 0)
    orm = np.stack((0.995 + 0.24 * cavity, roughness, np.zeros_like(height)), axis=-1)
    return {
        "base": image(base),
        "height": image(0.5 + 0.42 * height),
        "normal": image(0.5 + 0.5 * normal),
        "orm": image(orm).resize((packed_side,) * 2, Image.Resampling.BOX),
    }


def material(source, name, seed):
    index, tone, mean_roughness = SAMPLED[name]
    sample = seamless(swatch(source, index))
    base = (0.18 + 0.82 * sample / sample.mean(axis=(0, 1))) * tone
    rng = np.random.default_rng(27803 + seed)
    height = relief(name, rng)
    roughness = mean_roughness + 0.065 * np.tanh(noise(rng, (20, 17)))
    if name == "spoiled":
        roughness += np.clip((base[:, :, 1] - base[:, :, 0]) * 1.6, -0.09, 0.10)
    return maps(base, height, roughness, SIDE // 2)


def smoothstep(value):
    t = np.clip(value, 0, 1)
    return t * t * (3 - 2 * t)


def cap_mask(outline, scale, rng):
    positions = ((np.arange(ATLAS) + 0.5) / ATLAS - 0.5) * SPAN
    x, y = np.meshgrid(positions, -positions)
    distance = np.full_like(x, np.inf)
    width = np.zeros_like(x)
    interior = np.zeros_like(x, dtype=bool)
    edge = [(a * scale * LIP_SCALE, b * scale * LIP_SCALE, w * scale)
            for a, b, _, w in smooth_outline(outline)]
    for (ax, ay, aw), (bx, by, bw) in zip(edge, edge[1:] + edge[:1]):
        vx, vy = bx - ax, by - ay
        t = np.clip(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy), 0, 1)
        step = np.square(x - ax - t * vx) + np.square(y - ay - t * vy)
        closer = step < distance
        distance = np.minimum(distance, step)
        width = np.where(closer, np.maximum(0, aw + t * (bw - aw)), width)
        if vy:
            interior ^= ((ay > y) != (by > y)) & (x < ax + (y - ay) * vx / vy)

    distance = np.sqrt(distance) * np.where(interior, -1, 1)
    fray = .0035 * np.tanh(noise(rng, (42, 47), ATLAS)) + .003 * np.tanh(noise(rng, (15, 19), ATLAS))
    inner = smoothstep((distance + .77 * width + fray) / .0055)
    outer = smoothstep((1.26 * width - distance + fray) / .011)
    return inner * outer * smoothstep((width - .0025) / .010)


def steak(source, outline, cooked, seed):
    name = "cooked" if cooked else "raw"
    index, tone, rough = SAMPLED[name]
    picture = swatch(source, index).resize((ATLAS,) * 2, Image.Resampling.LANCZOS)
    sample = np.asarray(picture, dtype=np.float32) / 255
    meat = (0.18 + 0.82 * sample / sample.mean(axis=(0, 1))) * tone
    rng = np.random.default_rng(74461 + seed)
    fat = cap_mask(outline, COOKED_SCALE if cooked else 1, rng)
    lobules = np.tanh(noise(rng, (34, 31), ATLAS))
    freckles = np.maximum(0, noise(rng, (71, 67), ATLAS))
    tint = (0.64, 0.40, 0.235) if cooked else (0.86, 0.65, 0.52)
    trim = tint + lobules[..., None] * (0.071, 0.070, 0.059)
    trim -= freckles[..., None] * (0.047 if cooked else 0.023)
    trim += (meat - tone) * (0.42 if cooked else 0.25)
    base = meat + (trim - meat) * (fat * (.88 + .10 * lobules))[..., None]

    height = relief(name, rng, ATLAS) * (1 - fat) + fat * (0.14 * lobules - 0.040 * freckles)
    height = np.asarray(Image.fromarray(height.astype(np.float32)).resize((SIDE,) * 2, Image.Resampling.BOX))
    fat_area = np.asarray(Image.fromarray(fat.astype(np.float32)).resize((SIDE,) * 2, Image.Resampling.BOX))
    roughness = rough + 0.065 * np.tanh(noise(rng, (20, 17))) - 0.032 * fat_area
    return maps(base, height, roughness, SIDE)


def write_maps():
    with Image.open(HERE.parent / "ref/material-source.png") as opened:
        source = opened.convert("RGB")
    with TemporaryDirectory(prefix=".food-maps-", dir=HERE) as work:
        ready = Path(work)
        for seed, name in enumerate(SAMPLED):
            if name in ("raw", "cooked"):
                continue
            for role, picture in material(source, name, seed).items():
                picture.save(ready / f"{name}_{role}.png", optimize=True)
        for seed, (name, (outline, _, cooked)) in enumerate(CUTS.items()):
            for role, picture in steak(source, outline, cooked, seed).items():
                picture.save(ready / f"{name}_{role}.png", optimize=True)
        for file in sorted(ready.iterdir()):
            file.replace(HERE / file.name)


if __name__ == "__main__":
    write_maps()
