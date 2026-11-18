"""Source atlas and two progressive wear layers. Run python3 -B tex/paint.py from anywhere."""

import math
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from finish import SURFACES, TILES

rng = np.random.default_rng(417)
ink = (31, 43, 50)
white = (226, 228, 220)
gold = (202, 156, 84)
base = Image.new("RGB", (1024, 1024), ink)
surface = Image.new("RGB", base.size, (255, 135, 0))
regions = Image.new("RGB", base.size)
height = Image.new("L", base.size, 128)
hurt = Image.new("RGBA", base.size)
decay = Image.new("RGBA", base.size)


def typeface(size):
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def centered(d, xy, text, size, color):
    d.text(xy, text, font=typeface(size), fill=color, anchor="mm")


def emblem(d, x, y, w):
    # The county patch has a chevron outline, two mountain peaks, a river and one star.
    def outline(points, fill):
        d.polygon([(x + (a - 0.5) * w, y + (b - 0.5) * w) for a, b in points], fill=fill)

    outline(
        [
            (0, 0.15),
            (0.19, 0.14),
            (0.5, 0),
            (0.81, 0.14),
            (1, 0.15),
            (0.90, 0.69),
            (0.70, 0.91),
            (0.5, 1),
            (0.30, 0.91),
            (0.10, 0.69),
        ],
        gold,
    )
    outline(
        [
            (0.07, 0.21),
            (0.23, 0.19),
            (0.5, 0.075),
            (0.77, 0.19),
            (0.93, 0.21),
            (0.84, 0.64),
            (0.67, 0.84),
            (0.5, 0.94),
            (0.33, 0.84),
            (0.16, 0.64),
        ],
        ink,
    )
    outline([(0.14, 0.57), (0.38, 0.29), (0.48, 0.42), (0.62, 0.24), (0.87, 0.57)], (217, 226, 215))
    outline(
        [(0.45, 0.43), (0.62, 0.24), (0.84, 0.54), (0.66, 0.44), (0.61, 0.38), (0.57, 0.46), (0.52, 0.42)], (111, 145, 147)
    )
    outline(
        [(0.23, 0.65), (0.72, 0.61), (0.52, 0.73), (0.67, 0.75), (0.50, 0.85), (0.37, 0.80), (0.48, 0.75), (0.32, 0.72)],
        gold,
    )


def door(tile, front):
    d = ImageDraw.Draw(tile)
    d.rectangle((0, 190, 512, 256), fill=ink)
    d.rectangle((0, 185, 512, 189), fill=(240, 238, 217))
    if front:
        emblem(d, 98, 118, 87)
        centered(d, (300, 104), "POLICE", 74, ink)
        centered(d, (299, 152), "ALDER  COUNTY", 23, ink)
    else:
        # Contour lines cross the rear door below the small district name.
        for x, y in [(20, 3), (53, 7), (88, 12), (116, 15)]:
            points = [
                (-36 + x, 182),
                (30 + x, 160 + y),
                (66 + x, 162 + y),
                (112 + x, 131 + y),
                (133 + x, 142 + y),
                (157 + x, 129 + y),
                (228 + x, 183),
            ]
            d.line(points, fill=(169, 178, 171), width=3, joint="curve")
        centered(d, (366, 95), "TRAIL", 45, ink)
        centered(d, (366, 132), "PATROL", 31, ink)


def graphics(name, tile):
    d = ImageDraw.Draw(tile)
    w, h = tile.size
    if name in ("frontdoor", "backdoor"):
        door(tile, name == "frontdoor")
    elif name == "quarter":
        centered(d, (128, 49), "U–17", 62, white)
        centered(d, (128, 97), "FIELD  SERVICES", 19, gold)
    elif name == "roofid":
        centered(d, (128, 125), "U17", 91, white)
    elif name == "plate":
        d.rounded_rectangle((9, 9, w - 10, h - 9), radius=9, outline=ink, width=3)
        d.rectangle((12, 11, w - 13, 35), fill=ink)
        centered(d, (128, 23), "ALDER   COUNTY", 17, white)
        centered(d, (128, 75), "AC • 017", 51, ink)
    elif name == "cluster":
        for cx in (64, 192):
            d.ellipse((cx - 48, 14, cx + 48, 110), fill=(20, 28, 28), outline=(112, 126, 122), width=4)
            for j in range(22):
                a = math.radians(132 + 12 * j)
                d.line([(cx + r * math.cos(a), 63 + r * math.sin(a)) for r in (36, 43)], fill=white, width=2)
            d.line((cx, 63, cx - 21, 35), fill=(223, 116, 65), width=3)
    elif name == "radio":
        d.rounded_rectangle((17, 15, 156, 83), 7, fill=(23, 53, 55), outline=(120, 128, 119), width=3)
        centered(d, (84, 38), "PATROL  2", 20, (174, 214, 192))
        centered(d, (84, 64), "DISPATCH", 15, (174, 214, 192))
        for x in range(175, 243, 24):
            for y in range(19, 101, 23):
                d.rectangle((x, y, x + 15, y + 11), fill=(91, 99, 95))


