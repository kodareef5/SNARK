"""Paint a teal optical coating and shallow moulded polymer grain."""

from pathlib import Path
import sys

import numpy as np

DEST = Path(__file__).resolve().parent
sys.path.insert(0, str(DEST.parents[1]))
from swatch_maps import grain, write_maps


def polymer():
    random = np.random.default_rng(241)
    broad = grain(random, 128, 8, 11)
    stipple = grain(random, 128, 1.1, 1.3)
    creases = np.maximum(grain(random, 128, 1, 6) - 1.1, 0)
    pigment = (83, 92, 106) + (3 * broad + 4 * stipple - 6 * creases)[..., None]
    relief = 0.13 * stipple - 0.11 * creases
    write_maps(DEST, "polymer", pigment, relief, 0.69 + 0.04 * broad, 0)


def optic():
    random = np.random.default_rng(243)
    coating = grain(random, 128, 15, 18)
    small = grain(random, 128, 1.0, 2.9)
    pigment = (64, 166, 169) + (5 * coating + 3.7 * small)[..., None] * (0.45, 0.9, 1)
    relief = 0.045 * small
    write_maps(DEST, "optic", pigment, relief, 0.28 + 0.013 * coating, 0)


if __name__ == "__main__":
    polymer()
    optic()
