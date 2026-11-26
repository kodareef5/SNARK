"""Prepare the generated tack colors and separately author the surface relief."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


HERE = Path(__file__).resolve().parent
SIZE = 128
OVERLAP = 24
LEATHER_SIZE = 256
SURFACES = {
    "leather": (0, (.414, .239, .149), .57, 0),
    "canvas": (1, (.353, .451, .404), .84, 0),
    "ash": (2, (.472, .322, .178), .58, 0),
    "metal": (3, (.566, .435, .229), .49, .84),
}


def noise(rng, rows, columns, size=SIZE):
    values = rng.standard_normal((rows, columns)).astype(np.float32)
    for axis, count in enumerate((rows, columns)):
        x = np.arange(size) * count / size
        lo = x.astype(np.intp)
        f = x - lo
        f = f * f * (3 - 2 * f)
        f = f[:, None] if axis == 0 else f[None, :]
        here = np.take(values, lo, axis=axis)
        there = np.take(values, (lo + 1) % count, axis=axis)
        values = here * (1 - f) + there * f
    return values


def albedo(source, index, tone, size=SIZE):
    row, column = divmod(index, 2)
    cell_x, cell_y = (axis // 2 for axis in source.size)
    tile = source.crop(((column + .055) * cell_x, (row + .055) * cell_y,
                        (column + .94) * cell_x, (row + .94) * cell_y))
    leather = size == LEATHER_SIZE
    overlap = OVERLAP * (2 if leather else 1)
    tile = tile.resize((size + overlap,) * 2, Image.Resampling.LANCZOS)
    rgb = np.asarray(tile, dtype=np.float32) / 255
    light = np.asarray(tile.filter(ImageFilter.GaussianBlur(21 if leather else 13)), dtype=np.float32) / 255
    joined = rgb - light * (.94 if leather else .72)
    t = np.linspace(0, 1, overlap, dtype=np.float32)[:, None, None]
    t = t * t * (3 - 2 * t)
    for _ in range(2):
        reduced = joined[:size].copy()
        reduced[:overlap] = t * joined[:overlap] + (1 - t) * joined[size:]
        joined = reduced.swapaxes(0, 1)
    return np.asarray(tone) + (.36 if leather else .72) * (joined - joined.mean(axis=(0, 1)))


def relief(name, rng):
    if name == "leather":
        speckle = np.tanh(noise(rng, 121, 127, LEATHER_SIZE))
        wrinkles = np.tanh(noise(rng, 33, 24, LEATHER_SIZE))
        pores = np.minimum(0, noise(rng, 111, 123, LEATHER_SIZE)) ** 2
        return .35 * wrinkles - .20 * np.minimum(pores, 2) + .16 * speckle
    speckle = np.tanh(noise(rng, 61, 63))
    if name == "canvas":
        y, x = np.mgrid[:SIZE, :SIZE] * (2 * np.pi / SIZE)
        slack = .35 * np.tanh(noise(rng, 7, 6))
        warp, weft = np.cos(24*x + slack), np.cos(23*y + slack)
        alternating = np.cos(12*x) * np.cos(12*y)
        weave = np.maximum(warp * (.70 + .26 * alternating), weft * (.70 - .26 * alternating))
        return .58 * weave + .11 * speckle
    if name == "ash":
        veins = np.tanh(noise(rng, 4, 33) + .52 * noise(rng, 9, 50))
        return .38 * veins + .10 * speckle
    dimples = noise(rng, 14, 13)
    return .43 * np.tanh(dimples) + .075 * speckle


def save(name, kind, values):
    pixels = np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(pixels).save(HERE / f"{name}_{kind}.png")


def write_maps():
    with Image.open(HERE.parent / "ref/material-source.png") as source_file:
        source = source_file.convert("RGB")
    for name, (index, tone, finish, metalness) in SURFACES.items():
        rng = np.random.default_rng(76839 + index)
        size = LEATHER_SIZE if name == "leather" else SIZE
        surface = relief(name, rng)
        dx = (np.roll(surface, -1, axis=1) - np.roll(surface, 1, axis=1)) / 2
        dy = (np.roll(surface, -1, axis=0) - np.roll(surface, 1, axis=0)) / 2
        normals = np.stack((-dx, dy, np.ones_like(dx)), axis=-1)
        normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
        roughness = finish + .062 * np.tanh(noise(rng, 15, 17, size))
        ambient = .98 + .11 * np.minimum(0, surface)
        metal = np.full_like(surface, metalness)
        maps = {
            "base": albedo(source, index, tone, size),
            "normal": .5 + .5 * normals,
            "height": .5 + .42 * surface,
            "orm": np.stack((ambient, roughness, metal), axis=-1),
        }
        for kind, values in maps.items():
            save(name, kind, values)


if __name__ == "__main__":
    write_maps()
