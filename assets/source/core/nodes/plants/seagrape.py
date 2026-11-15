# Sea grape (core:seagrape): a low sprawling shrub of the beach edge, crooked grey limbs from one base forking out and
# up, big round leaves in loose groups at nodes along the twigs, held every way, bunches of fruit hanging clear of them.
# Stripped, it keeps its limbs and a few leaves; torn twigs hang and leaves lie under it.

import math

from mathutils import Vector

import kit
from tones import tone

ATLAS = "seagrape"
UP = Vector((0, 0, 1))


def limbs(v, rng):
    """Branches as lines with radii, each forking toward the outline. Returns the lines and the twigs that carry leaves."""
    lines, twigs = [], []

    def grow(start, d, length, radius, depth):
        pts, radii = [start], [radius]
        p = start
        steps = 3 if depth > 0 else 2
        for k in range(steps):
            # Crooked: each step turns a little, and the limb rises toward the light as it goes out.
            d = (d + Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), rng.uniform(-0.15, 0.15)))).normalized()
            if p.z < 0.25 and d.z < 0.15:
                d = (d + UP * 0.4).normalized()
            p = p + d * (length / steps)
            pts.append(p)
            radii.append(radius * (1 - 0.45 * (k + 1) / steps))
        lines.append((pts, radii))
        if depth == 0 or radius < 0.012:
            twigs.append((pts, radii))
            return
        for j in range(2 if depth > 1 else rng.pick([2, 2, 3])):
            spin = rng.uniform(0.5, 1.0) * (1 if j == 0 else -1)
            side = d.cross(UP)
            if side.length < 1e-3:
                side = Vector((1, 0, 0))
            nd = (d + side.normalized() * spin + UP * rng.uniform(0.0, 0.3)).normalized()
            grow(p, nd, length * rng.uniform(0.6, 0.8), radii[-1] * 0.8, depth - 1)

    for k in range(v["limbs"]):
        az = v.get("heading", 0.0) + 2 * math.pi * k / v["limbs"] + rng.uniform(-0.4, 0.4)
        lean = math.radians(rng.uniform(*v.get("lean", (50, 70))) if k > 0 else rng.uniform(15, 30))
        d = Vector((math.cos(az) * math.sin(lean), math.sin(az) * math.sin(lean), math.cos(lean)))
        start = Vector((math.cos(az) * 0.04, math.sin(az) * 0.04, -0.12))
        grow(start, d, v["reach"] * rng.uniform(0.45, 0.6), v["radius"] * rng.uniform(0.8, 1.1), v.get("forks", 2))
    return lines, twigs


