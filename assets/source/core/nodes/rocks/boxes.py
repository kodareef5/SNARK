# The boxes of every stone and broken base fitted from their solids (collide.py), with what a footing needs, into
# mesh/<name>.json beside what make.py wrote there, without Blender; and how high a walk climbs each at its least and
# most size. make.py fits them the same way as it bakes a stone.
#   python3 boxes.py [--report] [rock_1 ...]
# --report says what the boxes there now give and writes nothing.

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True

import collide  # noqa: E402
from content import KINDS  # noqa: E402
from variants import DEPLETED, VARIANTS, form_of  # noqa: E402


def sizes(name):
    """The least and most a stone is drawn at, from its kind's line."""
    for k in KINDS.values():
        if name.replace(DEPLETED, "") in k["names"]:
            return k["size"]
    raise KeyError(name)


def fitted(name, form=None):
    """
    A stone's or broken base's boxes and how far they lie from it; and a whole stone's footing: how far its base reaches
    out at the ground, most and each of 16 ways round from +x toward +y, and how deep it is buried. With the solid's
    tallest point, for `report`.
    """
    form = form or form_of(name)
    lo, hi = form.bounds()
    xs, ys, top = collide.heights(form.base, lo, hi)
    tallest = float(top.max())
    boxes, err = collide.fit(xs, ys, top, least=collide.least_top(tallest, *sizes(name)))
    out = {"boxes": [[round(float(v), 3) for v in b] for b in boxes], "fit": {k: round(v, 3) for k, v in err.items()}}
    if not name.endswith(DEPLETED):
        X, Y = np.meshgrid(xs, ys, indexing="ij")
        on = top >= collide.CELL
        r, a = np.hypot(X, Y)[on] + collide.CELL / 2, np.arctan2(Y, X)[on]
        rim = [float(r[np.abs((a - k * np.pi / 8 + np.pi) % (2 * np.pi) - np.pi) <= np.pi / 16].max()) for k in range(16)]
        out["footing"] = {"reach": round(float(r.max()), 3), "rim": [round(v, 3) for v in rim], "burial": round(float(form.burial), 3)}
    return out, tallest


def report(name, boxes, top):
    lo, hi = sizes(name)
    said = []
    for s in (lo, hi):
        reach = collide.climbed(boxes, s)
        said.append(f"at {s}: {top * s:.2f} m tall, a walk reaches {reach:.2f} m")
    return "; ".join(said)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    only_report = "--report" in sys.argv
    for whole in args or VARIANTS:
        path = os.path.join(HERE, "mesh", f"{whole}.json")
        with open(path) as f:
            made = json.load(f)
        for name in (whole, whole + DEPLETED):
            new, tallest = fitted(name)
            if not only_report:
                made[name].update(new)
            print(f"{name}: {len(made[name]['boxes'])} boxes, fit {made[name]['fit']}; {report(name, made[name]['boxes'], tallest)}")
        if not only_report:
            with open(path, "w") as f:
                json.dump(made, f, indent=1)
