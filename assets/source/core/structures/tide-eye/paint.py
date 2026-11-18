"""Tileable metre-space trim atlas. Height drives the normal; the glass strip takes the site's dye."""

from pathlib import Path
import numpy as np
from PIL import Image

out = Path(__file__).parent / "tex"
size, strip = 1024, 128
rng = np.random.default_rng(8172)
v, u = np.mgrid[:strip, :size]


def noise(n, m):
    a = rng.integers(0, 256, (n, m), dtype=np.uint8)
    # Tile at both ends so that a repeating band has no vertical boundary.
    im = Image.fromarray(np.tile(a, (3, 3))).resize(
        (size * 3, strip * 3), Image.Resampling.BICUBIC
    )
    return np.asarray(im, dtype=float)[strip : 2 * strip, size : 2 * size] / 255 - 0.5


base = np.zeros((size, size, 3))
height = np.zeros((size, size))
orm = np.zeros_like(base)
mask = np.zeros_like(base)
# Porcelain, cast bronze, dark ribs, optical glass, paving, brass register, vented underplate, pale edge band.
rows = [
    ((208, 204, 181), 0.77, 0.04),
    ((137, 99, 62), 0.48, 0.76),
    ((54, 66, 71), 0.58, 0.73),
    ((172, 185, 204), 0.16, 0.66),
    ((122, 130, 125), 0.86, 0.05),
    ((194, 156, 91), 0.37, 0.82),
    ((49, 58, 60), 0.71, 0.68),
    ((224, 216, 189), 0.55, 0.18),
]
for i, (tone, rough, metal) in enumerate(rows):
    sl = slice(i * strip, (i + 1) * strip)
    clouds = noise(8, 37)
    streaks = noise(34, 22)
    grain = rng.normal(0, 1, (strip, size))
    patina = np.maximum(0, clouds + 0.2 * streaks)
    seam = u % (256 if i != 4 else 128)
    seam = np.minimum(seam, (256 if i != 4 else 128) - seam)
    edge = np.minimum(v, strip - 1 - v)
    groove = np.maximum(np.exp(-(seam**2) / 2.8), np.exp(-(((edge - 6) / 1.35) ** 2)))
    rivet = np.hypot(((u + 32) % 64) - 32, np.minimum(abs(v - 17), abs(v - 110)))
    pits = np.clip(1 - np.abs(rivet - 3.6) / 1.7, 0, 1) if i in (1, 2, 5, 6) else 0
    h = 0.53 + 0.12 * clouds + 0.018 * grain - 0.22 * groove + 0.11 * pits
    linear = np.broadcast_to(np.array(tone, dtype=float), (strip, size, 3)).copy()
    linear += (23 * clouds + 10 * streaks + 2 * grain - 47 * groove + 13 * pits)[
        ..., None
    ]
    if i in (1, 2, 5, 6):
        linear += patina[..., None] * np.array([-31, 11, 14])
    if i == 5:
        marks = ((u % 32) < 2) & (v > 55) & (v < np.where((u % 128) < 2, 107, 78))
        linear[marks] *= 0.47
        h[marks] -= 0.09
    if i == 6:
        vents = ((u % 32) > 5) & ((u % 32) < 14) & (edge > 23)
        h[vents] -= 0.26
        linear[vents] *= 0.48
    if i == 3:
        facet = np.abs((u % 128) / 64 - 1)
        linear += (20 * facet + 26 * np.exp(-(((edge - 14) / 3) ** 2)) - 10 * clouds)[
            ..., None
        ]
        h = (
            0.5
            + 0.13 * facet
            + 0.11 * np.exp(-(((edge - 15) / 5) ** 2))
            - 0.15 * groove
        )
        # Leave the cut glass and its pale bevel visible through the dye, even in daylight.
        mask[sl, :, 0] = np.where((edge > 16) & (facet > 0.13), 255, 0)
    base[sl] = linear
    height[sl] = h
    orm[sl, :, 0] = np.clip(0.96 - 0.28 * groove - 0.20 * patina, 0, 1)
    orm[sl, :, 1] = np.clip(rough + 0.095 * clouds + 0.15 * groove, 0.06, 1)
    orm[sl, :, 2] = np.clip(metal - 0.22 * patina, 0, 1)
