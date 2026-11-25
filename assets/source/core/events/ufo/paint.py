"""Paints the UFO's pictures into tex/. Run with a Python that has NumPy and Pillow:

    python3 assets/source/core/events/ufo/paint.py

Everything is drawn here from seeded noise; nothing is copied from a picture. Each material's pictures tile (the craft
is a turned shape and lays them on by metres, shape.py), so every noise is made periodic over the picture.

- `hull`: spun gunmetal plates with a cold blue cast, brushed round the craft (the picture's width runs round it), two
  plates a picture each way, their seams, fasteners and a few access panels.
- `trim`: polished near-black alloy with a fine hexagonal grain, for the dome, the bezels and the rings.
- `glow`: the light. Light grey, dyed by colour region 0, which the client sets to the craft's glow, brightest along the
  middle of a strip.
- `burnt`: the hull's plates after the crash: soot, heat tint, scale and cracks.
"""

from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).with_name("tex")
SIDE = 1024


def periodic(h, w, scale, rng, aniso=1.0):
    """Smooth noise that tiles, about -1..1: white noise filtered in frequency. `scale` is the feature size in
    pixels across, `aniso` stretches it along the width."""
    white = rng.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    k2 = (fy * scale) ** 2 + (fx * scale * aniso) ** 2
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * np.exp(-k2 * 8.0)))
    out -= out.mean()
    return out / (np.abs(out).max() + 1e-9)


def fractal(h, w, scale, rng, octaves=4, aniso=1.0):
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for k in range(octaves):
        out += amp * periodic(h, w, scale / 2 ** k, rng, aniso)
        total += amp
        amp *= 0.5
    return out / total


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def wrap_dist(a, b, n):
    d = np.abs(a - b) % n
    return np.minimum(d, n - d)


