"""Lays the block-out renders beside the concept views and measures how well their silhouettes agree.

    python3 compare.py --concept ../concept --blockout . --out ../blockout_vs_concept.png [--poses ../blockout_poses.png]

Both sets share one canvas (rig.py: CANVAS, PX_PER_M, GROUND_ROW), so a pixel is the same place in both.
Writes the sheet, and prints and saves (silhouettes.json) the overlap of each pair: intersection over union,
and the share of each silhouette the other misses.
"""

import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

VIEWS = ["front", "side", "back", "top"]
BG = (214, 212, 206)
CROP = (77, 90, 1177, 1190)  # the part of the 1254 canvas any view uses
CELL = 520


def font(size):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def concept_mask(folder, view):
    m = np.asarray(Image.open(os.path.join(folder, f"{view}_mask.png")).convert("L")) > 127
    return m


def blockout_mask(folder, view):
    return np.asarray(Image.open(os.path.join(folder, f"blockout_{view}.png")).convert("RGBA"))[:, :, 3] > 127


def outline(mask, colour, width=3):
    edge = Image.fromarray((mask * 255).astype(np.uint8))
    grown = edge.filter(ImageFilter.MaxFilter(width * 2 + 1))
    ring = (np.asarray(grown) > 127) & ~mask
    img = np.zeros(mask.shape + (4,), np.uint8)
    img[ring] = colour + (255,)
    return Image.fromarray(img)


def on_bg(path):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, BG + (255,))
    bg.alpha_composite(im)
    return bg


def cell(img):
    return img.crop(CROP).resize((CELL, CELL), Image.LANCZOS).convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--concept", required=True)
    ap.add_argument("--blockout", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--poses")
    a = ap.parse_args()

    label = font(26)
    small = font(20)
    head = 44
    sheet = Image.new("RGB", (CELL * 4, head + CELL * 3 + 30), BG)
    draw = ImageDraw.Draw(sheet)
    stats = {}
    for i, view in enumerate(VIEWS):
        cm = concept_mask(a.concept, view)
        bm = blockout_mask(a.blockout, view)
        inter, union = (cm & bm).sum(), (cm | bm).sum()
        stats[view] = {
            "iou": round(float(inter / union), 3),
            "concept_missed": round(float((cm & ~bm).sum() / cm.sum()), 3),
            "blockout_extra": round(float((bm & ~cm).sum() / bm.sum()), 3),
        }
        concept = on_bg(os.path.join(a.concept, f"{view}.png"))
        block = on_bg(os.path.join(a.blockout, f"blockout_{view}.png"))
        over = Image.blend(concept, Image.new("RGBA", concept.size, (255, 255, 255, 255)), 0.45)
        over.alpha_composite(outline(cm, (200, 40, 160)))
        over.alpha_composite(outline(bm, (20, 90, 220)))
        x = i * CELL
        draw.text((x + 14, 10), view, fill=(40, 40, 40), font=label)
        for row, img in enumerate((concept, block, over)):
            sheet.paste(cell(img), (x, head + row * CELL))
        draw.text((x + 14, head + 2 * CELL + 10), f"overlap {stats[view]['iou']:.2f}", fill=(40, 40, 40), font=small)
    draw.text((14, head + 3 * CELL + 4), "rows: concept, block-out, outlines (concept magenta, block-out blue)", fill=(60, 60, 60), font=small)
    sheet.save(a.out)
    with open(os.path.join(a.blockout, "silhouettes.json"), "w") as fh:
        json.dump(stats, fh, indent=1)
    print(json.dumps(stats))

    if a.poses:
        names = ["standing", "peck", "ground_peck", "startled", "lying"]
        cw = 420
        ps = Image.new("RGB", (cw * len(names), head + cw * 2), BG)
        d = ImageDraw.Draw(ps)
        for i, name in enumerate(names):
            d.text((i * cw + 12, 10), name.replace("_", " "), fill=(40, 40, 40), font=label)
            side = on_bg(os.path.join(a.blockout, f"pose_{name}_side.png")).resize((cw, cw), Image.LANCZOS)
            three = on_bg(os.path.join(a.blockout, f"pose_{name}_three.png")).resize((cw, cw), Image.LANCZOS)
            ps.paste(side.convert("RGB"), (i * cw, head))
            ps.paste(three.convert("RGB"), (i * cw, head + cw))
        ps.save(a.poses)


if __name__ == "__main__":
    main()