# The trim repeats horizontally. Match its terminal gutter and bleed the vertical atlas seam outside the usable band.
for layer in (base, height, orm, mask):
    layer[:, -1] = layer[:, 0]
    for i in range(4):
        weight = (4 - i) / 4
        layer[-1 - i] = layer[-1 - i] * (1 - weight) + layer[i] * weight
dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 1.65
dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 1.65
dx[:, -1] = dx[:, 0]
dy[:, -1] = dy[:, 0]
nz = 1 / np.sqrt(1 + dx * dx + dy * dy)


def save(name, data):
    Image.fromarray(np.clip(data, 0, 255).round().astype(np.uint8)).save(
        out / (name + ".png"), optimize=True
    )


save("base", base)
save("normal", (np.stack([-dx * nz, dy * nz, nz], axis=-1) * 0.5 + 0.5) * 255)
save("height", height * 255)
save("orm", orm * 255)
save("regions", mask)

# The red keel carries fired iron glaze. Chips reveal the same pale ceramic used by the bow.
sl = slice(3 * strip, 4 * strip)
vein = noise(10, 75) + 0.4 * noise(37, 170)
glaze = np.broadcast_to(np.array([151.0, 36.0, 28.0]), (strip, size, 3)).copy()
glaze += (48 * vein + 4 * rng.normal(0, 1, (strip, size)))[..., None]
chips = np.clip((vein + 0.15 - np.minimum(v, strip - 1 - v) / 19) * 4, 0, 1)
glaze = glaze * (1 - chips[..., None]) + np.array([207, 178, 126]) * chips[..., None]
base[sl] = glaze
orm[sl, :, 1] = np.clip(0.32 + 0.45 * chips + 0.12 * vein, 0.19, 0.87)
orm[sl, :, 2] = 0.13
base[:, -1] = base[:, 0]
orm[:, -1] = orm[:, 0]
save("sextant-base", base)
save("sextant-orm", orm * 255)

# Salt collects under the rolled edge. Exposed spots polish back to copper, with an irregular
# transition through dark oxide to turquoise. Narrow rain tracks start at each panel fastener.
verdigris = noise(7, 33) + 0.52 * noise(22, 85) + 0.25 * noise(58, 230)
wash = np.clip(0.55 + 1.25 * verdigris + 0.18 * np.cos(v / strip * np.pi), 0, 1)
polish = np.clip(0.96 - np.minimum(v, strip - 1 - v) / 13 + verdigris * 0.6, 0, 1)
fastener = np.hypot((u + 64) % 128 - 64, v - 23)
drip = np.exp(-((((u + 64) % 128 - 64) / (1.2 + 0.08 * v)) ** 2)) * np.clip(
    (v - 22) / 20, 0, 1
)
oxide = np.array([40, 66, 56]) + wash[..., None] * np.array([32, 75, 49])
metal = np.array([159, 106, 60]) + verdigris[..., None] * 22
base[sl] = (
    oxide * (1 - polish[..., None]) + metal * polish[..., None] - drip[..., None] * 18
)
base[sl] += (np.exp(-((fastener - 2.8) ** 2)) * 27)[..., None]
orm[sl, :, 0] = np.clip(0.91 - 0.14 * drip, 0, 1)
orm[sl, :, 1] = np.clip(0.58 + 0.23 * wash - 0.35 * polish, 0.19, 0.88)
orm[sl, :, 2] = np.clip(0.45 - 0.31 * wash + 0.45 * polish, 0.10, 0.93)
base[:, -1] = base[:, 0]
orm[:, -1] = orm[:, 0]
save("lantern-base", base)
save("lantern-orm", orm * 255)
