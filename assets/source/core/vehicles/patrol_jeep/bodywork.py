"""Pressed shell, separate doors, removable hardtop, stamped wheel flares and patrol equipment."""

import geometry as g
from geometry import box, cylinder_between as cyl, loft, side_panel, tube


def body():
    box("Pressed cabin floor", (0, 0.575, -0.39), (1.62, 0.105, 3.24), 0.042, "carpet")
    box("Footwell firewall", (0, 0.885, 0.966), (1.64, 0.57, 0.113), 0.041, "vinyl")
    box("Rear luggage floor", (0, 0.762, -1.65), (1.61, 0.073, 0.79), 0.035, "carpet")
    for s in (-1, 1):
        box("Inner rear wheel tub", (s * 0.714, 0.813, -1.45), (0.289, 0.384, 1.04), 0.094, "mat", segments=2)
        box("Body sill", (s * 0.801, 0.622, -0.13), (0.135, 0.105, 2.13), 0.024, "ebony")
        # A tapered cowl, shelf and stepped bonnet expose each wing as a separate casting.
        side_panel(
            "Cowl cheek",
            s,
            [(0.867, 0.68), (0.985, 0.67), (1.195, 0.96), (1.24, 1.175), (1.057, 1.31), (0.867, 1.31)],
            0.665,
            0.849,
            "ebony",
        )
        side_panel("Engine side", s, [(1.072, 0.785), (2.085, 0.79), (2.101, 1.124), (1.074, 1.217)], 0.632, 0.687, "ebony")
        for z in (1.121, 1.165, 1.209):
            side_panel(
                "Cowl exhaust slots",
                s,
                [(z, 0.985), (z + 0.024, 0.985), (z + 0.068, 1.13), (z + 0.044, 1.13)],
                0.688,
                0.70,
                "grille",
            )
        for z in (1.29, 1.962):
            box("Bonnet draw latch", (s * 0.693, 1.12, z), (0.032, 0.094, 0.036), 0.010, "rubber")
            box("Latch keeper", (s * 0.708, 1.13, z), (0.014, 0.039, 0.052), 0.006, "hub")
        # Around each tyre the flared edge moves out from the pressed steel to an outer rubber lip.
        for zc in (-1.45, 1.45):
            curve = [
                (-0.56, 0.56),
                (-0.515, 0.744),
                (-0.392, 0.901),
                (-0.26, 0.995),
                (-0.13, 1.014),
                (0.218, 1.014),
                (0.374, 0.961),
                (0.501, 0.792),
                (0.554, 0.605),
            ]
            flares = []
            for dz, h in curve:
                outer = 1.009 - 0.025 * (abs(dz) / 0.56) ** 2
                flares.append(
                    [
                        (s * 0.715, h - 0.083, zc + dz),
                        (s * 0.72, h + 0.016, zc + dz),
                        (s * (outer - 0.030), h + 0.01, zc + dz),
                        (s * outer, h - 0.010, zc + dz),
                        (s * outer, h - 0.062, zc + dz),
                        (s * (outer - 0.031), h - 0.088, zc + dz),
                    ]
                )
            loft(
                "Faceted bolt-on wheel flare",
                flares,
                lambda i, j: "ebony" if j in (0, 1) else "rubber",
                ("rubber", "rubber"),
            )
            for dz, h in (curve[1], curve[2], curve[4], curve[6], curve[7]):
                x = 1.010 - 0.025 * (abs(dz) / 0.56) ** 2
                cyl(
                    "Fender fastener",
                    (s * (x - 0.008), h - 0.038, zc + dz),
                    (s * (x + 0.002), h - 0.038, zc + dz),
                    0.009,
                    "hub",
                    8,
                )
        # Rear wall above the tyre envelope, plus a forward leg behind the door's swept trailing corner.
        rearwall = [
            (-2.075, 0.659),
            (-1.994, 0.661),
            (-1.936, 0.864),
            (-1.80, 0.977),
            (-1.66, 1.035),
            (-1.239, 1.035),
            (-1.096, 0.984),
            (-1.095, 1.305),
            (-2.075, 1.305),
        ]
        side_panel("Rear quarter pressing", s, rearwall, 0.758, 0.855, "ebony")
        # Livery on the high black corner panel; the strip remains legible over the arch.
        side_panel(
            "Quarter call sign",
            s,
            [(-1.99, 1.048), (-1.436, 1.048), (-1.436, 1.277), (-1.99, 1.277)],
            0.849,
            0.860,
            "quarter",
            edge="ebony",
        )
        side_panel(
            "Rear lower quarter",
            s,
            [(-2.083, 0.614), (-1.96, 0.614), (-1.928, 0.838), (-1.991, 1.007), (-2.083, 1.006)],
            0.757,
            0.846,
            "ebony",
        )
        box("Tailgate inner jamb", (s * 0.797, 1.029, -2.024), (0.109, 0.589, 0.097), 0.018, "ivory")
    # Wide cowl supports a fully open driver's sightline. The raised central hood ridge fades toward the nose.
    box("Wiper cowl", (0, 1.258, 0.969), (1.699, 0.111, 0.207), 0.043, "ebony", segments=2)
    profile = []
    for z, w, h in [
        (1.035, 0.713, 1.295),
        (1.134, 0.719, 1.289),
        (1.763, 0.706, 1.243),
        (2.082, 0.676, 1.209),
        (2.124, 0.667, 1.189),
    ]:
        profile.append(
            [
                (-w, 1.122, z),
                (-w, h - 0.023, z),
                (-w + 0.042, h, z),
                (-w * 0.67, h + 0.012, z),
                (-w * 0.54, h + 0.034, z),
                (w * 0.54, h + 0.034, z),
                (w * 0.67, h + 0.012, z),
                (w - 0.042, h, z),
                (w, h - 0.023, z),
                (w, 1.122, z),
            ]
        )
    loft("Power dome bonnet", profile, "ebony")
    for s in (-1, 1):
        for z in (1.085, 1.175):
            box("Bonnet hinge leaf", (s * 0.511, 1.306, z), (0.083, 0.022, 0.079), 0.006, "hub")
        cyl("Bonnet hinge pin", (s * 0.462, 1.321, 1.119), (s * 0.565, 1.321, 1.119), 0.016, "graphite", 10)
        box("Washer nozzle", (s * 0.43, 1.333, 1.052), (0.036, 0.024, 0.039), 0.008, "rubber")
    tail = [
        (-0.823, 0.644),
        (-0.849, 0.751),
        (-0.849, 1.243),
        (-0.788, 1.307),
        (0.788, 1.307),
        (0.849, 1.243),
        (0.849, 0.751),
        (0.823, 0.644),
    ]
    loft("Tailgate", [[(x, y, z) for x, y in tail] for z in (-1.983, -2.078)], "ebony")
    box("Tailgate inner door card", (0, 1.014, -1.975), (1.48, 0.41, 0.045), 0.04, "vinyl")
    for yy in (0.781, 1.19):
        box("External rear hinge", (-0.687, yy, -2.094), (0.193, 0.055, 0.051), 0.012, "hub")
    box("Spare wheel pedestal", (0, 1.142, -2.123), (0.269, 0.241, 0.144), 0.036, "graphite")


