"""Paint the tack trim sheets with independent grain, height and finish."""

from math import pi, tau
from pathlib import Path

import numpy as np
from PIL import Image

from surfaces import ATLASES, SIZE, SPAN

DEST = Path(__file__).resolve().parent / "tex"


def grain(rng, shape, across, along):
    rows, cols = shape
    fft = np.fft.rfft2(rng.standard_normal(shape))
    u, v = np.fft.rfftfreq(cols), np.fft.fftfreq(rows)
    envelope = np.exp(-2 * pi ** 2 * ((u[None, :] * across) ** 2 + (v[:, None] * along) ** 2))
    field = np.fft.irfft2(fft * envelope, s=shape)
    return field / field.std()


def field(shape, kind, color, seed):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[:shape[0], :shape[1]] * (SPAN / SIZE)
    fine = grain(rng, shape, 0.9, 1.1)
    coarse = grain(rng, shape, 23, 32)
    dapple = grain(rng, shape, 7, 9)
    scratch = np.maximum(grain(rng, shape, 1.1, 19) - 0.8, 0) ** 1.5
    tint = 3.2 * coarse + 2.6 * dapple + 1.5 * fine
    relief = 0.08 * fine + 0.06 * dapple
    rough = 0.70 + 0.018 * grain(rng, shape, 13, 18)
    metal = 0.0
    occlusion = np.full(shape, 0.99)

    if kind == "leather":
        pits = np.maximum(0, -grain(rng, shape, 1.7, 2.1) - 0.5) ** 1.4
        folds = np.maximum(0, grain(rng, shape, 12, 3) - 1.15) ** 1.2
        polish = np.maximum(coarse - 0.15, 0)
        tint += 5.0 * polish - 2.6 * pits - 2.9 * folds - 1.5 * scratch
        relief += -0.23 * pits - 0.21 * folds - 0.04 * scratch
        rough += 0.03 * pits - 0.025 * polish
        occlusion -= 0.027 * pits
    elif kind == "weave":
        u, v = x * 144, y * 152
        dominant = (np.floor(u) + np.floor(v)) % 2 == 0
        warp = (0.5 + 0.5 * np.sin(tau * (u + 0.09 * coarse))) ** 2
        weft = (0.5 + 0.5 * np.sin(tau * (v + 0.08 * dapple))) ** 2
        textile = np.where(dominant, 0.76 * warp + 0.24 * weft, 0.76 * weft + 0.24 * warp)
        tint += 18 * (textile - 0.45) + 1.5 * fine
        relief += 0.46 * textile
        rough += 0.16 - 0.021 * textile
        occlusion -= 0.085 * (1.0 - textile)
    elif kind == "suede":
        fibers = grain(rng, shape, 1.0, 2.7)
        waxed = np.maximum(0, coarse - 0.65)
        tint += 5.5 * dapple + 4.2 * fibers - 3.1 * waxed
        relief += 0.18 * fibers
        rough += 0.17 - 0.020 * waxed
    elif kind == "cord":
        plait = 0.5 + 0.5 * np.sin(tau * (x * 71 + y * 173 + 0.18 * dapple))
        strands = plait ** 2.3
        tint += 23 * (strands - 0.4) + 3.2 * fine
        relief += 0.46 * strands
        rough += 0.10 + 0.027 * fine
        occlusion -= 0.094 * (1.0 - strands)
    elif kind == "wood":
        flow = grain(rng, shape, 7, 60)
        fibers = grain(rng, shape, 1.0, 22)
        growth = np.sin(tau * (x * 155 + 0.41 * flow))
        checks = np.maximum(0, growth - 0.55) ** 3
        tint += 7.9 * growth + 6.9 * flow + 3.5 * fibers
        relief += 0.13 * fibers - 0.19 * checks
        rough -= 0.11 - 0.036 * checks
        occlusion -= 0.06 * checks
    elif kind in ("iron", "brass"):
        polish = grain(rng, shape, 10, 39)
        indent = np.maximum(0, grain(rng, shape, 4, 6) - 0.63)
        oxidation = np.maximum(0, 0.67 * coarse + 0.33 * dapple - 0.39)
        tint += -9.4 * oxidation + 2.9 * polish + 4.1 * scratch
        relief += -0.12 * indent - 0.16 * scratch
        rough += -0.22 + 0.086 * oxidation - 0.028 * polish
        metal = 0.83 - 0.12 * oxidation
        occlusion -= 0.022 * indent
    elif kind == "chitin":
        lamellae = np.sin(tau * (x * 45 + y * 7 + 0.23 * grain(rng, shape, 14, 56)))
        ridges = np.maximum(lamellae - 0.2, 0) ** 3
        scars = grain(rng, shape, 2, 10)
        tint += 8.0 * lamellae + 3.1 * scars
        relief += 0.20 * ridges + 0.05 * scars
        rough -= 0.16 - 0.065 * ridges

    rgb = np.asarray(color, dtype=float)[None, None, :] + tint[:, :, None] * (1.0, 0.89, 0.75)
    dy, dx = np.gradient(relief)
    normal = np.stack((-dx * 1.30, dy * 1.30, np.ones(shape)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    orm = np.stack((occlusion, np.clip(rough, 0.19, 0.96), np.broadcast_to(metal, shape)), axis=-1)
    return rgb, 127.5 * (1 + normal), 255 * orm, 127 + 110 * relief


def paint(atlas, columns, finishes, seed):
    maps = [np.zeros((SIZE, SIZE, 3), dtype=np.uint8) for _ in range(3)]
    maps.append(np.zeros((SIZE, SIZE), dtype=np.uint8))
    for i, (_, kind, color) in enumerate(finishes):
        col, row = i % columns, i // columns
        x0, x1 = round(col * SIZE / columns), round((col + 1) * SIZE / columns)
        y0, y1 = SIZE // 2 * (1 - row), SIZE // 2 * (2 - row)
        for canvas, pixels in zip(maps, field((y1 - y0, x1 - x0), kind, color, seed + i)):
            canvas[y0:y1, x0:x1] = np.uint8(np.clip(np.rint(pixels), 0, 255))
    for suffix, pixels in zip(("base", "normal", "orm", "height"), maps):
        Image.fromarray(pixels).save(DEST / f"{atlas}_{suffix}.png")


if __name__ == "__main__":
    DEST.mkdir(exist_ok=True)
    for i, (atlas, (columns, finishes)) in enumerate(ATLASES.items()):
        paint(atlas, columns, finishes, 261126 + i * 100)
