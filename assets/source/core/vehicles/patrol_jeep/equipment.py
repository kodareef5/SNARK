"""Patrol optics, self-recovery fittings and the four-seat utility cabin."""

import math
from mathutils import Matrix, Vector
import geometry as g
from geometry import box, loft, cylinder_between as cyl, tube


def front_and_rear():
    # A shallow face pressing follows the narrow bonnet, with a steel rim around each inset circular optic.
    outline = [
        (-0.712, 0.770),
        (-0.733, 0.817),
        (-0.733, 1.132),
        (-0.673, 1.194),
        (0.673, 1.194),
        (0.733, 1.132),
        (0.733, 0.817),
        (0.712, 0.770),
    ]
    loft("Front grille stamping", [[(x, y, z) for x, y in outline] for z in (2.056, 2.127)], "ebony")
    box("Radiator shadow", (0, 0.997, 2.128), (0.895, 0.319, 0.033), 0.015, "grille")
    for yy in (0.874, 0.923, 0.972, 1.021, 1.070, 1.119):
        box("Radiator fin", (0, yy, 2.146), (0.848, 0.011, 0.006), 0.002, "graphite", segments=1)
    for i in range(6):
        x = (i - 2.5) * 0.142
        cyl("Rounded grille bars", (x, 0.846, 2.150), (x, 1.146, 2.150), 0.018, "ebony", 12)
    for s in (-1, 1):
        xx = s * 0.566
        for tag, r, y, z, length in [
            ("graphite", 0.152, 1.012, 2.116, 0.036),
            ("bright", 0.133, 1.012, 2.147, 0.015),
            ("rubber", 0.121, 1.012, 2.154, 0.017),
            ("projector", 0.108, 1.012, 2.164, 0.014),
            ("drl", 0.082, 1.012, 2.174, 0.009),
            ("projector", 0.069, 1.012, 2.179, 0.014),
            ("lamp", 0.041, 1.018, 2.19, 0.011),
        ]:
            cyl("Round headlamp " + tag, (xx, y, z), (xx, y, z + length), r, tag, 32)
        box("Fender clearance lamp", (s * 0.892, 1.037, 1.697), (0.15, 0.05, 0.076), 0.018, "rubber")
        box("Fender amber lens", (s * 0.892, 1.037, 1.739), (0.123, 0.039, 0.013), 0.005, "amber")
    # Bevelled ends of both bumpers deflect into the wheel openings, leaving the shoulders exposed.
    for sign, zc in ((1, 2.190), (-1, -2.100)):
        rings = []
        for x, scale, offset in [
            (-0.94, 0.54, -0.111),
            (-0.885, 0.78, -0.061),
            (-0.73, 0.98, -0.011),
            (-0.493, 1, 0),
            (0.493, 1, 0),
            (0.73, 0.98, -0.011),
            (0.885, 0.78, -0.061),
            (0.94, 0.54, -0.111),
        ]:
            rings.append(
                [
                    (x, 0.66 + y * scale, zc + sign * (z * scale + offset))
                    for y, z in [
                        (-0.095, -0.085),
                        (-0.119, -0.039),
                        (-0.097, 0.096),
                        (-0.059, 0.127),
                        (0.062, 0.127),
                        (0.110, 0.081),
                        (0.102, -0.073),
                    ]
                ]
            )
        loft("Folded off-road bumper", rings, "graphite")
    shape = [(-0.51, 0.475), (-0.36, 0.385), (0.36, 0.385), (0.51, 0.475), (0.53, 0.596), (-0.53, 0.596)]
    loft("Front skid plate", [[(x, y, 2.20 + (y - 0.48) * 0.52 + d) for x, y in shape] for d in (-0.026, 0.0)], "hub")
    for x in (-0.222, -0.111, 0, 0.111, 0.222):
        box("Skid drain flute", (x, 0.502, 2.217), (0.021, 0.088, 0.010), 0.005, "graphite", Matrix.Rotation(0.42, 4, "X"))
    # Winch and aluminium fairlead sit forward of the grille, below the optical modules.
    box("Winch cradle", (0, 0.796, 2.191), (0.704, 0.101, 0.211), 0.034, "rubber")
    cyl("Winch cable drum", (-0.171, 0.860, 2.185), (0.179, 0.860, 2.185), 0.072, "hub", 16)
    for i in range(-6, 7):
        x = i * 0.022
        cyl("Cable winding", (x - 0.003, 0.86, 2.185), (x + 0.003, 0.86, 2.185), 0.074, "graphite", 16)
    box("Winch motor", (0.253, 0.868, 2.174), (0.165, 0.152, 0.170), 0.038, "ebony")
    box("Winch gearbox", (-0.224, 0.863, 2.174), (0.114, 0.147, 0.153), 0.029, "graphite")
    box("Fairlead flange", (0, 0.748, 2.308), (0.356, 0.083, 0.051), 0.023, "alloy")
    box("Fairlead opening", (0, 0.748, 2.336), (0.248, 0.036, 0.009), 0.004, "grille")
    tube(
        "Brush guard",
        [
            (-0.48, 0.765, 2.211),
            (-0.48, 0.958, 2.221),
            (-0.416, 1.071, 2.202),
            (-0.329, 1.105, 2.189),
            (0.329, 1.105, 2.189),
            (0.416, 1.071, 2.202),
            (0.48, 0.958, 2.221),
            (0.48, 0.765, 2.211),
        ],
        0.026,
        "graphite",
        12,
    )
    for s in (-1, 1):
        for sign, zc in [(1, 2.318), (-1, -2.212)]:
            # Recovery loops are open within their forged U and keyed around a steel cross pin.
            pts = [
                (s * 0.57, 0.697, zc),
                (s * 0.57, 0.635, zc + sign * 0.045),
                (s * 0.586, 0.605, zc + sign * 0.053),
                (s * 0.629, 0.605, zc + sign * 0.053),
                (s * 0.645, 0.635, zc + sign * 0.045),
                (s * 0.645, 0.697, zc),
            ]
            tube("Recovery bow", pts, 0.016, "shackle", 10)
            cyl("Recovery pin", (s * 0.546, 0.694, zc), (s * 0.67, 0.694, zc), 0.018, "hub", 8)
        y, z = 1.043, -2.098
        box("Tail lamp plinth", (s * 0.713, y, z), (0.185, 0.254, 0.095), 0.035, "rubber", segments=2)
        box("Stop lamp", (s * 0.713, y + 0.022, z - 0.051), (0.147, 0.165, 0.023), 0.011, "tail", segments=2)
        box("Rear reversing optic", (s * 0.713, y - 0.071, z - 0.056), (0.136, 0.031, 0.018), 0.007, "lamp")
        box("Tail light signature", (s * 0.713, y + 0.041, z - 0.064), (0.105, 0.018, 0.008), 0.004, "red")
    box("Rear registration holder", (0.527, 0.792, -2.119), (0.355, 0.148, 0.056), 0.020, "rubber")
    box("County registration", (0.527, 0.792, -2.151), (0.334, 0.132, 0.012), 0.005, "plate")
    box("Centre stop marker stem", (0, 1.474, -2.143), (0.075, 0.252, 0.066), 0.017, "rubber")
    box("High stop lamp", (0, 1.611, -2.157), (0.206, 0.044, 0.073), 0.012, "tail")


