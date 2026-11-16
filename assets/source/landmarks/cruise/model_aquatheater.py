"""Original AquaDome lounge fitting informed by the archived award photographs.

The operator's aquadome-award.pdf, page 2, shows ivory curved shells, deep
purple upholstery, small pedestal tables and lush planting around the pods.
This is a fitted interpretation, not an exact proprietary furniture replica.
Engine-local +Y is up; +Z is the planted back and -Z the open front. The ground
origin and every native level fit [-2.5,0,-2] .. [2.5,1.6,2].
"""
import math


def _arc(m, section, start, end, steps, tag):
    """Sweep a closed radial section along an ellipse; no open sheet surfaces."""
    rings = []
    for i in range(steps + 1):
        angle = start + (end - start) * i / steps
        rings.append([(rx * math.sin(angle), y, -.12 + rz * math.cos(angle))
                      for rx, rz, y in section])
    m.loft(rings, tag)


def _disc(m, x, z, y0, y1, rx, rz, tag, steps):
    m.loft([[(x + rx * math.cos(i * math.tau / steps), y,
              z + rz * math.sin(i * math.tau / steps)) for i in range(steps)]
            for y in (y0, y1)], tag)


def _pillow(m, x, z, angle):
    first = len(m.v)
    m.box([-.30, 0, -.11], [.30, .52, .11], 'ivory', .075)
    ca, sa = math.cos(angle), math.sin(angle)
    for i in range(first, len(m.v)):
        px, py, pz = m.v[i]
        # A slight recline reads as a cushion, with no nonuniform normal scaling.
        yy = py * .985 - pz * .173
        zz = py * .173 + pz * .985
        m.v[i] = (x + px * ca + zz * sa, .55 + yy, z - px * sa + zz * ca)


def _leaf(m, base, tip, width):
    """A closed eight-triangle leaf with a restrained central ridge."""
    dx, dz = tip[0] - base[0], tip[2] - base[2]
    length = math.hypot(dx, dz)
    ux, uz = (-dz / length, dx / length) if length > .0001 else (1, 0)
    center = [base[k] * .42 + tip[k] * .58 for k in range(3)]
    left = [center[0] + ux * width, center[1], center[2] + uz * width]
    right = [center[0] - ux * width, center[1], center[2] - uz * width]
    ridge = [center[0], center[1] + .032, center[2]]
    underside = [center[0], center[1] - .024, center[2]]
    m.indexed([base, tip, left, right, ridge, underside],
              [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4),
               (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)], 'leaf')


def aquadome_pod(m, prototype):
    """Append the whole lounge pod using only the existing parts.Mesh API."""
    first_vertex = len(m.v)
    level = m.level
    segments = (36, 28, 20, 14, 10, 8)[level]
    lo, hi = -2.57, 2.57

    # Low stone inset and a separate timber seat support. The C-shaped shell's
    # front stays open; its inner and outer surfaces are one closed curved solid.
    _disc(m, 0, -.29, .012, .065, 1.52, 1.17, 'stone', segments)
    _arc(m, [(1.12, .43, .10), (1.92, 1.14, .10),
             (1.92, 1.14, .335), (1.12, .43, .335)], lo, hi, segments, 'oak')
    _arc(m, [(2.26, 1.48, .12), (2.38, 1.60, .35),
             (2.38, 1.60, 1.08), (2.29, 1.51, 1.16),
             (2.12, 1.34, 1.16), (2.10, 1.32, 1.02),
             (2.10, 1.32, .38), (2.14, 1.36, .12)], lo, hi, segments, 'ivory')

    # Individual upholstered cushions preserve the reference's deep purple
    # rhythm. Tiny seams are real gaps, not coincident decorative faces.
    cushions = (12, 10, 7, 5, 3, 1)[level]
    for i in range(cushions):
        a = lo + (hi - lo) * i / cushions + .004
        b = lo + (hi - lo) * (i + 1) / cushions - .004
        count = max(1, math.ceil(segments / cushions))
        _arc(m, [(1.16, .47, .35), (1.82, 1.04, .35),
                 (1.87, 1.09, .43), (1.84, 1.06, .54),
                 (1.20, .51, .54), (1.14, .45, .48)], a, b, count, 'purple')
        _arc(m, [(2.06, 1.28, .52), (2.06, 1.28, 1.01),
                 (1.96, 1.18, 1.06), (1.88, 1.10, .94),
                 (1.88, 1.10, .54)], a, b, count, 'purple')

    # Two modest ivory pedestal tables, separated from the curved seating.
    circle = (16, 12, 10, 8, 6, 4)[level]
    for x in (-.60, .60):
        _disc(m, x, -.70, .073, .125, .25, .23, 'ivory', circle)
        m.tube([(x, .132, -.70), (x, .553, -.70)], .047, 'steel', n=max(4, circle // 2))
        _disc(m, x, -.70, .56, .61, .40, .30, 'ivory', circle)
    if level < 4:
        _pillow(m, -1.49, .22, -.78)
        _pillow(m, 1.49, .22, .78)
        if level < 2:
            _pillow(m, -.63, .81, -.29)
            _pillow(m, .63, .81, .29)

    # Planting occupies the rear only, leaving the front's open approach legible.
    # The planter and foliage are closed solids, including the coarsest fallback.
    m.box([-1.50, .04, 1.53], [1.50, .31, 1.93], 'oak', .055)
    leaves = (8, 7, 6, 5, 4, 3)[level]
    for plant, x in enumerate((-1.08, 0, 1.08)):
        m.tube([(x, .32, 1.73), (x, .91, 1.73)], .024, 'steel', n=4)
        for i in range(leaves):
            angle = math.tau * (i / leaves + plant * .13)
            tip = [x + .34 * math.cos(angle), 1.43 + .13 * math.sin(angle),
                   1.73 + .21 * math.sin(angle)]
            _leaf(m, [x, .53 + .10 * (i % 2), 1.73], tip, .095 if level < 3 else .12)

    bounds = prototype.get('visualBounds', {'min': [-2.5, 0, -2], 'max': [2.5, 1.6, 2]})
    for point in m.v[first_vertex:]:
        if any(point[k] < bounds['min'][k] - 1e-7 or
               point[k] > bounds['max'][k] + 1e-7 for k in range(3)):
            raise ValueError('AquaDome pod vertex outside authored bounds: ' + str(point))
