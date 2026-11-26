"""Paint repeating swatches with separate pigment, relief and roughness."""

from math import pi, tau
from pathlib import Path

import numpy as np
from PIL import Image

from surfaces import SEAM_LINE, SWATCHES

DEST = Path(__file__).resolve().parent / "tex"


def grain(rng, shape, across, along):
    rows, cols = shape
    fft = np.fft.rfft2(rng.standard_normal(shape))
    u, v = np.fft.rfftfreq(cols), np.fft.fftfreq(rows)
    envelope = np.exp(-2 * pi ** 2 * ((u[None, :] * across) ** 2 + (v[:, None] * along) ** 2))
    field = np.fft.irfft2(fft * envelope, s=shape)
    return field / field.std()


def stitches(x, y, span, seed):
    pitch = span / 12
    along = (x + pitch / 2) % pitch - pitch / 2
    waviness = 0.0006 * np.sin(tau * (3 * x / span + seed))
    across = y - SEAM_LINE - waviness
    thread = np.exp(-((along / 0.0020) ** 2 + ((across - along * 0.28) / 0.0049) ** 4))
    holes = np.exp(-((along / 0.0025) ** 2 + ((abs(across) - 0.0053) / 0.0014) ** 2))
    channel = np.exp(-(across / 0.0043) ** 2)
    return thread, holes, channel


def field(swatch, seed):
    kind, color, size, span, sewn = swatch
    rng = np.random.default_rng(seed)
    shape = (size, size)
    row, col = np.mgrid[:size, :size]
    x, y = (col + 0.5) / size, 1 - (row + 0.5) / size

    fine = grain(rng, shape, 0.8, 1.1)
    coarse = grain(rng, shape, 16, 21)
    dapple = grain(rng, shape, 4, 6)
    scratch = np.maximum(grain(rng, shape, 0.9, 13) - 0.9, 0) ** 1.4
    tint = 1.6 * coarse + 1.5 * dapple + 1.4 * fine
    relief = 0.065 * fine + 0.05 * dapple
    rough = 0.71 + 0.025 * grain(rng, shape, 11, 15)
    metal = 0.0
    occlusion = np.full(shape, 0.99)

    if kind == "leather":
        pits = np.maximum(0, -grain(rng, shape, 1.4, 1.6) - 0.4) ** 1.4
        creases = np.maximum(0, grain(rng, shape, 9, 2) - 1.0) ** 1.2
        polish = np.maximum(coarse - 0.25, 0)
        tint += 2.3 * polish - 1.9 * pits - 2.2 * creases - 1.7 * scratch
        relief += -0.22 * pits - 0.16 * creases - 0.037 * scratch
        rough += 0.031 * pits - 0.021 * polish
        occlusion -= 0.024 * pits
    elif kind == "weave":
        u, v = x * 52, y * 56
        alternating = np.cos(pi * u) * np.cos(pi * v)
        warp = (0.5 + 0.5 * np.sin(tau * (u + 0.07 * coarse))) ** 2
        weft = (0.5 + 0.5 * np.sin(tau * (v + 0.07 * dapple))) ** 2
        textile = (0.68 + 0.24 * alternating) * warp + (0.68 - 0.24 * alternating) * weft
        tint += 9.0 * (textile - 0.46)
        relief += 0.39 * textile
        rough += 0.16 - 0.024 * textile
        occlusion -= 0.059 * (1.0 - textile)
    elif kind == "suede":
        fibers = grain(rng, shape, 0.85, 2.2)
        waxed = np.maximum(0, coarse - 0.65)
        tint += 2.8 * dapple + 2.6 * fibers - 2.2 * waxed
        relief += 0.16 * fibers
        rough += 0.17 - 0.027 * waxed
    elif kind == "wood":
        flow = grain(rng, shape, 5, 26)
        fibers = grain(rng, shape, 1.0, 18)
        growth = np.sin(tau * (x * 25 + 0.4 * flow))
        checks = np.maximum(0, growth - 0.55) ** 3
        tint += 3.4 * growth + 3.0 * flow + 2.4 * fibers
        relief += 0.13 * fibers - 0.17 * checks
        rough -= 0.11 - 0.036 * checks
        occlusion -= 0.06 * checks
    elif kind in ("iron", "brass"):
        polish = grain(rng, shape, 7, 23)
        indent = np.maximum(0, grain(rng, shape, 3, 5) - 0.5)
        oxidation = np.maximum(0, 0.67 * coarse + 0.33 * dapple - 0.42)
        tint += -5.6 * oxidation + 1.9 * polish + 3.4 * scratch
        relief += -0.12 * indent - 0.14 * scratch
        rough += -0.23 + 0.085 * oxidation - 0.028 * polish
        metal = 0.81 - 0.10 * oxidation
        occlusion -= 0.021 * indent
    elif kind == "chitin":
        lamellae = np.sin(tau * (x * 5 + y * 18 + 0.19 * grain(rng, shape, 8, 26)))
        ridges = np.maximum(lamellae - 0.22, 0) ** 3
        scars = grain(rng, shape, 2, 8)
        tint += 4.8 * lamellae + 1.9 * scars
        relief += 0.19 * ridges + 0.05 * scars
        rough -= 0.13 - 0.065 * ridges

    base = np.array(color) + tint[:, :, None] * (1.0, 0.89, 0.75)
    if sewn:
        thread, holes, channel = stitches(x * span, y * span, span, seed / 7)
        base -= (6 * channel + 6 * holes)[:, :, None]
        thread_color = np.array((183, 152, 101)) + 1.7 * fine[:, :, None]
        base += (thread_color - base) * (0.74 * thread[:, :, None])
        relief += 0.47 * thread - 0.17 * channel - 0.25 * holes
        rough += 0.12 * thread - 0.05 * holes
        occlusion -= 0.05 * holes
    relief = np.clip(relief, -1, 1)
    dx = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) / 2
    dy = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) / 2
    normal = np.stack((-1.3 * dx, 1.3 * dy, np.ones(shape)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    packed = np.stack((occlusion, rough, np.broadcast_to(metal, shape)), axis=-1)
    return {
        "base": base,
        "normal": 127.5 * (1 + normal),
        "orm": 255 * packed,
        "height": 127.5 + 112 * relief,
    }


if __name__ == "__main__":
    DEST.mkdir(exist_ok=True)
    for index, (name, swatch) in enumerate(SWATCHES.items()):
        for kind, pixels in field(swatch, 261126 + 11 * index).items():
            data = np.uint8(np.clip(np.rint(pixels), 0, 255))
            Image.fromarray(data).save(DEST / f"{name}_{kind}.png")
