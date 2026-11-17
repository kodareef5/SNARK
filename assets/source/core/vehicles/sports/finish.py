"""Shared swatch atlas. Rectangles count eighths from the upper left of the picture."""

SWATCH = {
    "paint": (0, 0, 4, 4),
    "rubber": (4, 0, 2, 2),
    "glass": (6, 0, 2, 2),
    "leather": (4, 2, 2, 2),
    "grille": (6, 2, 2, 2),
    "carbon": (0, 4, 2, 2),
    "alloy": (2, 4, 2, 2),
    "disc": (4, 4, 2, 2),
    "screen": (6, 4, 2, 1),
    "navigation": (6, 5, 2, 1),
    "dash": (0, 6, 1, 1),
    "liner": (1, 6, 1, 1),
    "silver": (2, 6, 1, 1),
    "caliper": (3, 6, 1, 1),
    "white": (4, 6, 1, 1),
    "red": (5, 6, 1, 1),
    "amber": (6, 6, 1, 1),
    "inside": (7, 6, 1, 1),
    "seam": (0, 7, 1, 1),
    "tread": (1, 7, 1, 1),
    "lamp": (2, 7, 1, 1),
    "plate": (3, 7, 2, 1),
    "mirror": (5, 7, 1, 1),
    "brush": (6, 7, 1, 1),
    "carpet": (7, 7, 1, 1),
}


