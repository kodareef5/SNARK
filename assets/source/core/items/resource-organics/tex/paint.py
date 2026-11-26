"""Prepare repeating organic surfaces from the color study and authored relief."""

from math import ceil, cos, sin, tau
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


HERE = Path(__file__).resolve().parent
# Atlas order: material, pixels, target sRGB, relief strength, roughness, cavity.
MATERIALS = (
    ("bark", 256, (132, 82, 58), 10.0, 0.85, 0.23),
    ("end_grain", 128, (202, 155, 99), 6.0, 0.77, 0.08),
    ("straw", 128, (199, 164, 103), 8.0, 0.88, 0.19),
    ("bast", 128, (119, 128, 73), 7.0, 0.90, 0.17),
    ("hide", 128, (153, 85, 61), 6.0, 0.67, 0.11),
    ("fur", 256, (130, 124, 114), 6.5, 0.94, 0.16),
    ("chitin", 128, (76, 54, 38), 6.5, 0.37, 0.19),
    ("horn", 128, (211, 193, 152), 4.5, 0.49, 0.09),
    ("wax", 128, (187, 199, 179), 3.5, 0.42, 0.10),
)


def byte(values):
    return np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8)


def blur(values, radius):
    halo = ceil(radius * 3)
    padding = ((halo, halo), (halo, halo)) + ((0, 0),) * (values.ndim - 2)
    padded = np.pad(byte(values), padding, mode="wrap")
    filtered = Image.fromarray(padded).filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(filtered, dtype=float)[halo:-halo, halo:-halo] / 255


def overlap(values, margin, axis):
    """Blend an oversized sample across its texture boundary while keeping its center sharp."""
    original = np.moveaxis(values, axis, 0)
    side = len(original) - 2 * margin
    tile = original[margin:margin + side].copy()
    t = (np.arange(2 * margin) + 0.5) / (2 * margin)
    mix = (0.5 - 0.5 * np.cos(tau / 2 * t)).reshape((-1,) + (1,) * (values.ndim - 1))
    seam = original[:2 * margin] * mix + original[side:] * (1 - mix)
    tile[-margin:] = seam[:margin]
    tile[:margin] = seam[margin:]
    return np.moveaxis(tile, 0, axis)


def color_sample(source, index, name, side):
    row, col = divmod(index, 3)
    width, height = source.width / 3, source.height / 3
    left, top = round(col * width) + 5, round(row * height) + 5
    right, bottom = round((col + 1) * width) - 5, round((row + 1) * height) - 5
    if name == "end_grain":
        # The pith sits slightly below the middle of its generated cell.
        left, right = left + 16, right - 6
        top, bottom = top + 31, bottom - 5
    margin = side // 12
    sample = source.crop((left, top, right, bottom)).resize((side + 2 * margin,) * 2, Image.Resampling.LANCZOS)
    values = np.asarray(sample, dtype=float) / 255
    return overlap(overlap(values, margin, 1), margin, 0)


def grain_field(rng, side, rows, columns):
    """Interpolate a lattice of independent height samples on a torus."""
    values = rng.random((rows, columns), dtype=np.float32)

    def weights(count):
        position = (np.arange(side) + 0.5) * count / side - 0.5
        index = np.floor(position).astype(int)
        t = position - index
        return index % count, (index + 1) % count, t * t * (3 - 2 * t)

    left, right, x = weights(columns)
    upper, lower, y = weights(rows)
    across = values[:, left] * (1 - x) + values[:, right] * x
    return across[upper] * (1 - y[:, None]) + across[lower] * y[:, None]


