# Draws the guides the texture briefs point at, from the same numbers the model reads (layout.py), so a picture lands
# on the geometry. Run with python3 from this folder: it writes tex/<material>/guide/.

import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from layout import CLUSTERS, CUTS, FERN_SIZE, FRONDS, LEAVES, MASS, MOSS_SIZE, PARTS, ROOTS_SIZE, RUIN_SIZE, RUINS_SOURCE as RUINS, SPRAY_SIZE, STRIPS, frond_slot, leaf_cell  # noqa: E402

N = 2048


def out(material, name):
    d = os.path.join(HERE, "tex", material, "guide")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, name)


def fronds(material):
    info = FRONDS[material]
    img = Image.new("RGB", (N, N), (24, 24, 28))
    dr = ImageDraw.Draw(img)
    slots = []
    for k in range(info["slots"]):
        u0, _, u1, _ = frond_slot(material, k)
        x0, x1 = int(u0 * N), int(u1 * N)
        xc = (x0 + x1) / 2
        dr.rectangle([x0, 0, x1 - 1, N - 1], outline=(90, 90, 100), width=3)
        # Where leaflets may be: the slot less a margin of 12 pixels all round.
        dr.rectangle([x0 + 12, 12, x1 - 13, N - 13], fill=(40, 52, 40))
        # The midrib, foot at the bottom row, tip at the top.
        dr.line([(xc, N - 1), (xc, 12)], fill=(220, 200, 120), width=5)
        # The bare stalk before the first leaflets.
        bare = info["bare"] / info["length"] * N
        dr.rectangle([xc - 10, N - bare, xc + 10, N - 1], fill=(200, 140, 60))
        # Every half metre along the frond, a tick and its number.
        m = 0.0
        while m <= info["length"] + 1e-6:
            y = N - 1 - m / info["length"] * (N - 1)
            dr.line([(x0 + 4, y), (x0 + 40, y)], fill=(160, 160, 170), width=2)
            dr.text((x0 + 46, y - 8), f"{m:.1f} m", fill=(200, 200, 210))
            m += 0.5
        slots.append({"slot": k, "x0": x0, "x1": x1, "midrib_x": xc})
    img.save(out(material, "layout.png"))
    with open(out(material, "LAYOUT.json"), "w") as f:
        json.dump({
            "picture": N, "slots": slots, "frond_length_m": info["length"], "slot_half_width_m": info["half"],
            "bare_stalk_m": info["bare"], "pixels_per_metre_along": N / info["length"],
            "pixels_per_metre_across": (N / info["slots"]) / (2 * info["half"]),
            "foot": "bottom row", "tip": "top row", "margin_px": 12,
        }, f, indent=2)


def parts():
    img = Image.new("RGB", (N, N), (24, 24, 28))
    dr = ImageDraw.Draw(img)
    colours = {"crownshaft": (70, 140, 60), "sheath": (130, 100, 60), "cut": (200, 170, 110), "nut": (120, 140, 40), "root": (130, 80, 50), "stalk": (200, 180, 110)}
    regions = {}
    for name, (u0, v0, u1, v1) in PARTS.items():
        box = [int(u0 * N), int(v0 * N), int(u1 * N) - 1, int(v1 * N) - 1]
        dr.rectangle(box, fill=colours[name], outline=(240, 240, 240), width=3)
        dr.text((box[0] + 12, box[1] + 12), name, fill=(255, 255, 255))
        regions[name] = {"x0": box[0], "y0": box[1], "x1": box[2] + 1, "y1": box[3] + 1}
    # The cut: the disc the trunk's end is mapped to, 80% of its square.
    x0, y0, x1, y1 = (int(c * N) for c in PARTS["cut"])
    cx, cy, r = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.4
    dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(60, 40, 20), width=6)
    # The nut's three bands.
    x0, y0, x1, y1 = (int(c * N) for c in PARTS["nut"])
    for k in (1, 2):
        y = y0 + (y1 - y0) * k / 3
        dr.line([(x0, y), (x1, y)], fill=(240, 240, 240), width=2)
    img.save(out("palm_parts", "layout.png"))
    with open(out("palm_parts", "LAYOUT.json"), "w") as f:
        json.dump({"picture": N, "regions": regions}, f, indent=2)


