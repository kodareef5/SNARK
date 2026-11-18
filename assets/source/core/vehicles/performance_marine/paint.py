"""Bake repeatable marine material swatches with chipped gelcoat, salt and oxidised metal."""
from pathlib import Path
import math

import numpy as np
from PIL import Image, ImageDraw
from finishes import SWATCHES

OUT = Path(__file__).with_name("tex")
N = 128
Y, X = np.mgrid[:N, :N]
U, V = X / 127, Y / 127
METALS = {"chrome", "steel", "aluminium", "bronze", "gold"}
CLOTH = {"vinyl", "suede", "tobacco"}
RUBBER = {"grip", "tread", "rubber", "nonskid"}
for family, tags in SWATCHES.items():
    atlas = {key: Image.new(mode, (512, 512)) for key, mode in {
        "base": "RGB", "normal": "RGB", "height": "L", "packed": "RGB", "mask": "RGB", "hurt": "RGBA", "decay": "RGBA"
    }.items()}
    for i, (tag, rgb) in enumerate(tags.items()):
        rng = np.random.default_rng((1103 if family == "laminate" else 9029) + i)
        noise = rng.normal(0, 1, (N, N))
        relief = noise * .8
        rough, metallic = 96, 18
        shade = 1.1 * noise + 2.1 * np.cos(V * math.pi)
        if tag in METALS:
            rough, metallic = (59 if tag == "chrome" else 130), 183
            shade += 2.9 * np.cos(Y * 1.4 + .21 * np.sin(.13 * X)) + 4 * np.cos(V * 7)
        elif tag in CLOTH:
            rough = 181
            relief += 2.2 * np.sin((X + Y) * 2.3) + 2 * np.cos((X - Y) * 1.7)
            shade += relief
        elif tag in RUBBER:
            rough = 210
            pattern = (np.cos(X * .9) * np.cos(Y * .9) if tag == "nonskid" else np.cos((X + abs(Y % 18 - 9)) * .65))
            relief += 4.4 * pattern
            shade += relief + noise
        elif tag == "teak":
            grain = np.sin(X * .68 + np.sin(Y * .035 + X * .08)) + .6 * np.cos(X * 1.6 + np.sin(Y * .04))
            seam = np.abs(X % 22 - 11) < 1.8
            relief += 1.6 * grain - 10 * seam
            shade += 5 * grain - 40 * seam
            rough = 173
        elif tag == "carbon":
            weave = ((X // 3 + Y // 3) % 2) * 4 + np.cos((X + Y) * .9) * 2
            relief += weave * .7
            shade += weave
        elif tag == "intake":
            relief -= 7 * ((Y % 8 < 2) | (X % 10 < 2))
            shade += relief * 1.25
        base = Image.fromarray(np.uint8(np.clip(np.array(rgb) + shade[..., None], 0, 255)))
        draw = ImageDraw.Draw(base)
        if tag == "gauge":
            draw.ellipse((8, 8, 119, 119), outline=(153, 160, 149), width=3)
            for j in range(26):
                a = math.radians(132 + j * 11.8)
                length = 37 if j % 5 == 0 else 42
                draw.line((64 + length * math.cos(a), 64 + length * math.sin(a), 64 + 48 * math.cos(a), 64 + 48 * math.sin(a)),
                          fill=(218, 217, 187) if j < 22 else (207, 97, 63), width=2)
            draw.line((64, 64, 86, 35), fill=(231, 109, 60), width=4)
            draw.ellipse((60, 60, 68, 68), fill=(211, 214, 203))
        if tag == "chart":
            for k in range(4):
                draw.line([(0, 30 + 12*k), (27, 21 + 12*k), (52, 32 + 11*k), (82, 14 + 9*k), (127, 9 + 8*k)], fill=(95, 142, 136), width=2)
            draw.line([(13, 110), (54, 85), (73, 81), (102, 45)], fill=(201, 177, 100), width=2)
            draw.polygon([(57, 75), (55, 89), (62, 84)], fill=(244, 222, 158))
        gy, gx = np.gradient(relief)
        normal = np.stack((-gx * .055, gy * .055, np.ones_like(relief)), axis=-1)
        normal /= np.linalg.norm(normal, axis=-1)[..., None]
        hurt, decay = Image.new("RGBA", (N, N)), Image.new("RGBA", (N, N))
        hd, dd = ImageDraw.Draw(hurt), ImageDraw.Draw(decay)
        # Substrate-specific ageing. Abraded gel reveals a chalky glass layer, rubbed aluminium blooms
        # pale, torn vinyl exposes its textile backing and varnish breaks along the timber grain.
        chip = (178, 183, 179) if tag in METALS else (138, 128, 113) if tag in CLOTH else (113, 116, 107)
        salt = (169, 177, 166) if tag in METALS else (137, 122, 91) if tag in CLOTH else (145, 146, 118)
        if tag == "teak":
            chip, salt = (170, 151, 120), (128, 135, 121)
        elif tag == "steel":
            salt = (123, 93, 68)
        for k in range(13 if tag in CLOTH else 20):
            x, y = rng.integers(0, N, 2)
            dx, dy = rng.integers(3, 18), -rng.integers(1, 7)
            if tag == "teak":
                dx, dy = 2, rng.integers(9, 33)
            hd.line((x, y, x + dx, y + dy), fill=(*chip, int(rng.integers(55, 204))), width=1 + int(k % 8 == 0))
        for k in range(66):
            x, y = rng.integers(0, N, 2)
            dd.ellipse((x, y, x + int(rng.integers(1, 7)), y + int(rng.integers(1, 4))),
                       fill=(*salt, int(rng.integers(43, 153))))
        a = np.array(decay)
        a[np.array(hurt)[:, :, 3] > 0, 3] = 0
        maps = {"base": base, "height": Image.fromarray(np.uint8(np.clip(127 + relief, 0, 255))),
                "normal": Image.fromarray(np.uint8((normal + 1) * 127.5)),
                "packed": Image.fromarray(np.uint8(np.stack((244 + noise, rough + noise * 2, np.full_like(noise, metallic)), axis=-1).clip(0,255))),
                "mask": Image.new("RGB", (N, N), (255, 0, 0) if tag == "gel" else (0, 0, 0)),
                "hurt": hurt, "decay": Image.fromarray(a)}
        for role, picture in maps.items():
            atlas[role].paste(picture, (i % 4 * N, i // 4 * N))
    for role, picture in atlas.items():
        picture.paste(picture.crop((0, 0, 512, 1)), (0, 511))
        picture.paste(picture.crop((0, 0, 1, 512)), (511, 0))
        picture.save(OUT / f"{family}-{role}.png", optimize=True)
