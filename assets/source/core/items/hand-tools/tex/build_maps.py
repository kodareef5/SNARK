"""Paint forged steel, wick cloth and char into repeating PBR swatches."""

from math import pi
from pathlib import Path

import numpy as np
from PIL import Image

DEST = Path(__file__).resolve().parent


def grain(random, size, across, along):
    u, v = np.fft.rfftfreq(size), np.fft.fftfreq(size)
    mask = np.exp(-2 * pi**2 * ((u[None, :] * across)**2 + (v[:, None] * along)**2))
    field = np.fft.irfft2(np.fft.rfft2(random.normal(size=(size, size))) * mask, s=(size, size))
    return field / field.std()


def swatch(name, size, seed):
    random = np.random.default_rng(seed)
    broad = grain(random, size, 8, 12)
    fine = grain(random, size, 1, 2)
    if name == "steel":
        hammers = grain(random, size, 3, 4)
        brush = grain(random, size, 0.8, 17)
        pigment = (152, 154, 157) + (4 * broad + 2.5 * brush)[..., None]
        relief = 0.066 * hammers + 0.026 * brush
        roughness = 0.43 + 0.045 * broad + 0.02 * hammers
        metal = 0.93
    elif name == "cloth":
        y, x = np.indices((size, size)) / size
        warp = 0.5 + 0.5 * np.cos(2 * pi * (24 * x + 0.09 * broad))
        weft = 0.5 + 0.5 * np.cos(2 * pi * (24 * y + 0.07 * fine))
        braid = np.cos(24 * pi * x) * np.cos(24 * pi * y)
        weave = (0.55 + 0.23 * braid) * warp + (0.55 - 0.23 * braid) * weft
        pigment = (154, 114, 73) + (3 * broad + 15 * (weave - 0.45))[..., None]
        relief = 0.26 * weave + 0.03 * fine
        roughness = 0.83 + 0.026 * broad - 0.04 * weave
        metal = 0
    else:
        fissures = np.maximum(0, -grain(random, size, 1.5, 6) - 0.55)
        pigment = (52, 43, 34) + (7 * broad + 4 * fine - 6 * fissures)[..., None]
        relief = 0.18 * broad + 0.06 * fine - 0.29 * fissures
        roughness = 0.93 + 0.016 * broad
        metal = 0
    dx = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) / 2
    dy = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) / 2
    normal = np.stack((-1.1 * dx, 1.1 * dy, np.ones_like(relief)), axis=-1)
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    packed = np.stack((np.full_like(relief, 0.98), roughness, np.full_like(relief, metal)), axis=-1)
    return {"base": pigment, "normal": 127.5 * (normal + 1), "height": 127.5 + 112 * relief, "orm": 255 * packed}


if __name__ == "__main__":
    for seed, name, size in ((173, "steel", 256), (381, "cloth", 128), (439, "char", 128)):
        for role, pixels in swatch(name, size, seed).items():
            Image.fromarray(np.uint8(np.clip(np.rint(pixels), 0, 255))).save(DEST / f"{name}_{role}.png")
