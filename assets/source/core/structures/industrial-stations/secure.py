"""Exterior shapes for three placed stations, centred in their placement boxes."""

from hand_geometry import Y, Z, circle, rounded_outline


def _outline(prop, width, depth, cut):
    if cut and (prop.level < 3 or cut >= 0.04):
        return rounded_outline(width, depth, min(cut, min(width, depth) * 0.45))
    x, z = width / 2, depth / 2
    return [(-x, z), (x, z), (x, -z), (-x, -z)]


def _sections(prop, start, end, bevel):
    if not bevel or prop.level >= 2:
        return [(start, 0), (end, 0)]
    rows = [(start, bevel), (start + bevel, 0), (end - bevel, 0), (end, bevel)]
    if prop.level == 0:
        rows[1:1] = [(start + bevel * 0.3, bevel * 0.3)]
        rows[-1:-1] = [(end - bevel * 0.3, bevel * 0.3)]
    return rows


def _case(prop, lo, hi, surface, *, cut=0, bevel=0):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    x, z = (x0 + x1) / 2, (z0 + z1) / 2
    rings = [[(x + a, y, z + b)
              for a, b in _outline(prop, x1 - x0 - 2 * inset, z1 - z0 - 2 * inset, cut)]
             for y, inset in _sections(prop, y0, y1, bevel)]
    prop.shell(rings, surface, planar_sides=True)


def _front(prop, lo, hi, surface, *, cut=0, bevel=0):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    x, y = (x0 + x1) / 2, (y0 + y1) / 2
    rings = [[(x + a, y + b, -depth)
              for a, b in _outline(prop, x1 - x0 - 2 * inset, y1 - y0 - 2 * inset, cut)]
             for depth, inset in _sections(prop, -z1, -z0, bevel)]
    prop.shell(rings, surface, planar_sides=True)


def _turned(prop, center, axis, rows, sides, surface, **options):
    stations = [(distance, radius) for distance, radius, last in rows if prop.level <= last]
    prop.tube(center, axis, stations, sides[prop.level], surface, **options)


def vault(prop):
    level = prop.level
    case_half = 0.725 if level == 0 else 0.75
    _case(prop, (-0.72, -1.25, -0.52), (0.72, -1.08, 0.58), "iron",
          cut=0.08, bevel=0.026)
    _case(prop, (-case_half, -1.12, -0.43), (case_half, 1.25, 0.625), "steel",
          cut=0.07, bevel=0.036)
    _front(prop, (-0.67, -1.03, -0.473), (0.67, 1.15, -0.414), "iron",
           cut=0.064, bevel=0.020)
    _front(prop, (-0.58, -0.94, -0.535), (0.57, 1.06, -0.463), "steel",
           cut=0.055, bevel=0.026)

    # The dark hinges straddle the door frame.
    for y in (-0.70, 0.81):
        _turned(prop, (0.57, y, -0.505), Y, (
            (-0.168, 0.054, 3), (-0.145, 0.075, 2), (-0.097, 0.075, 1),
            (-0.070, 0.060, 0), (0.070, 0.060, 0), (0.097, 0.075, 1),
            (0.145, 0.075, 2), (0.168, 0.054, 3),
        ), (16, 12, 8, 6), "iron")
        if level <= 1:
            _front(prop, (0.43, y - 0.093, -0.54), (0.67, y + 0.093, -0.427),
                   "iron", cut=0.04, bevel=0.025)
        if level == 0:
            for dy in (-0.12, 0.12):
                prop.tube((0.57, y + dy, -0.505), Y, [(-0.02, 0.079), (0.02, 0.079)],
                          16, "steel")

    # The handwheel keeps its opening and crossed spokes at every distance.
    wheel = (-0.135, -0.04, 0)
    _turned(prop, wheel, -Z, (
        (0.567, 0.257, 3), (0.578, 0.274, 0), (0.590, 0.282, 2),
        (0.612, 0.282, 3), (0.621, 0.273, 1), (0.625, 0.259, 3),
        (0.625, 0.241, 0), (0.616, 0.229, 3), (0.595, 0.226, 1),
        (0.578, 0.231, 3), (0.568, 0.242, 0),
    ), (28, 20, 12, 8), "brass", closed=True)
    _front(prop, (-0.380, -0.064, -0.601), (0.110, -0.016, -0.563), "brass")
    _front(prop, (-0.159, -0.285, -0.607), (-0.111, 0.205, -0.569), "brass")
    _turned(prop, wheel, -Z, (
        (0.524, 0.096, 3), (0.541, 0.108, 1), (0.562, 0.108, 2),
        (0.576, 0.066, 3), (0.613, 0.066, 2), (0.622, 0.050, 3),
    ), (20, 12, 8, 6), "iron")

    _turned(prop, (-0.46, 0.47, 0), -Z, (
        (0.529, 0.072, 3), (0.547, 0.079, 1), (0.565, 0.078, 2),
        (0.575, 0.056, 1), (0.596, 0.055, 3),
    ), (20, 12, 8, 6), "brass")

    if level <= 2:
        _front(prop, (-0.49, 0.73, -0.560), (0.32, 0.86, -0.525),
               "iron", cut=0.033, bevel=0.013)
        _front(prop, (-0.49, -0.81, -0.570), (0.35, -0.68, -0.529),
               "iron", cut=0.04, bevel=0.015)
    if level <= 1:
        for x in (-0.62, 0.62):
            for y in (-0.84, 0.94):
                prop.tube((x, y, -0.463), -Z, [(0, 0.035), (0.028, 0.029)],
                          (12, 8)[level], "steel")
    if level == 0:
        for side in (-1, 1):
            x0, x1 = sorted((side * 0.70, side * 0.75))
            for z in (-0.20, 0.30):
                _case(prop, (x0, -0.98, z - 0.057), (x1, 1.05, z + 0.057),
                      "iron", cut=0.009)
        for x in (-0.39, 0.22):
            prop.tube((x, 0.795, -0.552), -Z, [(0, 0.037), (0.028, 0.03)], 12, "brass")


