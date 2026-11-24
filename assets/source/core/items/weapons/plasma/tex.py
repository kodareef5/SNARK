"""Paint the plasma guns' one material: three bands, gunmetal alloy, dark alloy and ceramic plate.

    python3 tex.py

Writes tex/tek_base.png, tek_normal.png and tek_orm.png, 512 pixels, the same on every run.
model.py lays each face in the band of its source colour (BANDS there, in this order from the top).
"""
from pathlib import Path

import numpy as np
from PIL import Image

SIDE = 512
# From the top: base colour (sRGB), roughness, metalness, how strongly the brushing shows.
BANDS = [
    ((47, 52, 61), 0.48, 0.50, 1.0),  # alloy: blued gunmetal
    ((23, 24, 28), 0.68, 0.25, 0.6),  # dark: near-black
    ((221, 224, 220), 0.36, 0.0, 0.35),  # plate: glazed ceramic
]
rng = np.random.default_rng(97)


def blurred(noise, wide, tall):
    """Noise smeared `wide` pixels along the picture and `tall` up it, wrapping across."""
    for axis, size in ((1, wide), (0, tall)):
        kernel = np.ones(size) / size
        noise = np.apply_along_axis(lambda row: np.convolve(np.concatenate((row[-size:], row, row[:size])), kernel, "same")[size:-size], axis, noise)
    return (noise - noise.mean()) / noise.std()


# Brushing runs along the gun: long fine streaks over a slow mottle.
streaks = 0.7 * blurred(rng.standard_normal((SIDE, SIDE)), 96, 1) + 0.3 * blurred(rng.standard_normal((SIDE, SIDE)), 24, 2)
mottle = blurred(rng.standard_normal((SIDE, SIDE)), 80, 40)

# Panel seams: a few fine grooves across each band, none the band's whole height.
groove = np.zeros((SIDE, SIDE))
tall = SIDE / len(BANDS)
for band in range(len(BANDS)):
    top, bottom = round(band * tall), round((band + 1) * tall)
    x = int(rng.integers(30, 90))
    while x < SIDE - 30:
        a = top + int(rng.integers(8, 70))
        groove[a:min(bottom - 8, a + int(rng.integers(40, 90))), x] = 1
        x += int(rng.integers(110, 170))

base = np.zeros((SIDE, SIDE, 3))
orm = np.zeros((SIDE, SIDE, 3))
height = np.zeros((SIDE, SIDE))
for band, (colour, rough, metal, brushing) in enumerate(BANDS):
    rows = slice(round(band * tall), round((band + 1) * tall))
    shade = 1 + brushing * (0.045 * streaks[rows] + 0.03 * mottle[rows])
    base[rows] = np.asarray(colour)[None, None, :] * shade[:, :, None]
    orm[rows, :, 1] = 255 * np.clip(rough + brushing * (0.05 * streaks[rows] - 0.03 * mottle[rows]), 0.05, 1)
    orm[rows, :, 2] = 255 * metal
    height[rows] = brushing * 0.25 * streaks[rows]
# A groove is dark and shadowed, with the lit lip of the panel beside it.
base *= (1 - 0.3 * groove)[:, :, None]
base *= (1 + 0.06 * np.roll(groove, 1, 1))[:, :, None]
orm[:, :, 0] = 255 * (1 - 0.4 * groove)
height -= 2.0 * groove

# The normal from the height, green up the picture.
dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / 2
dy = (np.roll(height, 1, 0) - np.roll(height, -1, 0)) / 2
normal = np.dstack((-dx * 0.35, -dy * 0.35, np.ones_like(dx)))
normal /= np.linalg.norm(normal, axis=2, keepdims=True)

out = Path(__file__).parent / "tex"
out.mkdir(exist_ok=True)
for name, picture in (("base", base), ("normal", normal * 127.5 + 127.5), ("orm", orm)):
    Image.fromarray(np.clip(np.rint(picture), 0, 255).astype(np.uint8), "RGB").save(out / f"tek_{name}.png", optimize=True)
