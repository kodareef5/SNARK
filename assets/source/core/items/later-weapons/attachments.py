"""Build four closed cosmetic attachment props."""

from hand_geometry import Prop, X, Y, Z, rounded_outline


def _lathe(prop, rows, sides, *, rear, front):
    profile = [(z, radius, surface) for z, radius, surface, last_level in rows
               if prop.level <= last_level]
    prop.tube(Z * 0, Z, [(z, radius) for z, radius, _ in profile], sides[prop.level],
              rear, cap_surface=front, band_surfaces=[row[2] for row in profile[:-1]])


def _outline(width, length, clip, sides):
    x, z = width / 2, length / 2
    if sides == 4:
        return [(-x, z), (x, z), (x, -z), (-x, -z)]
    if sides == 8:
        return rounded_outline(width, length, clip)

    corner = [(x - clip, z), (x - 0.29 * clip, z - 0.29 * clip), (x, z - clip)]
    return [
        *corner,
        *((a, -b) for a, b in reversed(corner)),
        *((-a, -b) for a, b in corner),
        *((-a, b) for a, b in reversed(corner)),
    ]


def scope(prop: Prop):
    lens = "iron" if prop.level == 3 else "optic"
    _lathe(prop, (
        (-0.167, 0.032, "iron", 2),
        (-0.175, 0.043, "iron", 3),
        (-0.148, 0.046, "iron", 1),
        (-0.121, 0.045, "iron", 3),
        (-0.088, 0.033, "iron", 1),
        (-0.070, 0.028, "iron", 3),
        (0.054, 0.028, "iron", 3),
        (0.083, 0.041, "iron", 1),
        (0.112, 0.056, "iron", 3),
        (0.153, 0.060, "iron", 2),
        (0.179, 0.059, "iron", 0),
        (0.190, 0.055, "iron", 3),
        (0.181, 0.044, "optic", 2),
    ), (24, 12, 8, 6), rear=lens, front=lens)

    saddle = [(-0.072, 0.90)]
    if prop.level < 3:
        saddle.append((-0.028, 1.0))
    if prop.level == 0:
        saddle.append((0.019, 0.90))
    saddle.append((0.054, 0.69))
    outline = _outline(0.096, 0.110, 0.016, 4 if prop.level == 3 else 8)
    prop.panel(Z * -0.008, outline, saddle, "brass")


def silencer(prop: Prop):
    _lathe(prop, (
        (-0.155, 0.025, "steel", 3),
        (-0.128, 0.030, "steel", 3),
        (-0.106, 0.042, "steel", 2),
        (-0.081, 0.044, "iron", 3),
        (0.091, 0.044, "iron", 1),
        (0.107, 0.043, "steel", 3),
        (0.135, 0.041, "steel", 2),
        (0.155, 0.033, "steel", 3),
    ), (26, 14, 8, 6), rear="steel", front="steel")


def flashlight(prop: Prop):
    lens = "steel" if prop.level == 3 else "optic"
    _lathe(prop, (
        (-0.102, 0.027, "polymer", 3),
        (-0.083, 0.035, "polymer", 2),
        (-0.058, 0.034, "polymer", 0),
        (-0.032, 0.032, "polymer", 2),
        (0.008, 0.034, "polymer", 3),
        (0.029, 0.037, "steel", 3),
        (0.057, 0.057, "steel", 3),
        (0.079, 0.060, "steel", 1),
        (0.098, 0.055, "steel", 3),
        (0.091, 0.045, "optic", 2),
    ), (24, 14, 8, 6), rear="steel", front=lens)


def laser(prop: Prop):
    sides = (12, 8, 8, 4)[prop.level]
    housing = (
        (-0.069, 0.048, 0.038, 0.008, 3),
        (-0.039, 0.076, 0.059, 0.014, 1),
        (0.036, 0.090, 0.073, 0.016, 3),
        (0.055, 0.084, 0.063, 0.014, 0),
        (0.065, 0.068, 0.046, 0.011, 3),
    )
    rings = []
    for z, width, height, clip, last_level in housing:
        if prop.level > last_level:
            continue
        section = _outline(width, height, clip, sides)
        rings.append([x * X + y * Y + z * Z for x, y in reversed(section)])
    lens = "polymer" if prop.level == 3 else "optic"
    prop.shell(rings, "polymer", cap_surface=lens, planar_sides=True)

    bracket = [(-0.047, 0.88)]
    if prop.level < 2:
        bracket.append((-0.034, 1.0))
    if prop.level == 0:
        bracket.append((-0.024, 0.94))
    bracket.append((-0.015, 0.79))

    outline = _outline(0.117, 0.115, 0.020, (12, 8, 4, 4)[prop.level])
    if prop.level == 3:
        outline = [(-0.058, 0.052), (0.058, 0.052), (0, -0.057)]
    prop.panel(Z * -0.016, outline, bracket, "steel")
