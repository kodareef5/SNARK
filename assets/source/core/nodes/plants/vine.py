# Vine (core:vine): ivy hanging from a slab's broken edge or a balcony's lip, where a ruin's wall stands open. Strands of
# uneven length, spacing and thickness fall from a mat along the edge, each a chain of the creeper's hanging runs one
# below the next, with leafy runs standing off it, more of them near the top where the growth is old, fewer and smaller
# toward the tip. It is made with the edge along x at z = 0, the wall at y = 0, hanging to -z and standing out to -y,
# then moved so its box's middle is its origin, as a static's is. Torn, a few short strands are left.

import math

from mathutils import Vector

import kit
from tones import tone

ATLAS = "creeper"
OUT = Vector((0, -1, 0))
DOWN = Vector((0, 0, -1))


def build(v, picked=False):
    rng = kit.Rng(v["seed"])
    sp = kit.sprites(ATLAS)
    runs = [n for n in sp if n.startswith("run")]
    hangs = [n for n in sp if n.startswith("hang")]
    L = [kit.Level(True), kit.Level(False), kit.Level(False), kit.Level(False)]
    half = v["width"] / 2
    centre = Vector((0, 0.4, -v["length"] * 0.35))
    hang = kit.hexname(tone(ATLAS, "hang"))
    run = kit.hexname(tone(ATLAS, "run"))
    mat = kit.hexname(tone(ATLAS, "mat"))

    # Where the strands fall: gaps of 15 to 70 cm, each its own length and growth.
    strands = []
    x = -half + rng.uniform(0.05, 0.3)
    while x < half - 0.05:
        strands.append((x, v["length"] * rng.uniform(0.25, 1.0) * (0.35 if picked else 1.0), rng.uniform(0.6, 1.4)))
        x += rng.uniform(0.15, 0.7)
    if picked:
        strands = strands[:: 2]

    # The mat along the edge: leafy runs lying over it, out and a little down, in clumps with gaps of bare edge.
    k = 0
    while k < (0 if picked else v.get("mat", 8)):
        at = Vector((rng.uniform(-half, half), -0.03, 0.02))
        way = Vector((rng.uniform(-1, 1), -0.4, -0.3)).normalized()
        name = rng.pick(runs)
        place = kit.Place(at, way, OUT + Vector((0, 0, 0.6)), sp[name]["metres"] * rng.uniform(0.7, 1.0), -0.3)
        kit.card(L[0], ATLAS, name, place, ATLAS, centre, 0.4)
        kit.card(L[1], ATLAS, name, place, mat, centre, 0.4, outline="card4")
        k += 1

    for x, length, growth in strands:
        at = Vector((x, -0.04, 0.0))
        fallen = 0.0
        links = []
        while fallen < length:
            name = rng.pick(hangs)
            size = min(sp[name]["metres"] * rng.uniform(0.75, 1.0), length - fallen + 0.1)
            sway = (DOWN + Vector((rng.uniform(-0.18, 0.18), rng.uniform(-0.12, 0.02), 0))).normalized()
            face = (OUT + Vector((rng.uniform(-0.5, 0.5), 0, rng.uniform(-0.1, 0.3)))).normalized()
            place = kit.Place(at, sway, face, size, rng.uniform(-0.25, 0.25))
            kit.card(L[0], ATLAS, name, place, ATLAS, centre, 0.3)
            links.append(place)
            at = place.tip() + OUT * 0.005
            fallen += size * 0.95
        # Leafy runs stand off the strand, as many as its growth, more and larger toward the top.
        for q in range(int(len(links) * 2 * growth) + 1):
            f = rng.uniform(0.0, 1.0) ** 1.6
            link = links[min(len(links) - 1, int(f * len(links)))]
            p, d, n = link.frame(rng.uniform(0.1, 0.9))
            side = Vector((rng.uniform(-1, 1), 0, 0))
            way = (d * 0.6 + side * 0.8 + OUT * 0.3).normalized()
            name = rng.pick(runs)
            size = sp[name]["metres"] * rng.uniform(0.55, 0.85) * (1.0 - 0.4 * f) * (0.8 + 0.2 * growth)
            leaf = kit.Place(p + OUT * 0.02, way, (OUT + Vector((0, 0, 0.3))).normalized(), size, -0.4, rng.uniform(0.0, 0.3))
            kit.card(L[0], ATLAS, name, leaf, ATLAS, centre, 0.4)
        # Flat: the strand as a thin stem with small leaves one side and the other; as quads for its hanging runs; and
        # farthest, one long quad.
        top, tip = links[0].origin, links[-1].tip()
        kit.spindle(L[1], [top, top.lerp(tip, 0.5), tip], 0.006 * growth + 0.004, 3, run)
        for q in range(max(2, int(length / 0.25))):
            f = (q + 0.5) / max(2, int(length / 0.25))
            p = top.lerp(tip, f) + Vector((0.04 if q % 2 else -0.04, -0.01, 0))
            tilt = (DOWN + Vector((0.9 if q % 2 else -0.9, 0, 0))).normalized()
            kit.card(L[1], ATLAS, rng.pick(runs), kit.Place(p, tilt, OUT, 0.18 * (1.0 - 0.3 * f) * growth, 0.0), hang, centre, 0.3, outline="card4")
        for link in links:
            kit.card(L[2], ATLAS, rng.pick(hangs), link, hang, centre, outline="quad")
        kit.card(L[3], ATLAS, hangs[0], kit.Place(top, DOWN, OUT, max(0.3, (tip - top).length), 0.0), hang, centre, outline="quad")
    # A static is drawn about the middle of its box: the edge at the box's top, the leaves either side of its middle.
    shift = Vector((0, 0.22, v["length"] / 2))
    for level in L:
        level.co = [tuple(Vector(c) + shift) for c in level.co]
    return L
