"""Measures the pteranodon's material studies, independently of the painter's own checks.

    python3 tex/studies/measure.py [study ...]      every set of each study (default: all), as text and <study>/checks/measure.json

The normal and seam measures are the game's own (tools/pack/image.ts), written again here. The rest follow from how the
game dyes (client/core/render/surface.ts): the dye is the region's colour over the material's mean grey, so every dyed
region needs that same mean grey, and no hue. The membrane's two faces are the exception COMMON.md allows: the upper
face's mean is 0.40 and the under face's 0.60.
"""

import json
import os
import site
import sys

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
STUDIES = ["membrane", "fuzz", "horn", "skin", "saddle"]
LAYERS = ["base", "height", "normal", "packed", "regions"]
REGION_RGB = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (0, 255, 255), (255, 0, 255), (255, 255, 0)]
NAMES = ["patterning", "wing_base", "face_crest_hands", "inner_crest", "wing_membrane", "body"]
GREY = {"membrane_upper": 0.40, "membrane_creased": 0.40, "membrane_under": 0.60}
TOLERANCE = 0.02


def to_linear(s):
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def read(path):
    im = Image.open(path)
    a = np.asarray(im)
    if im.mode in ("I;16", "I;16B", "I"):
        return a.astype(np.float32) / 65535.0, im.mode
    return a.astype(np.float32) / 255.0, im.mode


def regions_of(rgb8):
    """Region index a pixel, -1 for black, as tools/pack/mask.ts readRegions takes the nearest of the seven colours."""
    painted = np.array(REGION_RGB + [(0, 0, 0)], np.float32) / 255.0
    px = rgb8[..., :3].reshape(-1, 3).astype(np.float32) / 255.0
    best = np.empty(len(px), np.int64)
    for start in range(0, len(px), 1 << 18):
        chunk = px[start:start + (1 << 18)]
        best[start:start + len(chunk)] = ((chunk[:, None, :] - painted[None]) ** 2).sum(-1).argmin(-1)
    return np.where(best == 6, -1, best).reshape(rgb8.shape[:2])


def seam(a):
    """tools/pack/image.ts seam(): the jump across the wrap edge over the mean jump inside, across and down."""
    a = a if a.ndim == 3 else a[..., None]
    w, h = a.shape[1], a.shape[0]
    inner_x = np.abs(np.diff(a, axis=1)).sum()
    inner_y = np.abs(np.diff(a, axis=0)).sum()
    edge_x = np.abs(a[:, -1] - a[:, 0]).sum()
    edge_y = np.abs(a[-1] - a[0]).sum()
    return [float(edge_x * (w - 1) / max(inner_x, 1e-9)), float(edge_y * (h - 1) / max(inner_y, 1e-9))]


def corr(a, b):
    a, b = a.ravel() - a.mean(), b.ravel() - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def normal_against_height(n, h):
    """tools/pack/image.ts normalAgainstHeight()."""
    n = n[..., :3] * 2 - 1
    length = np.sqrt((n ** 2).sum(-1))
    z = np.maximum(n[..., 2], 0.05)
    slope_x = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    slope_y = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    return {"x": corr(-n[..., 0] / z, slope_x), "y": corr(n[..., 1] / z, slope_y), "length": float(length.mean())}


def baked_light(lum, n, where):
    """The strongest correlation between base brightness and the light the normal map would catch, over 8 directions."""
    n = n[..., :3] * 2 - 1
    best = (0.0, 0)
    for k in range(8):
        az = k * np.pi / 4
        shade = (n * np.array([np.cos(az) * 0.7, np.sin(az) * 0.7, 0.71], np.float32)).sum(-1)
        c = corr(lum[where], shade[where])
        if abs(c) > abs(best[0]):
            best = (c, k * 45)
    return {"corr": round(best[0], 3), "from_degrees": best[1]}


