"""Paint machine enamel, glass and an emissive status finish."""

from pathlib import Path
import sys

import numpy as np
from PIL import Image

DEST = Path(__file__).resolve().parent
sys.path.insert(0, str(DEST.parents[2] / "items"))
from swatch_maps import grain, write_maps


def enamel():
    random = np.random.default_rng(304)
    dapple = grain(random, 256, 14, 21)
    fine = grain(random, 256, 0.9, 1.7)
    pits = np.maximum(grain(random, 256, 1.1, 2.3) - 1.45, 0)
    tint = (3 * dapple + 1.8 * fine - 8 * pits)[..., None]
    relief = 0.07 * fine - 0.22 * pits
    write_maps(DEST, "enamel", (98, 115, 105) + tint, relief, 0.56 + 0.04 * dapple + 0.08 * pits, 0)
    cream = np.uint8(np.clip(np.rint((200, 194, 172) + tint), 0, 255))
    Image.fromarray(cream).save(DEST / "cream_base.png")


def glass(name, shade, roughness, amount, seed):
    random = np.random.default_rng(seed)
    variation = grain(random, 128, 13, 19)
    fine = grain(random, 128, 0.85, 2.0)
    pigment = shade + (5 * variation + amount * fine)[..., None] * (0.60, 0.93, 1)
    write_maps(DEST, name, pigment, 0.038 * fine, roughness + 0.016 * variation, 0)


if __name__ == "__main__":
    enamel()
    glass("glass", (61, 116, 160), 0.29, 6, 311)
    glass("status", (142, 193, 224), 0.39, 5, 317)
