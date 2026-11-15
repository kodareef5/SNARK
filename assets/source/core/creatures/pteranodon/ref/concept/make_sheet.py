"""One page of a concept round's pictures, for showing: the character, ridden, the views and the details.

    python3 make_sheet.py DIR OUT
"""

import os
import sys

from PIL import Image

BG = (214, 212, 206)
LAYOUT = [  # rows of (file, share of the row's width)
    [("three_quarter.png", 0.55), ("saddled_three_quarter.png", 0.45)],
    [("underside.png", 0.5), ("top.png", 0.5)],
    [("side.png", 0.25), ("folded_side.png", 0.25), ("saddled_folded_side.png", 0.25), ("folded_front.png", 0.25)],
    [("head_side.png", 0.4), ("head_front.png", 0.2), ("saddle_detail.png", 0.4)],
]


def trim(im, pad=40):
    """Crops to the picture's content on the plain ground, with a margin."""
    px = im.convert("RGB")
    bg = Image.new("RGB", px.size, BG)
    from PIL import ImageChops
    box = ImageChops.difference(px, bg).convert("L").point(lambda v: 255 if v > 12 else 0).getbbox()
    if box is None:
        return px
    l, t, r, b = box
    return px.crop((max(0, l - pad), max(0, t - pad), min(px.width, r + pad), min(px.height, b + pad)))


def main():
    folder, out = sys.argv[1], sys.argv[2]
    width = 3000
    rows = []
    for row in LAYOUT:
        cells = []
        for name, share in row:
            path = os.path.join(folder, name)
            if not os.path.exists(path):
                continue
            im = trim(Image.open(path))
            w = int(width * share)
            cells.append(im.resize((w, int(im.height * w / im.width)), Image.LANCZOS))
        if not cells:
            continue
        h = max(c.height for c in cells)
        strip = Image.new("RGB", (width, h), BG)
        x = 0
        for c in cells:
            strip.paste(c, (x, (h - c.height) // 2))
            x += c.width
        rows.append(strip)
    sheet = Image.new("RGB", (width, sum(r.height for r in rows)), BG)
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height
    sheet.save(out)
    print("sheet:", out, sheet.size)


if __name__ == "__main__":
    main()
