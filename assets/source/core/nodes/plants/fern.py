# The fern (core:fern): a rosette of sword-shaped fronds arching up and out from a crown at the ground, young ones
# upright at the middle, dead ones lying brown at the edge. Torn back, it keeps its crown, stubs of stalks and a few
# broken fronds on the ground.

import math

from mathutils import Vector

import kit
from tones import tone

ATLAS = "fern"
UP = Vector((0, 0, 1))


def fronds(v, rng, sp, green, young):
    """Each frond an element of the atlas at its own length, scaled so the individual's fronds average v["length"]. Short
    upright growth in the middle, a ring of rising arches round it and the longest arching out and down outside, one
    side left more open."""
    scale = v["length"] / (sum(sp[n]["metres"] for n in green) / len(green))
    out = []
    n = v["fronds"]
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        az = i * golden + rng.uniform(-0.35, 0.35)
        ring = 0 if i < n * 0.3 else 1 if i < n * 0.65 else 2
        # Rising steeply from the crown, then curving out and down: the outer ones furthest, their tips below their top.
        el = math.radians((rng.uniform(70, 86), rng.uniform(56, 72), rng.uniform(38, 60))[ring])
        bend = -(rng.uniform(0.3, 0.6), rng.uniform(0.9, 1.3), rng.uniform(1.4, 1.9))[ring]
        if math.cos(az - v.get("open", 0.0)) > 0.85:
            el -= math.radians(10)
        name = rng.pick(young if ring == 0 and rng.chance(0.4) else green)
        length = sp[name]["metres"] * scale * (0.6, 0.95, 1.1)[ring] * (rng.uniform(0.9, 1.1) if ring < 2 else rng.uniform(0.8, 1.2))
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        face = UP - d * d.z
        face.normalize()
        roll = rng.uniform(-0.4, 0.4)
        face = (face * math.cos(roll) + d.cross(face) * math.sin(roll)).normalized()
        start = Vector((math.cos(az), math.sin(az), 0)) * v.get("crown", 0.05) * rng.uniform(0.2, 1.0) + UP * 0.02
        out.append({"start": start, "along": d, "face": face, "length": length, "bend": bend, "fold": rng.uniform(0.15, 0.3), "inner": ring == 0, "az": az, "name": name})
    return out


def build(v, picked=False):
    rng = kit.Rng(v["seed"])
    sp = kit.sprites(ATLAS)
    green = [n for n in sp if n.startswith("frond")]
    dead = [n for n in sp if n.startswith("deadfrond")] or green
    young = [n for n in sp if n.startswith("young")] or green
    crown_bark = sp["bark"]
    L = [kit.Level(True), kit.Level(False), kit.Level(False), kit.Level(False)]
    centre = Vector((0, 0, v["length"] * 0.3))
    brown = kit.hexname(tone(ATLAS, "bark"))
    torn = kit.Rng(v["seed"] * 3 + 11)
    tips = []

    def frond(name, place, flat, span=None, far=True):
        kit.card(L[0], ATLAS, name, place, ATLAS, centre, 0.4, outline="strip", span=span)
        kit.card(L[1], ATLAS, name, place, flat, centre, outline="saw" if "saw" in sp[name] else "strip", span=span)
        if far:
            kit.card(L[2], ATLAS, name, place, flat, centre, outline="strip3", span=span)

    # The crown: a low scaly knob, carried a little below the ground.
    r = v.get("crown", 0.05)
    knob = [Vector((0, 0, -0.08)), Vector((0, 0, -0.01)), Vector((0, 0, 0.03))]
    kit.tube(L[0], knob, [r * 0.9, r * 0.95, r * 0.55], 6, ATLAS, crown_bark)
    kit.tube(L[1], knob, [r * 0.9, r * 0.95, r * 0.55], 4, brown)
    kit.tube(L[2], knob, [r * 0.9, r * 0.95, r * 0.55], 3, brown)

    stubs = partial = fallen = 0
    for f in fronds(v, rng, sp, green, young):
        name = f["name"]
        flat = kit.hexname(tone(ATLAS, name))
        place = kit.Place(f["start"], f["along"], f["face"], f["length"], f["bend"], f["fold"])
        if picked:
            # Torn back to the crown: green stalks torn off at unequal heights, one or two fronds broken half way and
            # still standing, the young curls left, and a broken piece or two on the ground.
            if name.startswith("young"):
                frond(name, place, flat, far=False)
            elif partial < 2 and torn.chance(0.25):
                partial += 1
                frond(name, place, flat, span=(sp[name]["lo"], torn.uniform(0.45, 0.6)), far=False)
            elif stubs < 7:
                stubs += 1
                stub = kit.Place(f["start"], (f["along"] + UP * 0.6).normalized(), f["face"], f["length"], f["bend"] * 0.3, 0.0)
                frond(name, stub, flat, span=(sp[name]["lo"], sp[name]["lo"] + torn.uniform(0.2, 0.36)), far=False)
            if fallen < 2 and torn.chance(0.3):
                fallen += 1
                foot = Vector((math.cos(f["az"]), math.sin(f["az"]), 0)) * torn.uniform(0.3, 0.6) * v["length"] + UP * 0.015
                lie = Vector((math.cos(f["az"] + torn.uniform(-1.2, 1.2)), math.sin(f["az"] + torn.uniform(-1.2, 1.2)), 0.02)).normalized()
                frond(name, kit.Place(foot, lie, UP, f["length"], 0.0), flat, span=(torn.uniform(0.35, 0.55), 1.0), far=False)
            continue
        frond(name, place, flat)
        tips.append(place.tip())
    # Old fronds, brown and drooping to the ground at the edge.
    for i in range(v.get("dead", 1)):
        az = rng.uniform(0, 2 * math.pi)
        d = Vector((math.cos(az) * 0.7, math.sin(az) * 0.7, 0.7)).normalized()
        name = dead[0] if rng.chance(0.75) else rng.pick(dead)
        face = UP - d * d.z
        place = kit.Place(Vector((math.cos(az), math.sin(az), 0)) * r + UP * 0.01, d, face.normalized(), v["length"] * rng.uniform(0.8, 1.0), -1.9, 0.1)
        frond(name, place, kit.hexname(tone(ATLAS, name)))

    # The coarsest: a few long blades arching out from the crown.
    far_tone = kit.hexname(tone(ATLAS, "frond3"))
    if not picked:
        tips = sorted(tips, key=lambda p: math.atan2(p.y, p.x))
        step = max(1, len(tips) // 6)
        for p in tips[::step][:6]:
            out = Vector((p.x, p.y, 0)).normalized()
            side = Vector((-out.y, out.x, 0)) * v["length"] * 0.12
            mid = Vector((p.x * 0.55, p.y * 0.55, v["length"] * 0.55))
            for a, b, c in (((0, 0, 0.02), mid + side, mid - side), (tuple(mid + side), p, tuple(mid - side))):
                va, vb, vc = L[3].vert(Vector(a)), L[3].vert(Vector(b)), L[3].vert(Vector(c))
                L[3].tri(va, vb, vc, far_tone)
                va, vb, vc = L[3].vert(Vector(a)), L[3].vert(Vector(b)), L[3].vert(Vector(c))
                L[3].tri(va, vc, vb, far_tone)
    else:
        kit.tube(L[3], knob, [r * 0.9, r * 0.95, r * 0.55], 3, brown)
    return L
