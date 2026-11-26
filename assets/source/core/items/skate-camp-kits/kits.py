"""Build the packed vehicle assemblies as grounded props."""

from math import cos, sin

from hand_geometry import Prop, X, Y, rounded_outline


def _footprint(width, length, cut):
    if cut:
        return rounded_outline(width, length, cut)
    x, z = width / 2, length / 2
    return [(-x, z), (x, z), (x, -z), (-x, -z)]


def _box(prop, center, width, height, length, surface, *, cut=0, bevel=0, corner_level=1, bevel_level=0):
    x, y, z = center
    profile = [(0, 0), (height, 0)]
    if bevel and prop.level <= bevel_level:
        profile = [(0, bevel), (bevel, 0), (height - bevel, 0), (height, bevel)]
    elif bevel and prop.level == 1:
        profile = [(0, 0), (height - bevel, 0), (height, bevel)]
    cut = cut if prop.level <= corner_level else 0
    rings = []
    for rise, inset in profile:
        outline = _footprint(width - 2 * inset, length - 2 * inset, cut)
        rings.append([(x + a, y + rise, z + b) for a, b in outline])
    prop.shell(rings, surface, planar_sides=True)


def _deck(prop):
    # Each row carries the edge and kick through the whole deck thickness.
    rows = (
        (-0.407, 0.021, 0.070, 1), (-0.394, 0.048, 0.059, 0),
        (-0.371, 0.074, 0.046, 3), (-0.335, 0.091, 0.027, 2),
        (-0.290, 0.101, 0.008, 1), (-0.240, 0.108, 0.000, 3),
        (-0.110, 0.110, 0.000, 0), (0.075, 0.110, 0.000, 0),
        (0.230, 0.107, 0.000, 3), (0.278, 0.105, 0.009, 1),
        (0.329, 0.095, 0.031, 2), (0.368, 0.078, 0.051, 3),
        (0.395, 0.051, 0.064, 0), (0.411, 0.025, 0.075, 1),
    )
    rings = []
    for z, w, y, last in rows:
        if prop.level > last:
            continue
        section = [(-w, 0), (w, 0), (w, 0.034), (-w, 0.034)]
        if prop.level == 0:
            section = [(-w + 0.013, 0), (w - 0.013, 0), (w, 0.010), (w, 0.026),
                       (w - 0.015, 0.034), (-w + 0.015, 0.034), (-w, 0.026), (-w, 0.010)]
        rings.append([(x, y + dy, z) for x, dy in section])
    prop.shell(rings, "wood", planar_sides=True)


def _truck_wrap(prop, x, z):
    outlines = (
        [(-0.111, -0.027), (0.111, -0.027), (0.133, -0.005), (0.130, 0.027),
         (0.103, 0.052), (0.060, 0.061), (0.033, 0.108), (-0.032, 0.108),
         (-0.056, 0.059), (-0.106, 0.049), (-0.132, 0.023), (-0.133, -0.009)],
        [(-0.130, -0.025), (0.130, -0.025), (0.128, 0.043), (0.047, 0.057),
         (0.032, 0.107), (-0.035, 0.107), (-0.056, 0.057), (-0.128, 0.043)],
        [(-0.130, -0.025), (0.130, -0.025), (0.117, 0.058), (0.034, 0.106),
         (-0.034, 0.106), (-0.117, 0.058)],
    )
    outer = outlines[prop.level]
    inner = [(a * 0.82, 0.036 + (b - 0.036) * 0.70) for a, b in outer]
    rings = [[(a + x, b, z + end) for a, b in outline]
             for end, outline in ((-0.028, inner), (-0.028, outer), (0.028, outer), (0.028, inner))]
    prop.shell(rings, "rubber", closed=True, planar_sides=True)


def zzzzzskateboard_assembly(prop: Prop):
    _deck(prop)
    wheel = (
        [(-0.022, 0.031), (-0.017, 0.039), (-0.001, 0.042), (0.016, 0.041), (0.023, 0.033)],
        [(-0.022, 0.034), (0.008, 0.042), (0.023, 0.035)],
        [(-0.022, 0.039), (0.023, 0.040)],
        [(-0.022, 0.038), (0.023, 0.038)],
    )[prop.level]
    for x, z in ((-0.010, -0.139), (0.013, 0.100)):
        if prop.level < 2:
            _box(prop, (x, 0.029, z), 0.107, 0.049, 0.082, "steel", cut=0.016, bevel=0.010)
        if prop.level < 3:
            axle = [(-0.122, 0.022), (-0.055, 0.028), (0.056, 0.030), (0.122, 0.022)]
            prop.tube((x, 0.071, z), X, axle, (12, 8, 5)[prop.level], "steel")
            _truck_wrap(prop, x, z)
        else:
            _box(prop, (x, 0.027, z), 0.226, 0.066, 0.059, "steel")
        for side in (-1, 1):
            prop.tube((x + side * 0.114, 0.071, z), X * side, wheel,
                      (16, 10, 7, 4)[prop.level], "rubber", cap_surface="steel")


