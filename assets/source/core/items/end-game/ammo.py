"""Ground models for the plasma charge, plasma cell and shock dart."""

from math import cos, sin, tau

from hand_geometry import Prop, X, Y, Z


# The cap's offset crown and broad key are part of its silhouette at every level.
CHARGE = (
    (-0.040, 0.045, 0.000, 0.000, "iron"),
    (-0.037, 0.053, 0.000, 0.000, "iron"),
    (-0.029, 0.059, 0.002, 0.000, "iron"),
    (-0.019, 0.059, 0.003, 0.002, "iron"),
    (-0.011, 0.053, 0.004, 0.004, "ceramic"),
    (0.000, 0.051, 0.007, 0.006, "ceramic"),
    (0.012, 0.053, 0.010, 0.010, "ceramic"),
    (0.020, 0.062, 0.014, 0.021, "iron"),
    (0.032, 0.061, 0.017, 0.024, "iron"),
    (0.041, 0.053, 0.015, 0.021, "iron"),
    (0.044, 0.040, 0.012, 0.009, "iron"),
    (0.038, 0.033, 0.013, 0.000, "optic"),
    (0.036, 0.025, 0.014, 0.000, "optic"),
)
CHARGE_SECTIONS = (
    range(13), (0, 2, 3, 4, 6, 7, 8, 10, 11, 12),
    (0, 2, 4, 7, 8, 10, 11, 12), (0, 3, 4, 8, 10, 12),
)


def plasma_charge(prop: Prop):
    sides = (24, 16, 10, 6)[prop.level]
    sections = [CHARGE[index] for index in CHARGE_SECTIONS[prop.level]]
    rings = []
    for y, radius, offset, key, _ in sections:
        points = []
        for index in range(sides):
            angle = index * tau / sides
            reach = radius + key * max(0, cos(angle - 1.05)) ** 8
            points.append((offset + reach * sin(angle), y, 0.88 * reach * cos(angle)))
        rings.append(points)
    prop.shell(rings, "iron", smooth=True, cap_surface="optic",
               band_surfaces=[surface for *_, surface in sections[:-1]])


BEVELED = (
    ((-0.76, -1), (0.76, -1), (0.92, -0.91), (1, -0.65), (1, 0.62), (0.91, 0.90),
     (0.75, 1), (-0.75, 1), (-0.91, 0.90), (-1, 0.62), (-1, -0.65), (-0.92, -0.91)),
    ((-0.79, -1), (0.79, -1), (1, -0.67), (1, 0.62), (0.76, 1), (-0.76, 1),
     (-1, 0.62), (-1, -0.67)),
    ((-0.84, -1), (0.84, -1), (1, 0.59), (0.75, 1), (-0.75, 1), (-1, 0.59)),
    ((-1, -1), (1, -1), (1, 1), (-1, 1)),
)

CELL = (
    (-0.139, 0.049, 0.028, -0.002, "iron"),
    (-0.135, 0.059, 0.036, -0.002, "iron"),
    (-0.127, 0.065, 0.040, -0.002, "iron"),
    (-0.115, 0.066, 0.040, -0.002, "iron"),
    (-0.105, 0.063, 0.038, -0.002, "iron"),
    (-0.097, 0.058, 0.035, -0.001, "ceramic"),
    (-0.085, 0.057, 0.034, 0.000, "ceramic"),
    (-0.069, 0.061, 0.036, 0.000, "ceramic"),
    (-0.040, 0.062, 0.036, 0.001, "ceramic"),
    (0.044, 0.062, 0.036, 0.001, "ceramic"),
    (0.075, 0.059, 0.035, 0.001, "ceramic"),
    (0.086, 0.058, 0.034, 0.002, "ceramic"),
    (0.097, 0.062, 0.037, 0.002, "iron"),
    (0.105, 0.065, 0.040, 0.002, "iron"),
    (0.119, 0.065, 0.039, 0.003, "iron"),
    (0.130, 0.060, 0.035, 0.005, "iron"),
    (0.138, 0.052, 0.027, 0.007, "iron"),
)
CELL_SECTIONS = (
    range(17), (0, 2, 3, 5, 6, 7, 9, 11, 12, 13, 14, 16),
    (0, 2, 5, 7, 9, 12, 14, 16), (0, 5, 12, 14, 16),
)
RAIL_PROFILE = (
    ((-0.011, 0.91), (-0.005, 1), (0.006, 1), (0.010, 0.91), (0.014, 0.82), (0.016, 0.74)),
    ((-0.011, 0.91), (-0.005, 1), (0.008, 0.97), (0.016, 0.74)),
    ((-0.011, 0.91), (0.001, 1), (0.015, 0.76)),
)
WINDOW_PROFILE = (
    ((-0.009, 0.81), (-0.005, 1), (0.002, 1), (0.006, 0.91), (0.008, 0.76)),
    ((-0.009, 0.88), (-0.002, 1), (0.008, 0.78)),
    ((-0.009, 0.95), (0.006, 0.87)),
    ((-0.009, 0.95), (0.007, 0.83)),
)


