"""Rigid parts in game metres, +Z at the radiator. All poses and LODs share these pivots."""

from pathlib import Path
import math
import numpy as np

ROOT = Path(__file__).resolve().parent
PIVOTS = {"chassis": (0, 0, 0)}
for axle, track, z in [("front", 0.98, 3.30862), ("middle", 0.86, -2.29138), ("rear", 0.86, -3.59138)]:
    for side, sign in [("left", 1), ("right", -1)]:
        PIVOTS[f"wheel_{axle}_{side}"] = (sign * track, 0.52, z)
PIVOTS.update(door_left=(1.08, 1.96, 3.1), door_right=(-1.08, 1.96, 3.1), steering_wheel=(0.5, 2.22, 2.69))
STATES = ["abandoned", "impact", "burnout", "stripped", "rollover", "separated", "cistern", "rear_crush"]
TANK = {
    4,
    5,
    6,
    7,
    16,
    *range(49, 54),
    *range(62, 67),
    68,
    69,
    *range(71, 79),
    *range(82, 92),
    *range(100, 105),
}
BOX_F = np.array(
    [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ]
)
BOX = np.array(
    [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    float,
)


def box(at, size, tile, group, bone="chassis", rake=0):
    v = BOX * np.array(size) / 2 + at
    v[4:8, 2] += rake * (BOX[4:8, 1] + 1) / 2
    v[:4, 2] += rake * (BOX[:4, 1] + 1) / 2
    return (v, BOX_F, tile, group, bone)


def shell(stations, axis, sides, tile, group, bone):
    """Capped elliptical rings, with stations in ascending axial order."""
    ang = np.arange(sides) * 2 * math.pi / sides
    if axis == "z" and tile == 16:
        # Put lengthwise edges at the two livery breaks so the untextured LODs can keep the stripe.
        breaks = [math.asin((height - 1.98) / 0.84) for height in (1.53, 1.58, 1.735)]
        ang = np.sort(
            np.unique(
                np.concatenate(
                    (
                        ang,
                        [(a + 2 * math.pi) % (2 * math.pi) for a in breaks],
                        [(math.pi - a) % (2 * math.pi) for a in breaks],
                    )
                )
            )
        )
        sides = len(ang)
    v = []
    for x, y, z, a, b in stations:
        if axis == "z":
            v.extend(zip(x + a * np.cos(ang), y + b * np.sin(ang), np.full(sides, z)))
        else:
            v.extend(zip(np.full(sides, x), y + a * np.cos(ang), z + b * np.sin(ang)))
    f = []
    for j in range(len(stations) - 1):
        for i in range(sides):
            a = j * sides + i
            b = j * sides + (i + 1) % sides
            f.extend([[a, b, b + sides], [a, b + sides, a + sides]])
    last = (len(stations) - 1) * sides
    for i in range(1, sides - 1):
        f.extend([[0, i + 1, i], [last, last + i, last + i + 1]])
    return np.array(v), np.array(f), tile, group, bone


def cab(detail):
    parts = [
        box((0, 3.015, 2.29), (2.12, 0.13, 1.65), 0, "cab"),
        box((0, 2.31, 1.51), (2.04, 1.36, 0.10), 0, "cab"),
    ]
    for sign, side in [(1, "left"), (-1, "right")]:
        x = sign * 1.055
        bone = "door_" + side
        parts.extend(
            [
                box((x, 1.85, 2.34), (0.095, 0.66, 1.49), 0, "cab", bone),
                box((x, 2.55, 1.65), (0.084, 0.87, 0.10), 0, "cab", bone),
                box((x, 2.54, 3.08), (0.094, 0.86, 0.092), 0, "cab", bone, -0.23),
                box((x, 2.94, 2.26), (0.092, 0.073, 1.31), 0, "cab", bone),
            ]
        )
        if detail:
            parts.extend(
                [
                    box((x * 1.05, 1.79, 2.34), (0.024, 0.048, 1.43), 2, "cab", bone),
                    box((x * 0.94, 2.07, 2.13), (0.13, 0.07, 0.45), 11, "cab", bone),
                    box((x, 2.18, 2.34), (0.11, 0.042, 1.5), 4, "cab", bone),
                ]
            )
    if detail:
        parts.extend(
            [
                box((0.48, 2.14, 2.964), (0.75, 0.25, 0.085), 15, "cab"),
                box((-0.53, 2.89, 2.93), (0.68, 0.13, 0.056), 6, "cab"),
                box((0.5, 2.89, 2.93), (0.69, 0.13, 0.056), 6, "cab"),
            ]
        )
        for z in (1.95, 2.45):
            parts.append(box((1.08, 0.72, z), (0.24, 0.047, 0.33), 5, "cab"))
    if detail:
        # Rain lip, cowl and the two wiper blades ground the open windshield in its frame.
        parts.extend(
            [
                box((0, 2.965, 3.085), (2.15, 0.045, 0.081), 5, "cab"),
                box((0, 2.183, 3.135), (2.12, 0.079, 0.13), 0, "cab"),
                box((0, 2.228, 3.138), (2.06, 0.027, 0.071), 4, "cab"),
            ]
        )
        for side in [-1, 1]:
            parts.append(box((side * 0.50, 2.258, 3.122), (0.73, 0.023, 0.032), 4, "cab"))
            bone = "door_left" if side > 0 else "door_right"
            parts.append(box((side * 1.111, 1.98, 2.38), (0.012, 0.178, 0.382), 13, "cab", bone))
            parts.extend(
                [
                    box((side * 1.078, 1.36, 3.8), (0.042, 0.042, 0.70), 2, "hood"),
                    box((side * 1.094, 1.295, 4.04), (0.042, 0.085, 0.125), 9, "hood"),
                ]
            )
            # Rear conspicuity tape and small amber flank reflectors.
            for z in [-3.82, -2.06, -1.30, -0.42, 0.60]:
                parts.append(
                    box((side * (1.165 if z > -2 else 1.214), 0.965, z), (0.018, 0.053, 0.18), 9, "frame")
                )
    return parts


def model(detail=True, distant=False, level=None):
    parts = cab(detail)
    if not detail:
        parts += [
            box((0, 0.88, -0.12), (1.26, 0.32, 8.52), 3, "frame"),
            box((0, 1.25, 2.40), (2.17, 0.97, 2.06), 0, "cab"),
            box((0, 1.28, 3.80), (2.13, 0.83, 1.15), 0, "hood"),
            box((0, 1.2, 4.385), (1.04, 0.44, 0.048), 4, "hood"),
            box((0, 0.79, 4.43), (2.28, 0.23, 0.28), 5, "hood"),
            box((0, 0.63, -4.44), (2.27, 0.23, 0.22), 3, "frame"),
            box((0, 2.84, -1.35), (0.63, 0.23, 0.7), 3, "tank"),
            box((-0.90, 2.13, 1.21), (0.15, 2.25, 0.15), 5, "cab"),
        ]
        for sign in [-1, 1]:
            parts += [
                box((sign * 0.82, 1.22, 4.38), (0.3, 0.28, 0.08), 7, "hood"),
                box((sign * 0.46, 3.22, -1.47), (0.055, 0.05, 4.7), 5, "tank"),
                box((sign * 0.46, 3, -3.79), (0.047, 0.44, 0.047), 5, "tank"),
                box((sign * 0.46, 3, 0.86), (0.047, 0.44, 0.047), 5, "tank"),
                box((sign * 0.93, 1.11, -2.94), (0.57, 0.16, 2.55), 3, "frame"),
            ]
        parts += [
            box((0, 2.04, 3.08), (1.95, 0.19, 0.30), 4, "cab"),
            box((0.5, 2.22, 2.69), (0.40, 0.21, 0.091), 4, "cab", "steering_wheel"),
        ]
        for sign in [-1, 1]:
            parts += [
                box((sign * 0.89, 0.78, -0.33), (0.54, 0.56, 2.48), 14, "frame"),
                box((sign * 0.24, 2.03, -4.47), (0.05, 2.17, 0.05), 5, "tank"),
                box((sign * 1.04, 0.42, 2.26), (0.24, 0.12, 0.8), 5, "cab"),
                box(
                    (sign * 1.32, 2.42, 3.05),
                    (0.10, 0.46, 0.10),
                    10,
                    "cab",
                    "door_left" if sign > 0 else "door_right",
                ),
                box((sign * 0.50, 2.17, 1.76), (0.50, 0.61, 0.19), 6, "cab"),
            ]
        for height in ((2.0,) if distant else (1.30, 2.0, 2.73)):
            parts.append(box((0, height, -4.47), (0.49, 0.045, 0.045), 5, "tank"))
        tank = shell(
            [
                (0, 1.98, z, 1.16 * s, 0.84 * s)
                for z, s in [(-4.37, 0.70), (-4.12, 1), (1.0, 1), (1.25, 0.70)]
            ],
            "z",
            8 if distant else 12,
            16,
            "tank",
            "chassis",
        )
        parts.append(tank)
        for bone, (x, y, z) in PIVOTS.items():
            if not bone.startswith("wheel"):
                continue
            w = 0.145 if "front" in bone else 0.273
            parts.append(
                shell(
                    [(x - w, y, z, 0.52, 0.52), (x + w, y, z, 0.52, 0.52)],
                    "x",
                    8 if distant else 12,
                    4,
                    "wheel",
                    bone,
                )
            )
            sign = 1 if x > 0 else -1
            hub = sorted([x + sign * w, x + sign * (w + 0.014)])
            parts.append(shell([(h, y, z, 0.29, 0.29) for h in hub], "x", 6 if distant else 8, 5, "wheel", bone))
        if distant:
            parts = [
                p
                for p in parts
                if not (p[3] == "cab" and p[4].startswith("door") and np.ptp(p[0][:, 1]) < 0.1)
            ]
        return parts
    donor = np.load(ROOT / "ref/parts.npz")
    envelopes = np.load(ROOT / "ref/shells.npz") if level is not None else None
    arches = np.load(ROOT / "ref/arches.npz") if envelopes is not None else None
    suffix = {
        "fl": "front_left",
        "fr": "front_right",
        "r1l": "middle_left",
        "r1r": "middle_right",
        "r2l": "rear_left",
        "r2r": "rear_right",
    }
    for key in donor.files:
        if not key.endswith("_v"):
            continue
        v = donor[key].astype(float)
        f = donor[key[:-1] + "f"].astype(int)
        if key.startswith("wheel"):
            bone = "wheel_" + suffix[key.split("_")[1]]
            x, y, z = PIVOTS[bone]
            # Raised steel hubcap, contrasting flange and six bolt heads on the outer wheel face.
            sign = 1 if x > 0 else -1
            outer = x + sign * (0.147 if "front" in bone else 0.288)
            if level in (None, 0, 1):
                for radius, offset, length, tint, n in [
                    (0.237, 0.003, 0.022, 3, 20),
                    (0.152, 0.024, 0.042, 5, 20),
                    (0.079, 0.062, 0.021, 3, 12),
                ]:
                    ends = sorted([outer + sign * offset, outer + sign * (offset + length)])
                    parts.append(
                        shell([(e, y, z, radius, radius) for e in ends], "x", n, tint, "wheel", bone)
                    )
                if level in (None, 0):
                    for a in np.arange(6) * math.pi / 3:
                        ends = sorted([outer + sign * 0.016, outer + sign * 0.037])
                        parts.append(
                            shell(
                                [
                                    (e, y + 0.191 * math.cos(a), z + 0.191 * math.sin(a), 0.024, 0.024)
                                    for e in ends
                                ],
                                "x",
                                6,
                                5,
                                "wheel",
                                bone,
                            )
                        )
            if level is not None:
                w = 0.145 if "front" in bone else 0.273
                n = [24, 16, 12][level]
                parts.append(
                    shell(
                        [
                            (x + s * w, y, z, r, r)
                            for s, r in [(-1, 0.43), (-0.82, 0.52), (0.82, 0.52), (1, 0.43)]
                        ],
                        "x",
                        n,
                        4,
                        "wheel",
                        bone,
                    )
                )
                h = x + (w if x > 0 else -w)
                ends = sorted([h, h + (0.023 if x > 0 else -0.023)])
                parts.append(shell([(e, y, z, 0.304, 0.304) for e in ends], "x", n // 2, 5, "wheel", bone))
                continue
            mid = v[f].mean(1)
            tile = np.where((mid[:, 1] - y) ** 2 + (mid[:, 2] - z) ** 2 < 0.337**2, 5, 4)
            parts.append((v, f, tile, "wheel", bone))
            continue
        i = int(key.split("_")[1])
        if i in [20, 22, 120]:
            continue
        group = (
            "tank"
            if i in TANK
            else "hood"
            if i in [18, 19, 28, 45, 54, 55, 56, 57, 67, 114]
            else "cab"
            if v[:, 2].mean() > 1.3 and v[:, 1].mean() > 1.25
            else "frame"
        )
        tile = 3
        if i == 16:
            tile = 16
        elif i in [19, 3, 113]:
            tile = 0
        elif i in [37, 38, 92, 93]:
            tile = 6
        elif i in [95, 96, 105, 106, 13, 111, 45, 27]:
            tile = 4
        elif i in [28, 114]:
            tile = 7
        elif i in [23, 115, 39, 107]:
            tile = 8
        elif i in [61, 81, 94]:
            tile = 9
        elif i in [0, 127]:
            tile = 10
        elif i in [15, 112, 34, 35, 36]:
            tile = 14
        elif i in [4, 5, 6, 7, 14, 18, 29, 54, 55, 56, 57, 116, 21, 121] or i in TANK:
            tile = 5
        bone = (
            "steering_wheel"
            if i in [95, 96, 105]
            else "door_left"
            if i in [118, 119, 121, 127]
            else "door_right"
            if i in [0, 1, 2, 21]
            else "chassis"
        )
        if level is not None:
            if level == 2 and i not in {
                0,
                3,
                4,
                5,
                6,
                7,
                13,
                15,
                16,
                17,
                18,
                19,
                25,
                26,
                27,
                28,
                29,
                34,
                35,
                36,
                37,
                38,
                45,
                47,
                49,
                50,
                53,
                62,
                63,
                64,
                65,
                71,
                74,
                77,
                88,
                92,
                93,
                95,
                98,
                100,
                101,
                104,
                111,
                112,
                113,
                114,
                127,
            }:
                continue
            if level == 1 and i in {
                8,
                9,
                10,
                11,
                12,
                31,
                32,
                51,
                52,
                68,
                69,
                83,
                84,
                85,
                86,
                87,
                89,
                90,
                91,
                102,
                103,
                122,
                123,
                124,
                125,
                126,
            }:
                continue
            if i == 16:
                n = [32, 24, 16][level]
                parts.append(
                    shell(
                        [
                            (0, 1.98, z, 1.16 * s, 0.84 * s)
                            for z, s in [
                                (-4.37, 0.65),
                                (-4.26, 0.88),
                                (-4.08, 1),
                                (0.96, 1),
                                (1.14, 0.90),
                                (1.25, 0.65),
                            ]
                        ],
                        "z",
                        n,
                        16,
                        "tank",
                        bone,
                    )
                )
                continue
            if i in [4, 5, 6, 7]:
                # A solid narrow ellipse is buried in the vessel, with its stainless outside strip exposed.
                z = v[:, 2].mean()
                parts.append(
                    shell(
                        [(0, 1.98, z + d, 1.175, 0.855) for d in [-0.053, 0.053]],
                        "z",
                        [28, 20, 12][level],
                        5,
                        "tank",
                        bone,
                    )
                )
                continue
            if i in (3, 19, 113):
                v = arches[str(level) + key].astype(float)
                f = arches[str(level) + key[:-1] + "f"].astype(int)
            elif i == 95 and level < 2:
                pass  # preserve the opening through the steering rim
            elif str(level) + key in envelopes:
                v = envelopes[str(level) + key].astype(float)
                f = envelopes[str(level) + key[:-1] + "f"].astype(int)
        parts.append((v, f, tile, group, bone))
    return parts


def posed(parts, state, with_uv=False):
    result = []
    for v, f, tile, g, bone in parts:
        if state == "cistern" and g != "tank" or state == "stripped" and g in ["tank", "wheel"]:
            continue
        rest = v
        v = v.copy()
        if state == "separated" and g == "tank":
            # Rolled clear of the saddles. Keep an actual walkable gap beside the rails.
            y = v[:, 1].copy() - 1.98
            x = v[:, 0].copy()
            v[:, 0] = 4.2 + x * 0.4 - y * 0.9165
            v[:, 1] = 1.21 + x * 0.9165 + y * 0.4
            v[:, 2] -= 1.25
        if state == "impact":
            crush = np.clip((v[:, 2] - 2.78) / 1.8, 0, 1)
            v[:, 2] -= 0.99 * crush
            v[:, 1] += 0.32 * crush
            v[:, 0] += 0.38 * crush**2
        if state == "rear_crush":
            crush = np.clip((-v[:, 2] - 2.7) / 1.9, 0, 1)
            v[:, 2] += 1.22 * crush
            v[:, 0] -= 0.72 * crush**2
            v[:, 1] += 0.48 * crush**2
        if state in ["impact", "abandoned", "burnout"] and bone == "door_left":
            a = {"impact": -0.97, "abandoned": -0.37, "burnout": -0.71}[state]
            x, y, z = PIVOTS[bone]
            dx = v[:, 0] - x
            dz = v[:, 2] - z
            v[:, 0] = x + dx * math.cos(a) + dz * math.sin(a)
            v[:, 2] = z - dx * math.sin(a) + dz * math.cos(a)
        if state == "burnout":
            if g == "wheel":
                x, y, z = PIVOTS[bone]
                v[:, 1] = y + (v[:, 1] - y) * 0.62
                v[:, 2] = z + (v[:, 2] - z) * 0.62
            if g == "cab":
                v[:, 1] -= 0.32 * np.maximum(v[:, 1] - 1.85, 0) * (1 - 0.24 * v[:, 0])
            tile = 11 if g == "tank" else 12 if g != "wheel" else 3
        if state == "rollover":
            if g == "cab":
                v[:, 1] -= np.maximum(v[:, 1] - 2.15, 0) * (0.21 + 0.13 * v[:, 0])
            x = v[:, 0].copy()
            y = v[:, 1].copy()
            v[:, 0] = 0.15 * x + 0.9887 * (y - 1.55)
            v[:, 1] = 0.15 * y - 0.9887 * x
        if state == "abandoned":
            v[:, 1] -= np.minimum(v[:, 1] * 0.55, 0.105) + 0.016 * v[:, 0]
        result.append((v, f, tile, g, bone, rest))
    if state == "stripped":
        for x in [-0.47, 0.47]:
            for z in [-3.45, 2.92]:
                block = box((x, 0.33, z), (0.55, 0.55, 0.85), 11, "frame")
                result.append((*block, block[0]))
    ground = min(v[:, 1].min() for v, *_ in result)
    return [
        (v - np.array([0, ground, 0]), f, t, g, b, *([rest] if with_uv else []))
        for v, f, t, g, b, rest in result
    ]


def uv_for(v, f, tile):
    pts = v[f]
    norm = np.cross(pts[:, 1] - pts[:, 0], pts[:, 2] - pts[:, 0])
    axis = np.abs(norm).argmax(1)
    a = np.where((axis == 0)[:, None], pts[:, :, 2], pts[:, :, 0])
    b = np.where((axis == 1)[:, None], pts[:, :, 2], pts[:, :, 1])
    lo = v.min(0)
    hi = v.max(0)
    span = np.maximum(hi - lo, 0.002)
    a = (a - np.where(axis == 0, lo[2], lo[0])[:, None]) / np.where(axis == 0, span[2], span[0])[:, None]
    b = (b - np.where(axis == 1, lo[2], lo[1])[:, None]) / np.where(axis == 1, span[2], span[1])[:, None]
    t = np.broadcast_to(tile, (len(f),))
    u = (t % 4)[:, None] * 0.25 + 0.007 + a * 0.236
    w = 0.5 + (t // 4)[:, None] * 0.125 + 0.005 + (1 - b) * 0.115
    tank = t == 16
    if np.any(tank):
        # A single lengthwise panel per flank; the crown and end caps do not repeat the stencil.
        length = (pts[:, :, 2] + 4.37) / 5.62
        nose = norm[:, 2] ** 2 > 1.2 * (norm[:, 0] ** 2 + norm[:, 1] ** 2)
        flank = tank & ~nose
        u[flank] = (
            np.where((pts[flank, :, 0].mean(1) > 0)[:, None], 1 - length[flank], length[flank]) * 0.991
            + 0.004
        )
        w[flank] = 0.005 + (2.82 - pts[flank, :, 1]) / 1.68 * 0.489
        end = tank & nose
        u[end] = 0.26 + 0.22 * a[end]
        w[end] = 0.505 + 0.115 * (1 - b[end])
    if np.all(t == 13) and v[:, 0].mean() > 0:
        u = 0.75 - u
    if np.all(t == 15):
        front = norm[:, 2] >= 0
        # Only the face towards the seats carries gauges.
        u[front] = 0.758 + 0.22 * a[front]
        w[front] = 0.76 + 0.10 * (1 - b[front])
    # Give each projection chart its own gutter, including opposing chart windings.
    u += ((axis * 2 + (norm[np.arange(len(f)), axis] > 0))[:, None] - 2.5) * 0.00042
    uv = np.stack([u, 1 - w], axis=-1)
    # Submillimetre bevels can quantize to a line in the packed UV format.
    d = uv[:, 1] - uv[:, 0]
    e = uv[:, 2] - uv[:, 0]
    tiny = np.abs(d[:, 0] * e[:, 1] - d[:, 1] * e[:, 0]) < 0.000002
    uv[tiny] = uv[tiny].mean(1)[:, None, :] + np.array([[-0.002, -0.002], [0.003, -0.002], [-0.002, 0.003]])
    return uv


def flat_paint(parts):
    """Flat tiers keep the service stripe and the contrasting cab trim as palette faces."""
    out = []
    for v, f, t, g, b in parts:
        if isinstance(t, (int, np.integer)) and t == 16:
            pts = v[f]
            y = pts[:, :, 1].mean(1)
            z = pts[:, :, 2].mean(1)
            panel = (z > -4.2) & (z < 1.12)
            swatches = np.where(
                panel & (y >= 1.53) & (y < 1.58), 2, np.where(panel & (y >= 1.58) & (y < 1.735), 0, 16)
            )
            for tint in np.unique(swatches):
                used, local = np.unique(f[swatches == tint], return_inverse=True)
                out.append((v[used], local.reshape(-1, 3), int(tint), g, b))
        else:
            out.append((v, f, t, g, b))
    return out