def build(v, picked=False):
    rng = kit.Rng(v["seed"])
    sp = kit.sprites(ATLAS)
    leaves = [n for n in sp if n.startswith("leaf")]
    # Red, orange and yellowing leaves are the odd few among the green.
    common = [n for n in leaves if sp[n]["mean"][0] < sp[n]["mean"][1] * 0.95]
    fruit = [n for n in sp if n.startswith("fruit")]
    bark = sp["bark"]
    L = [kit.Level(True), kit.Level(False), kit.Level(False), kit.Level(False)]
    centre = Vector((0, 0, v["height"] * 0.55))
    grey = kit.hexname(tone(ATLAS, "bark"))
    strip_rng = kit.Rng(v["seed"] * 13 + 5)
    lines, twigs = limbs(v, rng)
    for pts, radii in lines:
        thick = radii[0] > 0.025
        kit.tube(L[0], pts, radii, 4 if radii[0] > 0.025 else 3, ATLAS, bark)
        kit.tube(L[1], pts, radii, 3, grey)
        if thick:
            kit.tube(L[2], [pts[0], pts[-1]], [radii[0], radii[-1]], 3, grey)
    tips = []
    clusters = []
    # Leaves sit along the outer half of every branch thin enough to carry them, thickest at the ends.
    carriers = list(lines)
    for pts, radii in carriers:
        group = []
        length = sum((pts[k + 1] - pts[k]).length for k in range(len(pts) - 1))
        is_twig = any(pts is t[0] for t in twigs)
        # Leaves come in loose groups of three to seven at nodes staggered along the outer part of a twig (and near the
        # end of a limb), most at the end; each leaf on its stalk out from the node and up, its neighbours turned 15 to
        # 45 degrees from it.
        nodes = max(1, round(length * v["nodes"])) if is_twig else 1
        fruiting = is_twig and rng.chance(v.get("fruiting", 0.3))
        for j in range(nodes):
            f = 0.96 - (j / max(1, nodes - 1)) * 0.5 if nodes > 1 else 0.96
            seg = min(len(pts) - 2, int(f * (len(pts) - 1)))
            p = pts[seg].lerp(pts[seg + 1], f * (len(pts) - 1) - seg)
            d = (pts[min(seg + 1, len(pts) - 1)] - pts[seg]).normalized()
            side = d.cross(UP)
            side = side.normalized() if side.length > 1e-3 else Vector((1, 0, 0))
            end = j == 0 and is_twig
            k = rng.pick([6, 7, 8] if end else [4, 5] if is_twig else [2, 3])
            spin0 = rng.uniform(0, 2 * math.pi)
            for i in range(k):
                ang = spin0 + 2 * math.pi * i / k + rng.uniform(-0.3, 0.3)
                ring = side * math.cos(ang) + d.cross(side) * math.sin(ang)
                out = (d * rng.uniform(0.3, 0.8) + ring * rng.uniform(0.6, 1.0) + UP * rng.uniform(0.2, 0.8)).normalized()
                tilt = math.radians(rng.uniform(20, 80))
                face = UP * math.cos(tilt) + ring * math.sin(tilt)
                face = face - out * face.dot(out)
                face = face.normalized() if face.length > 1e-3 else UP
                young = end and i == 0 and "leaf4" in sp
                name = "leaf4" if young else (rng.pick(common) if rng.chance(0.84) else rng.pick(leaves))
                size = sp[name]["metres"] * v["leaf"] / 0.2 * rng.uniform(0.85, 1.15)
                place = kit.Place(p, out, face, size, rng.uniform(-0.3, 0.15), rng.uniform(0.15, 0.3) if rng.chance(0.3) else 0.0)
                if picked and not strip_rng.chance(0.1):
                    if strip_rng.chance(0.06):
                        foot = Vector((p.x, p.y, 0)) * strip_rng.uniform(0.8, 1.2) + UP * 0.01
                        lie = Vector((strip_rng.uniform(-1, 1), strip_rng.uniform(-1, 1), 0.03)).normalized()
                        kit.card(L[0], ATLAS, name, kit.Place(foot, lie, UP, size, 0.0), ATLAS, centre, 0.1)
                        kit.card(L[1], ATLAS, name, kit.Place(foot, lie, UP, size, 0.0), kit.hexname(tone(ATLAS, name)), centre)
                    continue
                kit.card(L[0], ATLAS, name, place, ATLAS, centre, 0.5)
                kit.card(L[1], ATLAS, name, place, kit.hexname(tone(ATLAS, name)), centre)
                group.append(place)
        if group:
            clusters.append(group)
        # Fruit hangs from some twigs, two cards crossed so it has depth from every side.
        if fruiting and fruit and not picked:
            out_h = Vector((pts[-1].x - pts[0].x, pts[-1].y - pts[0].y, 0))
            out_h = out_h.normalized() if out_h.length > 1e-3 else Vector((1, 0, 0))
            p = pts[-1] + out_h * v["leaf"] * 0.6 - UP * 0.04
            name = rng.pick(fruit)
            size = sp[name]["metres"] * rng.uniform(0.85, 1.1)
            down = (-UP + Vector((rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), 0))).normalized()
            for turn in (0.0, math.pi / 2):
                face = Vector((math.cos(turn), math.sin(turn), 0))
                place = kit.Place(p, down, face, size, 0.0)
                kit.card(L[0], ATLAS, name, place, ATLAS, centre, 0.3)
                kit.card(L[1], ATLAS, name, place, kit.hexname(tone(ATLAS, name)), centre)
        if is_twig:
            tips.append(pts[-1])
    # Far off, each twig's leaves are one patch of leaf colour: a polygon through them, facing up.
    leaf_tone = kit.hexname(tone(ATLAS, "leaf1"))
    for group in clusters:
        pts = [pl.tip() for pl in group] + [pl.origin for pl in group]
        if len(pts) < 3:
            continue
        mid = sum(pts, Vector()) / len(pts)
        ring = sorted(pts, key=lambda q: math.atan2(q.y - mid.y, q.x - mid.x))
        hull = _hull2(ring)
        front = [L[2].vert(q) for q in hull]
        back = [L[2].vert(q) for q in hull]
        for i in range(1, len(hull) - 1):
            L[2].tri(front[0], front[i], front[i + 1], leaf_tone)
            L[2].tri(back[0], back[i + 1], back[i], leaf_tone)
    # The coarsest: a low lump of crown over a short trunk.
    crown = sorted(tips, key=lambda p: -(p - centre).length)[:12]
    if picked:
        for pts, radii in lines:
            if radii[0] > v["radius"] * 0.8:
                kit.tube(L[3], [pts[0], pts[-1]], [radii[0], radii[-1]], 3, grey)
    else:
        kit.hull(L[3], crown + [centre * 0.6], leaf_tone)
        kit.spindle(L[3], [Vector((0, 0, -0.1)), Vector((0, 0, v["height"] * 0.2)), centre * 0.7], v["radius"], 3, grey)
    return L


def _hull2(points):
    """The convex hull of points seen from above, keeping their heights, counter-clockwise."""
    pts = sorted(set((round(p.x, 5), round(p.y, 5), round(p.z, 5)) for p in points))
    if len(pts) < 3:
        return [Vector(p) for p in pts]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return [Vector(p) for p in lower[:-1] + upper[:-1]]
