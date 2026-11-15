# Saw palmetto (core:palmetto): stiff folded fans on long thin stalks from one to three crowns, each crown at the end of
# a fibrous trunk that creeps along the ground; dead fans hang orange-brown round the base and a spear rises from the
# middle. Cut, it keeps its trunks, the spear and stubs of the stalks, and the cut fans lie round it.

import math

from mathutils import Vector

import kit
from tones import tone

ATLAS = "palmetto"
UP = Vector((0, 0, 1))


def crowns(v, rng):
    """Each crown: where its trunk starts below the ground, the line it creeps along, and the crown at its end."""
    out = []
    for k in range(v["crowns"]):
        a = v.get("heading", 0.0) + 2 * math.pi * k / v["crowns"] + rng.uniform(-0.5, 0.5)
        run = v["creep"] * rng.uniform(0.6, 1.0) if k > 0 or v["crowns"] == 1 else v["creep"] * 0.25
        d = Vector((math.cos(a), math.sin(a), 0))
        start = -d * run * 0.45 + Vector((0, 0, -0.1))
        rise = rng.uniform(0.08, 0.18) * v["height"] / 1.25
        crown = d * run * 0.55 + Vector((0, 0, rise))
        side = Vector((-d.y, d.x, 0)) * rng.uniform(-0.08, 0.08)
        line = [start, start.lerp(crown, 0.4) + side + Vector((0, 0, -0.03)), start.lerp(crown, 0.75) + side * 0.5, crown]
        r = v["trunk"] * rng.uniform(0.85, 1.1)
        out.append({"line": line, "radii": [r * 0.9, r, r * 0.95, r * 0.85], "crown": crown, "heading": a})
    return out


def fans(v, rng, crown, share):
    """The fans of one crown: each a stalk from the crown and a folded blade at its end."""
    out = []
    n = max(3, round(v["fans"] * share))
    golden = math.pi * (3 - math.sqrt(5))
    tall = v["height"]
    for i in range(n):
        az = crown["heading"] + i * golden + rng.uniform(-0.35, 0.35)
        inner = i < n * 0.3
        # The far side of the clump stands taller, the near side spreads low: high_side is the azimuth of the tall side.
        rear = math.cos(az - v.get("high_side", 1.0))
        el = math.radians(rng.uniform(64, 82) if inner else rng.uniform(32, 58) + 14 * rear)
        stalk = rng.uniform(0.25, 0.75) * tall / 1.25 * (0.6 if inner else 1.0 + 0.15 * rear)
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        sag = rng.uniform(0.03, 0.1) * stalk * (1.4 if rear < 0 else 1.0)
        start = crown["crown"]
        end = start + d * stalk - UP * sag
        mid = start.lerp(end, 0.5) + UP * sag * 0.4
        # The blade carries on from its stalk and faces out and up; turned broadside, obliquely, or now and then
        # edge-on to the eye.
        along = (d + UP * rng.uniform(0.1, 0.45)).normalized()
        out_h = Vector((d.x, d.y, 0)).normalized()
        tilt = math.radians(rng.uniform(15, 70))
        face = out_h * math.cos(tilt) + UP * math.sin(tilt)
        face = (face - along * face.dot(along)).normalized()
        roll = math.radians(rng.uniform(20, 50) if rng.chance(0.7) else rng.uniform(60, 85)) * (1 if rng.chance(0.5) else -1)
        face = (face * math.cos(roll) + along.cross(face) * math.sin(roll)).normalized()
        out.append({"stalk": [start, mid, end], "along": along, "face": face, "size": rng.uniform(0.85, 1.15) * (0.95 if inner else 1.0), "fold": rng.uniform(0.35, 0.6), "bend": rng.uniform(-0.35, 0.15), "inner": inner, "az": az})
    return out


