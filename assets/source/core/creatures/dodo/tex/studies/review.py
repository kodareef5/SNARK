"""Draws a review sheet of each set of the dodo's material studies: the layers, the set relit and dyed at full size,
at the bird's density, and at the size it covers when the bird is 200 and 50 pixels tall, and a sweep of the design's
colour set. Writes <study>/checks/review_<set>.jpg.

    python3 -I review.py [study ...]
"""

import json
import os
import site
import sys

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure import HERE, NAMES, REGION_RGB, STUDIES, read, regions_of, tiling, to_linear

# The design's colour set (ref/DESIGN.md), as the tones each region rolls, the default first.
COLOURS = [
    ["777A81", "65686F", "8A8780", "534437", "AB9073", "81442D", "6F6D53", "413D37", "BDA285", "CBC9AF"],
    ["DDA089", "E8B6A3", "D4B380", "F3E5D0", "CFC997", "AFA093"],
    ["989260", "B4A37C", "52565C", "2D3138", "614629", "736D3B", "6E321C"],
    ["C49C58", "AA7C30", "A6A152", "B0602C", "867F4E", "65686F", "B48E7C"],
    ["413225", "2E2B24", "6A4532", "534437", "52565C", "8A8780", "E6E3DC"],
    ["DDDBC1", "D9C8A1", "D4D1CA", "945640", "BDB685", "AEB2B8", "2E2B24"],
]
WORST = ["FF3EA5", "9FE01F", "9FE01F", "FF3EA5", "9FE01F", "9FE01F"]
# Where each set shows in our concept pictures: the picture, the centre of a crop, and the picture's pixels a metre.
# side.png and its siblings are 1500 a metre; head_side.png is about 4500.
CONCEPT = {
    "body_plain": ("side.png", 560, 850, 1500), "body_barred": ("top.png", 625, 735, 1500), "body_tips": ("side.png", 900, 700, 1500),
    "trousers": ("side.png", 600, 935, 1500), "trousers_fringe": ("side.png", 600, 960, 1500),
    "cap": ("head_side.png", 1000, 300, 4500), "mane": ("head_side.png", 1330, 700, 4500), "cap_to_mane": ("head_side.png", 1250, 500, 4500), "hood_cards": ("head_side.png", 1100, 450, 4500),
    "skin": ("head_side.png", 800, 520, 4500), "folds": ("head_side.png", 860, 520, 4500), "brow": ("head_side.png", 900, 345, 4500), "pouch": ("head_side.png", 750, 760, 4500),
    "horn": ("head_side.png", 420, 500, 4500), "beak_side": ("head_side.png", 440, 520, 4500),
    "shank": ("side.png", 635, 1040, 1500), "toe": ("side.png", 600, 1120, 1500), "claw": ("side.png", 715, 1130, 1500),
    "eye": ("head_side.png", 880, 440, 4500), "lid": ("head_side.png", 880, 420, 4500),
    "quills": ("side.png", 930, 560, 1500),
}
# Texels a metre each surface gets on the bird (tex/studies/COMMON.md), and where to take the 1:1 crop, as fractions.
BIRD_PPM = {"body": 2400, "trousers": 2400, "cap": 3600, "mane": 3600, "hood": 3600, "skin": 5000, "folds": 5000, "lid": 5000,
            "eye": 5000, "brow": 4000, "pouch": 4000, "horn": 4000, "beak": 4000, "shank": 3000, "toe": 3000, "claw": 3000, "quills": 1500}
CROP = {"eye": (0.5, 0.82), "beak_side": (0.5, 0.75), "lid": (0.5, 0.75)}
CONCEPT_DIR =os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "ref", "concept")
NEAR_BLACK, NEAR_WHITE = "2E2B24", "E6E3DC"
GREY = 0.50
BIRD_HEIGHT_M = 0.65
P = 384


def hex_linear(h):
    return to_linear(np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float64) / 255.0)


def to_srgb(l):
    l = np.clip(l, 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)


def shrink(a, size):
    """Area mean down to `size` pixels a side, in linear light for colours."""
    if a.shape[0] == size:
        return a
    im = Image.fromarray(a.astype(np.float32)) if a.ndim == 2 else None
    if a.ndim == 2:
        return np.asarray(im.resize((size, size), Image.BOX), np.float64)
    return np.stack([np.asarray(Image.fromarray(a[..., c].astype(np.float32)).resize((size, size), Image.BOX), np.float64) for c in range(a.shape[-1])], -1)


