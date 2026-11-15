# Our own reading of the mood keys, apart from the painter's: the points each key is read at, and whether the game's
# sky table can be graded to them.
#
#   python3 -I measure.py [keys dir]          reads <dir>/<key>.png, base/points.json and base/table.json
#
# For each key: the mean of the square of `patch` pixels round each point; how far each sky point lies from the
# table's own colour there before any grade (OKLab x 100, about 2 is just seen); and the same after the best grade
# the engine can make. base/table.json is the table at each key's points as the game shows it, written by the sky
# table's builder (tools/sky/preview.ts on r8/l1-sky-table); the grade is the engine's (tools/sky/grade.ts): a tint,
# a saturation about luminance, a lift toward the horizon on the sun's side and another on the far side, and a glow
# by nearness to the sun (the moon at night), each held to the same gentle bounds as its fitter (tools/sky/fit.ts).
# The table is held within 6 of the key at each point after its grade, so a key whose best grade leaves more than
# that asks for light the table cannot make. Without base/table.json it falls back to underlay/points.json, our own
# stand-in sky from physical.py. It also checks the order of brightness light keeps by day.
import json
import math
import os
import site
import sys

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SKY = ("zenith", "high", "toward", "away")
LUMA = np.array([0.2126, 0.7152, 0.0722])
# The fitter's bounds: tint, saturation, the two horizon lifts and the glow, as powers of e.
BOUNDS = [(-math.log(4), math.log(4))] * 3 + [(-math.log(2), math.log(2)), (math.log(1 / 3), math.log(2.5)),
                                              (math.log(1 / 3), math.log(2.5)), (math.log(0.5), math.log(2.5))]


def lin(c):
    c = np.asarray(c, np.float64) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055) * 255


def oklab(c):
    r, g, b = np.moveaxis(lin(c), -1, 0)
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return np.stack([0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                     1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                     0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s], -1) * 100


def tone(x):
    """Khronos PBR Neutral's shoulder from 0.8, no toe, as the engine draws the sky (linear in, linear out)."""
    x = np.maximum(x, 0)
    peak = x.max(-1, keepdims=True)
    d = 0.2
    new_peak = 1 - d * d / (peak + d - 0.8)
    scaled = x * new_peak / np.maximum(peak, 1e-9)
    g = 1 - 1 / (0.15 * (peak - new_peak) + 1)
    return np.where(peak > 0.8, scaled * (1 - g) + new_peak * g, x)


def untone(y):
    """The light before the shoulder that shows as `y`, found by stepping toward it."""
    y = np.minimum(y, 0.995)
    x = y.copy()
    for _ in range(60):
        x = np.maximum(x + (y - tone(x)) * 1.5, 0)
    return x


def read(img, p, patch):
    h = patch // 2
    y0, y1 = max(0, p["y"] - h), min(img.shape[0], p["y"] + h + 1)
    xs = [(p["x"] + dx) % img.shape[1] for dx in range(-h, h + 1)]
    return img[y0:y1][:, xs].reshape(-1, 3).mean(0)


def angle(p, q):
    v = [[math.sin(math.radians(a["heading"])) * math.cos(math.radians(a["elevation"])), math.sin(math.radians(a["elevation"])),
          math.cos(math.radians(a["heading"])) * math.cos(math.radians(a["elevation"]))] for a in (p, q)]
    return math.degrees(math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(*v))))))


def grade(light, x, elev, to_sun, night):
    """tools/sky/grade.ts's gradeDome on linear light, one row a point."""
    c = light * np.exp(x[0:3])
    y = (c * LUMA).sum(-1, keepdims=True)
    c = np.maximum(0, y + math.exp(x[3]) * (c - y))
    low = (1 - np.sin(np.radians(np.maximum(elev, 0)))) ** 2
    far = (1 - np.cos(np.radians(to_sun))) / 2
    glow = np.exp(-(180 - to_sun) / 30) if night else np.exp(-to_sun / 30)
    return c * np.exp((x[4] + (x[5] - x[4]) * far) * low + x[6] * glow)[:, None]


