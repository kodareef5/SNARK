"""Make the screen props' pictures.

    python3 tex.py

The four Poly Haven models' 1k maps are laid unchanged in the quarters of one 2k set, "kit" (tex/kit_base.png, _normal.png
and _orm.png), each where model.py's KIT puts its texture coordinates: the tube TV top left, the laptop top right, the
desk bottom left and the console bottom right. Their "arm" map is occlusion, roughness and metalness, the order the game's
packed map takes. Three more sets are painted here, the same on every run: "panel", gloss black plastic for the flat TVs; "alu", brushed dark aluminium for their
stands and brackets; and "cracked", a smashed screen for every broken form.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
OUT = HERE / "tex"
# Each source's quarter of the kit, in pixels from the top left.
KIT = {"television_02": (0, 0), "classic_laptop": (1024, 0), "metal_office_desk": (0, 1024), "vintage_spacecraft_instrument": (1024, 1024)}
rng = np.random.default_rng(41)


def save(pixels, name):
    Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8)).save(OUT / f"{name}.png", optimize=True)


def streaks(side, along):
    """Noise smeared along one axis: the grain of brushed metal or moulded plastic."""
    noise = rng.normal(0, 1, (side, side))
    kernel = np.ones(along) / along
    noise = np.apply_along_axis(lambda row: np.convolve(np.concatenate((row[-along:], row, row[:along])), kernel, "same")[along:-along], 1, noise)
    return (noise - noise.mean()) / noise.std()


def plain(name, colour, rough, metal, grain, along):
    side = 256
    g = streaks(side, along)
    base = np.stack([np.full((side, side), c, float) + g * grain for c in colour], -1)
    orm = np.stack([np.full((side, side), 255.0), np.full((side, side), rough * 255) + g * 6, np.full((side, side), metal * 255)], -1)
    save(base, f"{name}_base")
    save(orm, f"{name}_orm")


def cracked():
    """Black glass struck once a little off its middle: cracks out from the blow, rings round it, a dead bleed."""
    side = 512
    img = Image.new("RGB", (side, side), (10, 11, 14))
    d = ImageDraw.Draw(img)
    # A few columns of dead pixels, as a struck panel shows.
    for x in rng.integers(0, side, 5):
        d.line([(int(x), 0), (int(x), side)], fill=tuple(int(v) for v in rng.integers(30, 90, 3)), width=int(rng.integers(1, 3)))
    cx, cy = side * 0.58, side * 0.44
    # Rays from the blow, each a jagged walk to the edge.
    for k in range(17):
        a = k / 17 * 2 * np.pi + rng.uniform(-0.12, 0.12)
        x, y = cx, cy
        pts = [(x, y)]
        while 0 <= x < side and 0 <= y < side:
            a += rng.uniform(-0.25, 0.25)
            step = rng.uniform(14, 34)
            x, y = x + np.cos(a) * step, y + np.sin(a) * step
            pts.append((x, y))
        d.line(pts, fill=(150, 156, 164), width=1 if k % 3 else 2)
    # Rings of short chords round it.
    for r in (26, 58, 104, 170):
        n = int(r / 5)
        ring = [(cx + np.cos(k / n * 2 * np.pi) * r * rng.uniform(0.9, 1.1), cy + np.sin(k / n * 2 * np.pi) * r * rng.uniform(0.9, 1.1)) for k in range(n)]
        for k in range(n):
            if rng.random() < 0.35:
                continue
            d.line([ring[k], ring[(k + 1) % n]], fill=(120, 126, 134), width=1)
    # The crushed spot itself, pale with powdered glass.
    d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], fill=(170, 172, 176))
    img = img.filter(ImageFilter.SMOOTH)
    base = np.asarray(img).astype(float)
    save(base, "cracked_base")
    orm = np.zeros((side, side, 3))
    orm[..., 0] = 255
    # Glass is glossy; the cracks are rough.
    orm[..., 1] = 30 + (base.mean(-1) > 60) * 150
    save(orm, "cracked_orm")


OUT.mkdir(exist_ok=True)
for role, suffix in (("base", "diff"), ("normal", "nor_gl"), ("orm", "arm")):
    kit = Image.new("RGB", (2048, 2048))
    for source, at in KIT.items():
        kit.paste(Image.open(HERE / "polyhaven" / source / "textures" / f"{source}_{suffix}_1k.jpg").convert("RGB"), at)
    kit.save(OUT / f"kit_{role}.png", optimize=True)
plain("panel", (14, 14, 16), 0.28, 0.0, 1.2, 64)
plain("alu", (62, 63, 66), 0.42, 0.85, 7, 96)
cracked()