def measure_set(folder, name, info):
    out = {"set": name, "faults": [], "notes": []}
    pics = {}
    for k in LAYERS:
        f = os.path.join(folder, f"{name}_{k}.png")
        if not os.path.exists(f):
            out["faults"].append(f"{k} missing")
            continue
        a, mode = read(f)
        pics[k] = a
        out.setdefault("sizes", {})[k] = f"{a.shape[1]}x{a.shape[0]} {mode}"
        if a.shape[0] != a.shape[1] or a.shape[0] < 64:
            out["faults"].append(f"{k} is {a.shape[1]}x{a.shape[0]}")
    if len({p.shape[:2] for p in pics.values()}) > 1:
        out["faults"].append(f"layers differ in size: {out['sizes']}")
    if "base" not in pics:
        return out
    base = pics.pop("base")
    rgb = base[..., :3]
    solid = base[..., 3] >= 0.5 if base.shape[-1] == 4 else np.ones(base.shape[:2], bool)
    lum = rgb.mean(-1)
    lum_lin = (to_linear(rgb) * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1)
    hh, ww = lum.shape
    qm = [float(x.mean() * 255) for x in (lum[: hh // 2, : ww // 2], lum[: hh // 2, ww // 2:], lum[hh // 2:, : ww // 2], lum[hh // 2:, ww // 2:])]
    out["quarters"] = [round(v, 1) for v in qm]
    tiles = bool(info.get("tiles", False))
    if tiles and (max(qm) - min(qm)) / max(np.mean(qm), 1) > 0.02:
        out["faults"].append("base quarters differ by more than 2%")
    if "regions" in pics:
        r = pics.pop("regions")
        reg8 = np.round((r if r.ndim == 3 else np.repeat(r[..., None], 3, -1))[..., :3] * 255).astype(np.uint8)
        idx = regions_of(reg8)
        exact = np.zeros(idx.shape, bool)
        for c in REGION_RGB + [(0, 0, 0)]:
            exact |= (reg8 == np.array(c, np.uint8)).all(-1)
        out["regions_not_exact"] = round(float(1 - exact.mean()), 5)
        if out["regions_not_exact"] > 0:
            out["faults"].append(f"{out['regions_not_exact'] * 100:.3f}% of the region map is not one of the seven colours")
        dye = {}
        for k in range(6):
            m = (idx == k) & solid
            if not m.any():
                continue
            spread = (rgb[m].max(-1) - rgb[m].min(-1)) * 255
            grey = float(lum_lin[m].mean())
            want = GREY.get(name, 0.50)
            dye[NAMES[k]] = {"cover": round(float(m.mean()), 4), "grey": round(grey, 4), "hue_p99": round(float(np.percentile(spread, 99)), 1)}
            if abs(grey - want) > TOLERANCE:
                out["faults"].append(f"{NAMES[k]} mean grey {grey:.3f}, wants {want} +- {TOLERANCE}")
            if dye[NAMES[k]]["hue_p99"] > 4:
                out["faults"].append(f"{NAMES[k]} has hue: channel spread {dye[NAMES[k]]['hue_p99']} at the 99th percentile")
        out["dye"] = dye
        undyed = (idx < 0) & solid
        if undyed.any():
            out["undyed_mean_srgb"] = [round(float(v * 255), 1) for v in rgb[undyed].mean(0)]
    if "normal" in pics and "height" in pics and pics["normal"].shape[:2] == pics["height"].shape[:2]:
        h = pics["height"] if pics["height"].ndim == 2 else pics["height"][..., 0]
        nh = normal_against_height(pics["normal"], h)
        out["normal"] = {k: round(v, 3) for k, v in nh.items()}
        out["height"] = {"range": [round(float(h.min()), 4), round(float(h.max()), 4)], "mm": info.get("height_mm")}
        if h.max() - h.min() > 1e-6 and min(nh["x"], nh["y"]) < 0.9:
            out["faults"].append(f"normal follows height at {nh['x']:.2f}, {nh['y']:.2f}; wants 0.9")
        out["baked_light"] = baked_light(lum, pics["normal"], solid)
        if abs(out["baked_light"]["corr"]) > 0.3:
            out["faults"].append(f"base follows the light from {out['baked_light']['from_degrees']} degrees: {out['baked_light']['corr']}")
    if "packed" in pics:
        p = pics["packed"]
        out["packed"] = {"occlusion": [round(float(p[..., 0][solid].min()), 3), round(float(p[..., 0][solid].mean()), 3)],
                         "roughness": [round(float(np.percentile(p[..., 1][solid], 1)), 3), round(float(p[..., 1][solid].mean()), 3), round(float(np.percentile(p[..., 1][solid], 99)), 3)],
                         "metal_max": round(float(p[..., 2].max()), 3)}
    if tiles:
        worst = 0.0
        out["seam"] = {}
        for k, a in (("base", base), *((k, pics[k]) for k in ("height", "normal", "packed") if k in pics)):
            s = seam(a)
            out["seam"][k] = [round(v, 2) for v in s]
            worst = max(worst, *s)
        if worst > 4:
            out["faults"].append(f"seam {worst:.2f}: the game fails this")
        elif worst > 1.3:
            out["notes"].append(f"seam up to {worst:.2f}")
    if base.shape[-1] == 4:
        out["cutout_cover"] = round(float(solid.mean()), 4)
    return out


def main():
    for study in sys.argv[1:] or [s for s in STUDIES if os.path.isdir(os.path.join(HERE, s))]:
        folder = os.path.join(HERE, study)
        meta = os.path.join(folder, "study.json")
        sets = json.load(open(meta)).get("sets", {}) if os.path.exists(meta) else {}
        results = [measure_set(folder, name, info) for name, info in sets.items()]
        os.makedirs(os.path.join(folder, "checks"), exist_ok=True)
        json.dump(results, open(os.path.join(folder, "checks", "measure.json"), "w"), indent=1)
        for r in results:
            print(f"{study}/{r['set']}: " + ("OK" if not r["faults"] else "FAULTS"))
            for k in ("sizes", "quarters", "dye", "undyed_mean_srgb", "normal", "height", "baked_light", "packed", "seam", "cutout_cover"):
                if k in r:
                    print(f"  {k}: {json.dumps(r[k])}")
            for f in r["faults"]:
                print(f"  FAULT {f}")
            for n in r["notes"]:
                print(f"  note {n}")


if __name__ == "__main__":
    main()