def doors():
    for s, side in ((1, "left"), (-1, "right")):
        for rear in (False, True):
            g.bone = "door_" + ("rear_" if rear else "") + side
            if rear:
                zy = [
                    (-1.09, 1.306),
                    (-0.158, 1.306),
                    (-0.158, 0.694),
                    (-0.205, 0.666),
                    (-0.863, 0.666),
                    (-0.898, 0.706),
                    (-0.964, 0.864),
                    (-1.09, 1.00),
                ]
                top_front, top_aft = -0.169, -1.091
                bot_front, bot_aft = -0.169, -1.091
                pull, axis = -0.905, -0.17
            else:
                zy = [(-0.124, 1.305), (0.851, 1.305), (0.851, 0.713), (0.802, 0.667), (-0.083, 0.667), (-0.124, 0.707)]
                top_front, top_aft = 0.515, -0.126
                bot_front, bot_aft = 0.848, -0.126
                pull, axis = 0.021, 0.861
            side_panel(
                "Rear patrol door" if rear else "Front patrol door",
                s,
                zy,
                0.793,
                0.861,
                "backdoor" if rear else "frontdoor",
                edge="ivory",
            )

            # Empty openings bounded by rolled steel and thin glass seals survive both render paths.
            def xat(y, z):
                return 0.850 - 0.055 * (y - 1.31) / 0.55

            def upright(z0, z1, width, name):
                side_panel(
                    name,
                    s,
                    [(z0 - width / 2, 1.292), (z0 + width / 2, 1.292), (z1 + width / 2, 1.856), (z1 - width / 2, 1.856)],
                    lambda y, z: xat(y, z) - 0.042,
                    xat,
                    "ivory",
                    edge="ebony",
                )

            upright(bot_front, top_front, 0.044, "Front door window channel")
            upright(bot_aft, top_aft, 0.043, "Rear door window channel")
            side_panel(
                "Upper sash",
                s,
                [
                    (top_aft - 0.016, 1.822),
                    (top_front + 0.018, 1.822),
                    (top_front + 0.018, 1.859),
                    (top_aft - 0.016, 1.859),
                ],
                0.761,
                0.805,
                "ivory",
                edge="ebony",
            )
            box(
                "Window scraper",
                (s * 0.847, 1.311, (bot_front + bot_aft) / 2),
                (0.041, 0.023, bot_front - bot_aft - 0.026),
                0.006,
                "rubber",
            )
            box("Door pull well", (s * 0.865, 1.232, pull), (0.016, 0.068, 0.163), 0.021, "graphite", segments=2)
            box("Exterior paddle handle", (s * 0.875, 1.245, pull), (0.029, 0.03, 0.124), 0.010, "rubber")
            for y in (0.816, 1.137):
                box("Exposed hinge leaf", (s * 0.869, y, axis - 0.042), (0.016, 0.054, 0.079), 0.006, "graphite")
                cyl("External hinge barrel", (s * 0.877, y - 0.039, axis), (s * 0.877, y + 0.039, axis), 0.014, "hub", 10)
            box(
                "Inner moulded door card",
                (s * 0.783, 1.055, (bot_front + bot_aft) / 2),
                (0.039, 0.419, (bot_front - bot_aft) * 0.66),
                0.054,
                "vinyl",
                segments=2,
            )
            box("Door armrest", (s * 0.749, 1.062, (bot_front + bot_aft) / 2), (0.079, 0.065, 0.339), 0.023, "rubber")
            if not rear:
                tube(
                    "Wing mirror arm",
                    [(s * 0.857, 1.299, 0.748), (s * 0.91, 1.325, 0.748), (s * 0.981, 1.376, 0.725)],
                    0.022,
                    "graphite",
                )
                box("Wing mirror casing", (s * 0.99, 1.409, 0.698), (0.15, 0.135, 0.112), 0.033, "ebony", segments=2)
                box("Wing mirror glass", (s * 0.99, 1.409, 0.64), (0.131, 0.111, 0.009), 0.004, "mirror")
    g.bone = "chassis"


