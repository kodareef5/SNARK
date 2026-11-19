"""Puts the street atlases together from their painted parts, the ones asset.ts names in tex/:

    python3 -I paint.py

Each part (layout.json) was painted on its own, in tex/parts/<name>/ (a see-through one in tex/parts/cut_<name>/): its
base colour, height, roughness, metal and occlusion, at its size in the atlas, and tex/parts/parts.json gives each
height's range in millimetres. Here each is set in its place, a strip's gutters copying its own edge rows so a coarser
step of the picture does not take in its neighbour; each normal is made from its own height at its own scale (a strip
is 512 pixels a metre, a part its picture's width over its width in the world); and the packed map holds occlusion,
roughness and metal in red, green and blue, at half the base colour's side. A part not painted yet is laid in one flat
colour, so the meshes can be built and looked at before the pictures come. A working lamp's lens is a picture of its
own (tex/glow_base.png, from tex/parts/lens_lit), the base colour of the material that glows (asset.ts `emissive`), its
alpha whole.
"""

import json
import os
import site
import sys

site.addsitedir(site.getusersitepackages())

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "tex")
PARTS = os.path.join(TEX, "parts")
LAYOUT = json.load(open(os.path.join(HERE, "layout.json")))
SCALES = json.load(open(os.path.join(PARTS, "parts.json"))) if os.path.exists(os.path.join(PARTS, "parts.json")) else {}

# The glowing lens's picture: square, as a texture is; the lens is wider than long, and lays it so.
GLOW_SIZE = (128, 128)

# The colour a part is laid in until it is painted, as sRGB: the strips' means as their briefs give them.
FLAT = {"galvanised": (138, 141, 140), "green": (88, 104, 90), "yellow": (178, 158, 92), "red": (150, 76, 64), "blue": (62, 84, 118),
        "rust": (112, 66, 44), "wood": (96, 82, 66), "concrete": (150, 146, 136), "stop": (170, 70, 66), "speed": (210, 206, 192),
        "evacuation": (60, 84, 120), "arrow": (60, 84, 120), "fence": (150, 150, 146), "billboard": (170, 160, 140), "glass": (170, 180, 182)}


def read(folder, layer, w, h, depth=8):
    path = os.path.join(folder, f"{layer}.png")
    if not os.path.exists(path):
        return None
    im = Image.open(path)
    if (im.width, im.height) != (w, h):
        raise SystemExit(f"{path} is {im.width} by {im.height}, and its part is {w} by {h}")
    a = np.asarray(im)
    if layer == "height":
        return a.astype(np.float64) / (65535.0 if a.dtype == np.uint16 or a.max() > 255 else 255.0)
    return a


def part(name, w, h, cut=False):
    """A part's layers as floats: base colour (RGB, or RGBA where `cut`), height in mm, roughness, metal, occlusion."""
    folder = os.path.join(PARTS, ("cut_" if cut else "") + name)
    base = read(folder, "base", w, h)
    if base is None:
        colour = FLAT.get(name, (128, 128, 128))
        base = np.zeros((h, w, 4 if cut else 3), np.uint8)
        base[..., :3] = colour
        if cut:
            base[..., 3] = 255 if name != "spare" else 0
        return base, np.zeros((h, w)), np.full((h, w), 200.0), np.zeros((h, w)), np.full((h, w), 255.0)
    if cut and base.shape[2] == 3:
        raise SystemExit(f"{folder}/base.png has no alpha")
    base = base[..., :4] if cut else base[..., :3]
    mm = SCALES.get(("cut_" if cut else "") + name, SCALES.get(name, {})).get("height_mm", 2.0)
    height = read(folder, "height", w, h)
    rough = read(folder, "roughness", w, h)
    metal = read(folder, "metal", w, h)
    occl = read(folder, "occlusion", w, h)
    grey = lambda a, d: np.full((h, w), d) if a is None else (a[..., 0] if a.ndim == 3 else a).astype(np.float64)
    return base, (np.zeros((h, w)) if height is None else height * mm), grey(rough, 200.0), grey(metal, 0.0), grey(occl, 255.0)


def normal(height_mm, mm_per_px, wrap):
    """Tangent-space normals from a height in millimetres, green up the picture."""
    if wrap:
        dx = (np.roll(height_mm, -1, 1) - np.roll(height_mm, 1, 1)) / (2 * mm_per_px)
    else:
        dx = np.gradient(height_mm, axis=1) / mm_per_px
    drow = np.gradient(height_mm, axis=0) / mm_per_px
    n = np.dstack([-dx, drow, np.ones_like(dx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n


def atlas(key, cut):
    a = LAYOUT[key]
    side = a["side"]
    channels = 4 if cut else 3
    base = np.zeros((side, side, channels), np.uint8)
    nrm = np.zeros((side, side, 3))
    nrm[..., 2] = 1
    height = np.zeros((side, side))
    rough = np.full((side, side), 200.0)
    metal = np.zeros((side, side))
    occl = np.full((side, side), 255.0)

    def put(x, y, layers, mm_per_px, wrap):
        b, hgt, r, m, o = layers
        h, w = hgt.shape
        base[y:y + h, x:x + w] = b
        nrm[y:y + h, x:x + w] = normal(hgt, mm_per_px, wrap)
        height[y:y + h, x:x + w] = hgt
        rough[y:y + h, x:x + w] = r
        metal[y:y + h, x:x + w] = m
        occl[y:y + h, x:x + w] = o

    for k, name in enumerate(a.get("strips", [])):
        g, top = a["gutter"], k * a["strip"]
        rows = a["strip"] - 2 * g
        layers = part(name, side, rows)
        put(0, top + g, layers, 1000 * a["tiles"] / side, True)
        for arr in (base, nrm, height, rough, metal, occl):
            arr[top:top + g] = arr[top + g]
            arr[top + a["strip"] - g:top + a["strip"]] = arr[top + a["strip"] - g - 1]
    for name, (x, y, w, h) in a["parts"].items():
        put(x, y, part(name, w, h, cut), 1000 * a["metres"][name] / w, cut and name == "fence")
    return base, nrm, height, rough, metal, occl


def save(prefix, layers, cut):
    base, nrm, height, rough, metal, occl = layers
    side = base.shape[0]
    Image.fromarray(base, "RGBA" if cut else "RGB").save(os.path.join(TEX, f"{prefix}_base.png"))
    Image.fromarray(np.round((nrm * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(TEX, f"{prefix}_normal.png"))
    span = max(1e-6, height.max() - height.min())
    Image.fromarray(np.round((height - height.min()) / span * 65535).astype(np.uint16)).save(os.path.join(TEX, f"{prefix}_height.png"))
    packed = np.dstack([occl, rough, metal]).clip(0, 255).astype(np.uint8)
    Image.fromarray(packed).resize((side // 2, side // 2), Image.BOX).save(os.path.join(TEX, f"{prefix}_packed.png"))


if __name__ == "__main__":
    os.makedirs(TEX, exist_ok=True)
    save("street", atlas("street", False), False)
    save("cut", atlas("cut", True), True)
    lens = Image.open(os.path.join(PARTS, "lens_lit", "base.png")).convert("RGB").resize(GLOW_SIZE, Image.LANCZOS)
    lens.putalpha(255)
    lens.save(os.path.join(TEX, "glow_base.png"))
    print("paint: tex/street_* and tex/cut_* written")
