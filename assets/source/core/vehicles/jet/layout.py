"""The XF-51's picture layout, shared by convert.py (in Blender) and paint.py (outside it). Plain Python.

Coordinates are Blender's as convert.py leaves the airframe: metres, +Z up, the nose toward -Y, the left wing toward +X,
the wheels on z = 0. The game's axes are (x, z, -y).

One atlas, `paint`, square. Its picture is laid out in projections that both halves of the jet share (|x|):

- TOP, the airframe seen from above; BOTTOM, from below; each |x| across its width and the length down its height, the
  nose at the picture's top.
- SIDE, seen from the side: the height across its width and the length down it. Both fins' outer faces read it so that
  their tail codes read the right way round from each side (convert.py turns the right fin's along its length).
- STRIP, a column of small patches of plain colours: what a projection would smear (faces that look ahead or back), the
  tyres, the gear, the nozzle's metal, the fins' inner faces, the cockpit.
"""

SIDE_PX = 1024
LENGTH = 15.6
HALF = LENGTH / 2
# Wider than the jet each way, so nothing reaches a region's edge.
SPAN = 5.5
HEIGHT = 4.6
MARGIN = 0.012

TOP = (0.0, 0.335)
BOTTOM = (0.335, 0.67)
SIDE = (0.67, 0.955)
STRIP = (0.955, 1.0)
# Patches of the strip, as ranges of v (0 at the picture's foot).
PATCHES = {
    "dark": (0.00, 0.12),
    "rubber": (0.12, 0.24),
    "gear": (0.24, 0.40),
    "metal": (0.40, 0.56),
    "plain": (0.56, 0.72),
    "inner": (0.72, 0.86),
    "cockpit": (0.86, 1.00),
}


def along(y):
    """v of a point's place along the jet: the nose (-HALF) at the top of the picture."""
    return MARGIN + (1 - 2 * MARGIN) * (HALF - y) / LENGTH


def across(region, t, extent):
    u0, u1 = region
    return u0 + (u1 - u0) * (MARGIN + (1 - 2 * MARGIN) * t / extent)


def top(x, y):
    return across(TOP, abs(x), SPAN), along(y)


def bottom(x, y):
    return across(BOTTOM, abs(x), SPAN), along(y)


def side(z, y):
    return across(SIDE, z, HEIGHT), along(y)


def patch(name, a, b):
    """A point of a patch: `a` and `b` in 0..1 across and along it, kept inside its border."""
    u0, u1 = STRIP
    v0, v1 = PATCHES[name]
    return u0 + (u1 - u0) * (0.15 + 0.7 * a), v0 + (v1 - v0) * (0.15 + 0.7 * b)