def leaves(atlas):
    """The four cluster cells with their margins and where each twig enters, the two strips, and the crown's mass."""
    info = LEAVES[atlas]
    img = Image.new("RGB", (N, N), (24, 24, 28))
    dr = ImageDraw.Draw(img)
    cells = []
    for k in CLUSTERS:
        x0, y0, x1, y1 = (int(c * N) for c in leaf_cell(k))
        dr.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(90, 90, 100), width=3)
        dr.rectangle([x0 + 12, y0 + 12, x1 - 13, y1 - 13], fill=(40, 52, 40))
        dr.ellipse([x0 + 40, y0 + 40, x1 - 40, y1 - 40], outline=(80, 110, 70), width=3)
        dr.polygon([((x0 + x1) / 2 - 10, y1 - 1), ((x0 + x1) / 2 + 10, y1 - 1), ((x0 + x1) / 2, y1 - 40)], fill=(200, 140, 60))
        dr.text((x0 + 20, y0 + 20), f"cluster {k}: {info['cluster']} m across", fill=(220, 220, 230))
        cells.append({"cell": k, "what": "cluster", "box": [x0, y0, x1, y1], "metres_across": info["cluster"], "twig_enters": [(x0 + x1) // 2, y1]})
    strips = {
        "oak_leaves": [("Spanish moss, hangs from the top edge", MOSS_SIZE), ("fern tuft, stands on the bottom edge", FERN_SIZE)],
        "fig_leaves": [("aerial roots, dense, hang from the top edge", ROOTS_SIZE), ("aerial roots, sparse, hang from the top edge", ROOTS_SIZE)],
        "mangrove_leaves": [("spray, twig enters bottom middle", SPRAY_SIZE), ("spray, twig enters bottom middle", SPRAY_SIZE)],
    }[atlas]
    for (label, size), rect in zip(strips, STRIPS):
        x0, y0, x1, y1 = (int(c * N) for c in rect)
        dr.rectangle([x0 + 12, y0 + 12, x1 - 13, y1 - 13], fill=(52, 48, 40), outline=(160, 150, 120), width=2)
        dr.text((x0 + 20, y0 + 20), label, fill=(220, 220, 230))
        dr.text((x0 + 20, y0 + 40), f"{size[0]} m wide, {size[1]} m tall", fill=(220, 220, 230))
        cells.append({"what": label, "box": [x0, y0, x1, y1], "metres_across": size[0], "metres_down": size[1]})
    x0, y0, x1, y1 = (int(c * N) for c in MASS)
    dr.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(34, 46, 34), outline=(120, 150, 110), width=3)
    dr.text((x0 + 20, y0 + 20), f"the crown's mass: {info['mass']} m across, {info['mass'] / 2} m down, no sky, no margin", fill=(220, 220, 230))
    cells.append({"what": "mass", "box": [x0, y0, x1, y1], "metres_across": info["mass"], "metres_down": info["mass"] / 2})
    img.save(out(atlas, "layout.png"))
    with open(out(atlas, "LAYOUT.json"), "w") as f:
        json.dump({"picture": N, "cells": cells, "margin_px": 12}, f, indent=2)


def cuts():
    """Each quarter's disc, 80% of its width, where a stump's cut is laid."""
    img = Image.new("RGB", (N, N), (24, 24, 28))
    dr = ImageDraw.Draw(img)
    for name, rect in CUTS.items():
        x0, y0, x1, y1 = (int(c * N) for c in rect)
        dr.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(60, 50, 40), outline=(160, 160, 170), width=3)
        cx, cy, r = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.4
        dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(190, 160, 110), outline=(40, 30, 20), width=6)
        dr.text((x0 + 16, y0 + 16), name, fill=(240, 240, 240))
    img.save(out("stump_cuts", "layout.png"))
    with open(out("stump_cuts", "LAYOUT.json"), "w") as f:
        json.dump({"picture": N, "discs": {k: {"box": [int(c * N) for c in v], "disc_diameter_share": 0.8} for k, v in CUTS.items()}}, f, indent=2)


def ruins():
    """The regions of the swallowed things, with where a column's capital and a car's windows and wheels fall."""
    img = Image.new("RGB", (N, N), (24, 24, 28))
    dr = ImageDraw.Draw(img)
    regions = {}
    for name, rect in RUINS.items():
        x0, y0, x1, y1 = (int(c * N) for c in rect)
        dr.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(70, 66, 60), outline=(200, 200, 210), width=3)
        w, h = RUIN_SIZE[name]
        dr.text((x0 + 10, y0 + 10), f"{name}: {w} m across, {h} m down", fill=(240, 240, 240))
        regions[name] = {"box": [x0, y0, x1, y1], "metres_across": w, "metres_down": h}
    x0, y0, x1, y1 = (int(c * N) for c in RUINS["column"])
    dr.rectangle([x0, y0, x1 - 1, y0 + int((y1 - y0) * 0.6 / 4.5)], outline=(220, 180, 120), width=4)
    dr.text((x0 + 10, y0 + 40), "capital", fill=(220, 180, 120))
    x0, y0, x1, y1 = (int(c * N) for c in RUINS["sign"])
    dr.line([((x0 + x1) / 2, y0), ((x0 + x1) / 2, y1)], fill=(220, 180, 120), width=3)
    dr.text((x0 + 10, y0 + 40), "front", fill=(220, 180, 120))
    dr.text(((x0 + x1) / 2 + 10, y0 + 40), "back", fill=(220, 180, 120))
    x0, y0, x1, y1 = (int(c * N) for c in RUINS["car"])
    W, H = x1 - x0, y1 - y0
    for a, b in ((0.33, 0.45), (0.55, 0.67)):
        dr.rectangle([x0 + a * W, y0 + 0.28 * H, x0 + b * W, y0 + 0.78 * H], outline=(120, 170, 220), width=3)
    for a in (0.08, 0.86):
        for v in (0.22, 0.76):
            dr.ellipse([x0 + a * W, y0 + (v - 0.08) * H, x0 + (a + 0.06) * W, y0 + (v + 0.08) * H], outline=(220, 120, 120), width=3)
    dr.text((x0 + 10, y0 + 40), "u: underside, right side, roof, left side; v: front to back. Blue: windows. Red: wheels", fill=(240, 240, 240))
    img.save(out("ruins", "layout.png"))
    with open(out("ruins", "LAYOUT.json"), "w") as f:
        json.dump({"picture": N, "regions": regions}, f, indent=2)


if __name__ == "__main__":
    # `python3 guides.py oak_leaves` draws only that one.
    only = sys.argv[1:]
    if not only:
        ruins()
        cuts()
        for material in FRONDS:
            fronds(material)
        parts()
    for atlas in LEAVES:
        if not only or atlas in only:
            leaves(atlas)
    print("guides written")
