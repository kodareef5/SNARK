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
    "obsidian": (3, 0, 0.035, 0.17, 0.08),
    "ore": (0, 1, 0.02, 0.70, 0.26),
    "ingot": (1, 1, 0.075, 0.37, 0.10),
    "silica_pearls": (2, 1, 0.00, 0.28, 0.04),
    "charcoal": (3, 1, 0.05, 0.91, 0.34),
}


def image(values):
    return Image.fromarray(np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8))


def save(picture, path):
    with NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        picture.save(stream, "PNG", optimize=True)
        temporary = Path(stream.name)
    temporary.chmod(0o644)
    temporary.replace(path)


def swatch(atlas, column, row):
    width, height = atlas.size
    cell_width, cell_height = width / 4, height / 2
    x, y = (column + 0.5) * cell_width, (row + 0.5) * cell_height
    radius = (cell_width - 16) / 2
    square = atlas.crop(tuple(round(n) for n in (x - radius, y - radius, x + radius, y + radius)))
    base = np.asarray(square.resize((SIDE, SIDE), Image.Resampling.LANCZOS), dtype=float) / 255
    # Blend opposite edges through an interior strip with no change of texel scale.
    p = np.arange(SIDE)
    edge = np.minimum(p + 0.5, SIDE - p - 0.5)
    fade = (np.sin(0.5 * pi * np.minimum(edge / 16, 1)) ** 2)
    for axis, shape in ((0, (SIDE, 1, 1)), (1, (1, SIDE, 1))):
        weight = fade.reshape(shape)
        base = base * weight + np.roll(base, SIDE // 2, axis=axis) * (1 - weight)
    return base


def noise(rng, across, along):
    spectrum = np.fft.rfft2(rng.standard_normal((SIDE, SIDE)))
    ky = np.fft.fftfreq(SIDE)[:, None]
    kx = np.fft.rfftfreq(SIDE)[None, :]
    fields = spectrum * np.exp(-2 * pi ** 2 * ((kx * across) ** 2 + (ky * along) ** 2))
    values = np.fft.irfft2(fields, s=(SIDE, SIDE), axes=(0, 1))
    return values / values.std()


def grains(rng, count, radii, aspect):
    """Drop sparse oval features into the surface, wrapping them at the tile edge."""
    features = np.zeros((SIDE, SIDE))
    for _ in range(count):
        x, y = rng.random(2)
        dx, dy = (X - x + 0.5) % 1 - 0.5, (Y - y + 0.5) % 1 - 0.5
        radius = rng.uniform(*radii) / SIDE
        angle = rng.uniform(0, tau)
        a = (dx * np.cos(angle) + dy * np.sin(angle)) / radius
        b = (dy * np.cos(angle) - dx * np.sin(angle)) / (radius * aspect)
        features = np.maximum(features, np.exp(-0.5 * (a * a + b * b)) * rng.uniform(0.55, 1))
    return features


def surface(name, base, roughness):
    rng = np.random.default_rng(20261126 + list(SWATCHES).index(name))
    rough = np.full((SIDE, SIDE), roughness)
    metal = np.zeros_like(rough)
    if name == "crystal":
        striae = np.sin(tau * (15 * X + 0.15 * np.sin(tau * Y)))
        growth = np.sin(tau * (5 * Y + 0.25 * np.sin(tau * X)))
        relief = 0.16 * striae + 0.08 * growth + 0.03 * noise(rng, 3, 5)
        rough += 0.026 * striae
    elif name == "obsidian":
        arc = np.sin(tau * (8 * X + 3 * Y + 0.6 * np.sin(tau * Y)))
        fractures = np.maximum(arc, 0) ** 8
        relief = 0.11 * arc + 0.13 * fractures + 0.025 * noise(rng, 7, 2)
        rough += 0.025 * arc + 0.065 * fractures
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
    elif name == "ingot":
        pits = grains(rng, 140, (0.6, 1.75), 0.76)
        ripples = np.sin(tau * (5 * Y + 0.25 * np.sin(tau * X)))
        scuff = np.clip(noise(rng, 4.5, 1.2), -2, 2)
        relief = 0.13 * ripples + 0.04 * scuff - 0.8 * pits
        rough += 0.035 * scuff + 0.29 * pits
        metal = 0.89 - 0.32 * pits
    elif name == "silica_pearls":
        bands = np.sin(tau * (11 * Y + 0.65 * np.sin(tau * X)))
        relief = 0.075 * bands + 0.024 * noise(rng, 2.0, 4.5)
        rough += 0.02 * bands
    else:
        grain = np.sin(tau * (11 * X + 0.31 * np.sin(tau * Y)))
        splits = np.maximum(np.sin(tau * (5 * X + 0.45 * np.sin(tau * Y))), 0) ** 12
        fissures = splits * np.clip(0.55 + 0.65 * np.sin(tau * (2 * Y + X)), 0, 1)
        relief = 0.40 * grain - 0.90 * fissures + 0.18 * noise(rng, 1.0, 5.2)
        rough += 0.075 * fissures + 0.032 * grain
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
    save(orm.resize((SIDE // 2, SIDE // 2), Image.Resampling.BOX), dest / f"{name}_orm.png")


with Image.open(HERE / "ref" / "mineral-atlas.png") as source:
    atlas = source.convert("RGB")
    for name, (column, row, *surface_parameters) in SWATCHES.items():
        finish(name, swatch(atlas, column, row), *surface_parameters)
