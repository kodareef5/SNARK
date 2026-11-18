"""Puts the pictures look.sh draws together into the review pages kept in tex/look/.

    bash tex/paint/look.sh OUT --maps && bash tex/paint/look.sh OUT_STAGES --maps --stages
    python3 tex/paint/sheet.py OUT OUT_STAGES

Writes tex/look/animal.jpg (the animal in its dyes, near and far), saddled.jpg (with its saddle, from the rider's seat
and around), sizes.png (from below at 20, 60, 150 and 400 m, at that size and enlarged) and stages.jpg (hurt and decay,
every stage, from several sides).
"""

import os
import site
import sys

site.addsitedir(site.getusersitepackages())

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "look")


def grid(folder, names, columns, cell, path):
    rows = (len(names) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell[0], rows * (cell[1] + 22)), (232, 232, 230))
    draw = ImageDraw.Draw(sheet)
    for k, name in enumerate(names):
        x, y = (k % columns) * cell[0], (k // columns) * (cell[1] + 22)
        im = Image.open(os.path.join(folder, name + ".png")).convert("RGB").resize(cell, Image.LANCZOS)
        sheet.paste(im, (x, y + 22))
        draw.text((x + 6, y + 5), name.replace("_", " "), fill=(40, 40, 40))
    sheet.save(path, quality=90)
    print(path)


def stack(folder, names, path):
    ims = [Image.open(os.path.join(folder, n + ".png")).convert("RGB") for n in names]
    sheet = Image.new("RGB", (max(i.width for i in ims), sum(i.height + 22 for i in ims)), (232, 232, 230))
    draw = ImageDraw.Draw(sheet)
    y = 0
    for n, im in zip(names, ims):
        draw.text((8, y + 5), n.replace("stages_", "").replace("_", " ") + ": unhurt, hurt 1, 2, 3 (a fresh corpse), decay 1, 2, 3", fill=(40, 40, 40))
        sheet.paste(im, (0, y + 22))
        y += im.height + 22
    sheet.save(path, quality=90)
    print(path)


def main():
    look, stages = sys.argv[1], sys.argv[2]
    os.makedirs(OUT, exist_ok=True)
    grid(look, ["three_quarter_design", "below_design", "above_design", "side_design", "head_design", "head_front_design",
                "rider_design", "inner_wing_design", "under_wing_design", "feet_design", "three_quarter_loud", "three_quarter_dark",
                "head_loud", "head_dark", "rider_loud", "rider_dark"], 4, (600, 450), os.path.join(OUT, "animal.jpg"))
    grid(look, ["saddled_rider_design", "saddled_seat_design", "saddled_side_design", "saddled_front_design",
                "saddled_rider_loud", "saddled_rider_dark"], 3, (600, 450), os.path.join(OUT, "saddled.jpg"))
    Image.open(os.path.join(look, "sizes_design.png")).save(os.path.join(OUT, "sizes.png"))
    stack(stages, ["stages_three_quarter_design", "stages_under_wing_design", "stages_above_design", "stages_side_design",
                   "stages_head_design", "stages_inner_wing_design", "stages_rider_design", "stages_three_quarter_dark",
                   "stages_side_loud"], os.path.join(OUT, "stages.jpg"))


if __name__ == "__main__":
    main()
