# The crafting stations, one mesh object each, named as asset.ts names them: the mortar and pestle, the smithy, the
# refining forge, the fabricator and the preserving bin, and the lit forms of the last three. Each takes the place of the
# grey box of the structure with its id, and is modelled inside that box (content's half extents, or the ones chosen
# here for the stations content does not have yet: BOXES). Built to the concept views in ref/concept-a/ and
# ref/concept-b/, in the station's frame of kit.py: R right, U up, F out of the front, metres from the box's middle.
#
# Materials, three at most on a station (asset.ts names their pictures): the stone tools' "stone", "lashing" and the
# weapons' "hide"; the wood tier's "boards"; the stone tier's "iron"; this asset's own "kiln" and "plate". A fire is a
# material with no pictures, drawn in its palette colour: "ash" where a station is out and "ember" where it burns, the
# fabricator's lamps "glass" off and "lamp" on (the renderer has no emissive light, D436, so a fire is its shape and its
# colour). The coarser levels are made from the finest by the build (asset.ts: flat, budgets).

import math
import random

from kit import BANDS, F, Part, R, U, V, at, box, cylinder_between, loft, material, place, prism, ring

# Content's half extents, R, U, F, and the ones chosen for the stations to come (stations-plan.md S1 to S3 adopt them).
BOXES = {
    "mortar": (0.30, 0.25, 0.30),
    "smithy": (0.80, 0.55, 0.40),
    "forge": (0.60, 0.85, 0.60),
    "fabricator": (0.85, 0.65, 0.45),
    "bin": (0.40, 0.60, 0.35),
}

# The flat colours, each a palette colour (shared/pack/palette.ts) so it is drawn as it is.
material("ash", (64, 59, 55))
material("ember", (218, 130, 43))
material("glass", (62, 68, 72))
material("lamp", (236, 208, 72))
# A far level's flat colours, each its station's material as it reads from afar.
for name, colour in {"far_wood": (172, 128, 82), "far_stone": (88, 80, 72), "far_clay": (168, 132, 100), "far_iron": (44, 41, 39), "far_plate": (98, 110, 92)}.items():
    material(name, colour)


# ---- the mortar and pestle -------------------------------------------------------------------------------------------


def mortar():
    p = Part("mortar")
    hx, hy, hz = BOXES["mortar"]
    g = -hy  # the ground
    eight = math.pi / 8  # a flat to the front
    # Three stubby feet under the bowl, one at the back.
    for a in (0.0, 2 * math.pi / 3, 4 * math.pi / 3):
        c = (math.sin(a + math.pi) * 0.16, math.cos(a + math.pi) * 0.16)
        prism(p, c, 0.055, 6, g, g + 0.075, "stone", band="face", r1=0.06)
    # The bowl: eight facets round, in four courses, its lip a pale worn edge, a hollow to a crust of powder.
    foot, lip = g + 0.07, 0.16
    outer = [
        ring((0, 0), 0.17, 8, foot, eight),
        ring((0, 0), 0.25, 8, foot + 0.06, eight),
        ring((0, 0), 0.285, 8, -0.03, eight),
        ring((0, 0), 0.28, 8, 0.09, eight),
        ring((0, 0), 0.27, 8, lip, eight),
    ]
    inner = [
        ring((0, 0), 0.20, 8, lip, eight),
        ring((0, 0), 0.19, 8, 0.10, eight),
        ring((0, 0), 0.15, 8, -0.02, eight),
        ring((0, 0), 0.085, 8, -0.075, eight),
    ]
    # A chip knocked out of the lip at the front left: its corner there lower and further in.
    k = 6  # corners run from the front toward the right; the sixth is front left
    for r in (outer[-1], inner[0]):
        r[k] = r[k] + V(0, -0.035, 0) - V(r[k].x, 0, r[k].z) * 0.04
    # Outside in four courses, the lip a pale worn edge, the hollow, and in its bottom a crust of ground powder: the
    # stone's chalky cortex.
    loft(p, outer + inner, "stone", bands=["face"] * 4 + ["edge"] + ["face"] * 3, cap_bands=("face", "cortex"))
    # A band of hide round the waist, its edges turned in onto the stone, lashed with cord whose two ends hang at the
    # front.
    loft(p, [ring((0, 0), 0.262, 8, -0.085, eight), ring((0, 0), 0.287, 8, -0.085, eight), ring((0, 0), 0.308, 8, -0.03, eight), ring((0, 0), 0.305, 8, 0.03, eight), ring((0, 0), 0.279, 8, 0.03, eight)], "hide", loop=True)
    loft(p, [ring((0, 0), 0.30, 8, -0.013, eight), ring((0, 0), 0.32, 8, -0.013, eight), ring((0, 0), 0.32, 8, 0.004, eight), ring((0, 0), 0.30, 8, 0.004, eight)], "lashing", loop=True)
    for dx, tilt in ((-0.018, -0.25), (0.016, 0.3)):
        top = V(dx, -0.006, 0.288)
        cylinder_between(p, top, top + V(math.sin(tilt) * 0.03, -0.085, 0.004), 0.007, 5, "lashing", r1=0.005)
    # The pestle: a fat stone club standing in the bowl, leaning out to the back right, its top the box's top.
    lean = math.radians(30)
    d = V(math.sin(lean) * math.cos(math.pi / 4), math.cos(lean), -math.sin(lean) * math.sin(math.pi / 4))
    top = V(0.075, hy - 0.022, -0.075)
    length = 0.38
    base = top - d * length
    rings = []
    s = R.cross(d).normalized()
    t = d.cross(s).normalized()
    for f, r in ((0.0, 0.035), (0.06, 0.05), (0.35, 0.046), (0.7, 0.039), (0.97, 0.034), (1.0, 0.027)):
        c = base + d * (length * f)
        rings.append([c + (s * math.cos(2 * math.pi * k / 7 + 0.3) + t * math.sin(2 * math.pi * k / 7 + 0.3)) * r for k in range(7)])
    # The grinding end is rounded off, worn pale.
    loft(p, rings, "stone", bands=["edge", "face", "face", "face", "edge"], cap_band="edge")
    return p.build()


