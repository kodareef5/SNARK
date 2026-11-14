# The tier's four materials side by side, each tiled three by three (4.5 m square), base colour above and the base lit
# by its normal and occlusion below, so they can be judged as neighbours.
#
#   python3 ref/materials.py        writes ref/renders/materials.png

import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMES = ["thatch", "mat", "pole", "cord"]
SIDE = 640


def load(name, layer, mode="RGB"):
    return Image.open(os.path.join(HERE, "tex", name, f"{name}_{layer}.png")).convert(mode)


def tiled(img):
    w, h = img.size
    big = Image.new(img.mode, (w * 3, h * 3))
    for i in range(3):
        for j in range(3):
            big.paste(img, (i * w, j * h))
    return big.resize((SIDE, SIDE), Image.LANCZOS)


def lit(name):
    base = np.asarray(load(name, "base")).astype(np.float32) / 255
    linear = np.where(base <= 0.04045, base / 12.92, ((base + 0.055) / 1.055) ** 2.4)
    normal = np.asarray(load(name, "normal")).astype(np.float32) / 127.5 - 1
    orm = np.asarray(load(name, "orm")).astype(np.float32) / 255
    light = np.array([-0.5, 0.55, 0.67])
    light /= np.linalg.norm(light)
    shade = np.clip((normal * light).sum(-1), 0, 1) * 0.85 + 0.25 * orm[..., 0]
    out = np.clip(linear * shade[..., None], 0, 1)
    srgb = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
    return Image.fromarray((srgb * 255 + 0.5).astype(np.uint8))


sheet = Image.new("RGB", (SIDE * len(NAMES), SIDE * 2 + 28), (24, 25, 28))
draw = ImageDraw.Draw(sheet)
for k, name in enumerate(NAMES):
    sheet.paste(tiled(load(name, "base")), (k * SIDE, 28))
    sheet.paste(tiled(lit(name)), (k * SIDE, 28 + SIDE))
    draw.text((k * SIDE + 8, 8), f"{name}: 1.5 m a tile, shown 3 x 3; below, lit from the upper left", fill=(230, 230, 230))
os.makedirs(os.path.join(HERE, "ref", "renders"), exist_ok=True)
sheet.save(os.path.join(HERE, "ref", "renders", "materials.png"))
print("wrote ref/renders/materials.png")