def _bow_panel(prop, offset=0):
    rows = (
        (-0.219, 0.335, 0.166, 0.151, 3), (-0.172, 0.342, 0.165, 0.155, 0),
        (-0.088, 0.348, 0.167, 0.157, 1), (0.038, 0.349, 0.169, 0.160, 2),
        (0.187, 0.330, 0.182, 0.164, 0), (0.320, 0.282, 0.199, 0.161, 3),
        (0.428, 0.215, 0.218, 0.149, 1), (0.523, 0.137, 0.242, 0.135, 2),
        (0.590, 0.080, 0.259, 0.118, 1), (0.628, 0.030, 0.271, 0.102, 3),
    )
    section = (
        [(-1, 0.77), (-0.60, 0.26), (0, 0), (0.60, 0.26), (1, 0.77),
         (0.97, 1), (0.58, 0.46), (0, 0.22), (-0.58, 0.46), (-0.97, 1)],
        [(-1, 0.77), (-0.60, 0.26), (0, 0), (0.60, 0.26), (1, 0.77),
         (0.97, 1), (0, 0.23), (-0.97, 1)],
        [(-1, 0.78), (0, 0), (1, 0.78), (0.95, 1), (0, 0.24), (-0.95, 1)],
        [(-1, 0.77), (0, 0), (1, 0.77), (0.91, 1), (0, 0.25), (-0.91, 1)],
    )[prop.level]
    rings = []
    for z, w, y, rise, last in rows:
        if prop.level <= last:
            rings.append([(a * (w + offset * 0.65), y + b * rise + offset, z - offset * 0.5)
                          for a, b in section])
    prop.shell(rings, "steel")


def _boat_roll(prop):
    rows = (
        (-0.331, 0.096, "linen", 3), (-0.310, 0.121, "linen", 1),
        (-0.269, 0.128, "steel", 1), (-0.223, 0.130, "linen", 1),
        (-0.157, 0.132, "linen", 2), (0.019, 0.138, "linen", 0),
        (0.171, 0.132, "linen", 2), (0.221, 0.133, "steel", 1),
        (0.267, 0.130, "linen", 1), (0.310, 0.123, "linen", 1),
        (0.331, 0.100, "linen", 3),
    )
    roll = [(x, r, surface) for x, r, surface, last in rows if prop.level <= last]
    prop.tube((0, 0.310, -0.341), X, [(x, r) for x, r, _ in roll],
              (20, 12, 8, 6)[prop.level], "linen", oval=1.13, cap_surface="linen",
              band_surfaces=[surface for _, _, surface in roll[:-1]])


def boat_assembly(prop: Prop):
    floor = 0.053 if prop.level < 3 else 0
    _box(prop, (0, floor, -0.026), 0.823, 0.105 + 0.053 - floor, 1.217, "wood", cut=0.050, bevel=0.022)
    for side in (-1, 1):
        if prop.level < 3:
            _box(prop, (side * 0.257, 0, -0.030), 0.101, 0.061, 1.113, "wood", cut=0.024)
        _box(prop, (side * 0.373, 0.134, -0.024), 0.084, 0.136, 1.147, "wood", cut=0.023, bevel=0.015)
    if prop.level < 3:
        _box(prop, (0, 0.133, -0.565), 0.693, 0.144, 0.110, "wood", cut=0.025, bevel=0.016)
        if prop.level == 0:
            _box(prop, (0, 0.138, 0.511), 0.686, 0.059, 0.108, "wood", cut=0.022)
            _bow_panel(prop, offset=-0.041)
    _bow_panel(prop)
    _boat_roll(prop)


def _packed_rotor(prop):
    outlines = (
        [(-0.042, 0.071), (0.058, 0.086), (0.075, 0.206), (0.072, 0.568),
         (0.037, 0.633), (-0.044, 0.637), (-0.063, 0.593), (-0.064, 0.223)],
        [(-0.042, 0.072), (0.063, 0.088), (0.072, 0.561), (0.037, 0.629),
         (-0.048, 0.635), (-0.064, 0.578)],
        [(-0.050, 0.076), (0.063, 0.076), (0.067, 0.571), (0.027, 0.633), (-0.063, 0.629)],
        [(-0.050, 0.065), (0.065, 0.065), (0.058, 0.568), (-0.051, 0.630)],
    )
    c, s = cos(0.435), sin(0.435)
    for blade in (-1, 1):
        outline = [(blade * (x * c + z * s), blade * (z * c - x * s))
                   for x, z in reversed(outlines[prop.level])]
        stations = [(0.314, 0.96), (0.345, 1)]
        if prop.level == 0:
            stations = [(0.312, 0.96), (0.323, 1), (0.348, 0.98)]
        prop.panel((0, 0, 0.013), outline, stations, "steel")
    hub = (
        [(0.267, 0.094), (0.296, 0.113), (0.332, 0.113), (0.358, 0.094), (0.383, 0.066)],
        [(0.270, 0.089), (0.301, 0.109), (0.352, 0.103), (0.377, 0.067)],
        [(0.276, 0.101), (0.346, 0.103), (0.374, 0.071)],
        [(0.269, 0.102), (0.366, 0.087)],
    )[prop.level]
    prop.tube((0, 0, 0.013), Y, hub, (18, 12, 8, 6)[prop.level], "bronze", cap_surface="steel")


def helicopter_assembly(prop: Prop):
    _box(prop, (0, 0, 0), 0.441, 0.218, 1.527, "iron", cut=0.056, bevel=0.029, corner_level=2, bevel_level=1)
    _box(prop, (0, 0.183, 0), 0.483, 0.099, 1.556, "iron", cut=0.058, bevel=0.027, corner_level=2, bevel_level=1)
    for z in (-0.575, 0.575):
        _box(prop, (0, 0.011, z), 0.496, 0.281, 0.131, "bronze", cut=0.026,
             bevel=0.020 if prop.level == 0 else 0)
        if prop.level < 3:
            _box(prop, (0, 0.002, z), 0.470, 0.076, 0.173, "iron", cut=0.024,
                 bevel=0.016 if prop.level == 0 else 0)
    if prop.level < 2:
        for x in (-0.218, 0.218):
            _box(prop, (x, 0.094, 0), 0.097, 0.083, 0.291, "steel", cut=0.027, bevel=0.017, corner_level=0)
    _packed_rotor(prop)