def chemistry_bench(prop):
    level = prop.level
    _case(prop, (-1, -0.020, -0.5), (1, 0.075, 0.5), "steel",
          cut=0.045, bevel=0.025)
    _case(prop, (-0.94, 0.064, 0.285), (0.94, 0.191, 0.465), "cream",
          cut=0.035, bevel=0.024)

    # The offset cabinet leaves a wide knee space between it and the end trestle.
    _case(prop, (-0.94, -0.90, -0.41), (-0.21, -0.76, 0.423), "steel",
          cut=0.036, bevel=0.024)
    _case(prop, (-0.92, -0.795, -0.415), (-0.18, -0.008, 0.44), "cream",
          cut=0.045, bevel=0.025)
    for z in (-0.32, 0.34):
        _case(prop, (0.755, -0.90, z - 0.07), (0.91, -0.010, z + 0.07),
              "steel", cut=0.030, bevel=0.025)
    _case(prop, (0.768, -0.77, -0.31), (0.897, -0.66, 0.36), "steel",
          cut=0.032, bevel=0.025)
    _case(prop, (-0.21, -0.70, 0.29), (0.84, -0.60, 0.40), "steel",
          cut=0.028, bevel=0.024)
    for y0, y1 in ((-0.25, -0.075), (-0.734, -0.29)):
        _front(prop, (-0.87, y0, -0.468), (-0.24, y1, -0.401), "cream",
               cut=0.038, bevel=0.024)
        handle_y = y1 - 0.060
        _front(prop, (-0.71, handle_y - 0.020, -0.498),
               (-0.395, handle_y + 0.020, -0.455), "steel", cut=0.014)

    # The glassware is closed and has no connecting paths.
    _turned(prop, (-0.51, 0, 0.025), Y, (
        (0.074, 0.178, 3), (0.085, 0.204, 1), (0.113, 0.204, 2),
        (0.151, 0.166, 3),
    ), (24, 16, 12, 8), "steel")
    _turned(prop, (-0.51, 0, 0.025), Y, (
        (0.145, 0.119, 3), (0.179, 0.185, 1), (0.212, 0.224, 2),
        (0.271, 0.254, 3), (0.338, 0.263, 0), (0.411, 0.263, 3),
        (0.468, 0.247, 2), (0.513, 0.219, 1), (0.551, 0.177, 3),
        (0.580, 0.131, 1), (0.625, 0.084, 3), (0.664, 0.075, 0),
        (0.840, 0.075, 3), (0.850, 0.095, 2), (0.882, 0.095, 1),
        (0.90, 0.084, 3),
    ), (32, 20, 12, 8), "glass")

    _turned(prop, (0.30, 0, -0.192), Y, (
        (0.075, 0.168, 3), (0.098, 0.194, 2), (0.133, 0.194, 3),
        (0.220, 0.154, 0), (0.313, 0.083, 3), (0.344, 0.064, 1),
        (0.449, 0.064, 3), (0.466, 0.083, 1), (0.493, 0.083, 2),
        (0.510, 0.070, 3),
    ), (28, 16, 10, 6), "glass")

    if level <= 1:
        _case(prop, (0.53, 0.073, 0.018), (0.94, 0.135, 0.257), "steel",
              cut=0.045, bevel=0.020)
        _turned(prop, (0.742, 0, 0.141), Y, (
            (0.130, 0.08, 1), (0.160, 0.106, 1), (0.370, 0.106, 1),
            (0.402, 0.084, 0), (0.413, 0.072, 1), (0.473, 0.071, 1),
            (0.492, 0.085, 0), (0.522, 0.081, 1),
        ), (20, 12), "glass")
        _front(prop, (-0.89, -0.27, -0.450), (-0.22, -0.23, -0.405),
               "steel", cut=0.012)
    if level == 0:
        for x in (-0.80, -0.35, 0.14, 0.68):
            _front(prop, (x - 0.095, 0.105, 0.253), (x + 0.095, 0.165, 0.295),
                   "steel", cut=0.016, bevel=0.009)
        for z in (-0.32, 0.34):
            _case(prop, (0.72, -0.9, z - 0.09), (0.94, -0.828, z + 0.09),
                  "steel", cut=0.035, bevel=0.018)


