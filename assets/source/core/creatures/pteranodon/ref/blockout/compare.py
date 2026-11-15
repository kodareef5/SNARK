"""Lays the block-out renders beside the concept views and measures how well their silhouettes agree.

    python3 compare.py --concept ../concept --blockout DIR --out ../blockout_vs_concept.png

Both sets share the concept's canvases (preview.py: VIEWS, PX_PER_M), so a pixel is the same place in both. Writes the
sheet, and prints and saves (silhouettes.json, beside this script) for each view the overlap (intersection over
union), the share of each silhouette the other misses, and the farthest the block-out's outline lies from the
concept's, in centimetres, both ways.
"""

import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWS = ["top", "underside", "front", "side", "folded_side", "folded_front"]
BG = (214, 212, 206)
PX_PER_M = 400.0


def font(size):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def concept_mask(folder, view):
    return np.asarray(Image.open(os.path.join(folder, f"{view}_mask.png")).convert("L")) > 127


def blockout_mask(folder, view):
    return np.asarray(Image.open(os.path.join(folder, f"blockout_{view}.png")).convert("RGBA"))[:, :, 3] > 127


def edge(mask):
    m = Image.fromarray((mask * 255).astype(np.uint8))
    inner = np.asarray(m.filter(ImageFilter.MinFilter(3))) > 127
    return mask & ~inner


def farthest(a, b):
    """The farthest any outline pixel of `a` lies from the outline of `b`, in pixels."""
    pa, pb = np.argwhere(edge(a)), np.argwhere(edge(b))
    if len(pa) == 0 or len(pb) == 0:
        return float("nan")
    worst = 0.0
    for chunk in np.array_split(pa, max(1, len(pa) // 2000)):
        d = np.sqrt(((chunk[:, None, :] - pb[None, ::3, :]) ** 2).sum(-1)).min(1)
        worst = max(worst, float(d.max()))
    return worst


def outline(mask, colour, width=3):
    grown = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(width * 2 + 1))
    ring = (np.asarray(grown) > 127) & ~mask
    img = np.zeros(mask.shape + (4,), np.uint8)
    img[ring] = colour + (255,)
    return Image.fromarray(img)


def on_bg(path):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, BG + (255,))
    bg.alpha_composite(im)
    return bg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--concept", required=True)
    ap.add_argument("--blockout", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    label, small = font(30), font(24)
    width = 2400
    rows, stats = [], {}
    for view in VIEWS:
        cm, bm = concept_mask(a.concept, view), blockout_mask(a.blockout, view)
        inter, union = (cm & bm).sum(), (cm | bm).sum()
        stats[view] = {
            "iou": round(float(inter / union), 3),
            "concept_missed": round(float((cm & ~bm).sum() / cm.sum()), 3),
            "blockout_extra": round(float((bm & ~cm).sum() / bm.sum()), 3),
            "farthest_cm": [round(farthest(bm, cm) / PX_PER_M * 100, 1), round(farthest(cm, bm) / PX_PER_M * 100, 1)],
        }
        concept = on_bg(os.path.join(a.concept, f"{view}.png"))
        block = on_bg(os.path.join(a.blockout, f"blockout_{view}.png"))
        over = Image.blend(concept, Image.new("RGBA", concept.size, (255, 255, 255, 255)), 0.45)
        over.alpha_composite(outline(cm, (200, 40, 160)))
        over.alpha_composite(outline(bm, (20, 90, 220)))
        cells = [im.convert("RGB") for im in (concept, block, over)]
        cw = width // 3
        scale = cw / cells[0].width
        h = int(cells[0].height * scale)
        row = Image.new("RGB", (width, h + 44), BG)
        d = ImageDraw.Draw(row)
        for k, c in enumerate(cells):
            row.paste(c.resize((cw, h), Image.LANCZOS), (k * cw, 44))
        s = stats[view]
        d.text((14, 6), f"{view.replace('_', ' ')}: overlap {s['iou']:.2f}, outline within {max(s['farthest_cm']):.0f} cm", fill=(40, 40, 40), font=label)
        rows.append(row)
    foot = Image.new("RGB", (width, 40), BG)
    ImageDraw.Draw(foot).text((14, 6), "columns: concept, block-out, outlines (concept magenta, block-out blue)", fill=(60, 60, 60), font=small)
    rows.append(foot)
    sheet = Image.new("RGB", (width, sum(r.height for r in rows)), BG)
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height
    sheet.save(a.out)
    with open(os.path.join(HERE, "silhouettes.json"), "w") as fh:
        json.dump(stats, fh, indent=1)
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
