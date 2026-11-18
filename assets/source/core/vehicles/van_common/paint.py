"""Paint the three van atlases but for their hurt and decay pictures, which are wear.py's. Run with Python, Pillow and NumPy from any directory."""

import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from surfaces import TAGS

OUT = Path(__file__).resolve().parent / "tex"
S = 128
Y, X = np.mgrid[0:S, 0:S]
U = X / (S - 1)
V = Y / (S - 1)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
COLORS = {
    "enamel": (222, 225, 223),
    "pressed": (209, 215, 212),
    "sill": (59, 63, 63),
    "lower": (207, 215, 212),
    "hood": (218, 224, 222),
    "roof": (221, 227, 225),
    "lip": (205, 213, 210),
    "seam": (36, 40, 41),
    "rubstrip": (54, 58, 58),
    "highlight": (151, 157, 159),
    "wheelhouse": (48, 48, 49),
    "step": (67, 69, 68),
    "lining": (174, 176, 168),
    "ply": (161, 127, 81),
    "rearpress": (206, 214, 211),
    "under": (45, 46, 44),
    "rubber": (46, 46, 45),
    "tread": (44, 44, 43),
    "rim": (192, 197, 198),
    "hub": (100, 105, 106),
    "grille": (37, 42, 45),
    "chrome": (179, 188, 190),
    "headlamp": (198, 213, 211),
    "redlamp": (151, 41, 43),
    "amber": (220, 137, 52),
    "glass": (55, 75, 83),
    "invisible": (49, 65, 70),
    "mirror": (112, 140, 150),
    "plate": (214, 210, 185),
    "steel": (88, 91, 91),
    "badge": (68, 76, 79),
    "reverse": (197, 202, 197),
    "fabric": (173, 175, 173),
    "bolster": (157, 157, 154),
    "carpet": (67, 66, 64),
    "dash": (64, 68, 69),
    "gauges": (27, 32, 33),
    "radio": (51, 57, 58),
    "headliner": (172, 168, 155),
    "doorcard": (102, 101, 96),
    "vent": (51, 54, 53),
    "floor": (107, 103, 91),
    "belt": (47, 48, 47),
    "latch": (154, 49, 43),
    "screen": (47, 62, 60),
    "brake": (52, 55, 53),
    "lamp": (219, 210, 176),
    "aluminium": (148, 152, 151),
}
PAINT = {"enamel", "pressed", "lower", "hood", "roof", "lip", "rearpress"}
METAL = {"chrome", "rim", "steel", "aluminium", "mirror", "hub", "highlight"}
LENSES = {"headlamp", "amber", "redlamp", "reverse"}


def label(draw, position, words, size, fill):
    draw.text(position, words, anchor="mm", font=ImageFont.truetype(FONT, size), fill=fill, stroke_width=0)