# ---- shared shapes ---------------------------------------------------------------------------------------------------


def nugget(p, c, r, rng, mat, flat=1.0):
    """A lump: a jittered octahedron about c, `r` across its half, squashed to `flat` of that in height."""
    c = V(*c)
    pts = []
    for d in (R, -R, F, -F):
        pts.append(c + d * r * rng.uniform(0.75, 1.2) + U * r * rng.uniform(-0.2, 0.2) * flat)
    top = p.vert(c + U * r * flat * rng.uniform(0.8, 1.2) + R * rng.uniform(-0.3, 0.3) * r)
    bottom = p.vert(c - U * r * flat * 0.6)
    ring_ = [p.vert(q) for q in (pts[0], pts[2], pts[1], pts[3])]
    for k in range(4):
        a, b = ring_[k], ring_[(k + 1) % 4]
        p.face([a, b, top], mat, inside=c)
        p.face([b, a, bottom], mat, inside=c)


def rod(p, a, b, w, mat, h=None, turn=True, **kw):
    """A squared timber or bar from a to b, `w` across and `h` deep (w where not given), its grain along it."""
    a, b = V(*a), V(*b)
    d = (b - a).normalized()
    ref = U if abs(d.dot(U)) < 0.9 else F
    s = ref.cross(d).normalized()
    t = d.cross(s).normalized()
    h = w if h is None else h
    rings = [[c + s * (w / 2) * x + t * (h / 2) * y for x, y in ((1, 1), (-1, 1), (-1, -1), (1, -1))] for c in (a, b)]
    return loft(p, rings, mat, turn=turn, **kw)


# ---- the smithy ------------------------------------------------------------------------------------------------------