def dye(albedo_lin, idx, colours):
    out = albedo_lin.copy()
    for r in range(6):
        m = idx == r
        if m.any():
            out[m] = albedo_lin[m] * hex_linear(colours[r]) / GREY
    return out


def light(albedo_lin, n, ao, rough, az, el):
    n = n * 2 - 1
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
    L = np.array([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)])
    H = L + np.array([0, 0, 1.0])
    H /= np.linalg.norm(H)
    ndl = np.clip((n * L).sum(-1), 0, 1)
    ndh = np.clip((n * H).sum(-1), 0, 1)
    shin = np.clip(2 / np.maximum(rough, 0.05) ** 4 - 2, 1, 2000)
    spec = 0.04 * ndh ** shin * (shin + 2) / 8 * ndl
    return albedo_lin * (0.28 * ao + 0.95 * ndl)[..., None] + spec[..., None] * ao[..., None]


def tile_to(a, size):
    reps = int(np.ceil(size / a.shape[0]))
    t = np.tile(a, (reps, reps) + (1,) * (a.ndim - 2))
    return t[:size, :size]


def panel(a, label, size=P):
    if a.ndim == 2:
        a = np.repeat(a[..., None], 3, -1)
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    if im.size[0] != size:
        im = im.resize((size, size), Image.NEAREST if im.size[0] < size else Image.BOX)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, len(label) * 6 + 6, 12), fill=(20, 20, 20))
    d.text((3, 1), label, fill=(240, 240, 240))
    return im


