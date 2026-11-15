"""Summarize the supplied game-renderer sheets; no synthetic bird renderer.

Run after `bun tex/layers/look.ts --out tex/layers/look`.
The baseline directory, if present, holds the engine-test-layer renders taken
before painting. Only its unhurt column is used for the identity comparison.
"""
from pathlib import Path
import hashlib
import json
import site
import struct

site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
TEX = ROOT.parent
DYES = ("default", "loud", "dark")
VIEWS = ("front_left", "side", "back_right", "head", "back", "legs")
STAGES = ("UNHURT", "HURT 1", "HURT 2", "HURT 3 / FRESH", "DECAY 1", "DECAY 2", "DECAY 3")


def chunks(path):
    data = path.read_bytes()
    i, found = 8, {}
    while i < len(data):
        size = struct.unpack(">I", data[i:i+4])[0]
        name = data[i+4:i+8].decode("ascii")
        found[name] = data[i+8:i+8+size]
        i += 12 + size
    return found


def labels(canvas, side, y, title, font):
    d = ImageDraw.Draw(canvas)
    d.text((8,y+2),title,fill=(52,49,44),font=font)
    for k, name in enumerate(STAGES):
        d.text((8+k*(side+8),y+24),name,fill=(52,49,44),font=font)


def main():
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
    facts = {}
    for prefix, size in (("dodo",1024),("dodo_cards",256)):
        paths = [TEX / f"{prefix}_{layer}.png" for layer in ("hurt","decay")]
        arrays = [np.array(Image.open(p)) for p in paths]
        overlap = int(((arrays[0][...,3]>0)&(arrays[1][...,3]>0)).sum())
        assert overlap == 0
        facts[prefix] = dict(overlap_texels=overlap,files={})
        for p, a in zip(paths, arrays):
            png = chunks(p)
            assert a.shape == (size,size,4) and a.dtype == np.uint8
            assert png["IHDR"][8:10] == bytes((8,6)) and "sRGB" in png
            facts[prefix]["files"][p.name] = dict(size=size,depth=8,mode="RGBA",srgb=True,
                    alpha_values=int(len(np.unique(a[...,3]))),
                    sha256=hashlib.sha256(p.read_bytes()).hexdigest())
    rendered = {}
    # One sheet per dye, all six views. Captions are outside renderer pixels.
    for dye in DYES:
        pictures = [Image.open(ROOT/"look"/f"stages_{v}_{dye}.png").convert("RGB") for v in VIEWS]
        sheet = Image.new("RGB",(2164,sum(p.height+51 for p in pictures)),(233,230,224))
        y = 0
        for view, picture in zip(VIEWS,pictures):
            side = 280 if view in ("head","back","legs") else 300
            labels(sheet,side,y,f"{dye.upper()} / {view.replace('_',' ')}",font)
            y += 51
            sheet.paste(picture,(0,y)); y += picture.height
            baseline = ROOT/"baseline"/f"stages_{view}_{dye}.png"
            if baseline.exists():
                old = np.array(Image.open(baseline).convert("RGB"))[8:side+8,8:side+8]
                new = np.array(picture)[8:side+8,8:side+8]
                difference = int(np.abs(old.astype(int)-new.astype(int)).max())
                assert difference == 0, f"Changed unhurt view: {view}/{dye}"
                rendered[f"{view}/{dye}"] = dict(unhurt_max_channel_difference=difference)
        sheet.save(ROOT/"look"/f"review_{dye}.jpg",quality=95,subsampling=0)
    # Three dye rows at native 2 m / 10 m size and nearest-neighbour enlargement.
    sizes = [Image.open(ROOT/"look"/f"sizes_{d}.png").convert("RGB") for d in DYES]
    sheet = Image.new("RGB",(max(p.width for p in sizes),sum(p.height+51 for p in sizes)),(233,230,224))
    y = 0
    for dye, picture in zip(DYES,sizes):
        labels(sheet,252,y,f"{dye.upper()} / 2 m, 10 m, 10 m enlarged 5x",font)
        y += 51; sheet.paste(picture,(0,y)); y += picture.height
        a = np.array(picture)
        # The actual 2 m renderer row, not a rescaled closeup.
        previous = a[8:260,8:260].astype(int)
        changed = []
        for k in range(1,7):
            current = a[8:260,8+k*260:260+k*260].astype(int)
            changed.append(int(np.sum(np.max(abs(current-previous),axis=-1)>8)))
            previous = current
        rendered[f"2m_adjacent_stage_pixel_changes/{dye}"] = changed
    sheet.save(ROOT/"REVIEW.jpg",quality=95,subsampling=0)
    (ROOT/"checks/verification.json").write_text(json.dumps(dict(textures=facts,renderer=rendered),indent=2)+"\n")
    print("Four RGBA8/sRGB maps verified; both overlap counts zero.")
    print(f"Unhurt pixel identity checked in {len([k for k in rendered if not k.startswith('2m')])} views.")
    print(ROOT/"REVIEW.jpg")


if __name__ == "__main__":
    main()
