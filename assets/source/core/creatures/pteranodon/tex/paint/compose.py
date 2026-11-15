"""Puts the painters' layers together into the pteranodon's maps, the pictures asset.ts names in tex/.

    python3 tex/paint/compose.py [--out DIR]

Each painting group (GROUPS) writes its layers in tex/paint/<group>/layers/ (BRIEF.md says what each holds) and owns
the pieces listed here; texels it does not own are ignored. A group that has not painted yet is drawn plain grey in
the model's own regions, so an animal partly painted can be built and looked at. Writes to tex/ unless --out is given.

What it does that no single painter can: holds the mean grey of every dyed region at 0.50 in linear light over the
whole material (the game divides the dye by it), keeping the membrane's faces apart as painted; computes the normal
from the joined height at each texel's true size on the animal; multiplies the painters' fine occlusion by the
modeller's form occlusion where it is baked; and carries every map past the pieces' edges so filtering draws no
seams at any mip. The body takes a painted region map; the wing takes two masks of weights, so its wash can fade.
"""

import json
import os
import site
import sys

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.dirname(HERE)
BAKES = os.path.join(os.path.dirname(TEX), "ref", "bakes")
GREY = 0.50
SIZE = 2048
REGION = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (0, 255, 255), (255, 0, 255), (255, 255, 0)]
MATERIALS = ["pteranodon", "pteranodon_wing"]
# Which material takes masks made by hand rather than a painted region map.
MASKED = {"pteranodon_wing"}
GROUPS = {
    "body": {"pteranodon": ["torso", "neck", "leg", "toe_0", "toe_1", "toe_2", "toe_3", "hand_0", "hand_1", "hand_2"]},
    "head": {"pteranodon": ["head", "beak", "jaw", "crest", "eye_l"]},
    "wing": {"pteranodon_wing": ["membrane_upper", "membrane_under", "arm", "finger"]},
}
# Roughness of a piece not painted yet.
ROUGH = 0.8


def lin(s):
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def srgb(l):
    l = np.clip(l, 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)


def load(path, channels=None):
    if not os.path.exists(path):
        return None
    im = Image.open(path)
    a = np.asarray(im)
    a = a.astype(np.float32) / (65535.0 if a.dtype == np.uint16 or im.mode.startswith("I") else 255.0)
    if a.shape[0] != SIZE:
        raise SystemExit(f"{path}: {a.shape[0]} pixels across, wants {SIZE}")
    if channels == 1 and a.ndim == 3:
        a = a[..., 0]
    return a


def weights_of_map(rgb8):
    """Six region weights a texel from a painted region map: 1 for its region, 0 elsewhere (black undyed)."""
    w = np.zeros(rgb8.shape[:2] + (6,), np.float32)
    for r, c in enumerate(REGION):
        w[..., r] = (rgb8[..., :3] == np.array(c)).all(-1)
    return w


def weights_of_masks(mask, mask2):
    w = np.zeros(mask.shape[:2] + (6,), np.float32)
    w[..., :3] = mask[..., :3]
    if mask2 is not None:
        w[..., 3:] = mask2[..., :3]
    total = w.sum(-1, keepdims=True)
    return np.where(total > 1, w / np.maximum(total, 1e-6), w)


def fill_out(arr, covered):
    """Carries each covered texel's value out to every uncovered texel, from the nearest covered one."""
    _, (iy, ix) = distance_transform_edt(~covered, return_indices=True)
    return arr[iy, ix]


