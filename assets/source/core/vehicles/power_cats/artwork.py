"""Flat artwork and its projection onto the finish."""
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import map_coordinates

HERE = Path(__file__).resolve().parent
FONT = HERE.parents[3] / "raw/fonts/barlow/BarlowSemiCondensed-Medium.ttf"
IDENTITY = {
    "lagoon": ("DOUBLE TAKE", "FL 6274 DT"),
    "manta": ("WINGSPAN", "FL 3186 WS"),
}


def letters(caption, spacing, size=150, stroke=2):
    font = ImageFont.truetype(str(FONT), size)
    box = font.getbbox(caption)
    advance = [font.getlength(c) + spacing for c in caption]
    im = Image.new("L", (int(sum(advance) + size), box[3] - box[1] + 2*stroke + 12))
    pen = ImageDraw.Draw(im)
    x = 4+stroke
    for c, step in zip(caption, advance):
        pen.text((x, 4 + stroke - box[1]), c, font=font, fill=255,
                 stroke_width=stroke, stroke_fill=255)
        x += step
    return im.crop(im.getbbox())


def instruments():
    w, h = 720, 204
    chart = Image.new("RGB", (w, h), "#286478")
    pen = ImageDraw.Draw(chart)
    coast = [(0, -10), (244, -10), (227, 18), (176, 29), (186, 46),
             (145, 63), (138, 86), (91, 106), (79, 144), (35, 182), (22, 211), (0, 211)]
    for dx, color in [(104, "#448999"), (57, "#78adaa"), (16, "#acc5ac"), (0, "#c8ba90")]:
        pen.polygon([(x + dx if x else -2, y) for x, y in coast], fill=color)
    for j in range(4):
        x, y = 180 - 42 * j, 12 + 41 * j
        pen.line([(x, y), (x + 27, y + 4), (x + 33, y + 22)], fill="#f5e4bd", width=5)
    pen.polygon([(415, 8), (448, 0), (506, 0), (473, 15), (427, 24), (407, 24)], fill="#9db6a0")
    for x in (327, 408, 489):
        pen.line((x, 0, x, h), fill="#437885", width=2)
    for y in (48, 103, 158):
        pen.line((255, y, 540, y), fill="#437885", width=2)
    route = [(173, 215), (287, 145), (361, 111), (419, 55), (481, 31)]
    pen.line(route, fill="#184453", width=29, joint="curve")
    pen.line(route, fill="#ffda70", width=19, joint="curve")
    for x, y in route[1:-1]:
        pen.ellipse((x-6, y-6, x+6, y+6), fill="#ffe59a", outline="#384a44", width=2)
    pen.polygon([(376, 78), (358, 139), (345, 119), (323, 116)],
                fill="#fcffec", outline="#173d4a", width=3)
    for x, y in [(264, 137), (312, 153), (397, 58), (432, 67)]:
        pen.ellipse((x-3, y-3, x+3, y+3), fill="#f7eac4")
    echo = Image.new("RGB", (w, h), "#122d40")
    scan = ImageDraw.Draw(echo)
    rng = np.random.default_rng(273)
    x = np.arange(548)
    bed = 112 + 32*np.sin(x/82) - 18*np.sin(x/47) + 4*np.sin(x/22)
    for j in range(len(x)):
        y = int(bed[j] + rng.normal(0, 1.6))
        for dy, color in [(0, "#f5cc69"), (14, "#ed994c"), (34, "#bf6337"),
                          (51, "#853f33"), (68, "#483844")]:
            scan.line((j, y+dy, j, h), fill=color)
        for _ in range(8):
            yy = int(y + rng.uniform(-12, 41))
            scan.point((j, yy), fill=("#ed9a47" if yy > y else "#40717c"))
    for y in (43, 84, 126, 168):
        for j in range(3, 545, 10):
            scan.line((j, y, j+3, y), fill="#597684")
    for cx, cy, r in [(111, 84, 16), (267, 72, 12), (295, 80, 8), (464, 54, 15)]:
        scan.arc((cx-r, cy-6, cx+r, cy+13), 204, 334, fill="#ffbc64", width=4)
    def label(draw, xy, text, size, colour, anchor="lt", outline=0):
        font = ImageFont.truetype(str(FONT), size)
        draw.text(xy, text, font=font, fill=colour, anchor=anchor,
                  stroke_width=outline, stroke_fill="#214652")

    # Soundings stay in the water and the track passes between the two lateral marks.
    for x, y, value in [(246,13,"3.1"),(223,80,"4.6"),(177,150,"3.8"),
                        (331,41,"6.2"),(464,137,"8.4"),(373,167,"7.1")]:
        label(pen, (x,y),value,16,"#cde7dc",outline=1)
    for x,y,col in [(291,117,"#ec6b52"),(322,146,"#76dbab")]:
        pen.polygon([(x,y-9),(x-6,y+4),(x+6,y+4)],fill=col,outline="#1a3637",width=2)
        pen.line((x-7,y+7,x+7,y+7),fill="#ecf1d7",width=2)
    pen.rectangle((0,0,154,33),fill="#163e4c")
    label(pen,(9,6),"INLET  /  WPT 03",21,"#e4edda")
    pen.line((14,178,14,185,97,185,97,178),fill="#23474b",width=3)
    label(pen,(14,157),"0.2 NM",16,"#203f40")
    pen.polygon([(512,13),(501,43),(512,36),(523,43)],fill="#f1eccc",outline="#244650",width=2)
    label(pen,(512,47),"N",17,"#e6f0d8","mt",1)

    scan.rectangle((0,0,174,32),fill="#153140")
    label(scan,(10,5),"SONAR   200 kHz",21,"#d9e9de")
    for row,depth in [(42,"2"),(83,"4"),(124,"6"),(165,"8")]:
        scan.rectangle((509,row-12,545,row+7),fill="#193646")
        label(scan,(537,row-9),depth,19,"#b7cfc7","rt")
    for im,title,reading,info in [(chart,"HDG","082°","NORTH UP"),(echo,"DEPTH","6.8","METRES")]:
        d=ImageDraw.Draw(im)
        d.rectangle((548,0,719,203),fill="#102a34")
        d.rectangle((549,8,553,198),fill="#6bb9b6")
        label(d,(566,10),title,33,"#a9d6d0")
        label(d,(562,54),reading,84,"#fff4cf")
        d.line((567,146,704,146),fill="#4d777b",width=2)
        label(d,(568,161),info,24,"#c7e4d9")
    return chart, echo