def smithy():
    p = Part("smithy")
    hx, hy, hz = BOXES["smithy"]
    g = -hy
    rng = random.Random(7)
    top = g + 0.80  # the bench's working surface
    x0, x1 = -0.74, 0.36  # the bench's ends
    # Three thick planks, their ends uneven, each laid on one board of the picture.
    edges = [-0.37, -0.125, 0.12, 0.37]
    for k in range(3):
        f0, f1 = edges[k] + (0.004 if k else 0), edges[k + 1] - 0.004
        a, b = x0 + rng.uniform(-0.03, 0.02), x1 + rng.uniform(-0.02, 0.03)
        t = top - rng.uniform(0, 0.008)
        box(p, (a, t - 0.09, f0), (b, t, f1), "boards", v0=0.25 * (k + 1) + f1 + 0.003)
    # Four square legs, splayed a little, joined low by stretchers that carry a shelf.
    under = top - 0.09
    legs = [(x, f) for x in (x0 + 0.08, x1 - 0.08) for f in (-0.29, 0.29)]
    for x, f in legs:
        sx = -0.035 if x < 0 else 0.035
        rod(p, (x + sx, g, f + math.copysign(0.035, f)), (x, under, f), 0.1, "boards")
    low = g + 0.15
    for f in (-0.30, 0.30):
        rod(p, (x0 + 0.04, low, f + math.copysign(0.02, f)), (x1 - 0.04, low, f + math.copysign(0.02, f)), 0.06, "boards", h=0.08, turn=False)
    for x in (x0 + 0.06, x1 - 0.06):
        rod(p, (x, low + 0.1, -0.30), (x, low + 0.1, 0.30), 0.055, "boards", h=0.07)
    for k, (f0, f1) in enumerate(((-0.27, -0.005), (0.005, 0.27))):
        box(p, (x0 + 0.1, low + 0.04, f0), (x1 - 0.1, low + 0.075, f1), "boards", v0=0.25 * (k + 5) + f1)
    # Two ingots on the shelf, and a third leaning.
    for k, (x, f, yaw) in enumerate(((-0.45, -0.1, 0.05), (-0.42, 0.1, -0.08), (-0.12, 0.0, 0.6))):
        with at(p, place((x, low + 0.075, f), yaw=yaw)):
            loft(p, [ring((0, 0), 1, 4, 0, math.pi / 4, (0.08, 0.035)), ring((0, 0), 1, 4, 0.05, math.pi / 4, (0.065, 0.025))], "iron")
    # The stump the anvil stands on, through the gap at the bench's right end.
    sx = 0.565
    prism(p, (sx, 0), 0.215, 8, g, g + 0.6, "boards", r1=0.2, turn=True)
    # The anvil: a broad foot, a waist, the face at 0.95, its horn out to the right and its heel over the bench.
    s0 = g + 0.6
    face = g + 0.95
    ax = 0.5
    loft(p, [ring((ax, 0), 1, 4, s0, math.pi / 4, (0.2, 0.15)), ring((ax, 0), 1, 4, s0 + 0.06, math.pi / 4, (0.16, 0.12)), ring((ax, 0), 1, 4, s0 + 0.11, math.pi / 4, (0.09, 0.07))], "iron")
    loft(p, [ring((ax, 0), 1, 4, s0 + 0.105, math.pi / 4, (0.085, 0.066)), ring((ax, 0), 1, 4, face - 0.09, math.pi / 4, (0.085, 0.066))], "iron")
    body = [(ax - 0.17, -0.07), (ax + 0.15, -0.07), (ax + 0.15, 0.07), (ax - 0.17, 0.07)]
    loft(p, [[V(x, face - 0.1, f) for x, f in body], [V(x, face - 0.07, f * 1.05) for x, f in body], [V(x, face, f) for x, f in body]], "iron")
    # The horn: a cone flattened underneath, from the face's right end to a point.
    horn = []
    for x, r in ((ax + 0.15, 0.07), (ax + 0.22, 0.05), (ax + 0.29, 0.028), (ax + 0.285 + 0.01, 0.006)):
        cy = face - 0.03 - (ax + 0.15 - x) * -0.05 - r * 0.4
        horn.append([V(x, cy + math.cos(a) * r * (0.9 if math.cos(a) > 0 else 0.6), math.sin(a) * r) for a in (2 * math.pi * k / 6 for k in range(6))])
    loft(p, horn, "iron")
    # A hammer and tongs on the bench.
    with at(p, place((-0.1, top, 0.12), yaw=0.35)):
        box(p, (-0.03, 0, -0.065), (0.03, 0.055, 0.065), "iron")
        rod(p, (0, 0.03, 0.055), (0, 0.03, 0.34), 0.03, "boards", h=0.026)
    with at(p, place((-0.45, top, -0.1), yaw=-0.25)):
        for side in (-1, 1):
            rod(p, (side * 0.012, 0.006, -0.2), (-side * 0.02, 0.006, 0.2), 0.012, "iron", h=0.012, turn=False)
        box(p, (-0.02, 0.0, -0.215), (0.02, 0.018, -0.17), "iron")
    # The apron: hung from a peg on a post at the bench's left end, its folds over the end.
    rod(p, (-hx + 0.05, g, -0.33), (-hx + 0.05, hy - 0.005, -0.33), 0.07, "boards")
    rod(p, (-hx + 0.05, hy - 0.09, -0.3), (-hx + 0.05, hy - 0.06, -0.18), 0.03, "boards", turn=False)
    folds = [(-0.29, 0.0), (-0.24, 0.025), (-0.19, -0.005), (-0.13, 0.03), (-0.08, 0.0), (-0.03, 0.02)]
    top_y, foot_y = hy - 0.07, top - 0.03
    rows = []
    for y, spread in ((top_y, 0.6), (top_y - 0.1, 0.85), (foot_y, 1.0)):
        rows.append([V(-hx + 0.01 + 0.008 + d * spread * 0.6, y, -0.16 + (f + 0.16) * spread) for f, d in folds])
    # A slab: the folds' face and, 1.5 cm in, its back.
    for i in range(len(rows) - 1):
        pass
    front = rows
    back = [[q + V(0.016, 0, 0) for q in r] for r in rows]
    sheet = [front[0] + back[0][::-1], front[1] + back[1][::-1], front[2] + back[2][::-1]]
    loft(p, sheet, "hide")
    return p.build()


