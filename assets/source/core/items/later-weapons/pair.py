"""Sculpt the fabricated pistol and compound bow as static game props."""

from math import copysign, cos, sin, tau

from hand_geometry import X, Y, Z


# Each casing station gives its reach, bottom, top and half-width.
PISTOL_CASE = (
    (-0.073, 0.040, 0.088, 0.014),
    (-0.067, 0.033, 0.098, 0.019),
    (-0.053, 0.032, 0.102, 0.021),
    (-0.032, 0.032, 0.102, 0.021),
    (-0.008, 0.032, 0.100, 0.021),
    (0.041, 0.034, 0.100, 0.021),
    (0.072, 0.035, 0.094, 0.020),
    (0.099, 0.037, 0.085, 0.018),
    (0.140, 0.040, 0.085, 0.018),
    (0.155, 0.045, 0.080, 0.014),
)
PISTOL_FRAME = (
    (-0.063, 0.014, 0.051, 0.012),
    (-0.052, 0.010, 0.053, 0.017),
    (-0.021, 0.008, 0.053, 0.019),
    (0.019, 0.012, 0.053, 0.020),
    (0.051, 0.013, 0.046, 0.019),
    (0.087, 0.017, 0.045, 0.017),
    (0.128, 0.025, 0.049, 0.015),
    (0.145, 0.031, 0.047, 0.013),
)
# Each upright station gives its height, offset across, back, front and half-width.
PISTOL_GRIP = (
    (-0.101, 0, -0.062, -0.011, 0.015),
    (-0.092, 0, -0.065, -0.008, 0.019),
    (-0.076, 0, -0.058, -0.006, 0.020),
    (-0.054, 0, -0.049, 0.002, 0.020),
    (-0.032, 0, -0.040, 0.008, 0.019),
    (-0.012, 0, -0.030, 0.017, 0.018),
    (0.008, 0, -0.025, 0.024, 0.017),
    (0.023, 0, -0.035, 0.027, 0.018),
    (0.036, 0, -0.052, 0.022, 0.017),
    (0.046, 0, -0.052, 0.014, 0.014),
)
PISTOL_HEEL = (
    (-0.111, 0, -0.065, -0.005, 0.018),
    (-0.107, 0, -0.072, 0.002, 0.022),
    (-0.094, 0, -0.072, 0.004, 0.022),
    (-0.087, 0, -0.063, -0.006, 0.017),
)

BOW_RISER = (
    (-0.278, 0.032, 0.100, 0.143, 0.012),
    (-0.267, 0.032, 0.111, 0.165, 0.020),
    (-0.250, 0.031, 0.112, 0.171, 0.025),
    (-0.225, 0.029, 0.099, 0.172, 0.023),
    (-0.191, 0.026, 0.089, 0.161, 0.019),
    (-0.154, 0.023, 0.071, 0.140, 0.016),
    (-0.118, 0.018, 0.030, 0.111, 0.017),
    (-0.086, 0.011, -0.008, 0.063, 0.019),
    (-0.061, 0.004, -0.022, 0.025, 0.015),
    (-0.028, 0.000, -0.018, 0.014, 0.012),
    (0.024, 0.000, -0.019, 0.015, 0.012),
    (0.056, 0.004, -0.019, 0.030, 0.014),
    (0.078, 0.015, -0.005, 0.060, 0.019),
    (0.103, 0.023, 0.041, 0.106, 0.019),
    (0.130, 0.029, 0.076, 0.135, 0.016),
    (0.161, 0.032, 0.096, 0.152, 0.017),
    (0.195, 0.032, 0.106, 0.166, 0.019),
    (0.226, 0.032, 0.111, 0.174, 0.022),
    (0.251, 0.032, 0.112, 0.176, 0.025),
    (0.269, 0.032, 0.101, 0.163, 0.021),
    (0.282, 0.032, 0.096, 0.141, 0.013),
)
BOW_GRIP = (
    (-0.063, 0.004, -0.024, 0.026, 0.015),
    (-0.056, 0.004, -0.029, 0.026, 0.019),
    (-0.036, 0.001, -0.026, 0.020, 0.019),
    (-0.012, 0.000, -0.024, 0.019, 0.018),
    (0.022, 0.000, -0.026, 0.022, 0.019),
    (0.049, 0.002, -0.026, 0.030, 0.019),
    (0.059, 0.004, -0.020, 0.028, 0.015),
)
BOW_SIDE = 0.032
BOW_LIMB = (
    (0.234, BOW_SIDE, 0.115, 0.148, 0.021),
    (0.253, BOW_SIDE, 0.100, 0.159, 0.026),
    (0.275, BOW_SIDE, 0.069, 0.144, 0.023),
    (0.292, BOW_SIDE, 0.048, 0.112, 0.019),
    (0.315, BOW_SIDE, 0.011, 0.069, 0.017),
    (0.340, BOW_SIDE, -0.033, 0.028, 0.016),
    (0.360, BOW_SIDE, -0.059, -0.007, 0.016),
    (0.372, BOW_SIDE, -0.077, -0.041, 0.014),
    (0.388, BOW_SIDE, -0.086, -0.053, 0.011),
)
BOW_BRACE = (
    (0.082, 0.016, 0.042, 0.071, 0.010),
    (0.106, 0.020, 0.026, 0.060, 0.010),
    (0.133, 0.024, 0.027, 0.056, 0.009),
    (0.167, 0.027, 0.043, 0.071, 0.009),
    (0.196, 0.030, 0.065, 0.092, 0.009),
    (0.221, 0.032, 0.089, 0.111, 0.010),
    (0.253, 0.032, 0.114, 0.136, 0.012),
)


