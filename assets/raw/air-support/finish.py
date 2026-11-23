"""Paint repeatable enamel, heat shield, rubber and brushed metal samples for the freight drone atlas."""
from pathlib import Path
from random import Random
from math import sin
from PIL import Image

HERE = Path(__file__).parent
SWATCHES = [
    ((44, 53, 59), 120, 165), ((68, 80, 84), 126, 130), ((130, 140, 139), 100, 205),
    ((205, 207, 187), 153, 57), ((236, 231, 210), 137, 56), ((30, 70, 79), 63, 195),
    ((210, 95, 35), 133, 75), ((240, 174, 64), 134, 59), ((113, 210, 221), 60, 125),
    ((34, 35, 40), 218, 7), ((197, 50, 41), 111, 69),
]
side = 256
base, normal, orm = [Image.new("RGB", (side, side)) for _ in range(3)]
rng = Random(902)
for index, (color, rough, metal) in enumerate(SWATCHES):
    ox, oy = index % 4 * 64, index // 4 * 64
    scratch = {rng.randrange(5, 59): (rng.randrange(4, 27), rng.randrange(36, 61)) for _ in range(4)}
    for y in range(64):
        brushed = (rng.random() - .5) * (8 if metal > 100 else 2)
        for x in range(64):
            p = (ox + x, oy + y)
            wear = int(y in scratch and scratch[y][0] < x < scratch[y][1] and rng.random() > .16)
            grain = rng.gauss(0, 2.1) + brushed + .9 * sin(x / 12 + y / 5)
            edge = max(0, 1 - min(x, 63-x, y, 63-y) / 5)
            base.putpixel(p, tuple(round(max(0, min(255, c + grain + (7 if metal < 150 else 13)*wear - 7*edge))) for c in color))
            normal.putpixel(p, (int(128+rng.gauss(0,1.6)), int(128+brushed*.6+wear*9), 255))
            orm.putpixel(p, (int(251-edge*12), int(max(0,min(255,rough+grain*1.3+wear*14))), int(min(255,metal+wear*16))))
for name, image in [('base',base),('normal',normal),('finish',orm)]:
    image.save(HERE / (name + '.png'), optimize=True)