# ---- the refining forge ----------------------------------------------------------------------------------------------


def forge(lit):
    p = Part("forge_lit" if lit else "forge")
    hx, hy, hz = BOXES["forge"]
    g = -hy
    fire = "ember" if lit else "ash"
    rng = random.Random(11)
    eight = math.pi / 8
    # The furnace: eight faces of stone in clay, straight to 0.8 and closing in like a hive to its flat top.
    shoulder, crown = g + 0.80, g + 1.15
    body = [(g, 0.51), (g + 0.12, 0.515), (shoulder, 0.495), (g + 0.98, 0.42), (crown, 0.30)]
    loft(p, [ring((0, 0), r, 8, y, eight) for y, r in body], "kiln", band="stone", cap_bands=("stone", "clay"))
    # A course of bigger stones round its foot, standing proud.
    loft(p, [ring((0, 0), 0.535, 8, g, eight), ring((0, 0), 0.54, 8, g + 0.1, eight), ring((0, 0), 0.52, 8, g + 0.13, eight)], "kiln", band="stone")
    # The mouth, low in front: clay jambs and sill, a big lintel stone, and in it a hearth of ash or of coals.
    flat = 0.495 * math.cos(eight)
    m0, m1, mh0, mh1 = -0.2, 0.2, g + 0.2, g + 0.58
    fz = flat + 0.11
    for a, b in ((-0.31, m0), (m1, 0.31)):
        box(p, (a, g + 0.1, flat - 0.12), (b, mh1, fz), "kiln", band="clay")
    box(p, (-0.31, g + 0.1, flat - 0.12), (0.31, mh0, fz + 0.02), "kiln", band="clay")
    box(p, (-0.36, mh1, flat - 0.12), (0.36, mh1 + 0.13, fz + 0.015), "kiln", band="stone")
    # Its upper corners filled in, so the mouth reads as an arch.
    for side in (-1, 1):
        x = m0 if side < 0 else m1
        tri = [(x, mh1), (x - side * 0.1, mh1), (x, mh1 - 0.1)]
        loft(p, [[V(px, py, f) for px, py in tri] for f in (flat - 0.12, fz)], "kiln", band="clay")
    # The back of the mouth: soot when out, a glowing bed when lit.
    box(p, (m0 - 0.01, mh0, flat + 0.02), (m1 + 0.01, mh1, flat + 0.034), fire)
    if lit:
        heap = [(0.0, 0.07, 0.0, 0.085), (-0.1, 0.05, 0.03, 0.06), (0.1, 0.05, 0.02, 0.065), (-0.05, 0.13, 0.0, 0.06), (0.06, 0.12, -0.02, 0.055), (0.0, 0.19, -0.03, 0.05), (-0.13, 0.08, -0.03, 0.05), (0.13, 0.09, -0.03, 0.05), (0.03, 0.03, 0.08, 0.05), (-0.08, 0.03, 0.08, 0.045)]
    else:
        heap = [(-0.06, 0.03, 0.02, 0.05), (0.07, 0.025, 0.04, 0.045), (0.0, 0.025, -0.04, 0.05), (0.12, 0.02, -0.05, 0.035)]
    for x, y, f, r in heap:
        nugget(p, (x * 1.1, mh0 + y, flat + 0.05 + f * 0.8), r * 1.1, rng, fire, flat=0.8)
    # The chimney, leaning a little to the back left, and its clay cap.
    cx, cf = -0.08, -0.08
    lean = V(-0.035, 0, -0.03)
    base = [V(cx + x, crown - 0.04, cf + f) for x, f in ((-0.14, -0.14), (0.14, -0.14), (0.14, 0.14), (-0.14, 0.14))]
    tip = [q + lean + V(0, hy - 0.05 - (crown - 0.04), 0) - V(math.copysign(0.01, q.x - cx), 0, math.copysign(0.01, q.z - cf)) for q in base]
    loft(p, [base, tip], "kiln", band="stone")
    capc = sum(tip, V(0, 0, 0)) / 4
    box(p, (capc.x - 0.17, hy - 0.055, capc.z - 0.17), (capc.x + 0.17, hy - 0.002, capc.z + 0.17), "kiln", band="clay")
    # The crucible at the front right of the top, in a clay collar, with a spout to the right.
    kx, kf = 0.12, 0.12
    prism(p, (kx, kf), 0.165, 8, crown - 0.05, crown + 0.05, "kiln", band="clay")
    outer = [ring((kx, kf), r, 8, y) for y, r in ((crown + 0.03, 0.10), (crown + 0.1, 0.135), (crown + 0.2, 0.13))]
    inner = [ring((kx, kf), r, 8, y) for y, r in ((crown + 0.2, 0.1), (crown + 0.17 if lit else crown + 0.09, 0.098))]
    # The spout: the rim's right corner drawn out and up.
    for r in (outer[-1], inner[0]):
        k = 2  # the corner toward +R
        r[k] = r[k] + V(0.05, 0.02, 0)
    loft(p, outer + inner, "kiln", bands=["clay"] * 3 + ["clay"], cap_bands=("clay", "clay"))
    # Molten metal to the lip when lit; when out, a dark crust low in it.
    prism(p, (kx, kf), 0.096 if lit else 0.09, 8, crown + (0.165 if lit else 0.085), crown + (0.172 if lit else 0.092), fire)
    # Split firewood stood on end against its right side, held in a plank frame.
    for k, f in enumerate((-0.26, -0.15, -0.04, 0.07, 0.18)):
        h = 0.62 + rng.uniform(-0.06, 0.05)
        lean_x = rng.uniform(0.0, 0.03)
        a = V(0.535, g, f + rng.uniform(-0.01, 0.01))
        b = a + V(-0.03 - lean_x, h, rng.uniform(-0.02, 0.02))
        cylinder_between(p, a, b, 0.05, 5, "boards", phase=rng.uniform(0, 1), turn=True)
    for y in (g + 0.12, g + 0.45):
        rod(p, (0.59, y, -0.33), (0.59, y, 0.27), 0.022, "boards", h=0.07, turn=False)
    for f in (-0.33, 0.27):
        rod(p, (0.58, g, f), (0.555, g + 0.55, f), 0.05, "boards")
    return p.build()


