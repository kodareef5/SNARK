"""Measures the dodo's material studies, independently of the painter's own checks.

    python3 -I measure.py [study ...]          every set of each study (default: all), as text and checks/measure.json

The normal, seam and region measures are the game's own (tools/pack/image.ts and mask.ts), written again here. The
rest follow from how the game dyes (client/core/render/surface.ts): the dye is the region's colour over the material's
mean grey, so every dyed region needs that same mean grey, and no hue.
"""

import json
import os
import site
import sys

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
STUDIES = ["body", "trousers", "hood", "face", "beak", "leg", "eye", "quills"]
LAYERS = ["base", "height", "normal", "packed", "regions"]
REGION_RGB = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (0, 255, 255), (255, 0, 255), (255, 255, 0)]
NAMES = ["body", "face", "beak", "forehead_neck_feet", "head", "wings_patterning"]
# The ring red, yellow, green, cyan, blue, magenta, as region indices. Neighbours on it may touch.
RING = [0, 5, 1, 3, 2, 4]
GREY = 0.50
GREY_TOLERANCE = 0.02


def neighbours(a, b):
    i, j = RING.index(a), RING.index(b)
    return (i - j) % 6 in (1, 5)


def to_linear(s):
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def read(path):
    im = Image.open(path)
    mode = im.mode
    a = np.asarray(im)
    if mode in ("I;16", "I;16B", "I"):
        depth = 16
        a = a.astype(np.float64) / 65535.0
    else:
        depth = 8
        a = a.astype(np.float64) / 255.0
    return a, mode, depth


def regions_of(rgb8):
    """Region index a pixel, -1 for black, as readRegions takes the nearest of the seven colours. Also the stray mask."""
    painted = np.array(REGION_RGB + [(0, 0, 0)], np.float64) / 255.0
    px = rgb8[..., :3].reshape(-1, 3).astype(np.float64) / 255.0
    best = np.empty(len(px), np.int64)
    for start in range(0, len(px), 1 << 18):
        chunk = px[start:start + (1 << 18)]
        best[start:start + len(chunk)] = ((chunk[:, None, :] - painted[None]) ** 2).sum(-1).argmin(-1)
    near = np.abs(px - painted[best]).max(-1) <= 0.25
    idx = np.where(best == 6, -1, best).reshape(rgb8.shape[:2])
    return idx, ~near.reshape(rgb8.shape[:2])


def ring_faults(idx):
    """Pairs of side-by-side pixels in two regions that are not neighbours on the ring."""
    out = {}
    for a, b in ((idx[:-1], idx[1:]), (idx[:, :-1], idx[:, 1:])):
        touch = (a >= 0) & (b >= 0) & (a != b)
        pairs, counts = np.unique(np.minimum(a[touch], b[touch]) * 8 + np.maximum(a[touch], b[touch]), return_counts=True)
        for p, c in zip(pairs, counts):
            x, y = divmod(int(p), 8)
            if not neighbours(x, y):
                k = f"{NAMES[x]}/{NAMES[y]}"
                out[k] = out.get(k, 0) + int(c)
    return out


def seam(a):
    """tools/pack/image.ts seam(): the jump across the wrap edge over the mean jump inside, across and down."""
    a = a if a.ndim == 3 else a[..., None]
    w, h = a.shape[1], a.shape[0]
    inner_x = np.abs(np.diff(a, axis=1)).sum()
    inner_y = np.abs(np.diff(a, axis=0)).sum()
    edge_x = np.abs(a[:, -1] - a[:, 0]).sum()
    edge_y = np.abs(a[-1] - a[0]).sum()
    return [float(edge_x * (w - 1) / max(inner_x, 1e-9)), float(edge_y * (h - 1) / max(inner_y, 1e-9))]


def normal_against_height(n, h, wrap=True):
    """tools/pack/image.ts normalAgainstHeight()."""
    n = n[..., :3] * 2 - 1
    length = np.sqrt((n ** 2).sum(-1))
    z = np.maximum(n[..., 2], 0.05)
    lean_x, lean_y = -n[..., 0] / z, n[..., 1] / z
    slope_x = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    slope_y = np.roll(h, -1, 0) - np.roll(h, 1, 0)

    def corr(a, b):
        a, b = a.ravel() - a.mean(), b.ravel() - b.mean()
        d = np.sqrt((a * a).sum() * (b * b).sum())
        return float((a * b).sum() / d) if d > 0 else 0.0

    return {"x": corr(lean_x, slope_x), "y": corr(lean_y, slope_y), "length": float(length.mean()), "off": float(np.abs(length - 1).max())}


