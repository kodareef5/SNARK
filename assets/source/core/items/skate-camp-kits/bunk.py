"""Two plank beds with hide covers and an offset ladder."""

from hand_geometry import X, Y, Z, rounded_outline
from mathutils import Vector


FLOOR = -1.25
TOP = 1.25
LEFT = -0.633
RIGHT = 0.397
BED_CENTER = (LEFT + RIGHT) / 2
POST_END = 1.06
DECKS = (-0.74, 0.61)

# Linen shows at the head and below the hanging sides of the cover.
PADDING = (
    (-0.76, 0.00), (0.76, 0.00), (0.98, 0.18), (1.00, 0.47), (0.83, 0.88),
    (0.40, 1.00), (-0.33, 0.98), (-0.84, 0.86), (-1.00, 0.43), (-0.96, 0.16),
)
PADDING_CORNERS = (range(10), (0, 1, 2, 3, 5, 6, 8, 9), (0, 1, 3, 5, 6, 8))

# Each station gives length, width, sideways drift, underside and crown in metres.
MATTRESS = (
    (-0.955, 0.324, 0.000, 0.020, 0.047),
    (-0.929, 0.410, 0.002, 0.008, 0.087),
    (-0.874, 0.453, 0.001, -0.010, 0.105),
    (-0.575, 0.454, -0.005, -0.013, 0.109),
    (-0.148, 0.453, 0.003, -0.014, 0.104),
    (0.322, 0.454, 0.005, -0.013, 0.109),
    (0.854, 0.453, -0.001, -0.011, 0.104),
    (0.926, 0.416, -0.003, 0.004, 0.084),
    (0.955, 0.316, 0.002, 0.016, 0.046),
)
COVER = (
    (-0.956, 0.347, 0.006, 0.033, 0.087),
    (-0.938, 0.420, 0.010, 0.016, 0.119),
    (-0.882, 0.478, 0.012, -0.034, 0.146),
    (-0.774, 0.485, 0.019, -0.070, 0.157),
    (-0.645, 0.481, 0.017, -0.065, 0.151),
    (-0.485, 0.484, 0.025, -0.082, 0.165),
    (-0.314, 0.487, 0.021, -0.054, 0.151),
    (-0.145, 0.475, 0.019, -0.063, 0.162),
    (0.020, 0.468, 0.011, -0.041, 0.153),
    (0.254, 0.467, 0.014, -0.017, 0.161),
    (0.334, 0.467, 0.012, 0.003, 0.158),
    (0.366, 0.445, 0.006, 0.014, 0.109),
)
PILLOW = (
    (0.497, 0.251, 0.009, 0.083, 0.106),
    (0.541, 0.333, 0.015, 0.074, 0.139),
    (0.608, 0.359, 0.010, 0.077, 0.211),
    (0.698, 0.372, 0.004, 0.076, 0.232),
    (0.794, 0.363, -0.002, 0.074, 0.203),
    (0.862, 0.343, -0.008, 0.073, 0.163),
    (0.905, 0.250, -0.010, 0.078, 0.107),
)


def _timber(prop, start, end, width, depth, detail=0):
    first, last = Vector(start), Vector(end)
    span = last - first
    axis = max((X, Y, Z), key=lambda candidate: abs(span.dot(candidate)))
    axis = axis if span.dot(axis) > 0 else -axis
    across = X if axis.x == 0 else Z
    other = across.cross(axis)
    if detail > prop.level:
        clip = min(0.016, width / 4, depth / 4)
        outline = rounded_outline(width, depth, clip)
    else:
        x, z = width / 2, depth / 2
        outline = ((-x, z), (x, z), (x, -z), (-x, -z))
    if detail == 2 and prop.level == 0:
        bevel = 0.009 / span.length
        stations = ((0, 0.9), (bevel, 1), (1 - bevel, 1), (1, 0.92))
    else:
        stations = ((0, 1), (1, 1))
    rings = [[first + fraction * span + scale * (u * across + v * other) for u, v in outline]
             for fraction, scale in stations]
    prop.shell(rings, "wood")