# ---- the fabricator --------------------------------------------------------------------------------------------------


def fabricator(lit):
    p = Part("fabricator_lit" if lit else "fabricator")
    hx, hy, hz = BOXES["fabricator"]
    g = -hy
    light = "lamp" if lit else "glass"
    y0, y1 = g + 0.10, g + 1.05
    x0, x1 = -0.75, 0.75
    f0, f1 = -0.375, 0.375
    # The body: a long box of painted plate, its front top edge chamfered bright.
    profile = [(y0, f0), (y0, f1), (y1 - 0.1, f1), (y1, f1 - 0.09), (y1, f0)]
    loft(p, [[V(x, y, f) for y, f in profile] for x in (x0, x1)], "plate", columns=["face", "face", "bare", "face", "face"], cap_bands=("face", "face"))
    # Four short iron feet.
    for x in (-0.62, 0.62):
        for f in (-0.27, 0.27):
            loft(p, [ring((x, f), 0.085, 4, g, math.pi / 4), ring((x, f), 0.065, 4, y0 + 0.01, math.pi / 4)], "iron")
    # Riveted seams: round the foot and the top, and up the front between its panels.
    box(p, (x0 - 0.012, y0, f0 - 0.012), (x1 + 0.012, y0 + 0.07, f1 + 0.012), "plate", band="rivets", v0=0.025)
    box(p, (x0 - 0.01, y1 - 0.06, f0 - 0.01), (x1 + 0.01, y1 + 0.01, f0 + 0.6), "plate", band="rivets", v0=0.025)
    for x in (-0.65, 0.0):
        box(p, (x - 0.035, y0 + 0.07, f1), (x + 0.035, y1 - 0.1, f1 + 0.012), "plate", band="rivets", turn=True, v0=0.025)
    # The hatch, left of the middle, with a round window and a stout handle.
    hx0, hx1, hy0, hy1 = -0.58, -0.08, -0.43, 0.04
    box(p, (hx0, hy0, f1), (hx1, hy1, f1 + 0.03), "plate", band="face", bands={"front": "face", "top": "bare", "left": "bare", "right": "bare", "bottom": "bare"})
    # Its dark iron frame.
    for a, b in (((hx0 - 0.025, hy0 - 0.025), (hx1 + 0.025, hy0)), ((hx0 - 0.025, hy1), (hx1 + 0.025, hy1 + 0.025)), ((hx0 - 0.025, hy0), (hx0, hy1)), ((hx1, hy0), (hx1 + 0.025, hy1))):
        box(p, (a[0], a[1], f1), (b[0], b[1], f1 + 0.04), "iron")
    for y in (hy0 + 0.08, hy1 - 0.12):
        box(p, (hx0 - 0.045, y, f1 + 0.03), (hx0 + 0.02, y + 0.06, f1 + 0.05), "iron")
    wc = (-0.33, -0.17)
    with at(p, place((wc[0], wc[1], f1 + 0.03), pitch=-math.pi / 2)):
        prism(p, (0, 0), 0.16, 12, 0, 0.025, "plate", band="bare")
        prism(p, (0, 0), 0.13, 12, 0.02, 0.032, light)
    rod(p, (-0.12, -0.32, f1 + 0.075), (-0.12, -0.04, f1 + 0.075), 0.03, "iron")
    for y in (-0.31, -0.05):
        rod(p, (-0.12, y, f1 + 0.03), (-0.12, y, f1 + 0.08), 0.026, "iron")
    # Three gauges in bright rims right of the hatch, with their needles, and a row of knobs under them.
    for k, x in enumerate((0.1, 0.27, 0.44)):
        with at(p, place((x, 0.12, f1), pitch=-math.pi / 2)):
            prism(p, (0, 0), 0.068, 8, 0, 0.03, "plate", band="bare")
            prism(p, (0, 0), 0.052, 8, 0.03, 0.036, "plate", band="bare")
        a = (-0.6, 0.3, 1.1)[k]
        rod(p, (x, 0.12, f1 + 0.037), (x + math.sin(a) * 0.04, 0.12 + math.cos(a) * 0.04, f1 + 0.037), 0.008, "iron", h=0.006)
    for x in (0.12, 0.25, 0.38):
        with at(p, place((x, -0.08, f1), pitch=-math.pi / 2)):
            prism(p, (0, 0), 0.03, 6, 0, 0.045, "iron", r1=0.026)
    # The lever in its slot at the right end: up when off, thrown down when on.
    box(p, (0.56, -0.38, f1), (0.66, 0.18, f1 + 0.02), "iron")
    pivot = V(0.61, -0.1, f1 + 0.035)
    ball = pivot + (V(0.0, -0.3, 0.035) if lit else V(0.0, 0.3, 0.035))
    rod(p, pivot, ball, 0.025, "iron")
    with at(p, place(tuple(ball))):
        loft(p, [ring((0, 0), r, 6, y) for y, r in ((-0.04, 0.02), (-0.025, 0.04), (0.02, 0.04), (0.04, 0.02))], "iron")
    # Two caged lamps at the front corners of the top.
    for x in (-0.62, 0.62):
        c = (x, f1 - 0.12)
        prism(p, c, 0.08, 6, y1, y1 + 0.03, "iron")
        prism(p, c, 0.058, 8, y1 + 0.03, y1 + 0.13, light, r1=0.052)
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            px, pf = c[0] + math.sin(a) * 0.07, c[1] + math.cos(a) * 0.07
            rod(p, (px, y1 + 0.03, pf), (px, y1 + 0.14, pf), 0.01, "iron")
        prism(p, c, 0.08, 6, y1 + 0.13, y1 + 0.15, "iron")
    # An intake at the back of the top, a stovepipe at the back right, and a jerrycan strapped to the left side.
    loft(p, [ring((0.0, -0.18), 1, 4, y1, math.pi / 4, (0.17, 0.1)), ring((0.0, -0.18), 1, 4, y1 + 0.2, math.pi / 4, (0.3, 0.17))], "plate", band="face")
    prism(p, (0.55, -0.22), 0.07, 8, y1, hy - 0.06, "iron")
    prism(p, (0.55, -0.22), 0.12, 8, hy - 0.06, hy - 0.04, "iron", r1=0.04)
    can = (-hx + 0.005, -0.75 + 0.005)
    box(p, (can[0], -0.47, -0.2), (can[1], 0.0, 0.16), "plate", band="face", bands={"top": "bare"})
    prism(p, (-0.8, 0.1), 0.025, 6, 0.0, 0.04, "plate", band="bare")
    box(p, (can[0] - 0.002, -0.27, -0.21), (x0 + 0.01, -0.23, 0.17), "iron")
    return p.build()


