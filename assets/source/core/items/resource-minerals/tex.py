"""Prepare the repeated mineral swatches and author relief independently of their albedo."""

from math import pi, tau
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SIDE = 128
Y, X = np.mgrid[0:SIDE, 0:SIDE] / SIDE
# Source atlas cells, brightness lift, roughness and surface occlusion strength.
SWATCHES = {
    "crystal": (2, 0, 0.00, 0.25, 0.04),
    "obsidian": (3, 0, 0.035, 0.24, 0.045),
    "ore": (0, 1, 0.02, 0.70, 0.26),
    "ingot": (1, 1, 0.075, 0.37, 0.10),
    "silica_pearls": (2, 1, 0.00, 0.28, 0.04),
    "charcoal": (3, 1, 0.05, 0.91, 0.34),
    "stone": (0, 0, 0.00, 0.84, 0.25),
}


def image(values):
    return Image.fromarray(np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8))


def save(picture, path):
    with NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        picture.save(stream, "PNG", optimize=True)
        temporary = Path(stream.name)
    temporary.chmod(0o644)
    temporary.replace(path)


def swatch(atlas, column, row, side=SIDE):
    width, height = atlas.size
    cell_width, cell_height = width / 4, height / 2
    x, y = (column + 0.5) * cell_width, (row + 0.5) * cell_height
    radius = (cell_width - 16) / 2
    square = atlas.crop(tuple(round(n) for n in (x - radius, y - radius, x + radius, y + radius)))
    base = np.asarray(square.resize((side, side), Image.Resampling.LANCZOS), dtype=float) / 255
    # Blend opposite edges through an interior strip with no change of texel scale.
    p = np.arange(side)
    edge = np.minimum(p + 0.5, side - p - 0.5)
    fade = (np.sin(0.5 * pi * np.minimum(edge / (side / 8), 1)) ** 2)
    for axis, shape in ((0, (side, 1, 1)), (1, (1, side, 1))):
        weight = fade.reshape(shape)
        base = base * weight + np.roll(base, side // 2, axis=axis) * (1 - weight)
    return base


def noise(rng, across, along, side=SIDE):
    spectrum = np.fft.rfft2(rng.standard_normal((side, side)))
    ky = np.fft.fftfreq(side)[:, None]
    kx = np.fft.rfftfreq(side)[None, :]
    fields = spectrum * np.exp(-2 * pi ** 2 * ((kx * across) ** 2 + (ky * along) ** 2))
    values = np.fft.irfft2(fields, s=(side, side), axes=(0, 1))
    return values / values.std()


def grains(rng, count, radii, aspect, side=SIDE):
    """Drop sparse oval features into the surface, wrapping them at the tile edge."""
    features = np.zeros((side, side))
    y_grid, x_grid = np.mgrid[0:side, 0:side] / side
    for _ in range(count):
        x, y = rng.random(2)
        dx, dy = (x_grid - x + 0.5) % 1 - 0.5, (y_grid - y + 0.5) % 1 - 0.5
        radius = rng.uniform(*radii) / side
        angle = rng.uniform(0, tau)
        a = (dx * np.cos(angle) + dy * np.sin(angle)) / radius
        b = (dy * np.cos(angle) - dx * np.sin(angle)) / (radius * aspect)
        features = np.maximum(features, np.exp(-0.5 * (a * a + b * b)) * rng.uniform(0.55, 1))
    return features


def cast_steel(rng, base, roughness):
    side = base.shape[0]
    y = (np.arange(side) + 0.5) / side
    # The UV cap stays in the upper patch, and the sides wrap below it.
    top = np.minimum(np.clip((y - 0.025) / 0.07, 0, 1), np.clip((0.53 - y) / 0.06, 0, 1))
    top = (top * top * (3 - 2 * top))[:, None]
    pores = grains(rng, 390, (0.65, 1.90), 0.69, side)
    mould = np.clip(noise(rng, 29, 12, side), -2.2, 2.2)
    scuffs = np.clip(noise(rng, 8.5, 1.5, side), -2.2, 2.2)
    side_color = 0.32 * base + 0.68 * base.mean(axis=(0, 1))
    side_color += (0.015 * mould + 0.009 * scuffs - 0.027 * pores)[..., None]
    colour = top[..., None] * base + (1 - top[..., None]) * side_color
    relief = (0.035 * mould + 0.055 * scuffs - (0.50 + 0.20 * top) * pores)
    rough = roughness + 0.035 * (1 - top) + 0.020 * mould + 0.22 * pores
    metal = 0.87 + 0.025 * top - 0.30 * pores
    return colour, relief, np.clip(rough, 0.1, 0.98), metal


def surface(name, base, roughness):
    rng = np.random.default_rng(20261126 + list(SWATCHES).index(name))
    if name == "ingot":
        return cast_steel(rng, base, roughness)
    rough = np.full((SIDE, SIDE), roughness)
    metal = np.zeros_like(rough)
    if name == "crystal":
        striae = np.sin(tau * (15 * X + 0.15 * np.sin(tau * Y)))
        growth = np.sin(tau * (5 * Y + 0.25 * np.sin(tau * X)))
        relief = 0.16 * striae + 0.08 * growth + 0.03 * noise(rng, 3, 5)
        rough += 0.026 * striae
    elif name == "obsidian":
        flow = np.clip(noise(rng, 11, 24), -2, 2)
        ripple = np.clip(noise(rng, 5, 10), -2, 2)
        relief = 0.063 * flow + 0.023 * ripple
        rough += 0.018 * flow + 0.009 * ripple
    elif name == "ore":
        bands = np.sin(tau * (3 * Y + X + 0.12 * np.sin(tau * X)))
        oxide = np.maximum(bands, 0) ** 8
        inclusions = grains(rng, 105, (0.85, 2.8), 0.52) * (0.55 + 0.45 * np.abs(bands))
        relief = 0.23 * noise(rng, 1.6, 3.2) + 0.35 * bands + 0.95 * inclusions - 0.25 * oxide
        base = base * (1 - 0.26 * oxide[..., None]) + np.array([0.42, 0.19, 0.11]) * 0.26 * oxide[..., None]
        exposed = np.clip((inclusions - 0.12) * 2.4, 0, 1)
        base = base * (1 - 0.62 * exposed[..., None]) + np.array([0.62, 0.64, 0.67]) * 0.62 * exposed[..., None]
        metal = 0.88 * exposed
        rough += 0.08 * oxide - 0.39 * exposed
    elif name == "silica_pearls":
        bands = np.sin(tau * (11 * Y + 0.65 * np.sin(tau * X)))
        relief = 0.075 * bands + 0.024 * noise(rng, 2.0, 4.5)
        rough += 0.02 * bands
    elif name == "charcoal":
        grain = np.sin(tau * (11 * X + 0.31 * np.sin(tau * Y)))
        splits = np.maximum(np.sin(tau * (5 * X + 0.45 * np.sin(tau * Y))), 0) ** 12
        fissures = splits * np.clip(0.55 + 0.65 * np.sin(tau * (2 * Y + X)), 0, 1)
        relief = 0.40 * grain - 0.90 * fissures + 0.18 * noise(rng, 1.0, 5.2)
        rough += 0.075 * fissures + 0.032 * grain
    else:
        pits = grains(rng, 170, (0.7, 2.15), 0.66)
        grains_in_stone = noise(rng, 1.1, 1.35)
        weathering = noise(rng, 5.5, 6.5)
        relief = 0.23 * grains_in_stone + 0.10 * weathering - 0.78 * pits
        rough += 0.025 * weathering + 0.12 * pits
    return base, relief, np.clip(rough, 0.1, 0.98), metal


def finish(name, base, lift, roughness, occlusion):
    dest = HERE / "tex"
    dest.mkdir(exist_ok=True)
    base, relief, rough, metal = surface(name, base, roughness)
    dx = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) * 0.5
    dy = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) * 0.5
    normal = np.stack((-dx, dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    cavity = np.clip(-relief * 1.2, 0, 1)
    orm = image(np.stack((1 - occlusion * cavity, rough, metal), axis=-1))
    height = (relief - relief.min()) / np.ptp(relief)

    save(image(base + lift), dest / f"{name}_base.png")
    save(image(height), dest / f"{name}_height.png")
    save(image(normal * 0.5 + 0.5), dest / f"{name}_normal.png")
    half = base.shape[0] // 2
    save(orm.resize((half, half), Image.Resampling.BOX), dest / f"{name}_orm.png")


with Image.open(HERE / "ref" / "mineral-atlas.png") as source:
    atlas = source.convert("RGB")
    for name, (column, row, *surface_parameters) in SWATCHES.items():
        side = 256 if name == "ingot" else SIDE
        finish(name, swatch(atlas, column, row, side), *surface_parameters)