def review_set(folder, name, info):
    files = {k: os.path.join(folder, f"{name}_{k}.png") for k in ("base", "height", "normal", "packed", "regions")}
    if not all(os.path.exists(f) for f in files.values()):
        return None
    base = read(files["base"])[0]
    h = read(files["height"])[0]
    h = h if h.ndim == 2 else h[..., 0]
    n = read(files["normal"])[0][..., :3]
    pk = read(files["packed"])[0]
    reg8 = np.round(read(files["regions"])[0][..., :3] * 255).astype(np.uint8)
    idx, _ = regions_of(reg8)
    size = base.shape[0]
    alpha = base[..., 3] if base.shape[-1] == 4 else np.ones((size, size))
    albedo = to_linear(base[..., :3])
    ao, rough = pk[..., 0], pk[..., 1]
    used = [r for r in range(6) if (idx == r).any()]
    default = [c[0] for c in COLOURS]
    span = info.get("span_m", 0.427)
    tiles = any(tiling(info))
    cut = base.shape[-1] == 4
    bg = hex_linear("8C8A84")

    def shown(colours, az=np.radians(135), el=np.radians(45), sl=np.s_[:, :], scale=1):
        a, nn, o, r, i, al = albedo[sl], n[sl], ao[sl], rough[sl], idx[sl], alpha[sl]
        if scale > 1:
            s = a.shape[0] // scale
            a, o, r, al = shrink(a, s), shrink(o, s), shrink(r, s), shrink(al, s)
            nn = shrink(nn, s)
            i = i[::scale, ::scale]
        lit = light(dye(a, i, colours), nn, o, r, az, el)
        if cut:
            hard = (al >= 0.5)[..., None]
            lit = np.where(hard, lit, bg)
        return to_srgb(lit)

    rows = []
    hn = (h - h.min()) / max(h.max() - h.min(), 1e-9)
    regview = reg8 / 255.0
    rows.append([panel(base[..., :3] if not cut else np.where((alpha >= 0.5)[..., None], base[..., :3], 0.55), "base"), panel(hn, "height"), panel(n, "normal"),
                 panel(ao, "occlusion"), panel(rough, "roughness"), panel(regview, "regions")])
    fy, fx = CROP.get(name, (0.5, 0.5))
    cy0, cx0 = int(np.clip(size * fy - P // 2, 0, size - P)), int(np.clip(size * fx - P // 2, 0, size - P))
    crop = np.s_[cy0:cy0 + P, cx0:cx0 + P]
    worst = list(default)
    for r in used:
        worst[r] = WORST[r]
    dark = [NEAR_BLACK] * 6
    light_ = [NEAR_WHITE] * 6
    rows.append([panel(to_srgb(dye(albedo, idx, default)[crop]), "1:1 dyed, unlit"), panel(shown(default, sl=crop), "1:1 lit upper left"),
                 panel(shown(default, az=np.radians(0), el=np.radians(22), sl=crop), "1:1 lit low right"), panel(shown(worst, sl=crop), "1:1 worst"),
                 panel(shown(dark, sl=crop), "1:1 near-black"), panel(shown(light_, sl=crop), "1:1 near-white")])
    ppm = next((v for k, v in BIRD_PPM.items() if name.startswith(k)), 2400)
    at = max(8, int(round(span * ppm)))
    bird = to_srgb(shrink(to_linear(shown(default)), at))
    if tiles and at < P:
        bird = tile_to(bird, P)
    b0 = max(0, bird.shape[0] // 2 - P // 2)
    row = [panel(bird[b0:b0 + P, b0:b0 + P], f"bird density {ppm}/m, 1:1")]
    for px_tall in (200, 50):
        t = max(4, int(round(span * px_tall / BIRD_HEIGHT_M)))
        small = to_srgb(shrink(to_linear(shown(default)), t))
        view = tile_to(small, P // 2) if tiles else small
        row.append(panel(view, f"bird {px_tall}px, x2", P))
    row.append(panel(to_srgb(shrink(to_linear(shown(worst)), P)), "worst, whole"))
    sweep_region = used[0] if used else 0
    if used:
        sweep = []
        for c in COLOURS[sweep_region][:8]:
            cols = list(default)
            cols[sweep_region] = c
            sweep.append(shrink(to_linear(shown(cols, sl=np.s_[: size // 2, : size // 2])), P // 4))
        grid = np.concatenate([np.concatenate(sweep[i * 4:(i + 1) * 4], 1) for i in range(2)], 0) if len(sweep) >= 8 else np.concatenate(sweep, 1)
        row.append(panel(to_srgb(grid) if grid.shape[0] == grid.shape[1] else to_srgb(tile_to(grid, P)), f"{NAMES[sweep_region]} colour set"))
    if name in CONCEPT:
        pic, cx, cy, ppm = CONCEPT[name]
        concept = np.asarray(Image.open(os.path.join(CONCEPT_DIR, pic)).convert("RGB"), np.float64) / 255.0
        half = P // 4
        x0, y0 = max(0, cx - half), max(0, cy - half)
        row.append(panel(concept[y0:y0 + 2 * half, x0:x0 + 2 * half], f"concept {pic}, x2"))
        at = max(8, int(round(size * ppm / (size / span))))
        ours = to_srgb(shrink(to_linear(shown(default)), at))
        if tiles and at < 2 * half:
            ours = tile_to(ours, 2 * half)
        o0 = max(0, ours.shape[0] // 2 - half)
        row.insert(len(row), panel(ours[o0:o0 + 2 * half, o0:o0 + 2 * half], "study at that scale, x2"))
    while len(row) < 8:
        row.append(panel(np.zeros((8, 8, 3)) + 0.1, ""))
    rows[0] += [panel(np.zeros((8, 8, 3)) + 0.1, ""), panel(np.zeros((8, 8, 3)) + 0.1, "")]
    rows[1] += [panel(shown(default, az=np.radians(270), el=np.radians(60), sl=crop), "1:1 lit from below"), panel(np.zeros((8, 8, 3)) + 0.1, "")]
    rows.append(row[:8])
    sheet = Image.new("RGB", (8 * P, len(rows) * P + 16), (30, 30, 30))
    for y, r in enumerate(rows):
        for x, p in enumerate(r):
            sheet.paste(p, (x * P, 16 + y * P))
    ImageDraw.Draw(sheet).text((4, 2), f"{os.path.basename(folder)}/{name}  {span} m, {size} px, {size / span:.0f} px/m; dyed regions {[NAMES[r] for r in used]}", fill=(230, 230, 230))
    out = os.path.join(folder, "checks", f"review_{name}.jpg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out, quality=90)
    return out


def main():
    studies = sys.argv[1:] or [s for s in STUDIES if os.path.isdir(os.path.join(HERE, s))]
    for s in studies:
        folder = os.path.join(HERE, s)
        meta_path = os.path.join(folder, "study.json")
        meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
        sets = meta.get("sets") or {f[: -len("_base.png")]: {} for f in sorted(os.listdir(folder)) if f.endswith("_base.png")}
        for name, info in sets.items():
            out = review_set(folder, name, info)
            print(out or f"{s}/{name}: layers missing")


if __name__ == "__main__":
    main()