def normal_from_height(h_mm, texel_mm, piece):
    """OpenGL tangent normal (green up the picture) from height in millimetres, each texel its own size, never
    differencing across two pieces."""
    def diff(axis):
        a, b = np.roll(h_mm, -1, axis), np.roll(h_mm, 1, axis)
        pa, pb = np.roll(piece, -1, axis), np.roll(piece, 1, axis)
        ok_a, ok_b = pa == piece, pb == piece
        d = np.where(ok_a & ok_b, (a - b) / 2, np.where(ok_a, a - h_mm, np.where(ok_b, h_mm - b, 0.0)))
        return d / np.maximum(texel_mm, 1e-3)
    n = np.stack([-diff(1), diff(0), np.ones_like(h_mm)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def hold_grey(base_lin, w, covered, label, report):
    """Scales each dyed region, in linear light, so its mean grey over the material is GREY. Painters aim for it; this
    holds it. A texel shared by regions takes the share of each region's scale."""
    lum = (base_lin * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1)
    scale = np.ones(6, np.float32)
    for r in range(6):
        wr = w[..., r] * covered
        if wr.sum() < 1:
            continue
        mean = float((lum * wr).sum() / wr.sum())
        scale[r] = GREY / max(mean, 1e-6)
        report.append(f"{label} region {r}: mean grey {mean:.4f}, held at {GREY} (x{scale[r]:.3f})")
        if abs(scale[r] - 1) > 0.05:
            report.append(f"  warning: region {r} was more than 5% off; its painter should fix it")
    dyed = w.sum(-1)
    k = (w * scale).sum(-1) + (1 - np.minimum(dyed, 1))
    return np.clip(base_lin * k[..., None], 0, 1)


def form_occlusion(material):
    path = os.path.join(BAKES, f"{material}_occlusion.png")
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert("L")
    if im.size[0] != SIZE:
        im = im.resize((SIZE, SIZE), Image.BILINEAR)
    return np.asarray(im).astype(np.float32) / 255.0


def compose(material, out, report):
    meta = json.load(open(os.path.join(HERE, f"{material}_pieces.json")))
    number = {p["name"]: p["number"] for p in meta["pieces"]}
    piece = np.asarray(Image.open(os.path.join(HERE, f"{material}_pieces.png")))[..., 0].astype(np.int32)
    texel_mm = np.asarray(Image.open(os.path.join(HERE, f"{material}_texel_mm.png"))).astype(np.float32) / 1000.0
    guide = weights_of_map(np.asarray(Image.open(os.path.join(BAKES, f"{material}_regions.png")).convert("RGB")))
    covered = piece > 0
    masked = material in MASKED

    base = np.full((SIZE, SIZE, 3), lin(188 / 255.0), np.float32)
    height = np.zeros((SIZE, SIZE), np.float32)
    rough = np.full((SIZE, SIZE), ROUGH, np.float32)
    occl = np.ones((SIZE, SIZE), np.float32)
    w = guide.copy()
    for group, spec in GROUPS.items():
        if material not in spec:
            continue
        own = np.isin(piece, [number[n] for n in spec[material] if n in number])
        folder = os.path.join(HERE, group, "layers")
        b = load(os.path.join(folder, f"{material}_base.png"))
        if b is None:
            report.append(f"{material}, {group}: not painted yet; its pieces are plain grey")
            continue
        info = json.load(open(os.path.join(folder, "layers.json")))
        if b.shape[-1] == 4:
            gaps = own & (b[..., 3] < 0.5)
            if gaps.any():
                report.append(f"{material}, {group}: {gaps.sum() / own.sum() * 100:.2f}% of its pieces' texels left unpainted; drawn grey")
            own &= ~gaps
        base[own] = lin(b[..., :3][own])
        h = load(os.path.join(folder, f"{material}_height.png"), 1)
        if h is not None:
            height[own] = h[own] * float(info[f"{material}_height_mm"])
        ro = load(os.path.join(folder, f"{material}_rough.png"), 1)
        if ro is not None:
            rough[own] = ro[own]
        oc = load(os.path.join(folder, f"{material}_occlusion.png"), 1)
        if oc is not None:
            occl[own] = oc[own]
        if masked:
            m1 = load(os.path.join(folder, f"{material}_mask.png"))
            m2 = load(os.path.join(folder, f"{material}_mask2.png"))
            if m1 is not None:
                w[own] = weights_of_masks(m1, m2)[own]
        else:
            rg = os.path.join(folder, f"{material}_regions.png")
            if os.path.exists(rg):
                w[own] = weights_of_map(np.asarray(Image.open(rg).convert("RGB")))[own]
        report.append(f"{material}, {group}: painted {own.sum()} texels")

    base = hold_grey(base, w, covered, material, report)
    form = form_occlusion(material)
    packed_r = occl * (form if form is not None else 1.0)
    if form is None:
        report.append(f"{material}: no form occlusion baked yet; the packed map holds the painters' own")
    # Each piece's relief about its own middle, so pieces painted at different levels do not meet in steps where the
    # padding of one runs into another's.
    for k in np.unique(piece[covered]):
        m = piece == k
        height[m] -= np.median(height[m])

    base_f = fill_out(base, covered)
    rough_f = fill_out(rough, covered)
    occ_f = fill_out(packed_r, covered)
    h_f = fill_out(height, covered)
    piece_f = fill_out(piece, covered)
    size_f = fill_out(texel_mm, covered)
    w_f = fill_out(w, covered)
    normal_f = normal_from_height(h_f, size_f, piece_f)
    lo, hi = float(h_f[covered].min()), float(h_f[covered].max())
    span = max(hi - lo, 1e-6)

    Image.fromarray(np.round(srgb(base_f) * 255).astype(np.uint8)).save(os.path.join(out, f"{material}_base.png"))
    Image.fromarray(np.round((normal_f * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(out, f"{material}_normal.png"))
    Image.fromarray(np.round(np.clip((h_f - lo) / span, 0, 1) * 65535).astype(np.uint16)).save(os.path.join(out, f"{material}_height.png"))
    packed = np.dstack([np.clip(occ_f, 0, 1), np.clip(rough_f, 0, 1), np.zeros_like(occ_f)])
    Image.fromarray(np.round(packed * 255).astype(np.uint8)).save(os.path.join(out, f"{material}_packed.png"))
    if masked:
        Image.fromarray(np.round(np.clip(w_f[..., :3], 0, 1) * 255).astype(np.uint8)).save(os.path.join(out, f"{material}_mask.png"))
        Image.fromarray(np.round(np.clip(w_f[..., 3:], 0, 1) * 255).astype(np.uint8)).save(os.path.join(out, f"{material}_mask2.png"))
    else:
        idx = np.where(w_f.max(-1) >= 0.5, w_f.argmax(-1), -1)
        rgb = np.zeros((SIZE, SIZE, 3), np.uint8)
        for r, c in enumerate(REGION):
            rgb[idx == r] = c
        Image.fromarray(rgb).save(os.path.join(out, f"{material}_regions.png"))
    report.append(f"{material} height: full range {span:.3f} mm")
    return {f"{material}_height_mm": round(span, 4)}


def main():
    out = TEX
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
    os.makedirs(out, exist_ok=True)
    report = []
    facts = {}
    for material in MATERIALS:
        facts.update(compose(material, out, report))
    json.dump(facts, open(os.path.join(out, "maps.json"), "w"), indent=1)
    print("\n".join(report))


if __name__ == "__main__":
    main()