def lightbar():
    for x in (-0.492, 0.492):
        box("Lamp mounting shoe", (x, 1.965, 0.282), (0.157, 0.077, 0.157), 0.018, "rubber")
    box("Extruded lightbar rail", (0, 2.001, 0.28), (1.456, 0.040, 0.208), 0.017, "graphite")
    box("Lightbar inner chassis", (0, 2.044, 0.28), (1.413, 0.086, 0.170), 0.023, "graphite")
    for side, tag in ((1, "red"), (-1, "blue")):
        for xc, width in ((0.234, 0.139), (0.434, 0.239), (0.626, 0.131)):
            box("Prismatic " + tag + " optic", (side * xc, 2.045, 0.28), (width, 0.068, 0.212), 0.019, tag, segments=2)
            for direction in (-1, 1):
                for j in range(3 if width < 0.15 else 5):
                    count = 3 if width < 0.15 else 5
                    x = xc + width * 0.69 * ((j + 0.5) / count - 0.5)
                    box(
                        "LED collimator",
                        (side * x, 2.045, 0.28 + direction * 0.106),
                        (width / (count * 2.9), 0.031, 0.004),
                        0.0018,
                        tag,
                    )
        box("Side-facing lens", (side * 0.704, 2.044, 0.280), (0.047, 0.066, 0.165), 0.017, tag)
        box("Grille strobe seal", (side * 0.39, 1, 2.126), (0.113, 0.064, 0.040), 0.017, "rubber")
        box("Grille strobe " + tag, (side * 0.39, 1, 2.147), (0.091, 0.042, 0.013), 0.006, tag)
    box("Lightbar cap", (0, 2.083, 0.28), (1.440, 0.014, 0.202), 0.006, "graphite")
    box("Central white takedown lens", (0, 2.043, 0.367), (0.248, 0.052, 0.042), 0.016, "lamp")
    box("Central rear alley lens", (0, 2.043, 0.190), (0.248, 0.052, 0.042), 0.016, "lamp")


