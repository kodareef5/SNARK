"""The sheet of what is deliberately ours (DESIGN.md), from the accepted concept pictures, each with what it shows.

    python3 ours.py --concept concept --out ours.png
"""

import argparse
import os

from PIL import Image, ImageChops, ImageDraw, ImageFont

BG = (214, 212, 206)
PANELS = [
    ("head_side.png", "One sabre crest, a single blade with one charcoal band near its tip; no twin sails, no notch. "
                      "A toothless needle beak with a faint upward flick and a low keel. One orange horn cap over beak, "
                      "skull and crest, meeting the ivory face in front of the eye; a charcoal eye streak."),
    ("head_front.png", "The horn cap and the band from the front; the crest a thin blade."),
    ("underside.png", "A seabird's colouring from below: an ivory body, a slate membrane with a warm wash by the body "
                      "and charcoal tips. A wing a little narrower than a bat's, its trailing edge one curve to the ankle."),
    ("top.png", "From above: the charcoal mantle and nape line in place of zebra stripes; the darker upper face."),
    ("three_quarter.png", "A short velvet fuzz on head, neck and body; the membrane bare and finely veined."),
    ("saddle_detail.png", "Our saddle: a fitted hide seat, a bent-wood cantle faced with chitin, rope-wrapped loop grips, "
                          "a girth in front of the wing roots, crossed breast straps, pegs on plaited rope, a thin halter "
                          "and plaited reins."),
]


def font(size):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def trim(im, pad=30):
    px = im.convert("RGB")
    box = ImageChops.difference(px, Image.new("RGB", px.size, BG)).convert("L").point(lambda v: 255 if v > 12 else 0).getbbox()
    if box is None:
        return px
    l, t, r, b = box
    return px.crop((max(0, l - pad), max(0, t - pad), min(px.width, r + pad), min(px.height, b + pad)))


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for word in text.split():
        test = (line + " " + word).strip()
        if draw.textlength(test, font=fnt) > width and line:
            lines.append(line)
            line = word
        else:
            line = test
    lines.append(line)
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--concept", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    cols, cw, ph = 2, 1200, 640
    text = font(26)
    title = font(34)
    cells = []
    for name, caption in PANELS:
        path = os.path.join(a.concept, name)
        if not os.path.exists(path):
            continue
        im = trim(Image.open(path))
        s = min((cw - 40) / im.width, ph / im.height)
        im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
        probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
        lines = wrap(probe, caption, text, cw - 40)
        cell = Image.new("RGB", (cw, ph + 30 + 34 * len(lines) + 20), BG)
        cell.paste(im, ((cw - im.width) // 2, 10 + (ph - im.height) // 2))
        d = ImageDraw.Draw(cell)
        for k, line in enumerate(lines):
            d.text((20, ph + 30 + 34 * k), line, fill=(40, 40, 40), font=text)
        cells.append(cell)
    rows = [cells[i:i + cols] for i in range(0, len(cells), cols)]
    heights = [max(c.height for c in row) for row in rows]
    sheet = Image.new("RGB", (cw * cols, 70 + sum(heights)), BG)
    d = ImageDraw.Draw(sheet)
    d.text((20, 16), "Pteranodon: what is deliberately ours (ref/DESIGN.md)", fill=(30, 30, 30), font=title)
    y = 70
    for row, h in zip(rows, heights):
        for k, c in enumerate(row):
            sheet.paste(c, (k * cw, y))
        y += h
    sheet.save(a.out)
    print("ours:", a.out, sheet.size)


if __name__ == "__main__":
    main()