# ---- the preserving bin ----------------------------------------------------------------------------------------------


def preserving_bin(lit):
    p = Part("preserving_bin_lit" if lit else "preserving_bin")
    hx, hy, hz = BOXES["bin"]
    g = -hy
    fire = "ember" if lit else "ash"
    rng = random.Random(5)
    fb = g + 0.30  # the firebox's top
    # The firebox: blackened stone round a low opening in front, a clay tray in it with ash or glowing sparkpowder.
    o0, o1, oh = -0.2, 0.2, g + 0.2
    box(p, (-hx, g, -hz), (hx, fb, 0.08), "kiln", band="stone")
    box(p, (-hx, g, 0.08), (o0, fb, hz), "kiln", band="stone")
    box(p, (o1, g, 0.08), (hx, fb, hz), "kiln", band="stone")
    box(p, (o0, oh, 0.08), (o1, fb, hz), "kiln", band="stone")
    # Its upper corners filled in, so the opening reads as an arch.
    for side in (-1, 1):
        x = o0 if side < 0 else o1
        tri = [(x, oh), (x - side * 0.075, oh), (x, oh - 0.075)]
        loft(p, [[V(px, py, f) for px, py in tri] for f in (0.08, hz)], "kiln", band="stone")
    box(p, (o0 - 0.005, g, 0.065), (o1 + 0.005, oh, 0.085), fire if lit else "kiln", band=None if lit else "clay")
    box(p, (o0 + 0.02, g, 0.1), (o1 - 0.02, g + 0.035, hz - 0.03), "kiln", band="clay")
    heap = [(0.0, 0.06, 0.2, 0.06), (-0.09, 0.05, 0.22, 0.05), (0.09, 0.05, 0.19, 0.055), (0.03, 0.11, 0.16, 0.05), (-0.05, 0.1, 0.17, 0.045), (-0.03, 0.05, 0.28, 0.045), (0.06, 0.05, 0.28, 0.04), (-0.13, 0.04, 0.15, 0.04), (0.13, 0.04, 0.16, 0.04)] if lit else [(0.0, 0.035, 0.21, 0.05), (-0.06, 0.03, 0.24, 0.035)]
    for x, y, f, r in heap:
        nugget(p, (x, g + y, f), r, rng, fire, flat=0.6)
    # The cabinet: a core, dark stone, corner posts, slats on the sides and back with gaps between them.
    c0, c1 = fb, g + 1.0
    w, d = 0.36, 0.31
    # Lit, its heat shows in the gaps between the slats.
    box(p, (-w + 0.03, c0, -d + 0.03), (w - 0.03, c1, d - 0.03), "ember" if lit else "kiln", band=None if lit else "stone")
    for x in (-w, w - 0.065):
        for f in (-d, d - 0.065):
            box(p, (x, c0, f), (x + 0.065, c1, f + 0.065), "boards", turn=True)
    slat, gap = 0.1, 0.014

    def slats(a, b, place_):
        n = max(1, round((b - a + gap) / (slat + gap)))
        width = (b - a - gap * (n - 1)) / n
        for k in range(n):
            s0 = a + k * (width + gap)
            place_(s0, s0 + width, k)

    slats(-w + 0.065, w - 0.065, lambda a, b, k: box(p, (a, c0 + 0.005, -d - 0.004), (b, c1 - 0.005 - rng.uniform(0, 0.01), -d + 0.018), "boards", turn=True, u0=k * 0.37))
    for x in (-w - 0.004, w - 0.018):
        slats(-d + 0.065, d - 0.065, lambda a, b, k, x=x: box(p, (x, c0 + 0.005, a), (x + 0.022, c1 - 0.005 - rng.uniform(0, 0.01), b), "boards", turn=True, u0=k * 0.41 + x))
    # The door: four boards on two battens, hung on wooden blocks at its left, a turn-latch at its right.
    slats(-w + 0.055, w - 0.055, lambda a, b, k: box(p, (a, c0 + 0.03, d - 0.004), (b, c1 - 0.03, d + 0.018), "boards", turn=True, u0=k * 0.53 + 0.2))
    for y in (c0 + 0.1, c1 - 0.12):
        box(p, (-w + 0.07, y, d + 0.018), (w - 0.07, y + 0.07, d + 0.036), "boards")
    for y in (c0 + 0.09, c1 - 0.13):
        box(p, (-w - 0.004, y, d - 0.01), (-w + 0.06, y + 0.09, hz - 0.002), "boards")
    box(p, (w - 0.08, (c0 + c1) / 2 - 0.05, d + 0.02), (w - 0.035, (c0 + c1) / 2 + 0.05, d + 0.04), "boards")
    box(p, (w - 0.12, (c0 + c1) / 2 - 0.018, hz - 0.012), (w + 0.025, (c0 + c1) / 2 + 0.018, hz - 0.001), "boards")
    # The pitched lid, its gable to the front like a little house's, overhanging, and a capped vent stack on its ridge.
    ridge = c1 + 0.13
    lid = [(-hx, c1), (hx, c1), (hx, c1 + 0.035), (0.0, ridge), (-hx, c1 + 0.035)]
    loft(p, [[V(x, y, f) for x, y in lid] for f in (-hz + 0.005, hz - 0.005)], "boards")
    box(p, (-0.06, ridge - 0.04, -0.06), (0.06, hy - 0.035, 0.06), "boards", turn=True)
    box(p, (-0.095, hy - 0.035, -0.095), (0.095, hy - 0.002, 0.095), "boards")
    return p.build()