def hardtop():
    # Profiled roof panel forms a shadow line above the doors and a pressed lip above the windscreen.
    roof = []
    for z, w, h in [
        (-2.043, 0.761, 1.865),
        (-2.004, 0.815, 1.91),
        (-1.857, 0.834, 1.931),
        (-0.68, 0.837, 1.936),
        (0.478, 0.837, 1.933),
        (0.588, 0.827, 1.92),
        (0.648, 0.798, 1.893),
    ]:
        roof.append(
            [
                (-w, h - 0.060, z),
                (-w, h - 0.020, z),
                (-w + 0.036, h, z),
                (-w + 0.109, h + 0.006, z),
                (w - 0.109, h + 0.006, z),
                (w - 0.036, h, z),
                (w, h - 0.020, z),
                (w, h - 0.060, z),
            ]
        )
    loft("Removable ribbed hardtop", roof, lambda i, j: "topliner" if j == 7 else "roof", ("roof", "roof"))
    for x in (-0.587, -0.487, 0.487, 0.587):
        box("Roof stiffening bead", (x, 1.936, -0.766), (0.044, 0.021, 2.221), 0.010, "roof")
    box("Aerial roof number", (0, 1.938, -1.0), (0.856, 0.012, 0.78), 0.004, "roofid")
    for s in (-1, 1):
        for name, lo, hi, w in (
            ("Windscreen pillar", 0.914, 0.570, 0.070),
            ("B pillar", -0.147, -0.146, 0.051),
            ("Quarter pillar", -1.119, -1.119, 0.063),
            ("Rear hatch pillar", -2.006, -1.992, 0.082),
        ):
            side_panel(
                name,
                s,
                [(lo - w / 2, 1.277), (lo + w / 2, 1.277), (hi + w / 2, 1.884), (hi - w / 2, 1.884)],
                lambda y, z: 0.798 - 0.059 * (y - 1.277) / 0.607,
                lambda y, z: 0.855 - 0.059 * (y - 1.277) / 0.607,
                "ebony" if name == "Windscreen pillar" else "roof",
            )

        def tapered(y, z):
            return 0.846 - 0.053 * (y - 1.31) / 0.55

        quarter = [
            (-1.967, 1.349),
            (-1.936, 1.322),
            (-1.159, 1.322),
            (-1.136, 1.355),
            (-1.136, 1.812),
            (-1.177, 1.846),
            (-1.926, 1.846),
            (-1.966, 1.810),
        ]
        side_panel("Quarter glass surround", s, quarter, lambda y, z: tapered(y, z) - 0.031, tapered, "rubber")
        center = (-1.557, 1.581)
        glass = [(center[0] + (z - center[0]) * 0.931, center[1] + (y - center[1]) * 0.908) for z, y in quarter]
        side_panel(
            "Fixed tinted cargo glass", s, glass, tapered, lambda y, z: tapered(y, z) + 0.004, "glass", "glass", "rubber"
        )
        box("Roof rain gutter", (s * 0.831, 1.875, -0.709), (0.023, 0.030, 2.588), 0.009, "graphite")
        # Door striker and jamb remain on the body when the leaf opens.
        cyl("B pillar striker bolt", (s * 0.77, 1.121, -0.147), (s * 0.828, 1.121, -0.147), 0.023, "hub")
    # Only the smoked frit edges are opaque. Forward glass remains clear in the palette renderer.
    loft(
        "Windscreen upper frit",
        [
            [(-0.773, y, z), (0.773, y, z), (0.773, y - 0.026, z + 0.015), (-0.773, y - 0.026, z + 0.015)]
            for y, z in [(1.867, 0.585), (1.858, 0.574)]
        ],
        "glass",
    )
    box("Rear hatch lower rail", (0, 1.335, -2.038), (1.64, 0.069, 0.075), 0.017, "roof")
    box("Rear hatch upper rail", (0, 1.845, -2.022), (1.61, 0.073, 0.079), 0.016, "roof")
    for s in (-1, 1):
        box("Rear hatch corner glass", (s * 0.753, 1.587, -2.008), (0.062, 0.448, 0.019), 0.008, "glass")
        tube("Wiper", [(s * 0.535, 1.328, 0.947), (s * 0.498, 1.343, 0.93), (s * 0.19, 1.371, 0.908)], 0.009, "rubber")
        cyl("Wiper blade", (s * 0.36, 1.356, 0.931), (s * 0.035, 1.39, 0.905), 0.009, "rubber", 8)
