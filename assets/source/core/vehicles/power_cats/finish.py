"""One set of marine finishes shared by both sizes of boat. Swatches are in image row order."""

import math
from pathlib import Path
import random

# Each finish has its base sRGB, roughness and metalness.
FINISH = {
    "shell": ((210, 214, 216), 65, 17),
    "stripe": ((215, 215, 215), 55, 12),
    "gel": ((237, 235, 225), 72, 8),
    "under": ((31, 51, 65), 163, 12),
    "teak": ((169, 120, 77), 149, 1),
    "seat": ((203, 202, 195), 145, 0),
    "piping": ((225, 214, 186), 140, 0),
    "metal": ((182, 197, 205), 49, 210),
    "rubber": ((39, 46, 49), 170, 8),
    "glass": ((40, 76, 90), 35, 84),
    "carbon": ((42, 52, 59), 92, 37),
    "screen": ((18, 40, 47), 69, 40),
    "bronze": ((161, 123, 66), 85, 180),
    "red": ((230, 53, 38), 64, 10),
    "green": ((55, 180, 122), 60, 10),
    "vent": ((45, 55, 62), 111, 80),
}
SWATCH = {k: (i % 4, i // 4) for i, k in enumerate(FINISH)}


CHARTS = {"chart": (.04,.07,.47,.86), "sonar": (.55,.07,.41,.86)}


def bake():
    from PIL import Image, ImageDraw, ImageFilter
    folder = Path(__file__).with_name("tex")
    side, tile = 512, 128
    base = Image.new("RGB", (side, side))
    finish = Image.new("RGB", base.size)
    height = Image.new("L", base.size, 128)
    normal = Image.new("RGB", base.size, (128, 128, 255))
    mask = Image.new("RGB", base.size)
    hurt = Image.new("RGBA", base.size)
    decay = Image.new("RGBA", base.size)
    rng = random.Random(27122)
    for name, (rgb, rough, metal) in FINISH.items():
        col, row = SWATCH[name]
        x0, y0 = col * tile, row * tile
        dye = {"shell": (255, 0, 0), "stripe": (0, 255, 0), "seat": (0, 0, 255)}.get(name, (0, 0, 0))
        mask.paste(dye, (x0, y0, x0 + tile, y0 + tile))
        for py in range(tile):
            for px in range(tile):
                x, y = x0 + px, y0 + py
                u, v = px / tile, py / tile
                noise = rng.uniform(-1, 1)
                tone, relief = noise * 2, 0.
                if name == "glass":
                    tone += 34 * (1 - v) ** 3 - 11 * v + 14 * math.exp(-((v - .37 - .18*u)/.10)**2)
                elif name == "teak":
                    plank = px // 6
                    seam = px % 6 == 0 or (py + (plank % 3)*41) % 124 < 1
                    grain = math.sin(px*2.4 + math.sin(v*9)*.35 + plank)
                    tone = -28 if seam else (plank % 5 - 2)*3 + grain*6 + noise*4
                    relief = -17 if seam else grain*2
                elif name == "seat":
                    edge = min(px, tile - px, py, tile - py)
                    stitch = 12 < edge < 15 and (px + py) % 9 > 3
                    tone += 11 if stitch else 5*math.sin(u*math.pi)*math.sin(v*math.pi) + 4*noise
                    relief = 2*noise + (7 if stitch else 0)
                elif name == "carbon":
                    tone += 3 * (((px//3 + py//2) % 2)*2 - 1)
                elif name == "metal":
                    tone += 12 * (1-v) + 3*math.sin(py*1.9) + 3*noise
                elif name == "vent":
                    tone += -19 if py % 13 < 7 else 8
                    relief = -8 if py % 13 < 7 else 3
                elif name in ("shell", "gel", "stripe", "under"):
                    tone += 7*(.5-v) + 2*math.sin(u*math.pi)
                base.putpixel((x,y), tuple(min(255,max(0,round(c+tone))) for c in rgb))
                finish.putpixel((x,y), (255, min(255,round(rough + noise*3)), metal))
                height.putpixel((x,y), round(128 + relief))
        if name == "screen":
            d = ImageDraw.Draw(base)
            for i in range(12, 118, 10):
                d.line([(x0+i,y0+17),(x0+i,y0+113)], fill=(30,57,62))
                d.line([(x0+12,y0+i),(x0+115,y0+i)], fill=(30,57,62))
            for i in range(4):
                pts = [(9,25+i*4),(24,35+i*5),(28+i*2,52+i),(44+i*3,64+i*3),(47+i*2,77+i*3),(41+i,112)]
                d.line([(x0+a,y0+b) for a,b in pts], fill=(57,127+i*14,139),width=2)
            d.line([(x0+22,y0+94),(x0+51,y0+56),(x0+43,y0+28)], fill=(225,184,102),width=3)
            d.polygon([(x0+24,y0+84),(x0+28,y0+103),(x0+16,y0+98)],fill=(245,245,213))
            d.rectangle((x0+7,y0+10,x0+62,y0+17),fill=(111,187,180))
            d.rectangle((x0+67,y0+5,x0+124,y0+123),fill=(22,42,60))
            for band in range(6):
                pts=[(x0+x,y0+int(66+13*math.sin(x*.105)+band*4+5*math.sin(x*.29))) for x in range(70,123)]
                d.line(pts,fill=(226-band*21,117+band*4,48+band*10),width=3)
            for y in (22,41,60,79,98):
                d.line([(x0+72,y0+y),(x0+121,y0+y)],fill=(56,92,103))
            d.rectangle((x0+71,y0+10,x0+121,y0+17),fill=(212,165,85))
        # Gelcoat crazing and impacts expose the laminate. Salt bloom, oxidation and marine staining build separately.
        if name in ("shell","stripe","gel","under","metal","carbon","teak","seat","glass"):
            for layer, count in ((hurt, 21),(decay, 28)):
                patch = Image.new("RGBA", (tile,tile))
                draw = ImageDraw.Draw(patch)
                for k in range(count):
                    x, y = rng.randrange(7,116), rng.randrange(8,116)
                    a = (230,135,60)[k%3]
                    if layer is hurt:
                        tint = (106,105,96,a) if name != "glass" else (202,226,223,a)
                        draw.line([(x,y),(x+5,y-1),(x+rng.randint(7,20),y+rng.randint(-6,5))],fill=tint,width=rng.choice([1,2,3]))
                        if k%3==0:
                            draw.line([(x+4,y),(x+7,y+5),(x+12,y+7)],fill=tint,width=1)
                    else:
                        tint = (66,85,66,a) if name in ("shell","under","teak") else (144,119,87,a)
                        for j in range(12):
                            dx,dy=rng.gauss(0,3),rng.gauss(0,6)
                            draw.ellipse((x+dx,y+dy,x+dx+2,y+dy+3),fill=tint)
                layer.paste(patch,(x0,y0))
    # UV islands are inset by over five pixels. Match the atlas gutter on the outer boundary at every edge.
    for picture, value in ((base,(106,111,114)),(finish,(255,124,35)),(height,128)):
        ImageDraw.Draw(picture).rectangle((0,0,side-1,side-1),outline=value,width=3)
    # The packed stage map stores either exposed damage or later oxidation per texel.
    for y in range(side):
        for x in range(side):
            if hurt.getpixel((x,y))[3]:
                decay.putpixel((x,y),(0,0,0,0))
    blur = height.filter(ImageFilter.GaussianBlur(.6))
    for y in range(side):
        for x in range(side):
            dx = (blur.getpixel(((x+1)%side,y))-blur.getpixel(((x-1)%side,y)))/50
            dy = (blur.getpixel((x,(y+1)%side))-blur.getpixel((x,(y-1)%side)))/50
            denom = math.sqrt(1+dx*dx+dy*dy)
            normal.putpixel((x,y),tuple(round(127.5+127.5*c/denom) for c in (-dx,dy,1)))
    for file,img in (("base",base),("normal",normal),("height",height),("finish",finish),("regions",mask),("hurt",hurt),("decay",decay)):
        img.save(folder / (file+".png"))


if __name__ == "__main__":
    bake()