def short_fur(reference, target, side, rng):
    """Paint short guard hairs above distinct undercoat colors and geometric relief."""
    scale = 3
    pad = 4 * scale
    period = side * scale
    size = (period + 2 * pad,) * 2
    pigments = Image.new("L", size, color=128)
    volume = Image.new("L", size, color=0)
    color_strokes, height_strokes = ImageDraw.Draw(pigments), ImageDraw.Draw(volume)
    for _ in range(side * side // 9):
        x, y = rng.uniform(0, side, 2)
        u, v = x / side, y / side
        angle = 0.46 * sin(tau * (u + v)) + 0.30 * cos(2 * tau * v) + 0.19 * sin(tau * u) + rng.normal(0, 0.25)
        length = rng.uniform(2.0, 8.0)
        curl = angle + rng.uniform(-0.7, 0.7)
        mx, my = x + sin(angle) * length * 0.62, y + cos(angle) * length * 0.62
        end = (mx + sin(curl) * length * 0.38, my + cos(curl) * length * 0.38)
        points = [(round(a * scale + pad), round(b * scale + pad)) for a, b in ((x, y), (mx, my), end)]
        thickness = int(rng.integers(2, 5))
        color = int(rng.integers(15, 239))
        height = int(rng.integers(85, 240))
        shifts = []
        for axis in range(2):
            lo, hi = min(p[axis] for p in points), max(p[axis] for p in points)
            near = 2 * pad + thickness
            shifts.append((0, period) if lo < near else (0, -period) if hi > period - thickness else (0,))
        for dx in shifts[0]:
            for dy in shifts[1]:
                path = [(a + dx, b + dy) for a, b in points]
                color_strokes.line(path, fill=color, width=thickness)
                height_strokes.line(path, fill=height, width=thickness)

    def sample(layer):
        small = layer.resize((side + 8,) * 2, Image.Resampling.LANCZOS)
        return np.asarray(small, dtype=float)[4:-4, 4:-4] / 255

    hairs, raised = sample(pigments), sample(volume)
    coarse = blur(reference, 10) - np.median(reference, axis=(0, 1))
    y, x = np.mgrid[0:side, 0:side] / side
    saddle_axis = (x - 0.47 - 0.07 * np.sin(tau * y) + 0.5) % 1 - 0.5
    saddle = np.exp(-(saddle_axis / 0.23) ** 2)
    undercoat = grain_field(rng, side, 20, 28) - 0.5
    markings = 0.065 - 0.14 * saddle + 0.055 * undercoat
    surface = target + coarse * 0.56 + (markings + (hairs - 0.5) * 0.40)[..., None]
    relief = 0.52 + 0.08 * undercoat + (raised - blur(raised, 3)) * 0.29
    return surface, relief


def material_height(name, side, rng):
    """Draw relief from pores, fibers, and growth lines independently of color."""
    y, x = (np.mgrid[0:side, 0:side] + 0.5) / side
    fine = grain_field(rng, side, side // 2, side // 2) - 0.5
    broad = grain_field(rng, side, 7, 8) - 0.5
    if name == "bark":
        shift = 0.022 * np.sin(2 * tau * y) + 0.032 * broad
        split = np.maximum(0, np.sin(tau * 21 * (x + shift))) ** 5
        ridges = np.sin(tau * (10 * (x + shift) + 0.29 * np.sin(3 * tau * y)))
        return 0.53 + 0.11 * broad + 0.030 * fine + 0.038 * ridges - 0.13 * split
    if name == "end_grain":
        radius = np.hypot(x - 0.50, 1.05 * (y - 0.50))
        rings = np.sin(tau * (15 * radius + 0.30 * broad))
        border = np.minimum(np.minimum(x, 1 - x), np.minimum(y, 1 - y))
        fade = np.clip((border - 0.01) / 0.08, 0, 1)
        return 0.51 + 0.047 * rings * fade * fade * (3 - 2 * fade) + 0.019 * fine
    if name in ("straw", "bast", "horn"):
        # Stem ridges and horn growth follow the long axis.
        bands, depth = {"straw": (20, 0.13), "bast": (34, 0.18), "horn": (23, 0.077)}[name]
        threads = grain_field(rng, side, 10, 55) - 0.5
        bend = 0.36 * np.sin(tau * y) + 0.32 * broad
        ridges = np.maximum(0, np.sin(tau * (bands * x + bend))) ** 2
        return 0.5 + depth * (0.78 * threads + 0.21 * ridges) + 0.019 * fine
    if name == "hide":
        pores = np.minimum(0, fine + 0.16)
        return 0.53 + 0.052 * broad + 0.17 * pores
    if name == "chitin":
        overlap = np.sin(tau * (7 * x + 0.17 * np.sin(tau * y) + 0.10 * broad))
        return 0.52 + 0.035 * overlap + 0.08 * np.minimum(0, fine + 0.12)
    return 0.5 + 0.063 * broad + 0.014 * fine


def maps(source, index, name, side, target, strength, roughness, cavity):
    reference = color_sample(source, index, name, side)
    target = np.array(target) / 255
    rng = np.random.default_rng(290 + index)
    if name == "fur":
        rgb, relief = short_fur(reference, target, side, rng)
    else:
        contrast = 0.53 if name == "wax" else 1.0
        rgb = target + (reference - np.median(reference, axis=(0, 1))) * contrast
        if name in ("bark", "end_grain", "straw", "bast"):
            rgb += (reference - blur(reference, 1.2)) * 0.36
        relief = material_height(name, side, rng)

    down = (np.roll(relief, -1, 0) - np.roll(relief, 1, 0)) / 2
    right = (np.roll(relief, -1, 1) - np.roll(relief, 1, 1)) / 2
    vectors = np.stack((-right * strength, down * strength, np.ones_like(right)), axis=2)
    normal = 0.5 + 0.5 * vectors / np.linalg.norm(vectors, axis=2, keepdims=True)
    crevices = np.clip((blur(relief, 5) - relief) * 5, 0, 1)
    orm = np.stack((1 - cavity * crevices, roughness + 0.12 * (crevices - 0.08), np.zeros_like(relief)), axis=2)
    return byte(rgb), byte(normal), byte(orm)


def paint():
    source = Image.open(HERE.parent / "ref" / "material-atlas.png").convert("RGB")
    for index, material in enumerate(MATERIALS):
        name, side = material[:2]
        for role, values in zip(("base", "normal", "orm"), maps(source, index, *material)):
            picture = Image.fromarray(values)
            if role == "orm":
                picture = picture.resize((side // 2,) * 2, Image.Resampling.BOX)
            target = HERE / f"{name}_{role}.png"
            temporary = target.with_suffix(".tmp")
            picture.save(temporary, format="PNG", optimize=True)
            temporary.replace(target)


if __name__ == "__main__":
    paint()
