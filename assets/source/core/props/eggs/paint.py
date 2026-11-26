"""Paint a shared shell tile for the 0.22 m repeat.

    python3 -I paint.py
"""

from pathlib import Path
import site
import sys
from tempfile import TemporaryDirectory

site.addsitedir(site.getusersitepackages())
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "items"))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from swatch_maps import grain, write_maps  # noqa: E402

SIZE = 256
SEED = 4127


def dab(mask, center, length, width, angle, bend, ragged, phase, opacity):
    """Lay tapered pigment across the tile edges as it would lie on a repeat."""
    radius = int(np.ceil(1.4 * max(length, width) + abs(bend))) + 2
    x, y = center
    columns = np.arange(int(x) - radius, int(x) + radius + 1)
    rows = np.arange(int(y) - radius, int(y) + radius + 1)
    dx, dy = columns[None, :] - x, rows[:, None] - y
    cosine, sine = np.cos(angle), np.sin(angle)
    along = (cosine * dx + sine * dy) / length
    across = (-sine * dx + cosine * dy - bend * along**2) / width
    direction = np.arctan2(across, along)
    edge = 1 + ragged * (0.65 * np.sin(3 * direction + phase) + 0.35 * np.sin(7 * direction - phase))
    distance = np.hypot(along, across)
    feather = min(width, 1.1) / width
    coverage = opacity * np.clip((edge - distance) / feather + 0.5, 0, 1)
    patch = np.ix_(rows % SIZE, columns % SIZE)
    mask[patch] = np.maximum(mask[patch], coverage)


def scatter(random, count, lengths, widths, ragged, curvature, direction=None):
    mask = np.zeros((SIZE, SIZE))
    for center in random.uniform(0, SIZE, (count, 2)):
        length = random.uniform(*lengths)
        width = random.uniform(*widths)
        angle = random.uniform(-np.pi, np.pi) if direction is None else random.normal(*direction)
        bend = random.uniform(-curvature, curvature) * length
        phase = random.uniform(0, 2 * np.pi)
        opacity = random.uniform(0.67, 1.0)
        dab(mask, center, length, width, angle, bend, ragged, phase, opacity)
    return mask


def paint_regions(random):
    blotches = scatter(random, 21, (7, 18), (5, 12), 0.31, 0.13)
    freckles = scatter(random, 215, (0.8, 2.8), (0.65, 2.2), 0.14, 0.05)
    streaks = scatter(random, 35, (6, 17), (0.95, 2.05), 0.23, 0.27, (0.52, 0.68))
    dashes = scatter(random, 102, (1.4, 4.2), (0.56, 1.15), 0.15, 0.12, (-0.31, 0.44))

    # The finer marks sit over the wider ones and leave the rest of the byte for the ground.
    weights = np.zeros((SIZE, SIZE, 6), dtype=np.uint8)
    ground = np.full((SIZE, SIZE), 255, dtype=np.uint8)
    for region, marks in ((4, dashes), (2, freckles), (3, streaks), (1, blotches)):
        weights[..., region] = np.rint(ground * marks).astype(np.uint8)
        ground -= weights[..., region]
    weights[..., 0] = ground
    return weights


def save_masks(folder, name, weights):
    Image.fromarray(weights[..., :3]).save(folder / f"{name}_mask.png")
    Image.fromarray(weights[..., 3:]).save(folder / f"{name}_mask2.png")


def paint_surface(folder):
    color = np.random.default_rng(SEED)
    value = 187.5 + 1.7 * grain(color, SIZE, 11, 16) + 0.7 * grain(color, SIZE, 2.3, 3.1)
    pigment = np.repeat(value[..., None], 3, axis=-1)

    # The cuticle has fine pits and a shallow grain separate from the pigment.
    surface = np.random.default_rng(SEED + 1)
    pits = np.clip((grain(surface, SIZE, 0.76, 0.95) - 0.85) / 1.75, 0, 1)**1.7
    relief = 0.034 * grain(surface, SIZE, 2.3, 3.4) + 0.024 * grain(surface, SIZE, 13, 18) - 0.37 * pits
    roughness = 0.56 + 0.014 * grain(surface, SIZE, 6, 9) + 0.09 * pits
    write_maps(folder, "shell", pigment, relief, roughness, 0, 0.995 - 0.09 * pits)
    (folder / "shell_orm.png").rename(folder / "shell_packed.png")


def main():
    tex = HERE / "tex"
    tex.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=tex) as temporary:
        folder = Path(temporary)
        paint_surface(folder)
        weights = paint_regions(np.random.default_rng(SEED + 2))
        save_masks(folder, "shell", weights)
        weights[..., 5] = weights[..., 0]
        weights[..., 0] = 0
        save_masks(folder, "shell_band", weights)
        for picture in folder.iterdir():
            picture.replace(tex / picture.name)


if __name__ == "__main__":
    main()
