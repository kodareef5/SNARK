# A tree in the game beside its concept, at each distance it is judged from and at two hours: one sheet of rows, each
# the concept at the size the tree stands in the game's picture beside the game at ten in the morning and at five in
# the afternoon. The game's pictures come from gpu.ts. Not part of the build.
#
#   python3 beside.py <the gpu.ts folder> <out.jpg> <concept.png> x0,y0,x1,y1 <tree's foot y in the concept> <rows>
#
# The concept box is the tree in its painting, the foot its trunk's foot. Each row is view:tall, the gpu.ts view and
# how tall the tree stands in its pictures in pixels, so the concept is shown at that size; "under" rows take a box of
# their own from a second concept as view:x0/y0/x1/y1:file.

import os
import sys

from PIL import Image, ImageDraw

ROW = 360


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 8 + 6 * len(text), 14), fill=(20, 22, 26))
    d.text((4, 2), text, fill=(235, 235, 235))
    return im


def fit(im, h):
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def main():
    folder, out, concept, box, foot = sys.argv[1:6]
    rows = sys.argv[6:]
    art = Image.open(concept).convert("RGB")
    x0, y0, x1, y1 = (int(v) for v in box.split(","))
    tree = art.crop((x0, y0, x1, y1))
    tall_concept = int(foot) - y0
    sheet = []
    for row in rows:
        view, rest = row.split(":", 1)
        shots = [Image.open(os.path.join(folder, f"{view}-{h}.png")).convert("RGB") for h in (10, 17)]
        if "/" in rest:
            bx, by, bx1, by1, other = rest.split("/")
            ref = Image.open(other).convert("RGB").crop((int(bx), int(by), int(bx1), int(by1)))
            left = fit(ref, ROW)
            name = f"concept, {os.path.basename(other)}"
        else:
            # The concept at the size the tree stands in the game's picture, on the game's sky, in a frame as tall.
            k = int(rest) / tall_concept
            small = tree.resize((max(1, round(tree.width * k)), max(1, round(tree.height * k))), Image.LANCZOS)
            h = shots[0].height
            frame = Image.new("RGB", (max(small.width + 40, shots[0].width // 2), h), (150, 185, 225))
            frame.paste(small, ((frame.width - small.width) // 2, max(0, h - small.height - 40)))
            left = fit(frame, ROW)
            name = "concept at the game's size"
        cells = [label(left, name)] + [label(fit(s, ROW), f"{view}, {h}:00, game GPU medium") for s, h in zip(shots, (10, 17))]
        w = sum(c.width for c in cells) + 4 * (len(cells) - 1)
        line = Image.new("RGB", (w, ROW), (20, 22, 26))
        x = 0
        for c in cells:
            line.paste(c, (x, 0))
            x += c.width + 4
        sheet.append(line)
    w = max(l.width for l in sheet)
    img = Image.new("RGB", (w, sum(l.height for l in sheet) + 4 * (len(sheet) - 1)), (20, 22, 26))
    y = 0
    for l in sheet:
        img.paste(l, (0, y))
        y += l.height + 4
    img.save(out, quality=90)
    print(out, img.size)


if __name__ == "__main__":
    main()