def wake():
    # The long foil opens into two fine prongs against the stem.
    im = Image.new("L", (1600, 192))
    d = ImageDraw.Draw(im)
    d.polygon([(0,165),(358,138),(685,103),(978,55),(1340,17),(1599,7),
               (1330,45),(987,98),(693,143),(382,154)], fill=255)
    d.polygon([(390,183),(677,148),(1006,107),(1255,86),(1498,80),
               (1261,112),(1020,144),(719,168)], fill=255)
    return im


@lru_cache(maxsize=2)
def originals(boat):
    name, registration = IDENTITY[boat]
    if boat == "manta":
        from sport_art import sport_chart, wing, wordmark
        return {"name": wordmark(), "port": letters("MIAMI, FL", 19, stroke=4),
                "registration": letters(registration, 10, stroke=3),
                "wing": wing(), "chart": sport_chart(FONT)}
    chart, echo = instruments()
    return {"name": letters(name, 16, stroke=3), "port": letters("MIAMI, FL", 26, stroke=4),
            "registration": letters(registration, 12), "wake": wake(),
            "chart": chart, "sonar": echo}


def save_originals(boat):
    folder = HERE / "ref/artwork"
    if boat == "manta":
        folder = folder / "manta"
    folder.mkdir(exist_ok=True, parents=True)
    name, number = IDENTITY[boat]
    filenames = {"name": name.lower().replace(" ", "-"), "registration": number.lower().replace(" ", "-"),
                 "port": "miami-fl"}
    for key, im in originals(boat).items():
        im.save(folder / (filenames.get(key, key) + ".png"))


@lru_cache(maxsize=32)
def raster(boat, key, width, height):
    return np.asarray(originals(boat)[key].resize((width, height), Image.Resampling.LANCZOS),
                      dtype=np.float32)


def project(boat, key, u, v, width, height, face):
    """Sample a prefiltered master at local face density. Coordinates run left to right and down."""
    valid = face & (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
    pixels = raster(boat, key, width, height)
    out = np.zeros((*u.shape, *pixels.shape[2:]), np.float32)
    if valid.any():
        coords = [(v[valid] * height - .5), (u[valid] * width - .5)]
        if pixels.ndim == 2:
            out[valid] = map_coordinates(pixels, coords, order=1, mode="nearest") / 255
        else:
            out[valid] = np.stack([map_coordinates(ch, coords, order=1, mode="nearest")
                                   for ch in pixels.transpose(2, 0, 1)], axis=-1)
    return out
