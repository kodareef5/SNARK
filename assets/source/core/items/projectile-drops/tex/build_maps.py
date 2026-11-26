"""Paint dull coated colours and a fine, matte flint surface."""

from pathlib import Path
import sys

import numpy as np

DEST = Path(__file__).resolve().parent
sys.path.insert(0, str(DEST.parents[1]))
from swatch_maps import grain, write_maps


def paint(name, colour, seed):
    random = np.random.default_rng(seed)
    broad = grain(random, 128, 10, 13)
    fine = grain(random, 128, 1, 2)
    scuffs = np.maximum(grain(random, 128, 0.9, 7) - 1.2, 0)
    pigment = colour + (3 * broad + 1.5 * fine - 5 * scuffs)[..., None]
    relief = 0.06 * fine - 0.11 * scuffs
    write_maps(DEST, name, pigment, relief, 0.63 + 0.045 * broad, 0)


def flint():
    random = np.random.default_rng(119)
    scars = grain(random, 128, 4, 8)
    furrows = np.maximum(scars - 0.25, 0)
    pores = grain(random, 128, 1, 2)
    mottles = grain(random, 128, 11, 14)
    chips = np.maximum(grain(random, 128, 0.75, 1.2) - 0.7, 0)
    pigment = (79, 77, 71) + (5.8 * mottles + 1.4 * pores + 2 * furrows + 8 * chips)[..., None]
    relief = 0.13 * scars - 0.22 * furrows + 0.04 * pores
    write_maps(DEST, "flint", pigment, relief, 0.73 + 0.049 * mottles, 0)


if __name__ == "__main__":
    paint("green", (86, 140, 92), 131)
    paint("orange", (224, 126, 66), 143)
    flint()
