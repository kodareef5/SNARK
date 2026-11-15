"""How the views read at play distances: each shrunk to the size it is drawn on a 1080-row screen with the game's 70
degree vertical field of view (client/core/app.ts: BASE_FOV), on a sky colour, then blown up without smoothing so
the pixels show.

    python3 read.py --views DIR [--prefix blockout_] --out read.png

The views are on the concept's canvases at 400 px a metre (preview.py). A picture with alpha is laid on the sky by
its alpha; one without, by its mask beside it (<view>_mask.png).
"""

import argparse
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

PX_PER_M = 400.0
PX_PER_M_AT_1M = 1080 / (2 * math.tan(math.radians(70) / 2))  # 771: pixels a metre spans at 1 m
DISTANCES = [20, 60, 150, 400]
SKY = (196, 214, 232)
GROUND = (214, 212, 206)
VIEWS = [("underside", SKY), ("side", SKY), ("front", SKY), ("folded_side", GROUND)]
CELL = 300


def font(size):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def cutout(folder, prefix, view):
    im = Image.open(os.path.join(folder, f"{prefix}{view}.png"))
    if im.mode == "RGBA" and np.asarray(im)[:, :, 3].min() < 255:
        return im.convert("RGBA")
    mask = Image.open(os.path.join(folder, f"{prefix}{view}_mask.png")).convert("L")
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def crop_to(im):
    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return im.crop(box) if box else im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", required=True)
    ap.add_argument("--prefix", default="")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    label = font(22)
    sheet = Image.new("RGB", (CELL * len(DISTANCES), 40 + CELL * len(VIEWS)), (235, 235, 232))
    d = ImageDraw.Draw(sheet)
    for k, dist in enumerate(DISTANCES):
        d.text((k * CELL + 10, 8), f"{dist} m", fill=(40, 40, 40), font=label)
    for row, (view, colour) in enumerate(VIEWS):
        path = os.path.join(a.views, f"{a.prefix}{view}.png")
        if not os.path.exists(path):
            continue
        full = crop_to(cutout(a.views, a.prefix, view))
        for k, dist in enumerate(DISTANCES):
            scale = PX_PER_M_AT_1M / dist / PX_PER_M
            w, h = max(1, round(full.width * scale)), max(1, round(full.height * scale))
            small = full.resize((w, h), Image.LANCZOS)
            pad = 6
            bg = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), colour + (255,))
            bg.alpha_composite(small, (pad, pad))
            blow = max(1, min(CELL // bg.width, (CELL - 40) // bg.height))
            big = bg.convert("RGB").resize((bg.width * blow, bg.height * blow), Image.NEAREST)
            x, y = k * CELL + (CELL - big.width) // 2, 40 + row * CELL + (CELL - big.height) // 2
            sheet.paste(big, (x, y))
            d.text((k * CELL + 10, 40 + row * CELL + 4), f"{view.replace('_', ' ')}: {w} px", fill=(60, 60, 60), font=font(16))
    sheet.save(a.out)
    print("read:", a.out)


if __name__ == "__main__":
    main()
