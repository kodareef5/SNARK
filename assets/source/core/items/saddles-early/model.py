"""Five saddles at rest in metres. Positive Z faces the animal's head."""

from geometry import Tack, X, Y, Z


def reflected(side, path):
    return [(side * x, y, z) for x, y, z in path]


def strap(tack, path, surface, width, *, guide=Z, closed=False):
    tack.sweep(path, surface, width * 0.5, 0.0048, guide=guide,
               sides=(8, 6, 4, 4)[tack.level], closed=closed)


def buckle(tack, x, y, z, width, length, surface, *, pin=True):
    if tack.level > 1:
        return
    hx, hz = width / 2, length / 2
    corner = width * 0.13
    path = [(-hx + corner, hz), (hx - corner, hz), (hx, hz - corner),
            (hx, corner - hz), (hx - corner, -hz), (corner - hx, -hz),
            (-hx, corner - hz), (-hx, hz - corner)]
    tack.sweep([(x + u, y, z + v) for u, v in path], surface, width * 0.07,
               closed=True, cuts=0, sides=(6, 4)[tack.level])
    if pin:
        tack.sweep([(x, y + 0.001, z - hz), (x - width * 0.064, y + 0.004, z + hz * 0.94)],
                   surface, width * 0.043, cuts=0, sides=5)


def stirrup(tack, side, base, span, surface, *, flat=False):
    x, y, z = base
    # The tread tips outward and stops level with the other two bearing points.
    profile = [(0.0, 0.0, -0.22), (0.29, -0.27, -0.53), (0.80, -0.65, -0.64),
               (1.00, -0.67, -0.51), (1.00, -0.67, 0.52), (0.81, -0.64, 0.65),
               (0.29, -0.27, 0.53), (0.0, 0.0, 0.22)]
    if flat:
        profile = [(u, v * 0.4, w) for u, v, w in profile]
    if tack.level == 2:
        profile = [profile[i] for i in (0, 2, 3, 4, 5, 7)]
    if tack.level == 3:
        profile = [profile[i] for i in (0, 2, 5, 7)]
    tack.sweep([(side * (x + u * span), y + v * span, z + w * span) for u, v, w in profile],
               surface, span * 0.092, span * 0.068, closed=True,
               sides=(8, 6, 4, 4)[tack.level])
    if tack.level == 0:
        tack.sweep([(side * (x + span * 0.96), y + profile[3][1] * span, z + w * span)
                    for w in (-0.46, 0.47)], surface, span * 0.11, span * 0.14,
                   guide=X, sides=6)


def parasaur(tack):
    tack.pad([
        (-0.493, 0.233, 0.107, 0.051), (-0.464, 0.341, 0.120, 0.046),
        (-0.372, 0.436, 0.161, 0.044), (-0.190, 0.439, 0.187, 0.040),
        (0.040, 0.391, 0.190, 0.037), (0.230, 0.355, 0.174, 0.039),
        (0.389, 0.439, 0.154, 0.039), (0.472, 0.382, 0.121, 0.045),
        (0.505, 0.252, 0.102, 0.050),
    ], "trail_weave", 0.034, rim=0.010, sewn=True, bow=0.009, side_surface="chestnut")
    tack.pad([
        (-0.417, 0.148, 0.258, 0.209), (-0.390, 0.270, 0.292, 0.186),
        (-0.315, 0.326, 0.252, 0.176), (-0.215, 0.304, 0.222, 0.172),
        (-0.037, 0.246, 0.206, 0.162), (0.133, 0.206, 0.213, 0.160),
        (0.265, 0.228, 0.235, 0.179), (0.353, 0.284, 0.259, 0.178),
        (0.398, 0.147, 0.232, 0.184),
    ], "trail", 0.036, rim=0.008, sewn=True, lip=0.009, side_surface="chestnut")
    if tack.level < 3:
        for z, crown in ((-0.372, 0.277), (0.340, 0.251)):
            tack.sweep([(-0.288, 0.180, z + 0.024), (-0.195, crown - 0.015, z),
                        (0, crown, z - 0.021), (0.194, crown - 0.015, z),
                        (0.283, 0.178, z + 0.025)], "chestnut", 0.022, 0.026,
                       guide=Z, sides=(10, 8, 6)[tack.level])
    for side in (-1, 1):
        tack.sweep(reflected(side, [(0.144, 0.234, 0.289), (0.152, 0.303, 0.305),
                                    (0.154, 0.365, 0.342), (0.179, 0.359, 0.403),
                                    (0.211, 0.299, 0.407), (0.199, 0.174, 0.372)]),
                   "trail", 0.019, sides=(10, 8, 6, 4)[tack.level], guide=X)
        for z in (-0.282, 0.246):
            if tack.level == 3 and z > 0:
                continue
            slide = 0.039 * side
            path = [(0.221, 0.191, z), (0.356, 0.106, z + slide),
                    (0.449, 0.034, z + 0.019 + slide), (0.490, 0.017, z + 0.065 + slide),
                    (0.479, 0.009, z + 0.146 + slide), (0.411, 0.010, z + 0.174 + slide)]
            strap(tack, reflected(side, path[:4] if tack.level >= 2 else path), "chestnut", 0.070)
            buckle(tack, side * 0.471, 0.028, z + 0.090 + slide, 0.081, 0.062, "iron")
        stir_z = 0.021 + side * 0.048
        strap(tack, reflected(side, [(0.202, 0.214, 0.120), (0.295, 0.159, 0.101),
                                     (0.405, 0.071, stir_z + 0.038), (0.484, 0.053, stir_z)]),
              "chestnut", 0.049)
        stirrup(tack, side, (0.481, 0.053, stir_z), 0.068, "iron")


