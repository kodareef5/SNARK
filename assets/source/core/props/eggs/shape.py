"""The egg: its outline, the sizes it is made in, and how its picture lies on it. model.py (in Blender) and paint.py
(numpy alone) both read it, so the mesh and the pictures agree.

The egg stands on its blunt end, +Y up, in metres, its origin where it meets the ground. A point of it is named by
`theta` round the upright and `phi` from the blunt end's pole (0) to the pointed end's (pi). The picture holds each half
in a disc of its own, the stereographic view of that half from the other pole: no seam round the egg, nothing pinched
at the poles, and a texel at the rim twice the size of one at the middle. Past each disc's rim the picture carries on
over the other half, so filtering never meets an edge.
"""

import math

import numpy as np

# Each size by ARK's name for it, and its height in metres. A species lays the size its egg prop names
# (core:egg_<size>); the dodo's is the smallest.
SIZES = {"xs": 0.11, "s": 0.16, "m": 0.23, "l": 0.33, "xl": 0.48}
# Height over the greatest width, and how much fuller the blunt end is than the pointed one.
LONG = 1.36
BLUNT = 0.12
# It sits this share of its height into the ground, as an egg settles into grass or sand.
SINK = 0.02
# Each half's disc in the picture: its middle (u, v) and radius.
BLUNT_DISC = (0.3, 0.3)
POINTED_DISC = (0.7, 0.7)
DISC = 0.27


def _fullness(phi):
    return np.sin(phi) * (1 + BLUNT * np.cos(phi))


# The greatest of _fullness, where cos(phi) solves cos + BLUNT * (2 cos^2 - 1) = 0.
_WIDEST = float(_fullness(math.acos((math.sqrt(1 + 8 * BLUNT * BLUNT) - 1) / (4 * BLUNT))))


def point(theta, phi, height):
    """The point (x, y, z) of an egg `height` tall."""
    theta, phi = np.asarray(theta, float), np.asarray(phi, float)
    rho = (height / LONG / 2) * _fullness(phi) / _WIDEST
    y = (height / 2) * (1 - np.cos(phi)) - SINK * height
    return np.stack([rho * np.cos(theta), y, rho * np.sin(theta)], axis=-1)


def uv(theta, phi, pointed):
    """Where (theta, phi) lies on the picture, on the pointed half's disc or the blunt half's. Seen from outside, neither
    disc is mirrored."""
    theta, phi = np.asarray(theta, float), np.asarray(phi, float)
    if pointed:
        r = np.tan((math.pi - phi) / 2)
        return np.stack([POINTED_DISC[0] + DISC * r * np.cos(theta), POINTED_DISC[1] - DISC * r * np.sin(theta)], axis=-1)
    r = np.tan(phi / 2)
    return np.stack([BLUNT_DISC[0] + DISC * r * np.cos(theta), BLUNT_DISC[1] + DISC * r * np.sin(theta)], axis=-1)


def angles(u, v):
    """(theta, phi) of each place on the picture, from the disc it is nearer: the inverse of `uv`."""
    u, v = np.asarray(u, float), np.asarray(v, float)
    pointed = (u - POINTED_DISC[0]) ** 2 + (v - POINTED_DISC[1]) ** 2 < (u - BLUNT_DISC[0]) ** 2 + (v - BLUNT_DISC[1]) ** 2
    a = np.where(pointed, u - POINTED_DISC[0], u - BLUNT_DISC[0]) / DISC
    b = np.where(pointed, POINTED_DISC[1] - v, v - BLUNT_DISC[1]) / DISC
    r = np.hypot(a, b)
    phi = np.where(pointed, math.pi - 2 * np.arctan(r), 2 * np.arctan(r))
    return np.arctan2(b, a), phi