def _section(center, u, v, width, depth, chamfer):
    if not chamfer:
        return [center + u * a + v * b for a, b in (
            (-width, -depth), (width, -depth), (width, depth), (-width, depth),
        )]
    corner = min(width * 0.36, depth * 0.33)
    return [center + u * a + v * b for a, b in (
        (-width + corner, -depth), (width - corner, -depth),
        (width, -depth + corner), (width, depth - corner),
        (width - corner, depth), (-width + corner, depth),
        (-width, depth - corner), (-width, -depth + corner),
    )]


def _case(prop, profile, indices, surface, chamfer):
    rings = []
    for i in indices:
        z, bottom, top, width = profile[i]
        center = Z * z + Y * ((bottom + top) / 2)
        rings.append(_section(center, X, Y, width, (top - bottom) / 2, chamfer))
    prop.shell(rings, surface, planar_sides=True)


def _upright(prop, profile, indices, surface, chamfer, side=1):
    rings = []
    order = indices if side == 1 else reversed(indices)
    for i in order:
        y, x, back, front, width = profile[i]
        center = Y * (y * side) + Z * ((front + back) / 2) + X * x
        rings.append(_section(center, Z, X, (front - back) / 2, width, chamfer))
    prop.shell(rings, surface, planar_sides=True)


def _side_band(prop, center, outside, inside, sides, width, surface, *, squareness=1, tilt=0):
    sections = (
        ((-1, .08), (-1, .88), (-.65, 1), (.65, 1), (1, .88), (1, .08), (.72, 0), (-.72, 0)),
        ((-1, 0), (-1, .88), (-.62, 1), (.62, 1), (1, .88), (1, 0)),
        ((-1, 0), (-1, 1), (1, 1), (1, 0)),
    )
    c = cos(tilt)
    s = sin(tilt)
    rings = []
    for x, reach in sections[min(prop.level, 2)]:
        height = inside[0] + reach * (outside[0] - inside[0])
        depth = inside[1] + reach * (outside[1] - inside[1])
        ring = []
        for i in range(sides):
            angle = i * tau / sides
            # The squarer rings retain a long flat side under the body.
            a = cos(angle)
            b = sin(angle)
            y = height * copysign(abs(a) ** squareness, a)
            z = depth * copysign(abs(b) ** squareness, b)
            ring.append(center + X * (x * width) + Y * (y * c - z * s) + Z * (y * s + z * c))
        rings.append(ring)
    prop.shell(rings, surface, closed=True, planar_sides=True)


def pistol_fabricated(prop):
    """Set a raised steel casing over a short frame and swept dark palm."""
    level = prop.level
    case = (range(10), (0, 2, 5, 7, 8, 9), (0, 2, 7, 9), (0, 2, 7, 9))[level]
    frame = (range(8), (0, 2, 4, 6, 7), (0, 2, 4, 7), (0, 7))[level]
    grip = (range(10), (0, 1, 3, 5, 7, 9), (0, 3, 6, 9), (0, 5, 9))[level]
    heel = (range(4), (0, 2, 3), (0, 2), (0, 2))[level]
    _case(prop, PISTOL_CASE, case, "steel", level < 3)
    _case(prop, PISTOL_FRAME, frame, "polymer", level < 2)
    _upright(prop, PISTOL_GRIP, grip, "rubber", level < 3)
    _upright(prop, PISTOL_HEEL, heel, "polymer", level == 0)
    _side_band(prop, Y * 0.002 + Z * 0.055, (0.036, 0.047), (0.020, 0.030),
               (24, 12, 8, 6)[level], 0.010, "polymer", squareness=0.65)


def bow_compound(prop):
    """Sweep the limbs back to large brass ovals on either end of the riser."""
    level = prop.level
    riser = (range(21), (0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20),
             (0, 2, 6, 9, 12, 16, 20), (0, 4, 9, 15, 20))[level]
    grip = (range(7), (0, 2, 4, 6), (0, 3, 6), (0, 6))[level]
    limb = (range(9), (0, 2, 4, 6, 8), (0, 4, 6, 8), (0, 4, 8))[level]
    brace = (range(7), (0, 2, 4, 6), (0, 3, 6))[min(level, 2)]
    _upright(prop, BOW_RISER, riser, "steel", level < 2)
    _upright(prop, BOW_GRIP, grip, "polymer", level < 2)
    for side in (-1, 1):
        _upright(prop, BOW_LIMB, limb, "polymer", level < 2, side)
        if level < 3:
            _upright(prop, BOW_BRACE, brace, "steel", level == 0, side)

    rim_sides = (24, 12, 12, 6)[level]
    _side_band(prop, X * BOW_SIDE + Y * 0.384 - Z * 0.105,
               (0.072, 0.062), (0.038, 0.032), rim_sides, 0.012, "brass", tilt=0.26)
    _side_band(prop, X * BOW_SIDE - Y * 0.381 - Z * 0.107,
               (0.058, 0.065), (0.030, 0.034), rim_sides, 0.012, "brass", tilt=-0.37)
    string = X * BOW_SIDE - Z * 0.155
    prop.cord([string - Y * 0.390, string + Y * 0.396], 0.004,
              (8, 6, 4, 3)[level], "polymer")
