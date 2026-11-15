"""A plain test picture for the cards: grey, its alpha cut into feather tips in each kind of card's rectangle, so the
model can be judged with its outline broken as it will be. Not the painter's picture: render.py cutout= takes it.

    python3 ref/renders/testcards.py OUT.png
"""
import json
import os
import sys
import numpy as np
from PIL import Image, ImageDraw

S = 1024
HERE = os.path.dirname(os.path.abspath(__file__))
# the rectangles the bakes publish for each kind of card
atlas = json.load(open(os.path.join(HERE, "..", "bakes", "bakes.json")))["material dodo_cards"]["rectangles"]
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
grey = (176, 176, 172, 255)


def box(name):
    u0, v0, u1, v1 = atlas[name]
    return u0 * S, (1 - v1) * S, u1 * S, (1 - v0) * S


# strips: solid from the root (top) down, ending in a row of rounded tips of uneven length
rng = np.random.default_rng(3)
for name, n, depth in (("hood", 26, 0.75), ("body", 22, 0.6), ("trousers", 18, 0.75), ("forehead", 3, 0.6)):
    x0, y0, x1, y1 = box(name)
    h = y1 - y0
    w = (x1 - x0) / n
    for k in range(n + 1):
        cx = x0 + (k + rng.uniform(-0.2, 0.2)) * w
        L = h * (depth * rng.uniform(0.75, 1.0))
        top = y0 + h * rng.uniform(0.0, 0.15)
        d.ellipse([cx - w * 0.75, top, cx + w * 0.75, top + L], fill=grey)
# mane: long lank feathers hanging from the top
x0, y0, x1, y1 = box("mane")
n = 7
w = (x1 - x0) / n
for k in range(n):
    cx = x0 + (k + 0.5) * w
    L = (y1 - y0) * rng.uniform(0.8, 0.98)
    d.rounded_rectangle([cx - w * 0.6, y0, cx + w * 0.6, y0 + L], radius=w * 0.55, fill=grey)
# tail and finger: one broad feather each, root at the bottom, rounded tip at the top
for name in ("tail", "finger"):
    x0, y0, x1, y1 = box(name)
    m = (x1 - x0) * 0.06
    d.rounded_rectangle([x0 + m, y0 + m, x1 - m, y1], radius=(x1 - x0) * 0.45, fill=grey)
img.save(sys.argv[1])
print("test cards written")