def normal_from(height, strength):
    """A normal map from a height map that tiles: x right, y up the picture, z out."""
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
    dy = (np.roll(height, 1, 0) - np.roll(height, -1, 0)) * 0.5
    n = np.dstack([-dx * strength, -dy * strength, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n


def srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, 12.92 * linear, 1.055 * linear ** (1 / 2.4) - 0.055)


def save_rgb(name, rgb):
    Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(OUT / name, optimize=True)


def save_grey(name, grey):
    Image.fromarray((np.clip(grey, 0, 1) * 255 + 0.5).astype(np.uint8), "L").save(OUT / name, optimize=True)


def save_normal(name, n):
    save_rgb(name, n * 0.5 + 0.5)


def plates(rng, n=SIDE):
    """The plate layout every hull picture shares: two plates each way, their seams, fasteners and access panels.
    Returns the plates' ids, a seam depth, and a fastener depth, as arrays."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    # The picture's edges fall in the middle of plates, so a seam never lies along one.
    x = (x + n // 4) % n
    y = (y + n // 4) % n
    half = n // 2
    # Plates two by two; the lower pair is offset half a plate, as courses of plating are.
    row = (y >= half).astype(int)
    col = ((x + row * (n // 8)) % n >= half).astype(int)
    ids = row * 2 + col
    seam_x = np.minimum(wrap_dist(x + row * (n // 8), 0, n), wrap_dist(x + row * (n // 8), half, n))
    seam_y = np.minimum(wrap_dist(y, 0, n), wrap_dist(y, half, n))
    seam = np.minimum(seam_x, seam_y)
    groove = 1.0 - smooth(1.0, 3.2, seam)
    # A row of fasteners a little inside every seam.
    pitch = 32
    fast = np.zeros((n, n))
    for d in (seam_x, seam_y):
        along = (x if d is seam_y else y)
        on_line = np.exp(-((d - 9.0) ** 2) / 2.2)
        dots = np.exp(-(((along % pitch) - pitch / 2) ** 2) / 3.0)
        fast = np.maximum(fast, on_line * dots)
    # An access panel in two of the four plates: a thin inset rectangle.
    panel = np.zeros((n, n))
    for (cx, cy, hw, hh) in ((0.25, 0.27, 0.12, 0.07), (0.70, 0.76, 0.08, 0.10)):
        px, py = cx * n, cy * n
        inside = np.maximum(np.abs(x - px) - hw * n, np.abs(y - py) - hh * n)
        panel = np.maximum(panel, 1.0 - smooth(0.6, 2.0, np.abs(inside)))
    return ids, groove, fast, panel


def hull(rng, burnt=False):
    n = SIDE
    ids, groove, fast, panel = plates(rng, n)
    # Spun: fine streaks running round the craft, across the picture's width.
    brush = fractal(n, n, 3.0, rng, 3, aniso=40.0)
    mottle = fractal(n, n, 160.0, rng, 4)
    tone = np.array([0.0, 0.035, -0.03, 0.02])[ids]
    height = -groove * 1.0 - fast * 0.45 - panel * 0.5 + brush * 0.04
    # Gunmetal with a cold blue cast: linear colour.
    base = np.array([0.040, 0.047, 0.066])
    value = 1.0 + tone + 0.06 * mottle + 0.035 * brush
    rgb = base[None, None, :] * value[..., None]
    rgb *= (1.0 - 0.55 * groove - 0.25 * panel)[..., None]
    rough = 0.30 + 0.05 * brush + 0.04 * mottle + 0.03 * np.array([0, 1, -1, 0.5])[ids] + 0.25 * groove
    metal = np.full((n, n), 0.88) - 0.3 * groove
    occ = 1.0 - 0.45 * groove - 0.2 * fast - 0.15 * panel
    if burnt:
        soot = smooth(-0.3, 0.6, fractal(n, n, 260.0, rng, 5))
        heat = fractal(n, n, 340.0, rng, 3)
        # Heat tint: straw, bronze and blue-purple bands where the metal ran hot, then soot over most of it.
        tint = np.dstack([0.10 + 0.08 * heat, 0.065 + 0.03 * heat, 0.05 - 0.03 * heat]).clip(0.01, 0.2)
        rgb = rgb * 0.7 + tint * 0.5 * smooth(0.0, 0.8, heat)[..., None]
        rgb = rgb * (1.0 - 0.85 * soot[..., None]) + np.array([0.012, 0.011, 0.010]) * soot[..., None]
        # Cracks: thin dark lines along ridges of noise.
        ridge = np.abs(fractal(n, n, 120.0, rng, 4))
        crack = 1.0 - smooth(0.0, 0.018, ridge)
        rgb *= (1.0 - 0.8 * crack)[..., None]
        height = height - crack * 1.2 + 0.25 * fractal(n, n, 18.0, rng, 3)
        rough = np.clip(0.55 + 0.35 * soot + 0.1 * fractal(n, n, 30.0, rng, 3), 0, 1)
        metal = np.clip(0.6 - 0.45 * soot, 0, 1)
        occ = occ * (1.0 - 0.5 * crack)
    return srgb(rgb), height, np.dstack([occ, np.clip(rough, 0.05, 1), np.clip(metal, 0, 1)])


def trim(rng):
    n = SIDE
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    # A fine hexagonal grain: the distance to the nearest of a hexagonal lattice's points, which tiles at this pitch.
    pitch = n / 32
    rows = y / (n / 36)
    shift = (np.floor(rows) % 2) * 0.5
    cx = (x / pitch - shift) % 1.0 - 0.5
    cy = rows % 1.0 - 0.5
    cell = np.sqrt(cx ** 2 + (cy * np.sqrt(3) / 2) ** 2 * 1.3)
    edge = smooth(0.38, 0.46, cell)
    mottle = fractal(n, n, 200.0, rng, 4)
    streak = fractal(n, n, 4.0, rng, 3, aniso=30.0)
    height = -edge * 0.35 + 0.03 * streak
    base = np.array([0.012, 0.014, 0.019])
    rgb = base[None, None, :] * (1.0 + 0.12 * mottle - 0.12 * edge)[..., None]
    rough = 0.14 + 0.03 * mottle + 0.03 * streak + 0.08 * edge
    occ = 1.0 - 0.15 * edge
    return srgb(rgb), height, np.dstack([occ, rough, np.full((n, n), 0.95)])


def glow():
    n = 128
    v = (np.arange(n)[:, None] + 0.5) / n * np.ones((1, n))
    # Brightest along the middle of a strip, falling a little to its edges.
    value = 0.66 + 0.34 * np.sin(np.pi * v) ** 0.6
    grey = srgb(value * 0.78)
    return np.dstack([grey, grey, grey])


def main():
    OUT.mkdir(exist_ok=True)
    for name, burnt, seed in (("hull", False, 51), ("burnt", True, 52)):
        rgb, height, packed = hull(np.random.default_rng(seed), burnt)
        save_rgb(f"{name}_base.png", rgb)
        save_normal(f"{name}_normal.png", normal_from(height, 2.2 if not burnt else 2.6))
        save_rgb(f"{name}_packed.png", packed)
        save_grey(f"{name}_height.png", (height - height.min()) / (np.ptp(height) + 1e-9))
    rgb, height, packed = trim(np.random.default_rng(53))
    save_rgb("trim_base.png", rgb)
    save_normal("trim_normal.png", normal_from(height, 1.6))
    save_rgb("trim_packed.png", packed)
    save_grey("trim_height.png", (height - height.min()) / (np.ptp(height) + 1e-9))
    save_rgb("glow_base.png", glow())
    # Region 0 everywhere: the red of the first mask.
    save_rgb("glow_mask.png", np.dstack([np.ones((128, 128)), np.zeros((128, 128)), np.zeros((128, 128))]))
    save_rgb("glow_packed.png", np.dstack([np.ones((128, 128)), np.full((128, 128), 0.35), np.zeros((128, 128))]))
    print(f"paint: wrote {len(list(OUT.glob('*.png')))} pictures to {OUT}")


if __name__ == "__main__":
    main()
