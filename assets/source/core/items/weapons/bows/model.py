# The bow and the crossbow: "bow" and "bow_lying" (core:bow's held and lying meshes), and "crossbow" (core:crossbow),
# modelled from the concept views in ref/concept/ (their sizes are BRIEF.md's).
#
# The crossbow is modelled as the right hand holds it (tools/art/spec.ts, PieceSpec.hold): the tiller along +Z, +Y up,
# the origin in the tiller over the pistol grip, where tools/pack/weapons.ts's box has it. The bow is modelled as the left
# hand holds it, in the box's axes: the grip at the origin, its limbs along +-Y, the arrow flying along +X and the string
# behind the grip at -X (ref/TRAITS.md, "The bow in the left hand"). "bow_lying" is the same bow laid on its side.
#
# Materials: "wood", "lashing" and "hide" on the bow; "wood", "steel" and "lashing" on the crossbow.

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from kit import STEEL, V, Part, bent, bezier, circle, cord, grip, line, rrect, sweep, tube  # noqa: E402

# ---- the bow -----------------------------------------------------------------------------------------------------------

GRIP = 0.075  # half the grip's length
KNEE = 0.50  # where each limb's curve reverses into its ear
TIP = 0.66
STRING_X = -0.1695


def limb_x(y):
    """
    The bow's centreline in x at height y: the grip upright, each limb sweeping back to its knee, and there the curve
    reversing, each ear flicking forward again toward its tip.
    """
    a = abs(y)
    if a <= GRIP:
        return -0.005
    if a <= KNEE:
        f = (a - GRIP) / (KNEE - GRIP)
        return -0.005 - 0.155 * f ** 1.6
    g = (a - KNEE) / (TIP - KNEE)
    return -0.160 + 0.036 * g ** 1.25


def string_x(y):
    """
    The braced string: straight between the string bridges at the knees, and from each bridge lying along the belly of
    its ear to the nock.
    """
    a = abs(y)
    if a <= KNEE - 0.005:
        return STRING_X
    return limb_x(y) - limb_section(y)[1] / 2 - 0.0026


def limb_section(y):
    """(width across z, thickness in x) at height y."""
    a = abs(y)
    if a <= GRIP:
        return 0.030, 0.040
    if a <= KNEE:
        f = (a - GRIP) / (KNEE - GRIP)
        # Thickest where it leaves the grip, through a short fade.
        fade = min(1.0, (a - GRIP) / 0.03)
        w = 0.036 - 0.010 * f
        t = 0.018 - 0.005 * f
        return 0.030 + (w - 0.030) * fade, 0.040 + (t - 0.040) * fade
    f = (a - KNEE) / (TIP - KNEE)
    return 0.024, 0.020 - 0.002 * f


