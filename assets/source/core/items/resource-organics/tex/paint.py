"""Crop the original material study and derive the game's three maps."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


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
    ((132, 127, 119), 8.0, 0.95, 0.15), # fur
    ((76, 54, 38), 6.5, 0.37, 0.19),    # chitin
    ((211, 193, 152), 4.5, 0.49, 0.09), # horn
    ((131, 169, 149), 6.0, 0.43, 0.13), # organic polymer
)


def byte(values):
    return np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8)


def blur(values, radius):
    return np.asarray(Image.fromarray(byte(values)).filter(ImageFilter.GaussianBlur(radius)), dtype=float) / 255


def maps(tile, target, strength, roughness, cavity):
    rgb = np.asarray(tile, dtype=float) / 255
    rgb = np.clip(rgb - np.median(rgb, axis=(0, 1)) + np.array(target) / 255, 0, 1)
    luminance = rgb @ np.array([0.2126, 0.7152, 0.0722])
    # A local reference level keeps broad color variation out of the relief.
    relief = blur(luminance, 0.45) - 0.79 * blur(luminance, 5)
    down, right = np.gradient(relief)
    vectors = np.stack((-right * strength, down * strength, np.ones_like(right)), axis=2)
    normal = 0.5 + 0.5 * vectors / np.linalg.norm(vectors, axis=2, keepdims=True)
    crevices = np.clip((blur(luminance, 6) - blur(luminance, 1)) * 7, 0, 1)
    orm = np.stack((1 - cavity * crevices, roughness + 0.12 * (crevices - 0.08), np.zeros_like(luminance)), axis=2)
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
        for atlas, layer in zip(images, maps(tile, *material)):
            padded = np.pad(layer, ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")
            atlas[row * SLOT:(row + 1) * SLOT, col * SLOT:(col + 1) * SLOT] = padded

    for name, atlas in zip(names, images):
        picture = Image.fromarray(np.pad(atlas, ((MARGIN, MARGIN), (MARGIN, MARGIN), (0, 0)), mode="edge"))
        if name == "orm":
            picture = picture.resize((SIDE // 2, SIDE // 2), Image.Resampling.BOX)
        picture.save(HERE / f"organics_{name}.png", optimize=True)


if __name__ == "__main__":
    paint()
