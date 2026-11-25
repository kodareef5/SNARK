"""The craft's core (`core:ufo_core`), the crate a downed UFO throws clear of its wreck and anyone may loot: a glowing
column of its light in a cage of six ribs between a hexagonal plinth and cap, two containment rings round it. 1.8 m
across the plinth's corners and 1.6 m tall, standing on its origin, as the prop's radius and height (content/core.ts).
Its light is colour region 0, which is the prop's colour."""

import math

from kit import Mesh, frame, tiled, turn, uniform_angles
from shape import HULL_TILE, TRIM_TILE

RADIUS = 0.9
HEIGHT = 1.6


def hexagon(m, r0, y0, y1, chamfer, mat, top_glow=None):
    """A hexagonal block from y0 to y1, its corners at r0, its top and bottom edges chamfered. `top_glow`, a radius
    pair, sets a ring of light into its top."""
    a = uniform_angles(6, math.pi / 6)
    prof = [(0.0, y0), (r0 - chamfer, y0), (r0, y0 + chamfer), (r0, y1 - chamfer), (r0 - chamfer, y1)]
    if top_glow:
        prof += [(top_glow[1], y1), (top_glow[0], y1)]
    prof += [(0.0, y1)]
    for i in range(len(prof) - 1):
        p, q = prof[i], prof[i + 1]
        glow = top_glow is not None and abs(p[1] - y1) < 1e-6 and abs(q[1] - y1) < 1e-6 and p[0] <= top_glow[1] + 1e-6 and q[0] >= top_glow[0] - 1e-6 and p[0] > 0 and q[0] > 0
        turn(m, [p, q], a, lambda i, j, glow=glow: "glow" if glow else mat,
             tiled([p, q], a, 6, HULL_TILE if mat == "hull" else TRIM_TILE), smooth=False)


def core():
    m = Mesh()
    # Plinth and cap, each with a ring of light set into its face toward the column.
    hexagon(m, RADIUS, 0.0, 0.24, 0.04, "hull", (0.42, 0.6))
    cap = Mesh()
    hexagon(cap, 0.8, 0.0, 0.22, 0.04, "hull", (0.38, 0.54))
    # The cap is the plinth's shape turned over, its ring facing down.
    m.add(cap, frame((0.0, HEIGHT, 0.0), (0, -1, 0)))
    # The column of light: a long hexagonal crystal, pointed at both ends.
    col = [(0.0, 0.24), (0.17, 0.32), (0.33, 0.6), (0.36, 0.8), (0.33, 1.0), (0.17, 1.28), (0.0, HEIGHT - 0.22)]
    a6 = uniform_angles(6)
    turn(m, col, a6, lambda i, j: "glow", lambda i, j, k: ((j + (1 if k in (2, 3) else 0)) / 6, 0.5), smooth=False)
    # Six ribs bowed out between them, square in section.
    ribs = 7
    for k in range(6):
        t = k * math.tau / 6 + math.pi / 6
        pts = []
        for s in range(ribs + 1):
            f = s / ribs
            y = 0.22 + f * (HEIGHT - 0.44)
            r = 0.7 + 0.1 * math.sin(math.pi * f)
            pts.append((r, y))
        rib = Mesh()
        w = 0.065
        # A square tube along the bowed line, in the rib's own plane.
        rings = []
        for i, (r, y) in enumerate(pts):
            ring = []
            for (dr, dw) in ((-w, -w), (w, -w), (w, w), (-w, w)):
                ring.append(rib.vert((r + dr, y, dw)))
            rings.append(ring)
        for i in range(ribs):
            for q in range(4):
                q2 = (q + 1) % 4
                c = [rings[i][q], rings[i + 1][q], rings[i + 1][q2], rings[i][q2]]
                mid = [sum(rib.verts[v][d] for v in c) / 4 for d in range(3)]
                out = (mid[0] - pts[i][0], 0, mid[2])
                rib.face(c, [(0, i / ribs), (0, (i + 1) / ribs), (0.1, (i + 1) / ribs), (0.1, i / ribs)], "trim", out)
        rib.face(list(reversed(rings[0])), [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)], "trim", (0, -1, 0))
        rib.face(rings[-1], [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)], "trim", (0, 1, 0))
        m.add(rib, _turned(t))
    # Two containment rings round the column, each with light on its inner face.
    a = uniform_angles(24)
    for y in (0.55, 1.05):
        # Walked so its outside is on the right: in over the top, down the inner face, out under it, up the outer face.
        loop = [(0.6, y + 0.04), (0.5, y + 0.04), (0.5, y - 0.04), (0.6, y - 0.04)]
        for i in range(4):
            p, q = loop[i], loop[(i + 1) % 4]
            turn(m, [p, q], a, lambda i2, j, i=i: "glow" if i == 1 else "trim", lambda i2, j, k: ((j + (1 if k in (2, 3) else 0)) / 24 * 4, 0.5 if i == 1 else (k in (1, 2)) * 0.1), smooth=False)
    return m


def _turned(t):
    """The turn that takes the rib built in the x-y plane round the axis to the angle `t`."""
    from mathutils import Matrix
    return Matrix.Rotation(-t, 4, "Y")