def bow_part():
    rng = random.Random(5)
    part = Part("bow", ["wood", "lashing", "hide"])
    # Stations from the bottom tip to the top tip, closer where the limb bends most.
    half = [0.0, 0.040, GRIP, 0.105, 0.16, 0.23, 0.30, 0.37, 0.43, 0.47, KNEE, 0.525, 0.58, 0.635, TIP - 0.004]
    ys = [-y for y in reversed(half[1:])] + half
    path = [V(limb_x(y), y, 0.0) for y in ys]
    secs = []
    for y in ys:
        w, t = limb_section(y)
        secs.append(rrect(w, t, min(w, t) * 0.38, 1))
    # The section's a runs across z and its b along x: t is as near +X as the path allows.
    sweep(part, "wood", path, secs, hint=(1, 0, 0), uv="wrap", u0=0.17)
    # The nock knobs at the tips.
    for side in (-1, 1):
        y0 = side * (TIP - 0.010)
        tube(part, "wood", [V(limb_x(y0), y0, 0), V(limb_x(y0) + 0.001, side * (TIP + 0.004), 0), V(limb_x(y0), side * (TIP + 0.016), 0)],
             [0.0125, 0.015, 0.010], 8, hint=(1, 0, 0))
    # The grip's spiral wrap of hide, in bands that stand a little proud.
    n = 7
    wy = [-GRIP + 2 * GRIP * i / n for i in range(n + 1)]
    sweep(part, "hide", [V(limb_x(y), y, 0) for y in wy],
          [rrect(0.030 + (0.0034 if 0 < i < n else 0.001), 0.040 + (0.0034 if 0 < i < n else 0.001), 0.012, 1) for i in range(n + 1)],
          hint=(1, 0, 0), uv="wrap")
    # The arrow shelf: a rounded bump on the -Z side of the grip's top.
    sweep(part, "wood", [V(-0.002, GRIP - 0.004, -0.010), V(-0.002, GRIP + 0.006, -0.020), V(-0.002, GRIP + 0.018, -0.022)],
          [rrect(0.026, 0.018, 0.006, 1), rrect(0.024, 0.016, 0.006, 1), rrect(0.012, 0.008, 0.003, 1)], hint=(1, 0, 0))
    # A binding of cord at each ear's joint, with two cut tails.
    for side in (-1, 1):
        by = [side * (KNEE - 0.022 + 0.044 * i / 6) for i in range(7)]
        if side < 0:
            by = by[::-1]
        bsecs = []
        for i, y in enumerate(by):
            w, t = limb_section(y)
            sw = 0.0045 * (0.4 + 0.6 * math.sin(math.pi * i / 6))
            bsecs.append(rrect(w + 2 * sw, t + 2 * sw, min(w, t) * 0.45, 1))
        sweep(part, "lashing", [V(limb_x(y), y, 0) for y in by], bsecs, hint=(1, 0, 0), uv="wrap")
        y0 = side * (KNEE - 0.018)
        for dz, splay in ((0.010, 0.4), (-0.006, -0.3)):
            b = V(limb_x(y0) + 0.008, y0, dz)
            d = V(0.6, -side * 0.9, splay).normalized()
            cord(part, [b - d * 0.003, b + d * 0.018, b + d * 0.032], [0.0021, 0.0018, 0.0012], 5, hint=(0, 0, 1))
    # The string, hooked over each nock.
    sy = [0.495, 0.53, 0.57, 0.61, TIP - 0.012]
    sy = [-y for y in reversed(sy)] + [0.0] + sy
    cord(part, [V(string_x(y), y, 0) for y in sy], 0.0026, 6, hint=(1, 0, 0))
    return part


# ---- the crossbow ------------------------------------------------------------------------------------------------------


def grooved(w, h, top_w, gw, gd, r=0.004):
    """The tiller's section: w wide at the bottom, top_w at the top, with a groove gw wide and gd deep along its top."""
    hb, ht = -h / 2, h / 2
    return [(w / 2, hb + r), (top_w / 2, ht - r), (top_w / 2 - r, ht), (gw / 2, ht), (gw / 2 * 0.8, ht - gd), (-gw / 2 * 0.8, ht - gd),
            (-gw / 2, ht), (-top_w / 2 + r, ht), (-top_w / 2, ht - r), (-w / 2, hb + r), (-w / 2 + r, hb), (w / 2 - r, hb)]