def _slab(prop, center, width, length, outline, profile, surface):
    prop.panel(center, [(a * width / 2, -b * length / 2) for a, b in outline], profile, surface)


def plasma_cell(prop: Prop):
    level = prop.level
    sections = [CELL[index] for index in CELL_SECTIONS[level]]
    outline = BEVELED[level]
    rings = [[(x * width, height + y * depth, z) for x, y in outline]
             for z, width, depth, height, _ in sections]
    prop.shell(rings, "iron", planar_sides=True,
               band_surfaces=[surface for *_, surface in sections[:-1]])

    if level < 3:
        for x, z in ((-0.047, -0.006), (0.047, 0.004)):
            _slab(prop, (x, 0.036, z), 0.040, 0.207, outline, RAIL_PROFILE[level], "iron")
        windows = ((-0.041, 0.095), (0.052, 0.050))
    else:
        windows = ((-0.008, 0.117),)
    for z, length in windows:
        window_outline = BEVELED[min(level + 1, 3)]
        _slab(prop, (0, 0.040, z), 0.047, length, window_outline, WINDOW_PROFILE[level], "optic")


SHOCK = (
    (-0.095, 0.006, "steel"),
    (-0.087, 0.011, "steel"),
    (-0.066, 0.011, "steel"),
    (-0.048, 0.008, "iron"),
    (-0.035, 0.009, "iron"),
    (-0.025, 0.014, "iron"),
    (-0.014, 0.022, "optic"),
    (-0.005, 0.023, "optic"),
    (0.027, 0.023, "optic"),
    (0.036, 0.021, "steel"),
    (0.048, 0.014, "steel"),
    (0.056, 0.010, "steel"),
    (0.062, 0.004, "steel"),
    (0.085, 0.001, "steel"),
)
SHOCK_SECTIONS = (
    range(14), (0, 1, 3, 5, 6, 8, 9, 10, 12, 13),
    (0, 1, 3, 5, 7, 8, 10, 13), (0, 4, 7, 9, 13),
)
SLEEVE_GUARD = (
    (-0.034, 0.010, 0.006, 0.004), (-0.024, 0.016, 0.009, 0.005),
    (-0.011, 0.022, 0.010, 0.007), (0.021, 0.024, 0.010, 0.007),
    (0.039, 0.020, 0.009, 0.005), (0.048, 0.011, 0.005, 0.004),
)
GUARD_SECTIONS = (range(6), (0, 2, 3, 5), (0, 3, 5))
TAIL_FIN = (
    (-0.094, 0.019, 0.008, 0.004), (-0.085, 0.024, 0.010, 0.005),
    (-0.076, 0.022, 0.011, 0.008), (-0.054, 0.014, 0.008, 0.006),
    (-0.035, 0.006, 0.005, 0.003),
)
FIN_SECTIONS = (range(5), (0, 1, 3, 4), (0, 2, 4), (0, 4))


def _dart_vane(prop, angle, sections, outline):
    out = X * cos(angle) + Y * sin(angle)
    side = out.cross(Z)
    rings = []
    for z, reach, width, depth in sections:
        center = Z * z + out * reach
        rings.append([center + side * (a * width) + out * (b * depth) for a, b in outline])
    prop.shell(rings, "iron", planar_sides=True)


def dart_shock(prop: Prop):
    level = prop.level
    body = [SHOCK[index] for index in SHOCK_SECTIONS[level]]
    prop.tube((0, 0, 0), Z, [(z, radius) for z, radius, _ in body], (18, 12, 8, 6)[level], "steel",
              phase=0.25, band_surfaces=[surface for _, _, surface in body[:-1]])

    fins = [TAIL_FIN[index] for index in FIN_SECTIONS[level]]
    fin_outline = BEVELED[(1, 2, 3, 3)[level]]
    for index in range(3):
        angle = 0.25 + index * tau / 3
        _dart_vane(prop, angle, fins, fin_outline)
        if level < 3:
            guard = [SLEEVE_GUARD[station] for station in GUARD_SECTIONS[level]]
            _dart_vane(prop, angle + tau / 6, guard, BEVELED[(2, 3, 3)[level]])