def build(v, picked=False):
    rng = kit.Rng(v["seed"])
    sp = kit.sprites(ATLAS)
    # Mostly mature blue-green fans; fresh, torn and bleached ones are the odd few.
    mix = v.get("mix", {"fan4": 4, "fan5": 3, "fan2": 2, "fan3": 1, "fan6": 1})
    live = [n for n in sp if n.startswith("fan") for _ in range(mix.get(n, 1))]
    dead = [n for n in sp if n.startswith("deadfan")] or live
    trunk, stalk = sp["bark"], sp.get("stalk", sp["bark"])
    L = [kit.Level(True), kit.Level(False), kit.Level(False), kit.Level(False)]
    centre = Vector((0, 0, v["height"] * 0.4))
    wood = kit.hexname(tone(ATLAS, "bark"))
    green = kit.hexname(tone(ATLAS, "stalk"))
    cut = kit.Rng(v["seed"] * 5 + 1)
    tips = []

    def blade(name, place, flat, quad=True):
        """A fan: the cut-out card, and for the flat levels its web and fingers, seven and then three; far off, two fans
        in three."""
        fan = "spikes" in sp[name]
        kit.card(L[0], ATLAS, name, place, ATLAS, centre, 0.45)
        kit.card(L[1], ATLAS, name, place, flat, centre, outline="spikes" if fan else "card")
        if quad and len(tips) % 3 != 2:
            kit.card(L[2], ATLAS, name, place, flat, centre, outline="spikes5" if fan else "quad")

    cs = crowns(v, rng)
    weights = [1.0] + [0.6] * (len(cs) - 1)
    cuts = [0, 0]
    for c, w in zip(cs, weights):
        kit.tube(L[0], c["line"], c["radii"], 6, ATLAS, trunk)
        kit.tube(L[1], c["line"], c["radii"], 4, wood)
        kit.tube(L[2], [c["line"][0], c["line"][-1]], [c["radii"][0], c["radii"][-1]], 3, wood)
        for f in fans(v, rng, c, w / sum(weights)):
            name = "fan1" if f["inner"] and "fan1" in sp and rng.chance(0.5) else rng.pick(live)
            flat = kit.hexname(tone(ATLAS, name))
            r = sp[name]["metres"] * v["fan_size"] / 0.4 * f["size"]
            if picked:
                # Cut through the stalk at unequal heights; a few of the fans lie where they fell.
                a, m, b = f["stalk"]
                if cuts[0] < v.get("stubs", 7):
                    cuts[0] += 1
                    stub = a + (b - a).normalized() * cut.uniform(0.12, 0.3)
                    kit.tube(L[0], [a, a.lerp(stub, 0.5), stub], [0.011, 0.01, 0.009], 4, ATLAS, stalk, end_cap=True)
                    kit.tube(L[1], [a, stub], [0.011, 0.009], 3, green, end_cap=True)
                if cuts[1] < 3 and cut.chance(0.35):
                    cuts[1] += 1
                    foot = Vector((math.cos(f["az"]), math.sin(f["az"]), 0)) * cut.uniform(0.45, 0.85) * v["height"] + Vector((0, 0, 0.02))
                    lie = Vector((math.cos(f["az"] + cut.uniform(-1, 1)), math.sin(f["az"] + cut.uniform(-1, 1)), 0.08)).normalized()
                    blade(name, kit.Place(foot, lie, (UP + lie * -0.2).normalized(), r, 0.1, 0.3), flat, quad=False)
                continue
            kit.spindle(L[0], f["stalk"], 0.009, 3, ATLAS, stalk)
            kit.spindle(L[1], f["stalk"], 0.009, 3, green)
            place = kit.Place(f["stalk"][2], f["along"], f["face"], r, f["bend"], f["fold"])
            blade(name, place, flat)
            tips.append(place.tip())
        # Dead fans hang round the base of the crown.
        for i in range(v.get("dead", 2) if w == 1.0 else 1):
            az = c["heading"] + rng.uniform(0, 2 * math.pi)
            out_h = Vector((math.cos(az), math.sin(az), 0))
            start = c["crown"]
            end = start + out_h * rng.uniform(0.12, 0.25) + UP * rng.uniform(-0.02, 0.06)
            kit.spindle(L[0], [start, start.lerp(end, 0.5), end], 0.008, 3, ATLAS, stalk)
            kit.spindle(L[1], [start, start.lerp(end, 0.5), end], 0.008, 3, wood)
            along = (out_h * 0.45 - UP).normalized()
            name = rng.pick(dead)
            place = kit.Place(end, along, out_h + UP * 0.2, sp[name]["metres"] * v["fan_size"] / 0.4 * rng.uniform(0.8, 1.0), rng.uniform(0.0, 0.3), rng.uniform(0.3, 0.6))
            blade(name, place, kit.hexname(tone(ATLAS, name)), quad=True)
        # The spear: the new leaf, still folded, from the middle of the crown.
        if "spear1" in sp and w == 1.0:
            along = (UP + Vector((rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), 0))).normalized()
            place = kit.Place(c["crown"], along, Vector((1, 0, 0)), v["height"] * rng.uniform(0.4, 0.55), 0.0)
            name = "spear1"
            kit.card(L[0], ATLAS, name, place, ATLAS, centre, 0.3)
            kit.card(L[1], ATLAS, name, place, kit.hexname(tone(ATLAS, name)), centre)
            if not picked:
                tips.append(place.tip())

    # The coarsest: a fountain of a few long blades from the middle, which still says "spiky" at a few pixels.
    far_tone = kit.hexname(tone(ATLAS, "fan2"))
    if picked:
        for c in cs:
            kit.tube(L[3], [c["line"][0], c["line"][-1]], [c["radii"][0], c["radii"][-1]], 3, wood)
    else:
        tips = sorted(tips, key=lambda p: math.atan2(p.y, p.x))
        step = max(1, len(tips) // 6)
        for p in tips[::step][:6]:
            base = Vector((p.x * 0.15, p.y * 0.15, 0.05))
            out = Vector((p.x, p.y, 0)).normalized()
            side = Vector((-out.y, out.x, 0)) * v["fan_size"] * 0.55
            a, b, c = L[3].vert(base), L[3].vert(p + side), L[3].vert(p - side)
            L[3].tri(a, b, c, far_tone)
            a2, b2, c2 = L[3].vert(base), L[3].vert(p + side), L[3].vert(p - side)
            L[3].tri(a2, c2, b2, far_tone)
    return L
