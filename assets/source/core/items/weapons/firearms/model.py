# The early firearms: core:pistol, core:rifle, core:shotgun and core:flare_gun, one mesh object each ("pistol",
# "rifle", "shotgun", "flare_gun"), modelled from the concept views in ref/concept/ (their sizes are BRIEF.md's).
#
# Each is modelled as it is held (tools/art/spec.ts, PieceSpec.hold): the grip at the origin, the barrel along +Z, the
# sights on top along +Y, +X its right side. The sight line of each, the height a player's eye looks along, is SIGHT:
# the rear notch's bottom and the front blade's top both sit on it, parallel to z (ref/TRAITS.md).
#
# Materials, three at most on a gun: "wood", "steel" and "hide" (the revolver, rifle and shotgun), and "wood",
# "lashing" and "flint" (the flare gun, which has no metal). Steel is a trim sheet: its dark face, a worn bright band
# that narrow faces (the chamfers) take, and brass (kit.py).

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from kit import (BRASS, BRIGHT, STEEL, STEEL_BRASS, STEEL_FACE, STONE_EDGE_V, STONE_FACE, V, Part, bent, block, circle, grip,  # noqa: E402
                 rrect, stock, sweep, tube, wrap)

# The sight line's height above the grip, metres (ref/TRAITS.md, "The sights").
SIGHT = {"pistol": 0.068, "rifle": 0.052, "shotgun": 0.040, "flare_gun": 0.084}
# ---- the revolver -----------------------------------------------------------------------------------------------------


def pistol():
    part = Part("pistol", ["wood", "steel", "hide"])
    axis = 0.040
    grip(part, (0.016, 0.004), (-0.092, -0.030), 0.020, 0.030, 0.038, 0.18, 0.80)
    # The frame behind the cylinder, the recoil shield rounding over at its back, and its strap down into the grip.
    block(part, "steel", -0.046, 0.006, 0.027, 0, 0, 0.004, ends=((0.004, 0.050), (0.002, 0.058)))
    # The cylinder: five chambers as five lands between five flutes, a brass band at its front.
    sec = []
    for k in range(10):
        a = math.pi / 2 + 2 * math.pi * k / 10
        r = 0.0232 if k % 2 == 0 else 0.0205
        sec.append((r * math.cos(a), r * math.sin(a)))
    sweep(part, "steel", [V(0, axis, 0.006), V(0, axis, 0.050)], sec, **STEEL)
    sweep(part, "steel", [V(0, axis, 0.050), V(0, axis, 0.058)], sec, **BRASS)
    # The five chamber mouths in its front, dark in the bright face.
    for k in range(5):
        a = math.pi / 2 + 2 * math.pi * k / 5
        c = V(0.0138 * math.cos(a), axis + 0.0138 * math.sin(a), 0.058)
        sweep(part, "steel", [c, c + V(0, 0, 0.0008)], circle(0.0047, 6), **STEEL)
    # The octagonal barrel, its eight arrises chamfered bright, its bore dark.
    octa = []
    for k in range(8):
        a = 2 * math.pi * k / 8
        r = 0.011 / math.cos(math.pi / 8)
        for e in (-1, 1):
            t = a + math.pi / 8 + e * 0.065
            octa.append((r * 0.985 * math.cos(t), r * 0.985 * math.sin(t)))
    sweep(part, "steel", [V(0, axis, 0.056), V(0, axis, 0.230)], octa, cap_inset=(0.012, 0.42), **STEEL)
    # The loading lever under the barrel and its link down from the barrel.
    bent(part, "steel", [V(0, 0.0215, 0.072), V(0, 0.0205, 0.130), V(0, 0.0225, 0.192)], 0.007, 0.006, opts=STEEL, hint=(0, 1, 0))
    block(part, "steel", 0.180, 0.192, 0.006, 0.020, 0.032, 0.001)
    # The hammer, its spur hooking back over the frame below the sight line, and the folding trigger under it.
    bent(part, "steel", [V(0, 0.046, -0.028), V(0, 0.058, -0.036), V(0, 0.064, -0.046), V(0, 0.062, -0.058)], 0.009, 0.007)
    bent(part, "steel", [V(0, 0.013, -0.006), V(0, 0.006, -0.010), V(0, -0.002, -0.008)], 0.005, 0.004)
    # The sights: a blade on the barrel's muzzle end, and a notch on a base on the frame's top over the cylinder's
    # back, the notch's bottom and the blade's top on the sight line, above the cylinder's top (0.063).
    s = SIGHT["pistol"]
    block(part, "steel", 0.214, 0.226, 0.0034, axis + 0.009, s, 0.0008, opts=BRIGHT)
    block(part, "steel", -0.022, -0.012, 0.016, 0.056, s, 0.0015)
    for x in (-0.0055, 0.0055):
        block(part, "steel", -0.022, -0.012, 0.005, s - 0.002, s + 0.0045, 0.001, x=x)
    return part