def pteranodon(tack):
    tack.pad([
        (-0.303, 0.100, 0.116, 0.085), (-0.280, 0.175, 0.131, 0.084),
        (-0.213, 0.197, 0.122, 0.075), (-0.128, 0.181, 0.093, 0.047),
        (-0.025, 0.161, 0.077, 0.032), (0.091, 0.124, 0.063, 0.031),
        (0.178, 0.068, 0.052, 0.030), (0.206, 0.030, 0.039, 0.027),
    ], "russet", 0.022, rim=0.0075, sewn=True, lip=0.009, side_surface="trail")
    bow = [(-0.161, 0.085, -0.251), (-0.149, 0.151, -0.285), (-0.104, 0.209, -0.309),
           (0.0, 0.235, -0.319), (0.103, 0.209, -0.310), (0.149, 0.152, -0.287),
           (0.163, 0.085, -0.252)]
    plate = [(-0.139, 0.123, -0.280), (-0.086, 0.164, -0.295), (0.0, 0.176, -0.303),
             (0.088, 0.164, -0.296), (0.139, 0.123, -0.280)]
    if tack.level < 3:
        tack.sweep(bow, "wood", 0.016, 0.020, guide=Z)
    tack.sweep(plate, "chitin", 0.013, 0.056, guide=Z, sides=(12, 10, 8, 6)[tack.level])
    if tack.level == 0:
        for x in (-0.103, 0.0, 0.104):
            y = 0.211 if x else 0.233
            z = -0.310 if x else -0.319
            tack.sweep([(x - 0.014, y, z), (x, y + 0.016, z + 0.012), (x + 0.012, y - 0.002, z + 0.019)],
                       "cord", 0.004, sides=6)
    for side in (-1, 1):
        y_shift = 0.011 if side == -1 else 0
        grip = [(0.113, 0.052, 0.041), (0.124, 0.116, 0.060), (0.136, 0.185, 0.082),
                (0.150, 0.195, 0.117), (0.159, 0.174, 0.156), (0.162, 0.101, 0.185),
                (0.166, 0.022, 0.211)]
        if tack.level == 3:
            grip = [grip[i] for i in (0, 2, 4, 6)]
        tack.sweep(reflected(side, grip), "cord", 0.015, guide=X, sides=(10, 8, 6, 4)[tack.level])
        strap(tack, reflected(side, [(0.099, 0.062, 0.120), (0.173, 0.034, 0.173),
                                     (0.174, 0.019, 0.221), (0.088, 0.014, 0.290),
                                     (0.011, 0.017, 0.275)]), "russet", 0.046, guide=X)
        rope_end = (0.262 + 0.014 * side, 0.022, 0.031 + y_shift)
        tack.sweep(reflected(side, [(0.124, 0.080, 0.090), (0.164, 0.033, 0.074),
                                    (0.211, 0.015, 0.050), rope_end]), "cord", 0.0062,
                   sides=(8, 6, 4, 4)[tack.level])
        if tack.level < 2:
            tack.sweep(reflected(side, [(0.138, 0.066, 0.062), (0.175, 0.021, 0.048),
                                        (0.214, 0.014, 0.019), (rope_end[0], 0.020, -0.027 + y_shift)]),
                       "cord", 0.0058, sides=6)
        tack.sweep(reflected(side, [(rope_end[0], 0.019, -0.045 + y_shift),
                                    (rope_end[0] + 0.016, 0.021, 0.064 + y_shift)]),
                   "wood", 0.015, sides=(12, 8, 6, 4)[tack.level])
        if tack.level < 3:
            strap(tack, reflected(side, [(0.122, 0.050, 0.102), (0.097, 0.033, 0.179),
                                         (0.000, 0.023, 0.254), (-0.062, 0.013, 0.281)]),
                  "russet", 0.022, guide=X)
    tack.sweep([(0, 0.018, 0.255), (0, 0.028, 0.255)], "chitin", 0.022, guide=X,
               sides=(12, 8, 6, 4)[tack.level])
    if tack.level < 3:
        tack.sweep([(0.147, 0.149, 0.168), (0.181, 0.064, 0.228), (0.160, 0.012, 0.337),
                    (0.081, 0.010, 0.413), (-0.019, 0.011, 0.405), (-0.053, 0.012, 0.344),
                    (-0.007, 0.017, 0.316), (0.050, 0.016, 0.346), (0.026, 0.015, 0.390),
                    (-0.078, 0.012, 0.405), (-0.161, 0.014, 0.337), (-0.161, 0.062, 0.245),
                    (-0.155, 0.145, 0.172)], "cord", 0.0057, sides=(8, 6, 4)[tack.level])


