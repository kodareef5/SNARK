"""Closed, six-level exterior fittings for the native cruise landmark.

The lifeboat is an original reconstruction from the actual Icon photographs,
especially Concord's Palfinger 01/03 (CC BY-SA 4.0, reference copies archived by
the parent author). White hull, yellow canopy, paired fabric doors, small dark
door lights, bow helm and hanging grablines follow those photographs. This is
not a working or dimensionally certified rescue craft.

https://commons.wikimedia.org/wiki/File:Icon_of_the_Seas_Palfinger_01.jpg
https://commons.wikimedia.org/wiki/File:Icon_of_the_Seas_Palfinger_03.jpg

Canonical envelope is the supplied MPC49 reference size: 15 x 5.5 x 4.2 m,
engine +Y up / +Z bow, centered on the craft. Every level stays inside it.
Only semantic material names are used; parts.Mesh owns UVs and conversion.
"""
import math


def _outline(y, half_x, half_z, steps, front_drop=0):
    """Rounded oblong with a fuller stern and a softer, longer bow shoulder."""
    points = []
    rx = min(.74, half_x * .46)
    for sx, sz, start in ((1, 1, 0), (-1, 1, math.pi / 2),
                          (-1, -1, math.pi), (1, -1, 3 * math.pi / 2)):
        rz = min(1.42 if sz > 0 else .78, half_z * .35)
        for i in range(steps + 1):
            angle = start + math.pi * i / (2 * steps)
            x = sx * (half_x - rx) + rx * math.cos(angle)
            z = sz * (half_z - rz) + rz * math.sin(angle)
            dip = front_drop * max(0, (z - 4.8) / max(.01, half_z - 4.8))
            points.append((x, y - dip, z))
    return points


def _shell(m, rings, bands, cap='enamel'):
    """One closed indexed solid, partitioned by material without layered faces."""
    first = len(m.tags)
    m.loft(rings, cap)
    size = len(rings[0])
    for band, tag in enumerate(bands):
        for face in range(size):
            m.tags[first + band * size + face] = tag


def _side_x(y):
    # The uninterrupted middle of each longitudinal side, before rounded ends.
    if y <= .45:
        return 2.64 + (2.60 - 2.64) * (y + .37) / .82
    if y <= 1.30:
        return 2.60 + (2.54 - 2.60) * (y - .46) / .84
    return 2.54 + (2.38 - 2.54) * (y - 1.30) / .45


def _side_panel(m, side, z0, z1, y0, y1, tag, stand=.016, depth=.012):
    rings = []
    for y in (y0, y1):
        x = _side_x(y) + stand
        rings.append([(side * (x + d), y, z) for d, z in
                      ((0, z0), (depth, z0), (depth, z1), (0, z1))])
    m.loft(rings, tag)


def _door(m, side, center, panel=_side_panel):
    """Closed fabric closure with a separate small window and sewn border."""
    z0, z1 = center - .49, center + .49
    # Different lower/upper fabric pieces meet with a narrow shadow seam.
    panel(m, side, z0, z1, -.31, .444, 'enamel')
    panel(m, side, z0, z1, .456, 1.59, 'yellow')
    panel(m, side, center - .22, center + .22, .12, 1.23,
                'navy', stand=.045, depth=.010)
    if m.level < 3:
        # Narrow sewn hems and bottom folds, all standing off the hull surface.
        for z in (z0 + .025, z1 - .055):
            panel(m, side, z, z + .03, -.30, 1.58,
                        'enamel', stand=.060, depth=.008)
        for y in (-.21, -.04, 1.49):
            panel(m, side, z0 + .06, z1 - .06, y, y + .025,
                        'enamel', stand=.060, depth=.008)
        # Grab handles beside the closure, not a large bus-window frame.
        for z in (z0 - .11, z1 + .11):
            points = [(side * (_side_x(y) + .075), y, z)
                      for y in (-.23, .35)]
            m.tube(points, .018, 'steel', n=6 if m.level == 0 else 4)
    if m.level < 2:
        # Horizontal retaining bar at the top of each fabric door.
        m.tube([(side * (_side_x(1.65) + .06), 1.65, z0 - .06),
                (side * (_side_x(1.65) + .06), 1.65, z1 + .06)],
               .022, 'steel', n=6 if m.level == 0 else 4)