# ---- far levels ------------------------------------------------------------------------------------------------------
#
# A station of many separate parts (a bench's legs, a forge's chimney and rack, a machine's lamps and pipe) loses them
# all at once when its levels are made down to a handful of triangles, and its far level then lies more than 10 cm from
# its finest. These are made by hand instead, a few solids in flat colours that keep each part's place, and follow the
# made levels as the last (asset.ts: a level a script brings).


def smithy_far():
    p = Part("smithy_LOD1")
    hx, hy, hz = BOXES["smithy"]
    g = -hy
    top = g + 0.80
    box(p, (-0.76, top - 0.09, -0.37), (0.38, top, 0.37), "far_wood")
    for x in (-0.66, 0.28):
        box(p, (x - 0.05, g, -0.34), (x + 0.05, top - 0.09, 0.34), "far_wood")
    box(p, (-0.66, g + 0.15, -0.3), (0.28, g + 0.22, 0.3), "far_wood")
    prism(p, (0.565, 0), 0.215, 6, g, g + 0.6, "far_wood")
    box(p, (0.33, g + 0.6, -0.08), (0.79, g + 0.95, 0.08), "far_iron")
    box(p, (-hx + 0.015, g, -0.37), (-hx + 0.085, hy - 0.005, -0.29), "far_wood")
    box(p, (-hx + 0.005, top - 0.03, -0.3), (-hx + 0.03, hy - 0.07, -0.02), "far_wood")
    return p.build(uv=False)