# ---- the long rifle ---------------------------------------------------------------------------------------------------


def rifle():
    part = Part("rifle", ["wood", "steel", "hide"])
    axis = 0.022
    # The butt stock: a tall butt plate narrowing to the wrist round the grip, its comb a straight line.
    stock(part, [(-0.380, -0.088, 0.017, 1.0), (-0.300, -0.074, 0.019, 1.0), (-0.200, -0.052, 0.020, 0.95),
                 (-0.100, -0.030, 0.019, 0.88), (-0.040, -0.019, 0.017, 0.80), (0.000, -0.018, 0.017, 0.78),
                 (0.040, -0.021, 0.020, 0.84)], 0.040)
    # The steel butt plate.
    block(part, "steel", -0.386, -0.379, 0.041, -0.089, 0.018, 0.004)
    # The hide cheek pad on the left of the butt, laced across with cord in the picture's place of the lacing.
    sweep(part, "hide", [V(-0.0205, -0.020, -0.330), V(-0.0215, -0.016, -0.240), V(-0.0205, -0.012, -0.150)],
          [rrect(0.006, 0.050, 0.0025, 1), rrect(0.007, 0.054, 0.003, 1), rrect(0.006, 0.044, 0.0025, 1)], hint=(1, 0, 0), uv="wrap")
    # The receiver, and its tang down onto the wrist.
    block(part, "steel", -0.070, 0.120, 0.030, 0.004, 0.045, 0.005)
    block(part, "steel", -0.110, -0.066, 0.022, 0.012, 0.022, 0.003, ends=((0.016, 0.020), (0.008, 0.040)))
    # The bolt: its body along the receiver's right side and a big round knob.
    tube(part, "steel", [V(0.016, 0.030, -0.050), V(0.016, 0.030, 0.020)], 0.0062, 8, **STEEL)
    tube(part, "steel", [V(0.016, 0.030, -0.030), V(0.031, 0.030, -0.030)], 0.0035, 6, **BRIGHT)
    sweep(part, "steel", [V(0.029, 0.030, -0.030), V(0.035, 0.030, -0.030), V(0.043, 0.030, -0.030)],
          [circle(0.0075, 8), circle(0.0102, 8), circle(0.006, 8)], hint=(0, 1, 0), **BRIGHT)
    # The trigger and its brass guard.
    bent(part, "steel", [V(0, 0.004, -0.004), V(0, -0.012, -0.010), V(0, -0.026, -0.008)], 0.005, 0.005)
    bent(part, "steel", [V(0, 0.000, 0.030), V(0, -0.036, 0.018), V(0, -0.045, -0.010), V(0, -0.036, -0.040), V(0, -0.016, -0.052)],
         0.008, 0.0035, opts=BRASS)
    # The long neck: the fore-stock under the barrel, tapering, with two brass bands.
    stock(part, [(0.040, -0.024, 0.016, 0.80), (0.120, -0.030, 0.020, 0.78), (0.300, -0.022, 0.024, 0.72),
                 (0.500, -0.012, 0.024, 0.66), (0.700, 0.002, 0.024, 0.58)], 0.040)
    for z in (0.400, 0.680):
        yb = {0.400: -0.016, 0.680: 0.001}[z]
        sweep(part, "steel", [V(0, (yb + 0.036) / 2, z - 0.005), V(0, (yb + 0.036) / 2, z + 0.005)],
              rrect(0.030 if z < 0.5 else 0.026, 0.036 - yb, 0.008, 1), **BRASS)
    # The barrel, a little fatter at the muzzle, its bore dark.
    tube(part, "steel", [V(0, axis, 0.115), V(0, axis, 0.955), V(0, axis, 0.962), V(0, axis, 0.980)],
         [0.0110, 0.0110, 0.0128, 0.0130], 10, cap_inset=(0.015, 0.45), uv="along", band=STEEL_FACE, smooth=True)
    # The sights: an open rear sight on its base and a blade at the muzzle, their tops on the sight line.
    s = SIGHT["rifle"]
    block(part, "steel", 0.192, 0.208, 0.016, axis + 0.009, axis + 0.016, 0.002)
    for x in (-0.0055, 0.0055):
        block(part, "steel", 0.196, 0.204, 0.005, axis + 0.015, s + 0.003, 0.001, x=x)
    block(part, "steel", 0.196, 0.204, 0.006, axis + 0.015, s, 0.001)
    block(part, "steel", 0.952, 0.968, 0.0034, axis + 0.011, s, 0.0008, opts=BRIGHT)
    return part