def fit(table, key, elev, to_sun, night):
    light = untone(lin(table))
    target = oklab(key)
    cost = lambda x: float(np.max(np.linalg.norm(oklab(srgb(tone(grade(light, x, elev, to_sun, night)))) - target, axis=1)))
    rng = np.random.default_rng(1)
    best_x, best = np.zeros(7), cost(np.zeros(7))
    lo = np.array([b[0] for b in BOUNDS])
    hi = np.array([b[1] for b in BOUNDS])
    # A plain random search from a few starts: seven numbers, four points.
    for start in range(4):
        x = best_x if start == 0 else rng.uniform(lo, hi)
        cur, step = cost(x), 0.4
        for i in range(3000):
            q = np.clip(x + rng.normal(0, step, 7), lo, hi)
            c = cost(q)
            if c < cur:
                x, cur = q, c
            if i % 500 == 499:
                step *= 0.6
        if cur < best:
            best_x, best = x, cur
    return best, best_x


def main():
    keys_dir = sys.argv[1] if len(sys.argv) > 1 else HERE
    points = json.load(open(os.path.join(HERE, "base", "points.json")))
    table_path = os.path.join(HERE, "base", "table.json")
    if not os.path.exists(table_path):
        table_path = os.path.join(HERE, "underlay", "points.json")
    table = json.load(open(table_path))["keys"]
    patch = points["patch"]
    out = {"patch": patch, "against": os.path.relpath(table_path, HERE), "keys": {}}
    for k in points["keys"]:
        path = os.path.join(keys_dir, f"{k['name']}.png")
        if not os.path.exists(path):
            continue
        img = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
        read_pts = {n: [round(float(v), 1) for v in read(img, p, patch)] for n, p in k["points"].items()}
        entry = {"points": read_pts}
        if k["name"] in table:
            tb = np.array([table[k["name"]][n] for n in SKY], np.float64)
            ky = np.array([read_pts[n] for n in SKY], np.float64)
            entry["fromTable"] = {n: round(float(d), 1) for n, d in zip(SKY, np.linalg.norm(oklab(ky) - oklab(tb), axis=1))}
            elev = np.array([k["points"][n]["elevation"] for n in SKY])
            to_sun = np.array([angle(k["points"][n], k["sun"]) for n in SKY])
            night = k["lightBy"] == "moon"
            worst, x = fit(tb, ky, elev, to_sun, night)
            entry["afterBestGrade"] = round(worst, 1)
            entry["grade"] = {"tint": [round(math.exp(v), 3) for v in x[:3]], "saturation": round(math.exp(x[3]), 3),
                              "horizon": round(float(x[4]), 3), "farHorizon": round(float(x[5]), 3),
                              ("moonGlow" if night else "glow"): round(float(x[6]), 3)}
        y = {n: float((lin(read_pts[n]) * LUMA).sum()) for n in read_pts}
        notes = []
        if k["sunHeight"] > 1 and k["lightBy"] == "sun":
            if y["high"] > y["away"] * 1.05:
                notes.append("by day the sky 30 degrees up is brighter than the horizon below it")
            if y["toward"] < y["away"] * 0.95:
                notes.append("the horizon toward the sun is darker than away from it")
        if k["lightBy"] == "sun" and k["sunHeight"] < 1 and y["zenith"] > y["toward"]:
            notes.append("at sunset and after, the zenith is brighter than the horizon toward the sun")
        if y["lit"] < y["shaded"]:
            notes.append("the lit face is darker than the shaded one")
        entry["notes"] = notes
        out["keys"][k["name"]] = entry
        print(k["name"], json.dumps(entry))
    with open(os.path.join(keys_dir, "points-read.json"), "w") as f:
        json.dump(out, f, indent=2)


if __name__ == "__main__":
    main()
