# Draws the masonry and flagstone patterns of ../layout.py, every stone with its
# own shape, as the pictures the texture jobs are painted to: run with python3
# from this folder.
#
#   <material>/layout/cells.png    each stone's footprint a colour of its own, mortar black
#   <material>/layout/faces.png    the same with each stone's face (inside its bevel) drawn lighter
#   <material>/layout/layout.json  every stone's footprint, face and rise in metres and pixels

import colorsys
import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.dont_write_bytecode = True
import layout  # noqa: E402

SIZE = 2048
PX = SIZE / layout.TILE


def draw(name, stones, look_of, note):
    folder = os.path.join(HERE, name, "layout")
    os.makedirs(folder, exist_ok=True)
    cells = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    faces = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    dc, df = ImageDraw.Draw(cells), ImageDraw.Draw(faces)
    records = []
    for i, s in enumerate(stones):
        # Hues spread by the golden angle, so neighbours never look alike.
        r, g, b = colorsys.hsv_to_rgb((i * 0.618034) % 1.0, 0.55 + 0.4 * ((i * 7) % 3) / 2, 0.6 + 0.35 * ((i * 5) % 4) / 3)
        colour = (round(r * 255), round(g * 255), round(b * 255))
        look = look_of(s)
        ring = layout.face_ring(s["footprint"], s["chips"], look["bevel"])
        for du in (-layout.TILE, 0.0, layout.TILE):
            dc.polygon([((u + du) * PX, v * PX) for u, v in s["outline"]], fill=colour)
            df.polygon([((u + du) * PX, v * PX) for u, v in s["outline"]], fill=tuple(c // 2 for c in colour))
            df.polygon([((u + du) * PX, v * PX) for u, v in ring], fill=colour)
        records.append({
            "name": s["name"],
            "id_colour": list(colour),
            "footprint_metres": [[round(u, 4), round(v, 4)] for u, v in s["outline"]],
            "footprint_pixels": [[round(u * PX, 2), round(v * PX, 2)] for u, v in s["outline"]],
            "face_metres": [[round(u, 4), round(v, 4)] for u, v in ring],
            "face_pixels": [[round(u * PX, 2), round(v * PX, 2)] for u, v in ring],
            "face_rise_mm_at_corners": [round(h * 1000, 1) for h in look["rise"]],
            "crown_mm": round(look["crown"] * 1000, 1),
            "crown_at_metres": None if look["crown"] == 0 else [round(c, 4) for c in crown_at(s, look)],
        })
    cells.save(os.path.join(folder, "cells.png"))
    faces.save(os.path.join(folder, "faces.png"))
    with open(os.path.join(folder, "layout.json"), "w") as f:
        json.dump({"tile_metres": layout.TILE, "pixels": SIZE, "pixels_per_metre": PX, "about": note, "stones": records}, f, indent=1)
    print(f"{name}: {len(stones)} stones")


def crown_at(s, look):
    us = [p[0] for p in s["footprint"]]
    vs = [p[1] for p in s["footprint"]]
    return (min(us) + (max(us) - min(us)) * look["at"][0], min(vs) + (max(vs) - min(vs)) * look["at"][1])


def flag_look(s):
    # As model.py lays a flag: level, a few millimetres out of true, no crown.
    import random
    import zlib

    r = random.Random(zlib.crc32(("flag rise/" + s["name"]).encode()))
    rise = r.uniform(0.009, 0.012)
    return {"rise": [rise - r.uniform(0.0, 0.0015) for _ in range(4)], "bevel": [r.uniform(*layout.FLAG_BEVEL) for _ in range(4)], "crown": 0.0, "at": (0.5, 0.5)}


draw(
    "masonry",
    layout.masonry_stones(),
    layout.face,
    "u runs right, v runs down from the top of a wall, metres. Each stone's footprint is where it meets the mortar, "
    "eight corners round, broken at its own corners; the mortar is everything outside the footprints, 40 mm behind the "
    "wall's face. Its face is the ring inside its bevel, standing out from the mortar by the rise at its corners, and "
    "crowned in the middle by the crown at the point given. A stone whose footprint passes u = 3 wraps round to the left edge.",
)
draw(
    "flags",
    layout.flag_stones(),
    flag_look,
    "u runs along x and v along z of a floor seen from above, metres. Each flag's footprint is where it meets the "
    "mortar, its face the ring inside its bevel, standing out from the mortar by the rise. Joints run along all four edges.",
)