def raptor(tack):
    tack.pad([
        (-0.381, 0.058, 0.079, 0.053), (-0.349, 0.143, 0.123, 0.039),
        (-0.267, 0.192, 0.136, 0.032), (-0.098, 0.163, 0.127, 0.031),
        (0.083, 0.135, 0.095, 0.030), (0.253, 0.112, 0.075, 0.033),
        (0.337, 0.078, 0.066, 0.038), (0.371, 0.032, 0.057, 0.042),
    ], "oxblood", 0.027, rim=0.007, side_surface="dark_wood")
    tack.pad([
        (-0.333, 0.056, 0.239, 0.199), (-0.302, 0.117, 0.230, 0.187),
        (-0.237, 0.149, 0.172, 0.150), (-0.141, 0.133, 0.139, 0.127),
        (-0.025, 0.110, 0.127, 0.118), (0.099, 0.086, 0.130, 0.121),
        (0.221, 0.064, 0.157, 0.140), (0.278, 0.043, 0.154, 0.143),
    ], "oxblood", 0.023, rim=0.005, sewn=True, lip=0.006)
    for side in (-1, 1):
        rail = [(0.096, 0.081, -0.374), (0.161, 0.084, -0.288), (0.180, 0.081, -0.170),
                (0.150, 0.071, 0.032), (0.100, 0.062, 0.223), (0.068, 0.033, 0.327)]
        tack.sweep(reflected(side, rail), "dark_wood", 0.028, 0.024, guide=X,
                   sides=(10, 8, 6, 4)[tack.level])
        bend = side * 0.023
        feather = [(0.100, 0.151, -0.142), (0.177, 0.102, -0.164),
                   (0.231, 0.043, -0.150 + bend), (0.250, 0.036, -0.111 + bend),
                   (0.248, 0.038, -0.066 + bend)]
        strap(tack, reflected(side, feather), "oxblood", 0.051)
        buckle(tack, side * 0.237, 0.049, -0.130 + bend, 0.060, 0.051, "iron")
        stirrup(tack, side, (0.246, 0.040, -0.070 + bend), 0.060, "iron", flat=True)
        if tack.level < 3:
            strap(tack, reflected(side, [(0.105, 0.107, 0.195), (0.159, 0.067, 0.235),
                                         (0.188, 0.028, 0.287), (0.176, 0.016, 0.346 + bend),
                                         (0.114, 0.010, 0.391), (0.042, 0.008, 0.370)]),
                  "oxblood", 0.043)
    tack.sweep([(-0.117, 0.136, 0.175), (-0.080, 0.156, 0.204), (-0.039, 0.187, 0.234),
                (0.0, 0.191, 0.245), (0.043, 0.184, 0.228), (0.083, 0.158, 0.201),
                (0.120, 0.126, 0.175)], "dark_wood", 0.020, 0.025, guide=Z,
               sides=(10, 8, 6, 4)[tack.level])


