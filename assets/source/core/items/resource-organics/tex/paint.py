"""Crop the original material study and derive the game's three maps."""

from math import cos, sin
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


HERE = Path(__file__).resolve().parent
SIDE = 512
SLOT = 160
MARGIN = 16
PAD = 8
INNER = SLOT - 2 * PAD
# In atlas order: target sRGB, relief strength, dry roughness, cavity depth.
MATERIALS = (
    ((132, 82, 58), 9.0, 0.85, 0.23),   # bark
    ((202, 155, 99), 4.0, 0.77, 0.08),  # end grain
    ((199, 164, 103), 7.0, 0.88, 0.19), # straw
    ((119, 128, 73), 8.0, 0.90, 0.17),  # bast
    ((153, 85, 61), 5.0, 0.67, 0.11),   # hide
    ((130, 124, 114), 6.5, 0.94, 0.16), # fur
    ((76, 54, 38), 6.5, 0.37, 0.19),    # chitin
    ((211, 193, 152), 4.5, 0.49, 0.09), # horn
    ((187, 199, 179), 3.5, 0.42, 0.10), # organic polymer
)


def byte(values):
    return np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8)


def blur(values, radius):
    return np.asarray(Image.fromarray(byte(values)).filter(ImageFilter.GaussianBlur(radius)), dtype=float) / 255


def short_fur(reference, rgb):
    """Lay a short guard coat over the low-frequency colors of the generated fur."""
    rng = np.random.default_rng(117)
    supersample = 3
    strokes = Image.new("L", (INNER * supersample, INNER * supersample), color=128)
    draw = ImageDraw.Draw(strokes)
    for _ in range(2300):
        x, y = rng.uniform(-6, INNER + 6, 2)
        u, v = x / INNER, y / INNER
        angle = 0.51 * sin(7 * u + 4 * v) + 0.32 * cos(9 * v) + 0.35 * (u - 0.5) + rng.normal(0, 0.26)
        length = rng.uniform(1.6, 6.8)
        curl = angle + rng.uniform(-0.7, 0.7)
        middle = (x + sin(angle) * length * 0.6, y + cos(angle) * length * 0.6)
        end = (middle[0] + sin(curl) * length * 0.4, middle[1] + cos(curl) * length * 0.4)
        points = [(round(a * supersample), round(b * supersample)) for a, b in ((x, y), middle, end)]
        draw.line(points, fill=int(rng.integers(28, 225)), width=int(rng.integers(1, 4)))

    hairs = np.asarray(strokes.resize((INNER, INNER), Image.Resampling.LANCZOS), dtype=float) / 255
    coarse = np.asarray(reference.filter(ImageFilter.GaussianBlur(6)), dtype=float) / 255
    coarse -= np.median(coarse, axis=(0, 1))
    y, x = np.mgrid[0:INNER, 0:INNER] / INNER
    saddle = np.exp(-((x - 0.46 - 0.08 * np.sin(y * 7)) / 0.28) ** 2)
    markings = 0.06 - 0.12 * saddle + 0.045 * np.sin(16 * x + np.sin(y * 13)) * np.sin(15 * y - x * 5)
    surface = np.median(rgb, axis=(0, 1)) + coarse * 0.49 + (markings + (hairs - 0.5) * 0.40)[..., None]
    relief = 0.52 + (hairs - blur(hairs, 3)) * 0.95
    return np.clip(surface, 0, 1), relief


def grain_field(rng, rows, columns):
    samples = Image.fromarray(rng.random((rows, columns), dtype=np.float32))
    return np.asarray(samples.resize((INNER, INNER), Image.Resampling.BILINEAR))


def material_height(index):
    """Draw relief from pores, fibers, and growth lines instead of color."""
    rng = np.random.default_rng(290 + index)
    y, x = np.mgrid[0:INNER, 0:INNER] / INNER
    fine = grain_field(rng, 70, 70) - 0.5
    broad = grain_field(rng, 7, 8) - 0.5
    if index == 0:
        shift = 0.026 * np.sin(9 * y) + 0.028 * broad
        cracks = np.sin(2 * np.pi * 17 * (x + shift))
        return 0.53 + 0.12 * broad + 0.035 * fine - 0.12 * np.maximum(0, cracks) ** 5
    if index == 1:
        radius = np.hypot(x - 0.47, 1.07 * (y - 0.51))
        rings = np.sin(2 * np.pi * (16 * radius + 0.37 * broad))
        return 0.51 + 0.028 * rings + 0.019 * fine
    if index in (2, 3, 7):
        # Stem ridges and horn growth run along the length of their mesh.
        threads = grain_field(rng, 12, 76) - 0.5
        strength = {2: 0.13, 3: 0.17, 7: 0.074}[index]
        return 0.5 + strength * threads + 0.022 * fine
    if index == 4:
        pores = np.minimum(0, fine + 0.16)
        return 0.53 + 0.052 * broad + 0.17 * pores
    if index == 6:
        overlap = np.sin(2 * np.pi * (7 * x + 0.22 * y * y + 0.10 * broad))
        return 0.52 + 0.035 * overlap + 0.08 * np.minimum(0, fine + 0.12)
    return 0.5 + 0.063 * broad + 0.014 * fine


def maps(tile, target, strength, roughness, cavity, index):
    source = np.asarray(tile, dtype=float) / 255
    contrast = 0.53 if index == 8 else 1.0
    rgb = np.clip((source - np.median(source, axis=(0, 1))) * contrast + np.array(target) / 255, 0, 1)
    if index == 5:
        rgb, relief = short_fur(tile, rgb)
    else:
        relief = material_height(index)
    down, right = np.gradient(relief)
    vectors = np.stack((-right * strength, down * strength, np.ones_like(right)), axis=2)
    normal = 0.5 + 0.5 * vectors / np.linalg.norm(vectors, axis=2, keepdims=True)
    crevices = np.clip((blur(relief, 5) - relief) * 5, 0, 1)
    orm = np.stack((1 - cavity * crevices, roughness + 0.12 * (crevices - 0.08), np.zeros_like(relief)), axis=2)
    return byte(rgb), byte(normal), byte(orm)


def paint():
    source = Image.open(HERE.parent / "ref" / "material-atlas.png").convert("RGB")
    names = ("base", "normal", "orm")
    images = [np.zeros((SIDE - 2 * MARGIN, SIDE - 2 * MARGIN, 3), dtype=np.uint8) for _ in names]
    for index, material in enumerate(MATERIALS):
        row, col = divmod(index, 3)
        left = round(col * source.width / 3) + 5
        top = round(row * source.height / 3) + 5
        right = round((col + 1) * source.width / 3) - 5
        bottom = round((row + 1) * source.height / 3) - 5
        tile = source.crop((left, top, right, bottom)).resize((INNER, INNER), Image.Resampling.LANCZOS)
        for atlas, layer in zip(images, maps(tile, *material, index)):
            padded = np.pad(layer, ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")
            atlas[row * SLOT:(row + 1) * SLOT, col * SLOT:(col + 1) * SLOT] = padded

    for name, atlas in zip(names, images):
        picture = Image.fromarray(np.pad(atlas, ((MARGIN, MARGIN), (MARGIN, MARGIN), (0, 0)), mode="edge"))
        if name == "orm":
            picture = picture.resize((SIDE // 2, SIDE // 2), Image.Resampling.BOX)
        target = HERE / f"organics_{name}.png"
        temporary = target.with_suffix(".tmp")
        picture.save(temporary, format="PNG", optimize=True)
        temporary.replace(target)


if __name__ == "__main__":
    paint()
