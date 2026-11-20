# What a dense wood of each kind costs to draw on the medium tier, counted from the levels themselves: a wood of 5 by 5
# chunks (320 m square) with a tree every 64 square metres, as the engine's dense-wood bench fills it, seen from its
# middle at eye height in eight directions on a 1,920 by 1,080 screen. Each tree is drawn at the level its 16 m cell's
# middle chooses, every tree at the kind's largest size. Prints the total and each level's share of it. Run with
# python3 from this folder.

import math
import random
import sys

import banyans
import figs
import mangroves
import oaks
import palms
import young

MEDIUM = 3505
SIZE = 1.25
FOV_X = math.radians(102)


def starts(height, kind):
    """Where the medium tier first draws each near level after the finest, as asset.ts states the errors."""
    if kind == "palms":
        at = (14, 55, height * 771 / 55, height * 771 / 20)
    elif kind == "mangroves":
        at = (14, 40, max(48, height * 771 / 140), height * 771 / 24)
    else:
        at = (14, 28, 40, max(48, height * 771 / 140), height * 771 / 24)
    return [0.0] + [d * SIZE for d in at]


def cost(module, pieces):
    """Triangles a frame, in all and by level."""
    tris = {}
    heights = {}
    for name in pieces:
        levels = [module.build(name, l) for l in range(module.levels(name))]
        tris[name] = [m.triangles() for m in levels]
        heights[name] = max(p[1] for p in levels[0].points)
    rng = random.Random(3)
    trees = []
    for i in range(40):
        for j in range(40):
            x, z = -160 + 8 * i + rng.uniform(0, 8), -160 + 8 * j + rng.uniform(0, 8)
            trees.append((x, z, rng.choice(pieces)))
    by_level = [0.0] * len(starts(1.0, module.__name__))
    for k in range(8):
        yaw = k * math.pi / 4
        for x, z, name in trees:
            # The middle of its 16 m cell sets its level; whether it is in view, its own place, give or take its crown.
            cx, cz = (math.floor(x / 16) + 0.5) * 16, (math.floor(z / 16) + 0.5) * 16
            d = math.hypot(cx, cz)
            ang = math.atan2(x, z) - yaw
            ang = (ang + math.pi) % (2 * math.pi) - math.pi
            if abs(ang) > FOV_X / 2 + math.atan2(10, max(1.0, math.hypot(x, z))):
                continue
            s = starts(heights[name], module.__name__)
            level = max(i for i, at in enumerate(s) if d >= at)
            by_level[level] += tris[name][level] / 8
    return sum(by_level), by_level


if __name__ == "__main__":
    for label, module in (("palms", palms), ("young oaks", young), ("elder oaks", oaks), ("strangler figs", figs), ("banyans", banyans), ("mangroves", mangroves)):
        pieces = [n for n, _ in module.PIECES if not n.endswith("_depleted")]
        total, by_level = cost(module, pieces)
        print(f"{label:16} {total / 1e6:.2f} M triangles a frame; by level " + ", ".join(f"{t / 1e6:.2f}" for t in by_level))
    sys.stdout.flush()