def trike(tack):
    tack.pad([
        (-0.634, 0.442, 0.164, 0.050), (-0.592, 0.684, 0.185, 0.046),
        (-0.442, 0.723, 0.198, 0.052), (-0.230, 0.722, 0.229, 0.046),
        (0.027, 0.732, 0.230, 0.038), (0.294, 0.735, 0.206, 0.044),
        (0.493, 0.676, 0.164, 0.042), (0.561, 0.472, 0.133, 0.050),
    ], "rawhide", 0.030, rim=0.009, sewn=True, bow=0.013, nudge=0.024, side_surface="chestnut")
    for side in (-1, 1):
        rail = [(0.638, 0.061, -0.613), (0.545, 0.111, -0.530), (0.401, 0.221, -0.439),
                (0.192, 0.303, -0.310), (0.180, 0.307, -0.099), (0.216, 0.290, 0.137),
                (0.421, 0.205, 0.308), (0.624, 0.093, 0.536), (0.673, 0.050, 0.582)]
        if tack.level > 1:
            rail = [rail[i] for i in (0, 2, 3, 5, 7, 8)]
        tack.sweep(reflected(side, rail), "wood", 0.056, 0.045, guide=X,
                   sides=(12, 10, 8, 6)[tack.level])
        if tack.level < 2:
            for x, y, z in (rail[0], rail[-1]):
                tack.deck(side * x, y - 0.023, z, 0.125, 0.115, 0.049, "wood")
        grip = [(0.188, 0.286, 0.120), (0.199, 0.380, 0.184), (0.209, 0.475, 0.226),
                (0.239, 0.515, 0.256), (0.265, 0.505, 0.263)]
        tack.sweep(reflected(side, grip), "cord", 0.026, guide=X,
                   sides=(12, 8, 6, 4)[tack.level])
        tread_z = -0.073 + side * 0.088
        strap(tack, reflected(side, [(0.225, 0.297, -0.232), (0.349, 0.230, -0.149),
                                     (0.535, 0.120, -0.119), (0.756, 0.071, tread_z)]),
              "chestnut", 0.063)
        tack.deck(side * 0.783, 0.050, tread_z, 0.171, 0.234, 0.051, "wood")
        if tack.level < 2:
            buckle(tack, side * 0.622, 0.110, tread_z - 0.089, 0.071, 0.056, "brass")
        for z in (-0.414, 0.330):
            if tack.level == 3 and z < 0:
                continue
            strap(tack, reflected(side, [(0.218, 0.263, z), (0.475, 0.165, z + 0.036),
                                         (0.676, 0.071, z + side * 0.055),
                                         (0.752, 0.033, z + side * 0.083)]),
                  "chestnut", 0.079)
        if tack.level < 3:
            strap(tack, reflected(side, [(0.455, 0.193, 0.356), (0.480, 0.085, 0.487),
                                         (0.333, 0.018, 0.625), (0.061, 0.019, 0.692)]),
                  "chestnut", 0.051, guide=X)
    tack.pad([
        (-0.425, 0.122, 0.354, 0.328), (-0.384, 0.245, 0.389, 0.332),
        (-0.292, 0.273, 0.353, 0.329), (-0.164, 0.257, 0.324, 0.317),
        (-0.010, 0.201, 0.311, 0.321), (0.136, 0.124, 0.307, 0.316),
        (0.235, 0.079, 0.293, 0.295),
    ], "chestnut", 0.043, rim=0.012, sewn=True)
    if tack.level < 3:
        tack.sweep([(-0.245, 0.337, -0.362), (-0.206, 0.417, -0.400),
                    (0, 0.463, -0.425), (0.207, 0.417, -0.401), (0.242, 0.338, -0.361)],
                   "chestnut", 0.037, 0.037, guide=Z, sides=(12, 8, 6)[tack.level])


