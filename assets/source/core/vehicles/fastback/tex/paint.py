"""Draw the fastback's finish maps and its registered panel damage with Pillow and NumPy."""

from pathlib import Path
import sys
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from finish import FINISH

rng = np.random.default_rng(9983)
# The two halves of the enamel atlas are orthogonal projections over the same body.
size = 512
y, x = np.indices((size, size))
n = rng.normal(0, 1.5, (size, size)) + 1.0 * np.sin(y * 0.042 + x * 0.063)


def color(base, noise=0):
    return np.clip(np.array(base)[None, None, :] + np.asarray(noise)[..., None], 0, 255).astype(np.uint8)


Image.fromarray(color((233, 235, 234), n)).save(HERE / "enamel.png")
Image.fromarray(np.dstack([np.full_like(n, 251), np.clip(72 + n * 1.8, 0, 255), np.full_like(n, 55)]).astype(np.uint8)).save(
    HERE / "enamel_orm.png"
)
Image.new("RGB", (size, size), (255, 0, 0)).save(HERE / "enamel_mask.png")
T = 128
size = 8 * T
maps = {
    m: Image.new(mode, (size, size), bg)
    for m, mode, bg in [
        ("detail", "RGBA", (42, 43, 44, 255)),
        ("detail_orm", "RGB", (255, 128, 0)),
        ("detail_mask", "RGB", (0, 0, 0)),
        ("detail_hurt", "RGBA", (0, 0, 0, 0)),
        ("detail_decay", "RGBA", (0, 0, 0, 0)),
    ]
}
Y, X = np.indices((T, T))
for i, (name, (base, rough, metal)) in enumerate(FINISH.items()):
    pos = (i % 8 * T, i // 8 * T)
    grain = rng.normal(0, 2.0, (T, T))
    if name in ("seat", "grip", "dash", "insert"):
        grain += ((X + Y) % 3 == 0) * 2.8
    if name == "weave":
        grain += np.where(((X // 6 + Y // 6) % 2) == 0, 10, -18) + (((X % 3) == 0) | ((Y % 3) == 0)) * 5
    if name == "glass":
        # Broad sky-to-cowl reflection with one soft horizon across the screen.
        grain += 13 * (1 - Y / T) + 8 * np.exp(-(((Y / T - 0.30 - X / T * 0.11) / 0.12) ** 2))
    if name == "intake":
        grain += (((X // 3 + Y // 3) % 2) == 0) * 4
    if name == "rotor":
        grain += np.sin(np.hypot(X - T / 2, Y - T / 2) * 1.4) * 8
    if name in ("headlight", "projector"):
        r = np.hypot(X - T / 2, Y - T / 2) / T
        grain += 14 * np.cos(5 * r) + 12 * np.sin(X * 0.32) + 10 * np.maximum(0, np.sin(Y * 0.33))
    if name in ("taillight", "amber"):
        grain += 5 * np.cos(X * 0.6) + 6 * np.cos(Y * 0.34)
    if name == "tread":
        grain += np.where((X + np.abs((Y % 30) - 15) * 0.8) % 17 < 2, -13, 0)
    tile = Image.fromarray(color(base, grain)).convert("RGBA")
    if name == "invisible":
        tile.putalpha(0)
    if name == "plate":
        d = ImageDraw.Draw(tile)
        d.rounded_rectangle((4, 25, 123, 101), 10, outline=(93, 95, 88), width=3)
        font = ImageFont.load_default(size=25)
        d.text((64, 64), "FB  /  6", font=font, fill=(33, 37, 39), anchor="mm", stroke_width=1)
    if name == "gauge":
        d = ImageDraw.Draw(tile)
        for j in range(29):
            a = math.radians(130 + j * 10)
            co = (210, 77, 56) if j > 24 else (224, 220, 199)
            r = 46 if j % 3 == 0 else 51
            d.line((64 + r * math.cos(a), 64 + r * math.sin(a), 64 + 58 * math.cos(a), 64 + 58 * math.sin(a)), fill=co, width=2)
        d.line((64, 66, 32, 88), fill=(240, 97, 55), width=4)
        d.ellipse((58, 60, 69, 71), fill=(148, 148, 137))
    if name == "hub":
        d = ImageDraw.Draw(tile)
        d.polygon(((63, 30), (81, 42), (64, 81), (47, 42)), fill=(183, 177, 154))
        d.polygon(((63, 42), (69, 46), (63, 62), (57, 46)), fill=(72, 72, 69))
    maps["detail"].paste(tile, pos)
    maps["detail_orm"].paste((255, rough, metal), (*pos, pos[0] + T, pos[1] + T))
    if name in ("seat", "weave", "alloy"):
        maps["detail_mask"].paste((0, 0, 255) if name == "alloy" else (0, 255, 0), (*pos, pos[0] + T, pos[1] + T))
    if name not in ("invisible", "glass"):
        grime = Image.fromarray(np.dstack([color((54, 47, 41), grain * 1.5), np.clip(89 + grain * 4, 0, 255).astype("uint8")]))
        maps["detail_decay"].paste(grime, pos)
    if name in ("headlight", "taillight", "glass", "projector"):
        scratch = Image.new("RGBA", (T, T))
        d = ImageDraw.Draw(scratch)
        for j in range(6):
            a = j * 1.05 + 0.11
            line = [
                (58, 61),
                (58 + 18 * math.cos(a), 61 + 18 * math.sin(a)),
                (58 + 46 * math.cos(a + 0.18), 61 + 46 * math.sin(a + 0.18)),
            ]
            d.line(line, fill=(134, 151, 156, 90 + j * 18), width=1)
        maps["detail_hurt"].paste(scratch, pos)
for name, im in maps.items():
    im.save(HERE / (name + ".png"))
for mode in ("hurt", "decay"):
    side = 512
    im = Image.new("RGBA", (side, side))
    d = ImageDraw.Draw(im)
    if mode == "hurt":
        for _ in range(18):
            x, y = rng.integers(9, side - 10, 2)
            angle = rng.uniform(-0.35, 0.35)
            length = rng.uniform(10, 60)
            for j in range(int(rng.integers(3, 10))):
                dx = rng.uniform(0, 22)
                dy = rng.normal(0, 3)
                l = length * rng.uniform(0.18, 1)
                d.line((x + dx, y + dy, x + dx + l, y + dy + l * angle), fill=(135, 140, 135, int(rng.uniform(87, 253))), width=1)
    else:
        scatter = rng.normal(0, 10, (side, side))
        Y, X = np.indices((side, side))
        cloud = np.sin(X * 0.031 + np.cos(Y * 0.046)) * 0.24 + np.cos(Y * 0.047 + np.sin(X * 0.026)) * 0.20 + 0.5
        im = Image.fromarray(
            np.dstack([color((67, 55, 46), cloud * 20 + scatter), np.clip(cloud * 160 + 60 + scatter, 5, 255).astype("uint8")])
        )
    im.save(HERE / f"enamel_{mode}.png")

# A texel belongs to exactly one of the two native damage layers.
for group in ("enamel", "detail"):
    hurt = np.array(Image.open(HERE / f"{group}_hurt.png"))
    decay = np.array(Image.open(HERE / f"{group}_decay.png"))
    decay[:, :, 3][hurt[:, :, 3] > 0] = 0
    Image.fromarray(decay).save(HERE / f"{group}_decay.png")
