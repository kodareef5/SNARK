"""Build four closed cosmetic attachment props."""

from hand_geometry import Prop, X, Y, Z, rounded_outline


def _lathe(prop, rows, sides, *, rear, front):
    profile = [(z, radius, surface) for z, radius, surface, last_level in rows
               if prop.level <= last_level]
    prop.tube(Z * 0, Z, [(z, radius) for z, radius, _ in profile], sides[prop.level],
              rear, cap_surface=front, band_surfaces=[row[2] for row in profile[:-1]])


def scope(prop: Prop):
    _lathe(prop, (
        (-0.167, 0.032, "iron", 3),
        (-0.175, 0.043, "iron", 3),
        (-0.148, 0.046, "iron", 1),
        (-0.121, 0.045, "iron", 3),
        (-0.088, 0.033, "iron", 1),
        (-0.070, 0.028, "iron", 3),
        (0.054, 0.028, "iron", 3),
        (0.083, 0.041, "iron", 2),
        (0.112, 0.056, "iron", 3),
        (0.153, 0.060, "iron", 3),
        (0.179, 0.059, "iron", 0),
        (0.190, 0.055, "iron", 3),
        (0.181, 0.044, "optic", 3),
    ), (20, 14, 10, 8), rear="optic", front="optic")

    saddle = [(-0.072, 0.90)]
    if prop.level < 3:
        saddle.append((-0.028, 1.0))
    if prop.level == 0:
        saddle.append((0.019, 0.90))
    saddle.append((0.054, 0.69))
    prop.panel(Z * -0.008, rounded_outline(0.096, 0.110, 0.016), saddle, "brass")


def silencer(prop: Prop):
    _lathe(prop, (
        (-0.155, 0.025, "steel", 3),
        (-0.128, 0.030, "steel", 3),
        (-0.106, 0.042, "steel", 3),
        (-0.081, 0.044, "iron", 3),
        (0.091, 0.044, "iron", 1),
        (0.107, 0.043, "steel", 3),
        (0.135, 0.041, "steel", 3),
        (0.155, 0.033, "steel", 3),
    ), (16, 12, 10, 8), rear="steel", front="steel")


def flashlight(prop: Prop):
    _lathe(prop, (
        (-0.102, 0.027, "steel", 3),
        (-0.083, 0.035, "polymer", 3),
        (-0.058, 0.034, "polymer", 0),
        (-0.032, 0.032, "polymer", 2),
        (0.008, 0.034, "polymer", 3),
        (0.029, 0.037, "steel", 3),
        (0.057, 0.057, "steel", 3),
        (0.079, 0.060, "steel", 1),
        (0.098, 0.055, "steel", 3),
        (0.091, 0.045, "optic", 3),
    ), (20, 14, 10, 8), rear="steel", front="optic")


def laser(prop: Prop):
    housing = (
        (-0.069, 0.048, 0.038, 0.008, 3),
        (-0.039, 0.076, 0.059, 0.014, 1),
        (0.036, 0.090, 0.073, 0.016, 3),
        (0.065, 0.068, 0.046, 0.011, 3),
    )
    rings = []
    for z, width, height, clip, last_level in housing:
        if prop.level > last_level:
            continue
        section = rounded_outline(width, height, clip)
        if prop.level == 3:
            x, y = width / 2, height / 2
            section = [(-x, y), (x, y), (x, -y), (-x, -y)]
        rings.append([x * X + y * Y + z * Z for x, y in reversed(section)])
    prop.shell(rings, "polymer", cap_surface="optic", planar_sides=True)

    bracket = [(-0.047, 0.88)]
    if prop.level == 0:
        bracket.append((-0.032, 1.0))
    bracket.append((-0.015, 0.79))
    prop.panel(Z * -0.016, rounded_outline(0.117, 0.115, 0.020), bracket, "steel")