def carbonemys(tack):
    tack.pad([
        (-0.488, 0.135, 0.114, 0.074), (-0.456, 0.273, 0.147, 0.064),
        (-0.366, 0.386, 0.187, 0.045), (-0.203, 0.462, 0.224, 0.044),
        (0.016, 0.488, 0.226, 0.040), (0.218, 0.434, 0.205, 0.039),
        (0.378, 0.339, 0.166, 0.053), (0.450, 0.215, 0.115, 0.067),
        (0.476, 0.087, 0.101, 0.081),
    ], "olive", 0.038, rim=0.012, sewn=True, bow=0.009)
    tack.pad([
        (-0.350, 0.112, 0.283, 0.238), (-0.324, 0.209, 0.306, 0.250),
        (-0.235, 0.223, 0.272, 0.242), (-0.105, 0.194, 0.246, 0.241),
        (0.036, 0.160, 0.241, 0.238), (0.160, 0.143, 0.252, 0.234),
        (0.264, 0.123, 0.258, 0.231), (0.314, 0.056, 0.237, 0.221),
    ], "chestnut", 0.042, rim=0.011, sewn=True, lip=0.006)
    arch = [(-0.222, 0.177, -0.266), (-0.234, 0.303, -0.340), (-0.159, 0.392, -0.369),
            (0, 0.408, -0.382), (0.157, 0.394, -0.371), (0.231, 0.304, -0.343),
            (0.226, 0.176, -0.265)]
    if tack.level == 3:
        arch = [arch[i] for i in (0, 2, 3, 4, 6)]
    tack.sweep(arch, "dark_wood", 0.028, 0.026, guide=Z)
    for side in (-1, 1):
        if tack.level < 3:
            grip = [(0.101, 0.241, 0.123), (0.114, 0.325, 0.174),
                    (0.151, 0.364, 0.221), (0.192, 0.339, 0.273), (0.202, 0.147, 0.304)]
            tack.sweep(reflected(side, grip), "dark_wood", 0.019, guide=X,
                       sides=(10, 8, 6)[tack.level])
        for z in (-0.243, 0.180):
            strap(tack, reflected(side, [(0.175, 0.254, z), (0.282, 0.172, z + side * 0.009),
                                         (0.385, 0.103, z + side * 0.016),
                                         (0.488, 0.037, z + side * 0.032),
                                         (0.516, 0.017, z + side * 0.047)]),
                  "chestnut", 0.066)
            buckle(tack, side * 0.489, 0.043, z + side * 0.032, 0.076, 0.067, "brass")
        foot = 0.543 + 0.026 * side
        peg_z = 0.363 + 0.065 * side
        offsets = (-0.056, 0.056) if tack.level < 2 else (0.0,)
        for dz in offsets:
            strap(tack, reflected(side, [(0.144, 0.233, 0.208 + dz),
                                         (0.300, 0.140, 0.264 + dz),
                                         (0.430, 0.054, 0.303 + dz), (foot, 0.026, peg_z + dz)]),
                  "chestnut", 0.033 if tack.level < 2 else 0.048)
        tack.sweep(reflected(side, [(foot, 0.020, peg_z - 0.072), (foot, 0.020, peg_z + 0.073)]),
                   "brass", 0.018, 0.023, sides=(12, 10, 6, 4)[tack.level])


ALIASES = {
    "parasaur": {"chestnut": "trail"},
    "pteranodon": {"trail": "russet", "cord": "chitin"},
    "raptor": {},
    "trike": {"cord": "wood", "brass": "wood"},
    "carbonemys": {"dark_wood": "chestnut"},
}

for build in (parasaur, pteranodon, raptor, trike, carbonemys):
    species = build.__name__
    for level in range(4):
        saddle = Tack(level, ALIASES[species])
        build(saddle)
        saddle.finish(f"saddle_{species}")