for i, (name, (x, y, w, h)) in enumerate(TILES.items()):
    fallback = (
        "ivory" if name in ("frontdoor", "backdoor", "plate") else "roof" if name in ("quarter", "roofid") else "vinyl"
    )
    color, rough, metal = SURFACES.get(name, SURFACES[fallback])
    yy, xx = np.indices((h, w))
    noise = rng.normal(0, 1.5, (h, w))
    if name in ("rubber", "tread", "roof", "canvas", "vinyl", "mat", "carpet"):
        noise += rng.normal(0, 2, (h, w)) + ((xx + yy) % 4 == 0) * 3
    if name in ("blue", "red", "lamp", "projector", "amber", "tail"):
        noise += 12 * np.sin(xx * 0.38) + 8 * np.cos(yy * 0.48) + 7 * np.sin((xx + yy) * 0.14)
    if name in ("glass", "mirror"):
        noise += 24 * np.exp(-(((yy * 0.012 + xx * 0.002 - 0.52) / 0.22) ** 2)) - yy * 0.06
    if name == "rotor":
        noise += 8 * np.sin(np.hypot(xx - w / 2, yy - h / 2) * 0.96)
    tile = Image.fromarray(np.uint8(np.clip(np.array(color)[None, None, :] + noise[:, :, None], 0, 255)))
    # Surface relief is independent of paint pigment. The low frequencies survive the packed 512 map.
    relief = np.zeros_like(noise)
    if name == "canvas":
        seam = np.minimum(abs(xx - w * 0.18), abs(xx - w * 0.82))
        relief = 3 * np.cos(xx * 1.5) * np.cos(yy * 0.81) - 10 * np.exp(-((seam / 1.8) ** 2))
        tile = Image.fromarray(np.uint8(np.clip(np.asarray(tile).astype(float) + (relief * 0.75)[:, :, None], 0, 255)))
    elif name in ("rubber", "tread", "carpet", "vinyl", "roof", "mat"):
        relief = 1.1 * noise + 1.7 * np.cos((xx + yy) * 0.41)
    elif name in ("red", "blue", "tail", "amber", "lamp", "projector"):
        relief = 3 * np.sin(xx * 0.38) + 3 * np.cos(yy * 0.48)
    elif name in ("grille", "rotor", "hub", "alloy"):
        relief = 0.35 * noise
    height.paste(Image.fromarray(np.uint8(np.clip(128 + relief, 0, 255))), (x, y))
    graphics(name, tile)
    if name in ("frontdoor", "backdoor"):
        regions.paste((255, 0, 0), (x, y + 185, x + w, y + 190))
    base.paste(tile, (x, y))
    surface.paste((252, rough, metal), (x, y, x + w, y + h))
    if name in ("stripe", "alloy", "canvas"):
        regions.paste({"stripe": (255, 0, 0), "alloy": (0, 0, 255), "canvas": (0, 255, 0)}[name], (x, y, x + w, y + h))
    dh, dd = Image.new("RGBA", (w, h)), Image.new("RGBA", (w, h))
    hd, de = ImageDraw.Draw(dh), ImageDraw.Draw(dd)
    lens = name in ("red", "blue", "tail", "glass", "mirror", "lamp", "projector", "amber", "drl")
    cloth = name in ("canvas", "carpet", "topliner", "mat", "vinyl", "rubber", "tread")
    # Scratch lengths and edge corrosion are in the local scale of each printed panel.
    for k in range(12 if lens else 22):
        sx, sy = rng.integers(w * 0.06, w * 0.94), rng.integers(h * 0.06, h * 0.94)
        dx, dy = rng.integers(4, max(8, w // 5)), rng.integers(-h // 14, h // 8)
        alpha = int(rng.integers(44, 254))
        pts = [(sx, sy), (sx + dx * 0.41, sy + dy * 0.3 - 2), (sx + dx * 0.7, sy + dy * 0.92), (sx + dx, sy + dy)]
        hd.line(pts, fill=(*((41, 45, 45) if not cloth else (56, 51, 44)), alpha), width=3)
        hd.line([(a, b - 1) for a, b in pts], fill=(*((181, 193, 194) if lens else (161, 148, 131)), alpha), width=1)
    if lens:
        for a in np.linspace(0, 2 * math.pi, 7, endpoint=False):
            hd.line(
                [
                    (w * 0.37, h * 0.58),
                    (w * (0.37 + 0.12 * math.cos(a)), h * (0.58 + 0.14 * math.sin(a))),
                    (w * (0.37 + 0.24 * math.cos(a + 0.08)), h * (0.58 + 0.26 * math.sin(a + 0.08))),
                ],
                fill=(184, 190, 184, 175),
                width=2,
            )
    for k in range(w * h // 29):
        px, py = int(rng.uniform(0, w)), int(rng.uniform(0, h))
        edge = min(px, w - px, py, h - py) / min(w, h)
        if rng.random() > 0.10 + 0.73 * math.exp(-max(0, edge - 0.015) * 18) + 0.23 * (py / h) ** 5:
            continue
        rad = int(rng.integers(1, 5))
        dirty = (98, 86, 65) if lens or cloth else (115, 86, 60)
        de.ellipse((px - rad, py - rad, px + rad, py + rad), fill=(*dirty, int(rng.integers(25, 254))))
    hurt.paste(dh, (x, y))
    weather = np.array(dd)
    weather[np.array(dh)[:, :, 3] != 0] = 0
    decay.paste(Image.fromarray(weather), (x, y))
# Derive the normals from the stored height, with positive green pointing up the picture.
h = np.asarray(height).astype(float)
nx = (np.roll(h, 1, axis=1) - np.roll(h, -1, axis=1)) * 0.041
ny = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.041
vectors = np.dstack([nx, ny, np.ones_like(h)])
vectors /= np.linalg.norm(vectors, axis=2, keepdims=True)
normal = Image.fromarray(np.uint8(np.clip(127.5 * (1 + vectors) + 0.5, 0, 255)))
for name, im in [
    ("height", height),
    ("normal", normal),
    ("patrol", base),
    ("surface", surface),
    ("regions", regions),
    ("hurt", hurt),
    ("decay", decay),
]:
    im.save(HERE / (name + ".png"), optimize=True)