def crossbow():
    rng = random.Random(9)
    part = Part("crossbow", ["wood", "steel", "lashing"])
    # The tiller: (z, y bottom, y top, width), its butt flared and squared, a groove along its top.
    prof = [(-0.220, -0.070, 0.020, 0.046), (-0.190, -0.068, 0.020, 0.046), (-0.120, -0.044, 0.019, 0.041), (-0.060, -0.040, 0.018, 0.040),
            (0.100, -0.040, 0.018, 0.040), (0.360, -0.036, 0.018, 0.040), (0.460, -0.030, 0.018, 0.038)]
    path = [V(0, (y0 + y1) / 2, z) for z, y0, y1, _ in prof]
    secs = [grooved(w, y1 - y0, w * 0.9, 0.008, 0.005) for _, y0, y1, w in prof]
    sweep(part, "wood", path, secs, hint=(0, 1, 0), uv="wrap")
    # The pistol grip under it, raked back.
    grip(part, (-0.030, 0.006), (-0.125, -0.030), 0.010, 0.030, 0.040, stations=6)
    # The trigger.
    bent(part, "steel", [V(0, -0.034, 0.028), V(0, -0.056, 0.024), V(0, -0.075, 0.030)], 0.006, 0.005, opts=STEEL)
    # The nut, a steel roller across the groove, standing 12 mm above it.
    tube(part, "steel", [V(-0.013, 0.021, 0.040), V(0.013, 0.021, 0.040)], 0.0095, 8, hint=(0, 1, 0), **STEEL)
    # The prod: a steel leaf spring across the nose, bent back by the drawn string.
    xs = [-0.300, -0.240, -0.160, -0.080, 0.0, 0.080, 0.160, 0.240, 0.300]
    prod_z = lambda x: 0.430 - 0.060 * (abs(x) / 0.3) ** 1.6
    ppath = [V(x, 0.005, prod_z(x)) for x in xs]
    psecs = [rrect(0.013 - 0.005 * abs(x) / 0.3, 0.038 - 0.012 * abs(x) / 0.3, 0.003, 1) for x in xs]
    sweep(part, "steel", ppath, psecs, hint=(0, 1, 0), **STEEL)
    # The stirrup: a steel loop in front of the nose.
    loop = bezier(V(0.016, 0.005, 0.452), V(0.070, 0.005, 0.500), V(0.050, 0.005, 0.566), V(0.0, 0.005, 0.560), 4)
    loop = loop + [V(-p.x, p.y, p.z) for p in reversed(loop[:-1])]
    tube(part, "steel", loop, 0.006, 6, hint=(0, 1, 0), uv="along", band=(0.02, 0.73))
    # The binding: cord wound round the nose and the prod's middle, crossed over it in an X, with two cut tails.
    nb = [0.398, 0.408, 0.420, 0.432, 0.444, 0.456, 0.464]
    bsec = []
    for i, z in enumerate(nb):
        sw = 0.004 * (0.4 + 0.6 * math.sin(math.pi * i / (len(nb) - 1)))
        bsec.append(rrect(0.040 + 2 * sw, 0.050 + 2 * sw, 0.010, 1))
    sweep(part, "lashing", [V(0, -0.006, z) for z in nb], bsec, hint=(0, 1, 0), uv="wrap")
    for sx in (-1, 1):
        cord(part, [V(sx * 0.026, 0.020, 0.400), V(sx * 0.010, 0.027, 0.428), V(-sx * 0.010, 0.027, 0.440), V(-sx * 0.030, 0.020, 0.462)],
             0.0035, 5, hint=(0, 1, 0))
        cord(part, [V(sx * 0.026, -0.036, 0.400), V(sx * 0.010, -0.040, 0.428), V(-sx * 0.010, -0.040, 0.440), V(-sx * 0.030, -0.036, 0.462)],
             0.0035, 5, hint=(0, 1, 0))
    for sx, d in ((1, V(0.5, -0.6, -0.6)), (-1, V(-0.3, -0.7, -0.65))):
        b = V(sx * 0.010, -0.034, 0.400)
        d = d.normalized()
        cord(part, [b - d * 0.003, b + d * 0.016, b + d * 0.030], [0.0022, 0.0019, 0.0013], 5, hint=(0, 0, 1))
    # The string, from each prod tip back to the nut: a V seen from above.
    for sx in (-1, 1):
        cord(part, line((sx * 0.294, 0.006, prod_z(0.294) - 0.004), (sx * 0.006, 0.027, 0.032), 3), 0.003, 5, hint=(0, 1, 0))
    return part


# The bow lying on its side, its thin z axis turned up, resting on y = 0 and centred over the origin: one quarter turn
# about x, as tools/pack/lying.ts lays a held piece down.
bow = bow_part()
pts = bow.verts
lo_z = min(p.z for p in pts)
mid_x = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
bow.build()
bow.name = "bow_lying"
bow.build(transform=lambda p: V(p.x - mid_x, p.z - lo_z, -p.y))
cb = crossbow()
cb.build()
for p in (bow, cb):
    print(f"{p.name}: {p.triangles()} triangles")