def _deck(prop, height):
    if prop.level >= 2:
        _timber(prop, (BED_CENTER, height - 0.079, -1.09), (BED_CENTER, height - 0.079, 1.09),
                1.15, 0.158)
        return
    for side in (LEFT, RIGHT):
        _timber(prop, (side, height - 0.079, -1.09), (side, height - 0.079, 1.09), 0.12, 0.158, 2)
    for z in (-POST_END, POST_END):
        _timber(prop, (LEFT, height - 0.083, z), (RIGHT, height - 0.083, z), 0.113, 0.146, 1)
    slats = 9 if prop.level == 0 else 6
    for index in range(slats):
        z = -0.886 + 1.772 * index / (slats - 1)
        _timber(prop, (LEFT, height - 0.031, z), (RIGHT, height - 0.031, z), 1.33 / slats, 0.044)


def _guards(prop):
    _timber(prop, (LEFT, 1.075, -1.095), (LEFT, 1.075, 1.095), 0.075, 0.135, 2)
    _timber(prop, (RIGHT, 1.075, -0.53), (RIGHT, 1.075, 1.095), 0.075, 0.135, 2)
    _timber(prop, (RIGHT, 0.57, -0.517), (RIGHT, 1.129, -0.517), 0.076, 0.085, 1)
    for z in (-POST_END, POST_END):
        _timber(prop, (LEFT, 1.072, z), (RIGHT, 1.072, z), 0.065, 0.125, 1)
    if prop.level < 3:
        _timber(prop, (LEFT, -0.423, POST_END), (RIGHT, -0.423, POST_END), 0.077, 0.148, 1)
    if prop.level < 2:
        _timber(prop, (LEFT, 0.873, -1.095), (LEFT, 0.873, 1.095), 0.057, 0.088, 1)
        _timber(prop, (RIGHT, 0.873, -0.53), (RIGHT, 0.873, 1.095), 0.057, 0.088, 1)
        _timber(prop, (LEFT, 0.060, 1.045), (LEFT + 0.31, 0.514, 1.045), 0.069, 0.078, 1)
        _timber(prop, (RIGHT, 0.060, 1.045), (RIGHT - 0.31, 0.514, 1.045), 0.069, 0.078, 1)


def _ladder(prop):
    first, last = -1.065, -0.546
    foot_x, top_x, top_y = 0.647, 0.464, 0.976
    for z in (first, last):
        _timber(prop, (foot_x, FLOOR, z), (top_x, top_y, z), 0.106, 0.082, 2)
    for y in (-0.99, -0.615, -0.24, 0.135, 0.51):
        x = foot_x + (top_x - foot_x) * (y - FLOOR) / (top_y - FLOOR)
        _timber(prop, (x, y, first), (x, y, last), 0.094, 0.051, 1)


def _padding(prop, deck, profile, selection, surface, drift):
    corners = PADDING_CORNERS[prop.level]
    rings = []
    for index in selection[prop.level]:
        z, width, sideways, base, crown = profile[index]
        rings.append([(BED_CENTER + sideways * drift + width * PADDING[i][0],
                       deck + base + (crown - base) * PADDING[i][1], z) for i in corners])
    prop.shell(rings, surface, smooth=True)


def _bedding(prop, deck, drift):
    if prop.level == 3:
        sections = (
            (-0.955, 0.393, 0.025, 0.105), (-0.812, 0.489, -0.044, 0.149),
            (0.353, 0.467, -0.018, 0.156), (0.955, 0.412, 0.016, 0.118),
        )
        corners = ((-0.9, 0), (0.9, 0), (0.91, 1), (-0.91, 1))
        rings = [[(BED_CENTER + across * width, deck + base + rise * (crown - base), z)
                  for across, rise in corners] for z, width, base, crown in sections]
        prop.shell(rings, "hide", cap_surface="linen", band_surfaces=("hide", "hide", "linen"))
        return
    _padding(prop, deck, MATTRESS, (range(9), (0, 2, 4, 6, 7, 8), (0, 2, 4, 6, 8)), "linen", drift)
    _padding(prop, deck, COVER, (range(12), (0, 2, 3, 5, 8, 10, 11), (0, 2, 5, 9, 11)), "hide", drift)
    _padding(prop, deck, PILLOW, (range(7), (0, 2, 4, 6), (0, 3, 6)), "linen", drift)


def bunk_bed(prop):
    for x in (LEFT, RIGHT):
        for z in (-POST_END, POST_END):
            _timber(prop, (x, FLOOR, z), (x, TOP, z), 0.134, 0.130, 2)
    for deck, drift in zip(DECKS, (1, -1)):
        _deck(prop, deck)
        _bedding(prop, deck, drift)
    _guards(prop)
    _ladder(prop)
