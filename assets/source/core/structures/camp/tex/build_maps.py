"""Paint undyed bed linen and glowing cracks in banked embers."""

from math import tau
from pathlib import Path
import sys

import numpy as np

DEST = Path(__file__).resolve().parent
sys.path.insert(0, str(DEST.parents[2] / "items"))
from swatch_maps import grain, write_maps


def linen():
    size = 256
    random = np.random.default_rng(229)
    y, x = np.indices((size, size)) / size
    fibres = grain(random, size, 1, 5)
    mottling = grain(random, size, 13, 18)
    warp = 0.5 + 0.5 * np.sin(tau * (42 * x + 0.07 * mottling))
    weft = 0.5 + 0.5 * np.sin(tau * (48 * y + 0.05 * mottling))
    cross = np.cos(tau * 21 * x) * np.cos(tau * 24 * y)
    weave = (0.57 + 0.22 * cross) * warp + (0.57 - 0.22 * cross) * weft
    pigment = (188, 169, 135) + (3 * mottling + 12 * (weave - 0.48))[..., None]
    relief = 0.18 * weave + 0.037 * fibres
    roughness = 0.82 + 0.022 * mottling - 0.046 * weave
    write_maps(DEST, "linen", pigment, relief, roughness, 0)


def ember():
    size = 128
    random = np.random.default_rng(223)
    eddies = grain(random, size, 5, 6)
    pockets = grain(random, size, 11, 12)
    fissure = np.exp(-(eddies / 0.22)**2)
    glow = np.clip(0.22 + 0.52 * fissure + 0.21 * pockets, 0.12, 1)
    soot = np.array((74, 34, 24))
    pigment = soot + (np.array((252, 135, 34)) - soot) * glow[..., None]
    relief = 0.12 * eddies - 0.14 * fissure
    roughness = 0.88 + 0.043 * pockets
    write_maps(DEST, "ember", pigment, relief, roughness, 0)


if __name__ == "__main__":
    linen()
    ember()