def lifeboat(m, prototype):
    """Append the whole enclosed craft; no layout, collision or material edits."""
    first_vertex = len(m.v)
    level = m.level
    # Both textured stages retain the same envelope; changing the corner
    # stations alone exceeded their stated 12.5 mm visible error.
    steps = (5, 5, 3, 2, 1, 1)[level]

    # White double-chine hull. The dark rubbing strake is a material region of
    # this same closed shell, avoiding a coplanar black overlay at every LOD.
    if level < 4:
        stations = [(-2.02, 1.12, 5.85), (-1.72, 1.82, 6.85),
                    (-1.14, 2.48, 7.25), (-.60, 2.65, 7.42),
                    (-.51, 2.70, 7.48), (-.44, 2.70, 7.48),
                    (-.37, 2.64, 7.42), (.45, 2.60, 7.32)]
        bands = ['enamel'] * 7
        bands[4] = 'rubber'
    else:
        stations = [(-2.02, 1.12, 5.85), (-1.14, 2.48, 7.25),
                    (-.51, 2.70, 7.48), (-.44, 2.70, 7.48),
                    (.45, 2.60, 7.32)]
        bands = ['enamel', 'enamel', 'rubber', 'enamel']
    _shell(m, [_outline(y, x, z, steps) for y, x, z in stations], bands)

    # The roof curves into the sides, while its bow slopes down beneath the
    # small raised helm. Side surfaces remain yellow, including coarse levels.
    canopy = [(.46, 2.60, 7.31, 0), (1.30, 2.54, 7.20, 0),
              (1.75, 2.38, 6.98, .20), (2.00, 2.06, 6.76, .45)]
    if level == 5:
        canopy = [canopy[0], canopy[1], canopy[-1]]
    _shell(m, [_outline(y, x, z, steps, dip) for y, x, z, dip in canopy],
           ['yellow'] * (len(canopy) - 1), 'yellow')

    # Two paired boarding-door sets on both sides. Even the flat fallback keeps
    # four separated small dark lights, the strongest near-broadside cue.
    for side in (-1, 1):
        for z in (-4.80, -3.48, 2.55, 3.87):
            if level < 5:
                _door(m, side, z)
            else:
                _side_panel(m, side, z - .22, z + .22, .12, 1.23,
                            'navy', stand=.055, depth=.012)

    # Bow helm is a compact opaque dark glazing solid with a small pale cap;
    # this static equipment has no accessible interior or transparent shader.
    m.box([-.80, 1.72, 5.67], [.80, 2.035, 6.58], 'navy', .09)
    m.box([-.84, 2.043, 5.63], [.84, 2.082, 6.62], 'enamel', .012)
    if level < 3:
        for x in (-.39, .39):
            m.box([x - .018, 1.76, 6.583], [x + .018, 2.03, 6.608], 'steel')

    if level < 2:
        # Thin hanging grablines below the rubrail, photographed on both sides.
        # LOD1 reduces their repetition; later levels omit this subpixel detail.
        count = 18 if level == 0 else 12
        for side in (-1, 1):
            for i in range(count):
                z = -5.65 + 11.3 * (i + .5) / count
                half = .23 if level == 0 else .34
                m.tube([(side * 2.715, -.53, z - half),
                        (side * 2.68, -.97, z - half * .65),
                        (side * 2.65, -1.16, z),
                        (side * 2.68, -.97, z + half * .65),
                        (side * 2.715, -.53, z + half)], .012, 'rubber', n=4)
        # Restrained roof seams and access hatches, clear of the recessed helm.
        for x in (-1.10, 1.10):
            m.tube([(x, 2.025, -5.4), (x, 2.025, 3.9)], .016, 'enamel', n=4)
        for z in (-3.6, .3):
            m.box([-.50, 2.012, z], [.50, 2.04, z + .75], 'orange', .008)
        # Short lifting eyes remain below the certified roof envelope.
        for z in (-6.54, 6.88):
            y = 1.58 if z > 0 else 1.74
            m.ring([0, y, z], [1, 0, 0], [0, 1, 0], .12, .17,
                   .025, 'steel', n=12 if level == 0 else 8)

    # Fail visibly if integration supplies an older, undersized collision box;
    # do not silently squash the manufacturer's corrected dimensions to fit.
    bounds = prototype.get('visualBounds', {'min': [-2.75, -2.1, -7.5],
                                          'max': [2.75, 2.1, 7.5]})
    for point in m.v[first_vertex:]:
        if any(point[k] < bounds['min'][k] - 1e-7 or
               point[k] > bounds['max'][k] + 1e-7 for k in range(3)):
            raise ValueError('lifeboat vertex outside corrected 15 x 5.5 x 4.2 m bounds: ' + str(point))