for mat, tags in TAGS.items():
    atlas = {
        r: Image.new(mode, (512, 512))
        for r, mode in {
            "base": "RGBA",
            "packed": "RGB",
            "mask": "RGB",
            "height": "L",
            "normal": "RGB",
        }.items()
    }
    for i, tag in enumerate(tags):
        rng = np.random.default_rng(139 + i)
        noise = rng.normal(0, 1, (S, S))
        h = np.full((S, S), 126.0, dtype=float)
        shade = noise * 0.8
        rough = 105 if tag in PAINT else 184
        metal = 90 if tag in PAINT else (208 if tag in METAL else 9)
        if tag in PAINT:
            shade += 4 * np.cos((V - 0.20) * math.pi) - 6 * V**8
            if tag in {"pressed", "rearpress"}:
                edge = np.minimum(np.minimum(U, 1 - U), np.minimum(V, 1 - V))
                shade += 5 * np.exp(-(((edge - 0.082) / 0.025) ** 2)) - 5 * np.exp(-(((edge - 0.116) / 0.028) ** 2))
            if tag == "hood":
                shade += 2.8 * np.exp(-(((np.abs(U - 0.5) - 0.335) / 0.023) ** 2))
        if tag in METAL:
            rough = 65 if tag in {"chrome", "mirror"} else 121
            shade += 8 * np.sin(V * math.pi * 1.4)
        if tag in {"carpet", "floor", "step", "fabric", "bolster", "rubstrip", "grille", "tread", "ply", "vent", "brake"}:
            if tag == "grille":
                weave = ((X % 12 < 3) | (Y % 8 < 2)).astype(float) * 16 - 7
            elif tag == "vent":
                weave = (Y % 14 < 5) * 23 - 12
            elif tag == "tread":
                weave = ((X + np.abs((Y % 40) - 20)) % 24 < 7) * -13
            elif tag == "ply":
                weave = 4 * np.sin(1.1 * Y + np.sin(0.13 * X)) + 5 * np.sin(Y * 0.18 + np.sin(X * 0.05))
            elif tag in {"floor", "step", "brake", "rubstrip"}:
                weave = 7 * np.cos(X * math.pi / 7) + noise
            else:
                weave = 3 * np.sin((X + Y) * math.pi * 0.5) + 3 * np.sin((Y - X) * math.pi * 0.6) + 3 * noise
            shade += weave
            h += weave * 0.9
        if tag in LENSES:
            rough, metal = 71, 82
            shade += 6 * np.cos(X * 0.9) + 4 * np.cos(Y * 1.6) + 17 * (1 - V) + 12 * np.exp(-(((V - 0.18) / 0.085) ** 2))
            h += np.cos(X * 0.9) * 3
        if tag == "glass":
            rough, metal = 44, 54
            shade += 22 * (1 - V) - 12 * V + 7 * np.exp(-(((U + 0.70 * V - 0.69) / 0.13) ** 2))
        if tag == "rubber":
            shade += 3 * np.cos(V * math.pi)
        rgb = np.uint8(np.clip(np.asarray(COLORS[tag]) + shade[:, :, None], 0, 255))
        base = Image.fromarray(rgb).convert("RGBA")
        draw = ImageDraw.Draw(base)
        if tag == "invisible":
            base.putalpha(0)
        if tag == "plate":
            draw.rounded_rectangle((5, 5, 122, 122), radius=5, outline=(70, 74, 71), width=3)
            label(draw, (64, 35), "DISTRICT  04", 13, (76, 89, 84))
            label(draw, (64, 76), "RV  268", 30, (48, 59, 56))
            for x in (12, 115):
                draw.ellipse((x - 2, 14, x + 2, 18), fill=(100, 101, 97))
        if tag == "gauges":
            for a in (34, 94):
                draw.ellipse((a - 26, 30, a + 26, 92), fill=(30, 34, 34), outline=(146, 157, 149), width=2)
                for angle in range(-205, 37, 22):
                    r = math.radians(angle)
                    draw.line(
                        (a + 17 * math.cos(r), 62 + 22 * math.sin(r), a + 22 * math.cos(r), 62 + 27 * math.sin(r)),
                        fill=(191, 198, 186),
                        width=2,
                    )
                draw.line((a, 62, a - 10, 45), fill=(225, 125, 66), width=3)
            draw.rectangle((49, 99, 78, 109), fill=(90, 121, 104))
        if tag in {"screen", "radio"}:
            draw.rounded_rectangle((19, 19, 108, 70), radius=4, fill=(33, 53, 53), outline=(89, 100, 92), width=2)
            label(draw, (64, 47), "FM  98.4", 15, (156, 184, 152))
            for xx in range(18, 109, 18):
                draw.rounded_rectangle((xx, 88, xx + 12, 101), 2, fill=(90, 95, 89))
        if tag == "badge":
            draw.polygon([(26, 77), (57, 43), (102, 43), (90, 56), (62, 56), (43, 77)], fill=(195, 200, 194))
            draw.polygon([(53, 78), (68, 62), (85, 62), (70, 78)], fill=(172, 178, 173))
        if tag == "fabric":
            for x in (16, 111):
                for y in range(8, 120, 7):
                    draw.line((x, y, x, y + 3), fill=(139, 141, 139), width=1)
        roughmap = np.uint8(np.clip(rough + 2 * noise, 0, 255))
        packed = np.stack([np.uint8(246 + np.clip(noise, -4, 4)), roughmap, np.full_like(roughmap, metal)], axis=-1)
        mask = (
            (255, 0, 0)
            if tag in PAINT
            else ((0, 255, 0) if tag in {"fabric", "bolster"} else ((0, 0, 255) if tag == "rim" else (0, 0, 0)))
        )
        gy, gx = np.gradient(h)
        norm = np.stack((-gx * 0.06, gy * 0.06, np.ones_like(h)), axis=2)
        norm /= np.linalg.norm(norm, axis=2)[:, :, None]
        maps = {
            "base": base,
            "packed": Image.fromarray(packed),
            "mask": Image.new("RGB", (S, S), mask),
            "height": Image.fromarray(np.uint8(h)),
            "normal": Image.fromarray(np.uint8((norm * 0.5 + 0.5) * 255 + 0.5)),
        }
        for r, picture in maps.items():
            atlas[r].paste(picture, ((i % 4) * S, (i // 4) * S))
    for role, picture in atlas.items():
        # The outer gutter wraps to itself when the game filters the atlas at its periodic edge.
        picture.paste(picture.crop((0, 0, 512, 1)), (0, 511))
        picture.paste(picture.crop((0, 0, 1, 512)), (511, 0))
        picture.save(OUT / f"{mat}-{role}.png", optimize=True)