# ---- the shotgun ------------------------------------------------------------------------------------------------------


def shotgun():
    part = Part("shotgun", ["wood", "steel", "hide"])
    axis = 0.020
    stock(part, [(-0.360, -0.090, 0.020, 1.0), (-0.280, -0.074, 0.021, 1.0), (-0.180, -0.050, 0.021, 0.94),
                 (-0.090, -0.025, 0.020, 0.86), (-0.030, -0.019, 0.018, 0.80), (0.000, -0.019, 0.018, 0.80),
                 (0.030, -0.020, 0.024, 0.92)], 0.040)
    block(part, "steel", -0.366, -0.359, 0.041, -0.091, 0.021, 0.004)
    # The action, its two hammers, its two triggers in a guard.
    block(part, "steel", -0.062, 0.062, 0.046, -0.004, 0.040, 0.006, ends=((-0.004, 0.036), (-0.006, 0.040)))
    for x in (-0.013, 0.013):
        bent(part, "steel", [V(x, 0.032, -0.030), V(x, 0.052, -0.036), V(x, 0.068, -0.044), V(x, 0.071, -0.054)], 0.008, 0.007)
    for z in (-0.005, 0.012):
        bent(part, "steel", [V(0, -0.004, z + 0.002), V(0, -0.018, z - 0.004), V(0, -0.028, z - 0.002)], 0.005, 0.0045)
    bent(part, "steel", [V(0, -0.006, 0.040), V(0, -0.038, 0.026), V(0, -0.045, -0.006), V(0, -0.036, -0.036), V(0, -0.016, -0.048)],
         0.009, 0.0035, opts=STEEL)
    # The barrels side by side, their bores dark; a rib between them on top, and a brass band round both at the muzzles.
    for x in (-0.0125, 0.0125):
        tube(part, "steel", [V(x, axis, 0.058), V(x, axis, 0.680)], 0.012, 10, cap_inset=(0.02, 0.72), uv="along", band=STEEL_FACE, smooth=True)
    block(part, "steel", 0.060, 0.676, 0.010, axis + 0.006, 0.037, 0.0015)
    sweep(part, "steel", [V(0, axis + 0.002, 0.652), V(0, axis + 0.002, 0.666)], rrect(0.054, 0.030, 0.012, 2), **BRASS)
    # The bead.
    tube(part, "steel", [V(0, 0.0355, 0.6695), V(0, SIGHT["shotgun"] - 0.0002, 0.6695), V(0, SIGHT["shotgun"], 0.6695)],
         [0.0024, 0.0022, 0.0006], 6, hint=(0, 0, 1), **BRASS)
    # The forend under the barrels, wrapped in hide.
    stock(part, [(0.075, -0.016, 0.012, 1.0), (0.300, -0.012, 0.012, 0.92)], 0.044)
    # The wrap: six turns of a hide strip, each standing a little proud where it overlaps the last.
    n = 12
    zs = [0.110 + 0.160 * i / n for i in range(n + 1)]
    f = lambda z: (z - 0.075) / 0.225
    sweep(part, "hide", [V(0, -0.002 + 0.002 * f(z), z) for z in zs],
          [rrect(0.044 - 0.004 * f(z) + e, 0.028 - 0.004 * f(z) + e, 0.009, 1) for z, e in
           zip(zs, [0.001] + [0.0042 if i % 2 else 0.0030 for i in range(1, n)] + [0.001])], hint=(0, 1, 0), uv="wrap")
    return part


