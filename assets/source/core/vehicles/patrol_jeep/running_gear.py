"""Solid axle running gear and five all-terrain tyres. The tailgate spare shares the road wheel's casting."""

import math
import geometry as g
from geometry import Part, box, cylinder_between, tube


def wheel(at, side, spare=False):
    def pos(x, y, z):
        if spare:
            return (at[0] + z, at[1] + y, at[2] - x)
        return (at[0] + side * x, at[1] + y, at[2] + z)

    def radial(x, r, a):
        return pos(x, r * math.cos(a), r * math.sin(a))

    def revolved(name, profile, tags, sides=28):
        p = Part()
        rings = [[p.v(radial(x, r, math.tau * j / sides)) for x, r in profile] for j in range(sides)]
        for j in range(sides):
            for i in range(len(profile)):
                k = (i + 1) % len(profile)
                p.face(
                    [rings[j][i], rings[j][k], rings[(j + 1) % sides][k], rings[(j + 1) % sides][i]],
                    tags[i] if isinstance(tags, list) else tags,
                )
        g.attach(p.obj(name))

    revolved(
        "All-terrain carcass",
        [
            (-0.145, 0.228),
            (-0.145, 0.301),
            (-0.137, 0.348),
            (-0.12, 0.378),
            (-0.101, 0.398),
            (-0.085, 0.401),
            (0.085, 0.401),
            (0.101, 0.398),
            (0.12, 0.378),
            (0.137, 0.348),
            (0.145, 0.301),
            (0.145, 0.228),
        ],
        ["rubber"] * 5 + ["tread"] + ["rubber"] * 6,
        32,
    )
    revolved("Beaded sidewall", [(0.141, 0.276), (0.1446, 0.277), (0.1446, 0.285), (0.141, 0.288)], "rubber")
    # Staggered shoulders and interlocking chevrons. Each lug has a tapered foot and a flattened contact patch.
    p = Part()
    for j in range(28):
        for band in (-1, 0, 1):
            center = j * math.tau / 28 + (0.061 if band == 0 else 0.018 * band)
            if band == 0:
                footprint = [
                    (-0.068, -0.041),
                    (-0.020, -0.07),
                    (0.064, -0.030),
                    (0.061, 0.019),
                    (0.012, 0.064),
                    (-0.063, 0.031),
                ]
            else:
                footprint = [
                    (0.037, -0.041),
                    (0.081, -0.052),
                    (0.119, -0.078),
                    (0.129, -0.012),
                    (0.108, 0.033),
                    (0.066, 0.058),
                    (0.041, 0.045),
                ]
                footprint = [(x * band, a * band) for x, a in footprint]
            rings = []
            for top in (False, True):
                q = []
                for x, angle in footprint:
                    # The angular tread toward the sidewall loses radius along the outer shoulder.
                    r = (0.42 if top else 0.396) - max(0, abs(x) - 0.079) * 0.55
                    q.append(radial(x * 0.99 if top else x, r, center + angle * (0.90 if top else 1)))
                rings.append(q)
            p.loft(rings, "tread", ("rubber", "tread"))
    g.attach(p.obj("Staggered shoulder and crown blocks"))
    revolved(
        "Steel rim bead and well",
        [
            (-0.13, 0.223),
            (-0.13, 0.234),
            (-0.106, 0.242),
            (0.10, 0.242),
            (0.139, 0.231),
            (0.142, 0.215),
            (0.128, 0.204),
            (0.095, 0.204),
            (0.071, 0.179),
            (-0.096, 0.179),
        ],
        ["hub", "hub", "graphite", "graphite", "alloy", "hub", "graphite", "graphite", "graphite", "hub"],
    )
    cylinder_between("Brake rotor", pos(-0.027, 0, 0), pos(-0.013, 0, 0), 0.181, "rotor", 24)
    cylinder_between("Bearing housing", pos(-0.034, 0, 0), pos(0.105, 0, 0), 0.088, "graphite", 16)
    p = Part()
    for j in range(8):
        a = j * math.tau / 8
        profile = [(0.075, -0.26), (0.207, -0.19), (0.216, 0.10), (0.193, 0.19), (0.081, 0.22)]
        rings = [[radial(x + 0.035 * (r - 0.08) / 0.14, r, a + da) for r, da in profile] for x in (0.033, 0.062)]
        p.loft(rings, "hub", ("hub", "graphite"))
    g.attach(p.obj("Eight pierced utility spokes"))
    cylinder_between("Locking hub", pos(0.091, 0, 0), pos(0.135, 0, 0), 0.084, "graphite", 16, 0.069)
    cylinder_between("Hubcap medallion", pos(0.128, 0, 0), pos(0.138, 0, 0), 0.042, "hub", 14)
    for j in range(5):
        a = j * math.tau / 5
        y, z = 0.099 * math.cos(a), 0.099 * math.sin(a)
        cylinder_between("Wheel nut", pos(0.071, y, z), pos(0.096, y, z), 0.0115, "bright", 6)


def chassis():
    for s in (-1, 1):
        box("Box-section frame rail", (s * 0.54, 0.44, 0.0), (0.115, 0.155, 3.89), 0.028, "graphite")
        box("Rock rail", (s * 0.92, 0.533, -0.105), (0.144, 0.091, 1.75), 0.029, "graphite")
        box("Rail grip surface", (s * 0.94, 0.580, -0.10), (0.114, 0.016, 1.65), 0.006, "mat")
        for z in (-0.75, -0.17, 0.49):
            cylinder_between("Outrigger", (s * 0.53, 0.47, z), (s * 0.933, 0.52, z), 0.028, "graphite")
    for z in (-1.45, 1.45):
        cylinder_between("Live axle", (-0.85, 0.416, z), (0.85, 0.416, z), 0.054, "hub", 14)
        cylinder_between("Differential cover", (-0.04, 0.417, z), (0.21, 0.417, z), 0.117, "graphite", 12, 0.134)
        cylinder_between("Prop shaft", (0.10, 0.44, z), (0.084, 0.50, 0.12), 0.039, "hub")
        for s in (-1, 1):
            toward = -1 if z > 0 else 1
            cylinder_between("Radius arm", (s * 0.62, 0.423, z), (s * 0.53, 0.485, z + 0.66 * toward), 0.029, "graphite", 8)
            cylinder_between("Gas damper", (s * 0.692, 0.397, z), (s * 0.60, 0.75, z + 0.17 * toward), 0.024, "shock")
            # Tangible spring coils leave visible daylight between the axle and the arch at full travel.
            pts = []
            for k in range(49):
                t = k / 48
                pts.append(
                    (s * 0.663 + 0.059 * math.cos(8 * math.pi * t), 0.47 + 0.250 * t, z + 0.061 * math.sin(8 * math.pi * t))
                )
            tube("Coil spring", pts, 0.010, "hub", 6)
    box("Transmission skid", (0, 0.393, 0.21), (0.77, 0.074, 1.36), 0.048, "hub")
    cylinder_between("Exhaust", (0.64, 0.42, -1.74), (0.64, 0.42, -2.120), 0.035, "hub")
    cylinder_between("Exhaust throat", (0.64, 0.42, -2.115), (0.64, 0.42, -2.122), 0.025, "grille")