def paint_maps():
    from PIL import Image, ImageDraw
    from pathlib import Path
    import math
    import random

    folder = Path(__file__).with_name("tex")
    folder.mkdir(exist_ok=True)
    base = Image.new("RGBA", (512, 512))
    finish = Image.new("RGB", base.size)
    height = Image.new("L", base.size, 128)
    regions = Image.new("RGB", base.size)
    hurt = Image.new("RGBA", base.size)
    decay = Image.new("RGBA", base.size)
    # RGB, roughness and metallic response for the game's material renderer.
    recipes = {
        "paint": ((198, 198, 195), 53, 99),
        "rubber": ((32, 34, 39), 158, 0),
        "tread": ((27, 29, 33), 180, 0),
        "glass": ((36, 56, 68), 32, 120),
        "leather": ((150, 143, 134), 137, 0),
        "grille": ((32, 35, 39), 117, 68),
        "carbon": ((41, 45, 48), 94, 66),
        "alloy": ((150, 155, 157), 69, 202),
        "disc": ((109, 112, 107), 119, 171),
        "screen": ((12, 22, 29), 62, 59),
        "navigation": ((15, 23, 27), 65, 42),
        "dash": ((47, 48, 51), 133, 0),
        "liner": ((30, 30, 33), 162, 0),
        "silver": ((192, 194, 190), 58, 221),
        "caliper": ((228, 93, 35), 96, 45),
        "white": ((215, 239, 244), 32, 35),
        "red": ((215, 29, 41), 47, 49),
        "amber": ((240, 144, 41), 48, 43),
        "inside": ((0, 0, 0), 128, 0),
        "seam": ((21, 22, 25), 150, 0),
        "lamp": ((40, 54, 65), 56, 106),
        "plate": ((220, 219, 204), 125, 18),
        "mirror": ((132, 160, 171), 32, 231),
        "brush": ((101, 108, 109), 93, 179),
        "carpet": ((42, 41, 41), 204, 0),
    }
    rng = random.Random(8430)
    for tag, (ix, iy, iw, ih) in SWATCH.items():
        x0, y0, w, h = ix * 64, iy * 64, iw * 64, ih * 64
        col, rough, metal = recipes[tag]
        pixels = base.load()
        pbr = finish.load()
        mask = regions.load()
        dye = {"paint": (255, 0, 0), "leather": (0, 255, 0), "alloy": (0, 0, 255)}.get(tag, (0, 0, 0))
        for y in range(h):
            for x in range(w):
                u, v = x / w, y / h
                n = rng.random() - 0.5
                grain = 0
                if tag == "carbon":
                    grain = 4 * ((x // 3 + y // 2) % 2)
                if tag == "tread":
                    grain = -12 * (int(x + y * 0.69) % 19 < 3)
                if tag == "leather":
                    grain = 3 * n - 7 * ((x % 11) < 2 and y % 9 < 2)
                if tag == "grille":
                    grain = 7 if (x + (y // 6 % 2) * 4) % 9 < 2 or y % 6 < 2 else -7
                if tag == "carpet":
                    grain = n * 7
                if tag == "rubber":
                    grain = 1.5 * math.sin(math.pi * x / 6)
                height.putpixel((x0 + x, y0 + y), 128 + round(grain))
                delta = n * (2 if tag == "paint" else 5)
                if tag == "paint":
                    delta += 5 * (1 - v) + 2 * math.sin(math.pi * u)
                if tag == "glass":
                    delta += 24 * (1 - v) ** 2 + 10 * math.exp(-(((v - 0.34 - 0.10 * u) / 0.15) ** 2))
                if tag == "mirror":
                    delta += 26 * (1 - v) - 32 * (v > 0.65 - 0.07 * u)
                if tag == "carbon":
                    delta += 5 * ((x // 3 + y // 2) % 2) + 2 * ((x + y) % 2)
                if tag == "leather":
                    delta += 1.7 * math.sin(x * 1.7 + y * 0.31) - 16 * ((x % 11) < 2 and y % 9 < 2)
                if tag == "grille":
                    delta += -15 if ((x + (y // 6 % 2) * 4) % 9 not in [0, 1] and y % 6 not in [0, 1]) else 12
                if tag == "tread":
                    delta -= 12 * (int(x + y * 0.69) % 19 < 3)
                if tag == "disc":
                    delta += 3 * math.sin(y * 1.4)
                if tag == "carpet":
                    delta += 8 * n
                if tag == "lamp":
                    delta += 14 * math.sin(u * math.pi) * math.sin(v * math.pi)
                if tag == "white":
                    delta += 8 * (x % 7 < 4)
                rgb = tuple(max(0, min(255, round(k + delta))) for k in col)
                alpha = 0 if tag == "inside" else 255
                if tag == "glass":
                    # Frit and shaded upper edge. The central area is open at all mip levels
                    # so dashboard, headrests and occupants can be seen from the street.
                    edge = min((u - 0.055) / 0.89, (0.945 - u) / 0.89)
                    rise = (v - 0.055) / 0.89
                    band = 0.055 + 0.065 * (1 - abs(2 * u - 1)) ** 2
                    alpha = 255 if edge < 0.030 or rise < band or rise > 0.963 else 0
                    # Sparse reflections in the outer quarter convey a pane across the
                    # opening while the cutout leaves the driver-facing field clear.
                    sheen = 0.19 + 0.15 * u + 0.025 * math.sin(4 * u)
                    if abs(rise - sheen) < 0.048 and u < 0.62 and ((x * 7 + y * 13) % 17) < 3:
                        alpha = 231
                    if 0.03 < edge < 0.076 or band < rise < band + 0.039:
                        alpha = 220 if x % 4 < 2 and y % 4 < 2 else 0
                pixels[x0 + x, y0 + y] = (*rgb, alpha)
                pbr[x0 + x, y0 + y] = (255, min(255, max(0, int(rough + n * 7))), metal)
                mask[x0 + x, y0 + y] = dye
        if tag in ("paint", "alloy", "glass", "carbon"):
            for layer, count, color in [(hurt, 18, (99, 87, 72)), (decay, 24, (112, 61, 40))]:
                d = ImageDraw.Draw(layer)
                for _ in range(count):
                    x = rng.randrange(5, w - 12)
                    y = rng.randrange(4, h - 7)
                    dx = min(w - 3 - x, rng.randrange(6, 23))
                    dy = min(h - 3 - y, rng.randrange(-3, 7))
                    d.line(
                        [(x0 + x, y0 + y), (x0 + x + dx // 2, y0 + y + dy // 2 + 1), (x0 + x + dx, y0 + y + dy)],
                        fill=(*color, rng.randrange(70, 245)),
                        width=1 if layer == hurt else 2,
                    )
    # Legible in the cabin at the driver's distance. Small reflected graphics only where the screen lies.
    draw = ImageDraw.Draw(base)
    draw.rounded_rectangle((390, 259, 505, 316), 5, fill=(17, 29, 35))
    draw.arc((425, 265, 474, 311), 142, 397, fill=(188, 218, 214), width=3)
    draw.arc((425, 265, 474, 311), 307, 345, fill=(238, 111, 66), width=3)
    draw.line((449, 288, 456, 276), fill=(236, 184, 99), width=2)
    draw.text((448, 292), "0", fill=(217, 231, 227))
    draw.text((393, 274), "N", fill=(141, 208, 201))
    for x in range(474, 498, 5):
        draw.rectangle((x, 292, x + 3, 294), fill=(119, 172, 170))
    draw.rounded_rectangle((390, 324, 505, 379), 5, fill=(35, 48, 54))
    for points in [
        [(394, 344), (416, 339), (432, 345), (445, 341), (485, 326)],
        [(401, 374), (418, 351), (435, 353), (460, 358), (499, 345)],
        [(407, 328), (419, 345), (425, 365), (442, 375)],
        [(461, 328), (454, 350), (465, 369)],
    ]:
        draw.line(points, fill=(81, 96, 99), width=2)
    draw.line([(416, 368), (428, 357), (439, 356), (447, 345), (462, 338)], fill=(86, 174, 180), width=3)
    draw.polygon([(437, 353), (441, 343), (445, 353)], fill=(212, 229, 226))
    draw.rounded_rectangle((197, 453, 314, 506), 8, outline=(73, 81, 86), width=3)
    draw.text((222, 474), "S N A R K", fill=(37, 47, 52), stroke_width=0)
    # A livery texel can show impact damage or decay. Reserve the hurt pixels.
    for yy in range(512):
        for xx in range(512):
            if hurt.getpixel((xx, yy))[3]:
                decay.putpixel((xx, yy), (0, 0, 0, 0))
    normal = Image.new("RGB", base.size)
    for yy in range(512):
        for xx in range(512):
            nx = (height.getpixel(((xx - 1) % 512, yy)) - height.getpixel(((xx + 1) % 512, yy))) * 0.029
            ny = (height.getpixel((xx, (yy + 1) % 512)) - height.getpixel((xx, (yy - 1) % 512))) * 0.029
            length = math.sqrt(nx * nx + ny * ny + 1)
            normal.putpixel((xx, yy), tuple(round(127.5 * (1 + q / length)) for q in (nx, ny, 1)))
    for name, img in [
        ("normal", normal),
        ("height", height),
        ("base", base),
        ("finish", finish),
        ("regions", regions),
        ("hurt", hurt),
        ("decay", decay),
    ]:
        img.save(folder / (name + ".png"), optimize=True)


if __name__ == "__main__":
    paint_maps()