# ---- the flare gun ----------------------------------------------------------------------------------------------------


def flare_gun():
    rng = random.Random(51)
    part = Part("flare_gun", ["wood", "lashing", "flint"])
    axis = 0.048
    grip(part, (0.024, 0.000), (-0.090, -0.032), 0.016, 0.032, 0.040)
    # A knob at the butt.
    tube(part, "wood", [V(0, -0.088, -0.050), V(0, -0.098, -0.052), V(0, -0.104, -0.050)], [0.017, 0.018, 0.011], 6, hint=(0, 0, 1))
    # The barrel, one piece of wood, rounded at its breech, flared at its muzzle, its wide bore dark.
    zs = [(-0.034, 0.012), (-0.030, 0.022), (-0.022, 0.027), (0.000, 0.028), (0.150, 0.0285), (0.186, 0.030), (0.200, 0.031)]
    tube(part, "wood", [V(0, axis, z) for z, _ in zs], [r for _, r in zs], 10, cap_inset=(0.03, 0.58), cap_mat="flint", hint=(0, 1, 0))
    # Three rings of cord round it.
    for z in (0.010, 0.095, 0.180):
        r0 = 0.0281 if z < 0.15 else 0.0295
        tube(part, "lashing", [V(0, axis, z - 0.0065), V(0, axis, z), V(0, axis, z + 0.0065)], [r0 + 0.0008, r0 + 0.0034, r0 + 0.0008], 10,
             hint=(0, 1, 0))
    # A carved bump as its front sight.
    block(part, "wood", 0.184, 0.196, 0.008, axis + 0.026, SIGHT["flare_gun"], 0.002, opts=dict(uv="wrap"))
    # The hammer: a wooden arm pivoting behind the breech, rising, with a wedge of flint clamped in its jaw.
    bent(part, "wood", [V(0, 0.030, -0.044), V(0, 0.056, -0.052), V(0, 0.070, -0.050), V(0, 0.073, -0.040)], 0.014, 0.012,
         opts=dict(uv="wrap"))
    # The flint: a knapped wedge pointing forward and down at the breech, its narrow facets on the sheet's pale edge.
    wedge = [V(0, 0.073, -0.040), V(0, 0.071, -0.030), V(0, 0.067, -0.020), V(0, 0.063, -0.011)]
    wsec = [[(a * f, b * f) for a, b in [(0.0085, 0.0), (0.0045, 0.0062), (-0.0045, 0.0058), (-0.0085, 0.0), (-0.0042, -0.006), (0.0048, -0.0058)]]
            for f in (1.0, 0.95, 0.72, 0.3)]
    sweep(part, "flint", wedge, wsec, hint=(1, 0, 0), uv="flat", band=STONE_FACE, narrow=(0.003, (STONE_EDGE_V - 0.02, STONE_EDGE_V + 0.02)), smooth=False)
    # The peg trigger.
    tube(part, "wood", [V(0, 0.024, 0.016), V(0, 0.008, 0.016), V(0, -0.004, 0.014)], [0.0045, 0.0045, 0.004], 6, hint=(0, 0, 1))
    return part


for make in (pistol, rifle, shotgun, flare_gun):
    p = make()
    print(f"{p.name}: {p.triangles()} triangles")
    p.build()