def baked_light(lum, n, where):
    """The strongest correlation between base luminance and the light the normal map would catch, over 8 directions."""
    n = n[..., :3] * 2 - 1
    best = (0.0, 0)
    for k in range(8):
        az = k * np.pi / 4
        light = np.array([np.cos(az) * 0.7, np.sin(az) * 0.7, 0.71])
        shade = (n * light).sum(-1)
        a, b = lum[where] - lum[where].mean(), shade[where] - shade[where].mean()
        d = np.sqrt((a * a).sum() * (b * b).sum())
        c = float((a * b).sum() / d) if d > 0 else 0.0
        if abs(c) > abs(best[0]):
            best = (c, k * 45)
    return {"corr": round(best[0], 3), "from_degrees": best[1]}


def tiling(info):
    """(across, down): whether a set tiles each way. study.json gives true, false or {"x": .., "y": ..}."""
    t = info.get("tiles", False)
    if isinstance(t, dict):
        return bool(t.get("x")), bool(t.get("y"))
    if isinstance(t, (list, tuple)):
        return bool(t[0]), bool(t[1])
    return bool(t), bool(t)


def measure_set(folder, name, info):
    out = {"set": name, "faults": [], "notes": []}
    files = {k: os.path.join(folder, f"{name}_{k}.png") for k in LAYERS}
    pics = {}
    for k, f in files.items():
        if not os.path.exists(f):
            out["faults"].append(f"{k} missing")
            continue
        a, mode, depth = read(f)
        pics[k] = a
        out.setdefault("sizes", {})[k] = f"{a.shape[1]}x{a.shape[0]} {mode}"
        if a.shape[0] != a.shape[1]:
            out["faults"].append(f"{k} not square")
        if a.shape[0] < 64:
            out["faults"].append(f"{k} under 64")
    sizes = {p.shape[:2] for p in pics.values()}
    if len(sizes) > 1:
        out["faults"].append(f"layers differ in size: {out['sizes']}")
    if "base" not in pics:
        return out
    base = pics["base"]
    rgb = base[..., :3]
    alpha = base[..., 3] if base.shape[-1] == 4 else np.ones(base.shape[:2])
    solid = alpha >= 0.5
    lum_lin = (to_linear(rgb) * [0.2126, 0.7152, 0.0722]).sum(-1)
    lum = rgb.mean(-1)
    hgt, wid = lum.shape
    q = [lum[: hgt // 2, : wid // 2], lum[: hgt // 2, wid // 2:], lum[hgt // 2:, : wid // 2], lum[hgt // 2:, wid // 2:]]
    qm = [float(x.mean() * 255) for x in q]
    out["quarters"] = [round(v, 1) for v in qm]
    if all(tiling(info)) and (max(qm) - min(qm)) / max(np.mean(qm), 1) > 0.02:
        out["faults"].append("base quarters differ by more than 2%")
    if "regions" in pics:
        reg8 = np.round(pics["regions"][..., :3] * 255).astype(np.uint8) if pics["regions"].ndim == 3 else np.repeat(np.round(pics["regions"][..., None] * 255).astype(np.uint8), 3, -1)
        idx, stray = regions_of(reg8)
        exact = np.zeros(idx.shape, bool)
        for c in REGION_RGB + [(0, 0, 0)]:
            exact |= (reg8 == np.array(c, np.uint8)).all(-1)
        out["regions"] = {"stray": round(float(stray.mean()), 5), "not_exact": round(float(1 - exact.mean()), 5)}
        faults = ring_faults(idx)
        if faults:
            out["faults"].append(f"ring rule broken: {faults}")
        grey = {}
        chroma = {}
        cover = {}
        for r in range(6):
            m = (idx == r) & solid
            if m.sum() == 0:
                continue
            cover[NAMES[r]] = round(float(m.mean()), 4)
            grey[NAMES[r]] = round(float(lum_lin[m].mean()), 4)
            spread = (rgb[m].max(-1) - rgb[m].min(-1)) * 255
            chroma[NAMES[r]] = {"mean": round(float(spread.mean()), 2), "p99": round(float(np.percentile(spread, 99)), 1)}
            if abs(grey[NAMES[r]] - GREY) > GREY_TOLERANCE:
                out["faults"].append(f"{NAMES[r]} mean grey {grey[NAMES[r]]:.3f}, wants {GREY} +- {GREY_TOLERANCE}")
            if chroma[NAMES[r]]["p99"] > 4:
                out["faults"].append(f"{NAMES[r]} has hue: p99 channel spread {chroma[NAMES[r]]['p99']}")
        dyed = (idx >= 0) & solid
        out["dye"] = {"cover": cover, "grey": grey, "material_grey": round(float(lum_lin[dyed].mean()), 4) if dyed.any() else None, "chroma": chroma}
        undyed = (idx < 0) & solid
        if undyed.any():
            out["dye"]["undyed_mean_srgb"] = [round(float(v * 255), 1) for v in rgb[undyed].mean(0)]
    if "normal" in pics and "height" in pics and pics["normal"].shape[:2] == pics["height"].shape[:2]:
        h = pics["height"] if pics["height"].ndim == 2 else pics["height"][..., 0]
        out["normal"] = {k: round(v, 3) for k, v in normal_against_height(pics["normal"], h).items()}
        if h.max() - h.min() < 1e-6:
            out["notes"].append("height and normal are flat on purpose")
        elif min(out["normal"]["x"], out["normal"]["y"]) < 0.9:
            out["faults"].append(f"normal follows height at {out['normal']['x']:.2f}, {out['normal']['y']:.2f}; wants 0.9")
        out["height"] = {"min": round(float(h.min()), 4), "max": round(float(h.max()), 4), "mm": info.get("height_mm")}
        out["baked_light"] = baked_light(lum, pics["normal"], solid)
        if abs(out["baked_light"]["corr"]) > 0.3:
            out["faults"].append(f"base follows the light from {out['baked_light']['from_degrees']} deg: {out['baked_light']['corr']}")
    if "packed" in pics:
        p = pics["packed"]
        out["packed"] = {"occlusion_mean": round(float(p[..., 0][solid].mean()), 3), "occlusion_min": round(float(p[..., 0][solid].min()), 3),
                         "roughness_mean": round(float(p[..., 1][solid].mean()), 3), "roughness_range": [round(float(np.percentile(p[..., 1][solid], 1)), 3), round(float(np.percentile(p[..., 1][solid], 99)), 3)],
                         "metal_max": round(float(p[..., 2].max()), 3)}
    axes = tiling(info)
    if any(axes):
        out["seam"] = {k: [round(v, 2) if t else None for v, t in zip(seam(pics[k]), axes)] for k in ("base", "height", "normal", "packed") if k in pics}
        worst = max(max(x for x in v if x is not None) for v in out["seam"].values())
        if worst > 4:
            out["faults"].append(f"seam {worst:.2f}: the game fails this")
        elif worst > 1.3:
            out["notes"].append(f"seam up to {worst:.2f}")
    if base.shape[-1] == 4:
        out["cutout"] = {"cover": round(float(solid.mean()), 4)}
    return out


def measure_study(study):
    folder = os.path.join(HERE, study)
    meta_path = os.path.join(folder, "study.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    sets = meta.get("sets", {})
    if not sets:
        sets = {f[: -len("_base.png")]: {} for f in sorted(os.listdir(folder)) if f.endswith("_base.png")}
    results = [measure_set(folder, name, info) for name, info in sets.items()]
    os.makedirs(os.path.join(folder, "checks"), exist_ok=True)
    json.dump(results, open(os.path.join(folder, "checks", "measure.json"), "w"), indent=1)
    return results


def main():
    studies = sys.argv[1:] or [s for s in STUDIES if os.path.isdir(os.path.join(HERE, s))]
    for s in studies:
        for r in measure_study(s):
            print(f"{s}/{r['set']}: " + ("OK" if not r["faults"] else "FAULTS"))
            for k in ("sizes", "quarters", "dye", "normal", "height", "baked_light", "packed", "seam", "regions", "cutout"):
                if k in r:
                    print(f"  {k}: {json.dumps(r[k])}")
            for f in r["faults"]:
                print(f"  FAULT {f}")
            for n in r["notes"]:
                print(f"  note {n}")


if __name__ == "__main__":
    main()
