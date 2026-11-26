"""Paints the XF-51's pictures into tex/ on the layout of layout.py, at the places convert.py measured (tex/layout.json).
Run with a Python that has NumPy and Pillow:

    python3 assets/source/core/vehicles/jet/paint.py

Nothing of the source model's pictures is used. A grey low-visibility livery of the US kind on no real unit: colour
region 0 is its paint (content/vehicles/jet.ts, a medium grey), region 1 its darker greys (the anti-glare panel ahead
of the canopy and the outlined star-and-bar insignia, on each wing and on each side behind the cockpit). The tail code
"WR" over "51" is black on each fin, its own words: no real wing or squadron uses it. Panel lines, fasteners and a
little weathering are drawn from seeded noise. The lettering is Pillow's bundled Aileron face, which is CC0.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import layout as L  # noqa: E402

OUT = HERE / "tex"
N = L.SIDE_PX
P = json.loads((OUT / "layout.json").read_text())
rng = np.random.default_rng(51)


def px(u, v):
    """A layout point to the picture's column and row."""
    return u * N, (1 - v) * N


def noise(scale, octaves=4):
    out = np.zeros((N, N))
    amp, tot = 1.0, 0.0
    for k in range(octaves):
        n = max(2, int(N / scale * 2 ** k))
        g = rng.random((n + 1, n + 1))
        img = Image.fromarray((g * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)
        out += amp * (np.asarray(img, np.float64) / 127.5 - 1)
        tot += amp
        amp *= 0.5
    return out / tot


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055)


# Layers in linear light: the base colour, the height, roughness, metal, occlusion and the two region masks.
base = np.zeros((N, N, 3))
height = np.zeros((N, N))
rough = np.full((N, N), 0.55)
metal = np.zeros((N, N))
occ = np.ones((N, N))
mask0 = np.zeros((N, N))
mask1 = np.zeros((N, N))

lines = Image.new("L", (N, N), 0)
ld = ImageDraw.Draw(lines)
dark1 = Image.new("L", (N, N), 0)
d1 = ImageDraw.Draw(dark1)
black = Image.new("L", (N, N), 0)
bd = ImageDraw.Draw(black)


def rect(region, a0, a1):
    u0, u1 = region
    return int(u0 * N), int((1 - a1) * N), int(u1 * N), int((1 - a0) * N)


# Every painted projection is the paint, light grey for the region to dye.
for region in (L.TOP, L.BOTTOM, L.SIDE):
    x0, y0, x1, y1 = rect(region, 0, 1)
    mask0[y0:y1, x0:x1] = 1
    base[y0:y1, x0:x1] = 0.62
for name in ("plain", "inner"):
    u0, u1 = L.STRIP
    v0, v1 = L.PATCHES[name]
    mask0[int((1 - v1) * N):int((1 - v0) * N), int(u0 * N):] = 1
    base[int((1 - v1) * N):int((1 - v0) * N), int(u0 * N):] = 0.62
for name, colour, r, m in (("dark", 0.02, 0.8, 0.0), ("rubber", 0.018, 0.9, 0.0), ("gear", 0.55, 0.45, 0.2),
                           ("metal", 0.07, 0.42, 0.85), ("cockpit", 0.035, 0.7, 0.1)):
    u0, u1 = L.STRIP
    v0, v1 = L.PATCHES[name]
    sl = (slice(int((1 - v1) * N), int((1 - v0) * N)), slice(int(u0 * N), N))
    base[sl] = colour
    rough[sl] = r
    metal[sl] = m
    if name == "metal":
        base[sl] = np.array([0.085, 0.07, 0.06])


def line(points, width=1):
    ld.line([px(*p) for p in points], fill=255, width=width)


# Panel lines: frames round the fuselage and across the wings, seams along them, in plan and in side view.
for y in np.arange(-7.2, 7.4, 0.86):
    for fn, xs in ((L.top, (0.0, 1.15)), (L.bottom, (0.0, 1.0))):
        line([fn(xs[0], y), fn(xs[1], y)])
    line([L.side(0.9, y), L.side(3.0, y)])
for x in (0.42, 0.85):
    for fn in (L.top, L.bottom):
        line([fn(x, -7.4), fn(x, 7.6)])
for z in (1.45, 2.35):
    line([L.side(z, -7.4), L.side(z, 7.6)])
wx, wy = P["wing_root_le"]
for k, x in enumerate(np.linspace(wx + 0.4, 4.7, 5)):
    for fn in (L.top, L.bottom):
        line([fn(x, wy + 0.35 + (x - wx) * 0.72), fn(x, wy + 3.9)])
for f in (0.3, 0.62):
    for fn in (L.top, L.bottom):
        line([fn(wx + 0.2, wy + 0.35 + f * 3.4), fn(5.0, wy + 0.35 + (5.0 - wx) * 0.72 + f * 1.2)])
# The lift fan's door and the canopy's frame line in plan, the gun port and the refuelling door.
dy0, dy1 = P["door_top"]
def box(fn, x0, y0, x1, y1, draw=ld, **kw):
    (a, b), (c, d) = px(*fn(x0, y0)), px(*fn(x1, y1))
    draw.rectangle([min(a, c), min(b, d), max(a, c), max(b, d)], **kw)