def soul_vault(prop, lit):
    level = prop.level
    window = "status" if lit else "glass"
    _case(prop, (-0.57, -1.0, -0.40), (0.57, -0.84, 0.42), "iron",
          cut=0.105, bevel=0.042)

    # The cabinet rises from an oval belly into a circular neck.
    body = [
        (-0.865, 0.436, 0.330, 3), (-0.821, 0.504, 0.370, 1),
        (-0.770, 0.555, 0.410, 2), (-0.675, 0.60, 0.440, 3),
        (-0.540, 0.60, 0.440, 0), (0.205, 0.60, 0.440, 3),
        (0.310, 0.575, 0.422, 2), (0.399, 0.539, 0.388, 1),
        (0.478, 0.477, 0.347, 3), (0.528, 0.413, 0.306, 1),
        (0.564, 0.342, 0.277, 2), (0.600, 0.283, 0.269, 3),
    ]
    rings = [circle((0, y, 0.010), Y, width, (32, 20, 12, 8)[level], oval=depth / width)
             for y, width, depth, last in body if level <= last]
    prop.shell(rings, "enamel", smooth=True)

    neck = [
        (0.560, 0.270, "iron", 3), (0.590, 0.305, "iron", 1),
        (0.642, 0.322, "iron", 2), (0.682, 0.316, window, 3),
        (0.753, 0.300, "iron", 3), (0.784, 0.347, "iron", 2),
        (0.823, 0.360, "iron", 3), (0.860, 0.359, "iron", 0),
        (0.898, 0.330, "iron", 3), (0.932, 0.280, "iron", 1),
        (0.976, 0.173, "iron", 2), (1.0, 0.143, "iron", 3),
    ]
    neck = [(y, radius, surface) for y, radius, surface, last in neck if level <= last]
    prop.tube((0, 0, 0.01), Y, [(y, radius) for y, radius, _ in neck],
              (32, 20, 12, 8)[level], "iron", band_surfaces=[row[2] for row in neck[:-1]])

    _front(prop, (-0.26, -0.047, -0.447), (0.26, 0.272, -0.342), "iron",
           cut=0.063, bevel=0.029)
    _front(prop, (-0.172, 0.064, -0.45), (0.172, 0.185, -0.412), window,
           cut=0.035, bevel=0.013)
    if level <= 2:
        _front(prop, (-0.11, -0.046, -0.45), (0.11, 0.023, -0.422), "enamel",
               cut=0.025, bevel=0.013)
    if level <= 1:
        for side in (-1, 1):
            x0, x1 = sorted((side * 0.34, side * 0.51))
            _front(prop, (x0, -0.54, -0.371), (x1, 0.08, -0.184), "iron",
                   cut=0.037, bevel=0.024)
            if level == 0:
                for y in (-0.455, -0.31, -0.165):
                    _front(prop, (x0 + 0.025, y, -0.394), (x1 - 0.025, y + 0.05, -0.364),
                           "enamel", cut=0.015, bevel=0.010)
        for x in (-0.19, 0.19):
            prop.tube((x, 0.820, 0.011), Y, [(0, 0.048), (0.128, 0.042)],
                      (14, 8)[level], "iron")