def interior():
    for s in (1, -1):
        for z in (0.22, -0.78):
            x = s * 0.446
            box("Seat pedestal", (x, 0.746, z), (0.431, 0.233, 0.383), 0.035, "graphite")
            box("Seat cushion", (x, 0.887, z), (0.519, 0.101, 0.471), 0.049, "canvas", segments=2)
            for d in (-1, 1):
                box("Cushion bolster", (x + d * 0.211, 0.927, z), (0.080, 0.100, 0.472), 0.038, "vinyl", segments=2)
            rotation = Matrix.Rotation(-0.124, 4, "X")
            box("Upholstered seat back", (x, 1.157, z - 0.244), (0.494, 0.543, 0.15), 0.069, "canvas", rotation, 2)
            for d in (-1, 1):
                box(
                    "Seat back bolster",
                    (x + d * 0.205, 1.160, z - 0.200),
                    (0.092, 0.492, 0.121),
                    0.039,
                    "vinyl",
                    rotation,
                    2,
                )
                cyl(
                    "Headrest stalk",
                    (x + d * 0.075, 1.387, z - 0.266),
                    (x + d * 0.075, 1.493, z - 0.275),
                    0.011,
                    "bright",
                    8,
                )
            box("Adjustable head restraint", (x, 1.525, z - 0.279), (0.276, 0.151, 0.138), 0.055, "canvas", rotation, 2)
            box("Belt buckle", (x - s * 0.263, 0.947, z - 0.11), (0.041, 0.107, 0.042), 0.013, "rubber")
            box("Webbing release", (x - s * 0.263, 0.995, z - 0.105), (0.034, 0.012, 0.029), 0.003, "red")
    box("Moulded dashboard", (0, 1.190, 0.915), (1.58, 0.192, 0.334), 0.060, "vinyl", segments=2)
    box("Dash lower bolster", (0, 1.094, 0.893), (1.49, 0.175, 0.212), 0.049, "rubber")
    box("Cluster shroud", (0.446, 1.261, 0.799), (0.379, 0.141, 0.202), 0.047, "graphite")
    box("Gauge cluster", (0.446, 1.240, 0.692), (0.305, 0.101, 0.015), 0.007, "cluster")
    box("Dispatch console", (0, 1.183, 0.728), (0.321, 0.188, 0.160), 0.027, "rubber")
    box("Digital dispatch radio", (0, 1.192, 0.643), (0.289, 0.139, 0.014), 0.006, "radio")
    for x in (-0.675, -0.245, 0.225, 0.672):
        cyl("Dash vent collar", (x, 1.198, 0.749), (x, 1.198, 0.726), 0.051, "hub", 18)
        cyl("Dash vent", (x, 1.198, 0.730), (x, 1.198, 0.720), 0.042, "grille", 18)
        for yp in (-0.016, 0.016):
            box("Vent slat", (x, 1.198 + yp, 0.716), (0.062, 0.008, 0.008), 0.003, "graphite")
    box("Centre tunnel", (0, 0.785, -0.021), (0.281, 0.294, 0.978), 0.038, "vinyl")
    box("Console armrest", (0, 0.961, -0.211), (0.244, 0.091, 0.412), 0.041, "vinyl")
    for x, z in ((-0.056, 0.279), (0.069, 0.220)):
        cyl("Transfer case selector", (x, 0.892, z), (x, 1.042, z - 0.027), 0.013, "hub", 10)
        box("Selector grip", (x, 1.047, z - 0.028), (0.052, 0.061, 0.061), 0.023, "rubber")
    for s in (1, -1):
        box("Footwell mat", (s * 0.440, 0.634, 0.477), (0.534, 0.013, 0.394), 0.006, "mat")
        box("Grab handle feet", (s * 0.738, 1.77, 0.43), (0.068, 0.060, 0.111), 0.016, "graphite")
        tube(
            "Pillar grab",
            [(s * 0.753, 1.776, 0.448), (s * 0.711, 1.748, 0.429), (s * 0.711, 1.705, 0.498), (s * 0.757, 1.692, 0.509)],
            0.011,
            "rubber",
        )
    cyl("Mirror stem", (0, 1.832, 0.609), (0, 1.770, 0.526), 0.014, "rubber")
    box("Rearview mirror", (0, 1.753, 0.498), (0.218, 0.072, 0.043), 0.016, "graphite")
    box("Rearview mirror face", (0, 1.754, 0.475), (0.194, 0.055, 0.008), 0.003, "mirror")
    cyl("Steering column", (0.446, 1.17, 0.816), (0.446, 1.20, 0.63), 0.04, "graphite")
    g.bone = "steering_wheel"
    # Wheel hub is exactly on the rig pivot. A slight rake leaves its top below the driver's sightline.
    c = Vector((0.446, 1.20, 0.63))
    h = Vector((1, 0, 0))
    v = Vector((0, 0.974, 0.226))
    n = h.cross(v)
    p = g.Part()
    rings = []
    for j in range(32):
        t = math.tau * j / 32
        a = math.cos(t) * h + math.sin(t) * v
        rings.append(
            [
                p.v(c + a * (0.156 + 0.016 * math.cos(k * math.tau / 8)) + n * 0.016 * math.sin(k * math.tau / 8))
                for k in range(8)
            ]
        )
    for j in range(32):
        for k in range(8):
            p.face([rings[j][k], rings[j][(k + 1) % 8], rings[(j + 1) % 32][(k + 1) % 8], rings[(j + 1) % 32][k]], "rubber")
    g.attach(p.obj("Three spoke steering rim"))
    for angle in (math.radians(-87), math.radians(18), math.radians(162)):
        p = c + 0.151 * (h * math.cos(angle) + v * math.sin(angle))
        cyl("Steering spoke", tuple(c), tuple(p), 0.017, "hub", 8)
    box("Steering wheel boss", tuple(c), (0.147, 0.103, 0.057), 0.026, "vinyl")
    g.bone = "chassis"