box(L.top, 0.0, dy0, 0.55, dy1, outline=255)
cy0, cy1, cx = P["canopy"]

# The anti-glare panel ahead of the canopy, region 1.
box(L.top, 0.0, cy0 - 1.6, 0.32, cy0 + 0.05, draw=d1, fill=255)


def insignia(draw, centre, radius, rotate, w=2):
    """The star-and-bar, outlined: a ring with a five-pointed star in it and a bar each side. `rotate` turns it in the
    picture so that its top points up the jet (+z on the side view) or ahead (in plan)."""
    cxp, cyp = centre
    def rot(dx, dy):
        c, s = math.cos(rotate), math.sin(rotate)
        return cxp + dx * c - dy * s, cyp + dx * s + dy * c
    draw.ellipse([cxp - radius, cyp - radius, cxp + radius, cyp + radius], outline=255, width=w)
    star = []
    for k in range(10):
        t = -math.pi / 2 + k * math.pi / 5
        r = radius * (0.92 if k % 2 == 0 else 0.36)
        star.append(rot(r * math.cos(t), r * math.sin(t)))
    draw.polygon(star, outline=255, width=w)
    for side in (-1, 1):
        bar = [(side * radius * 0.95, -radius * 0.32), (side * radius * 2.1, -radius * 0.32), (side * radius * 2.1, radius * 0.32), (side * radius * 0.95, radius * 0.32)]
        draw.polygon([rot(*p) for p in bar], outline=255, width=w)


# On each wing, above and below, its top toward the nose (the picture's top).
for fn in (L.top, L.bottom):
    c = px(*fn(3.55, wy + 2.2))
    insignia(d1, c, 0.42 * N / L.LENGTH, 0.0)
# On each side behind the cockpit: on the side view the jet's up is the picture's right.
c = px(*L.side(1.95, cy1 + 1.1))
insignia(d1, c, 0.38 * N / L.LENGTH, -math.pi / 2)

# The tail code on each fin: "WR" over "51", reading along the jet, its letters' tops up the fin (the picture's right).
fu, fv = P["fin_code"]
font_big = ImageFont.load_default(size=40)
font_small = ImageFont.load_default(size=22)
text = Image.new("L", (150, 80), 0)
td = ImageDraw.Draw(text)
td.text((75, 4), "WR", font=font_big, fill=255, anchor="mt")
td.text((75, 50), "51", font=font_small, fill=255, anchor="mt")
turned = Image.fromarray(np.rot90(np.asarray(text), -1).copy())
cxp, cyp = px(fu, fv)
black.paste(255, (int(cxp - turned.width / 2), int(cyp - turned.height / 2)), turned)

lines_a = np.asarray(lines, np.float64) / 255
dark_a = np.asarray(dark1, np.float64) / 255
black_a = np.asarray(black, np.float64) / 255

# Weathering: a soft mottle and streaks down the jet, over the paint.
mottle = noise(180)
streak = np.repeat(noise(60, 3)[:1], N, axis=0)
painted = mask0 > 0
base *= (1 + 0.05 * mottle + 0.03 * streak)[..., None]
base *= (1 - 0.35 * lines_a)[..., None]
height -= lines_a * 0.8
occ -= lines_a * 0.25
rough += 0.06 * mottle
# Region 1: the darker grey's area keeps the paint's light grey; it is the mask that dyes it.
mask1 = np.clip(dark_a, 0, 1) * painted
mask0 = np.clip(mask0 - mask1, 0, 1)
# The tail code: black, not dyed.
base = base * (1 - black_a[..., None]) + 0.015 * black_a[..., None]
mask0 *= 1 - black_a
mask1 *= 1 - black_a

dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
dy = (np.roll(height, 1, 0) - np.roll(height, -1, 0)) * 0.5
normal = np.dstack([-dx * 1.5, -dy * 1.5, np.ones_like(height)])
normal /= np.linalg.norm(normal, axis=2, keepdims=True)


def save(name, arr, mode="RGB"):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), mode).save(OUT / name, optimize=True)


save("paint_base.png", srgb(base))
save("paint_normal.png", normal * 0.5 + 0.5)
save("paint_height.png", (height - height.min()) / (np.ptp(height) + 1e-9), "L")
save("paint_packed.png", np.dstack([occ, np.clip(rough, 0.05, 1), metal]))
save("paint_mask.png", np.dstack([mask0, mask1, np.zeros((N, N))]))
g = np.linspace(0, 1, 64)[:, None] * np.ones((1, 64))
save("glass_base.png", srgb(np.dstack([0.028 + 0.01 * g, 0.034 + 0.012 * g, 0.046 + 0.014 * g])))
save("glass_packed.png", np.dstack([np.ones((64, 64)), np.full((64, 64), 0.06), np.full((64, 64), 0.5)]))
save("glow_base.png", srgb(np.dstack([np.full((64, 64), 0.62), np.full((64, 64), 0.9), np.full((64, 64), 1.0)])))
save("glow_packed.png", np.dstack([np.ones((64, 64)), np.full((64, 64), 0.3), np.zeros((64, 64))]))
print(f"paint: wrote the XF-51's pictures to {OUT}")