def forge_far(lit):
    p = Part("forge_lit_LOD1" if lit else "forge_LOD1")
    hx, hy, hz = BOXES["forge"]
    g = -hy
    eight = math.pi / 8
    crown = g + 1.15
    loft(p, [ring((0, 0), r, 8, y, eight) for y, r in ((g, 0.53), (g + 0.8, 0.5), (g + 0.98, 0.42), (crown, 0.3))], "far_stone")
    flat = 0.515 * math.cos(eight)
    box(p, (-0.34, g + 0.1, flat - 0.1), (0.34, g + 0.71, flat + 0.12), "far_clay")
    box(p, (-0.2, g + 0.2, flat + 0.12), (0.2, g + 0.58, flat + 0.125), "ember" if lit else "ash")
    box(p, (-0.27, crown - 0.04, -0.27), (0.09, hy - 0.002, 0.09), "far_stone")
    box(p, (-0.02, crown - 0.05, -0.02), (0.27, crown + 0.2, 0.26), "far_clay")
    box(p, (0.47, g, -0.33), (0.6, g + 0.62, 0.27), "far_wood")
    return p.build(uv=False)


def fabricator_far(lit):
    p = Part("fabricator_lit_LOD1" if lit else "fabricator_LOD1")
    hx, hy, hz = BOXES["fabricator"]
    g = -hy
    y0, y1 = g + 0.1, g + 1.05
    box(p, (-0.75, y0, -0.375), (0.75, y1, 0.375), "far_plate")
    for x in (-0.62, 0.62):
        box(p, (x - 0.08, g, -0.35), (x + 0.08, y0, 0.35), "far_iron")
        box(p, (x - 0.06, y1, 0.195), (x + 0.06, y1 + 0.15, 0.315), "lamp" if lit else "far_iron")
    box(p, (-0.3, y1, -0.35), (0.3, y1 + 0.2, -0.01), "far_plate")
    box(p, (0.48, y1, -0.29), (0.62, hy - 0.04, -0.15), "far_iron")
    box(p, (-hx + 0.005, -0.47, -0.2), (-0.75, 0.0, 0.16), "far_plate")
    box(p, (-0.62, -0.36, 0.375), (-0.04, 0.07, 0.415), "lamp" if lit else "far_iron")
    box(p, (0.56, -0.38, 0.375), (0.66, 0.2, 0.43), "far_iron")
    return p.build(uv=False)


mortar()
smithy()
smithy_far()
for lit in (False, True):
    forge(lit)
    forge_far(lit)
    fabricator(lit)
    fabricator_far(lit)
    preserving_bin(lit)
