"""Build periodic surface relief and save it separately from pigment."""

from math import pi

import numpy as np
from PIL import Image


def grain(random, size, across, along):
    u, v = np.fft.rfftfreq(size), np.fft.fftfreq(size)
    mask = np.exp(-2 * pi**2 * ((u[None, :] * across)**2 + (v[:, None] * along)**2))
    field = np.fft.irfft2(np.fft.rfft2(random.normal(size=(size, size))) * mask, s=(size, size))
    return field / field.std()


def write_maps(folder, name, pigment, relief, roughness, metalness, occlusion=0.98):
    dx = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) / 2
    dy = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) / 2
    normal = np.stack((-1.1 * dx, 1.1 * dy, np.ones_like(relief)), axis=-1)
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    packed = np.stack(np.broadcast_arrays(occlusion, roughness, metalness, relief)[:3], axis=-1)
    pictures = {"base": pigment, "normal": 127.5 * (normal + 1), "height": 127.5 + 112 * relief, "orm": 255 * packed}
    for role, pixels in pictures.items():
        Image.fromarray(np.uint8(np.clip(np.rint(pixels), 0, 255))).save(folder / f"{name}_{role}.png")
