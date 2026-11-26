"""The craft's three parts, as meshes in the game's axes about its middle (shape.py has the numbers):

- `craft()`, what stands still: the hull from the lens in its belly round under it, up its edge and over the top to the
  crown of its dome, the mast, and the lenses under it;
- `rim()`, the knife-edged ring round it, which turns slowly, its edge a ring of lights broken into segments;
- `ring()`, the ring under its belly, which turns fast round the lens, its nodes of light under it.

The client draws each as a piece of its own (client/core/mapevent/craft.ts) and turns the two rings.
"""

import math

from kit import Mesh, TAU, arcs, frame, puck, sector_angles, tiled, turn, uniform_angles
from shape import (
    BAND_HIGH, BAND_IN_HIGH, BAND_IN_LOW, BAND_LOW, BELLY_EDGE, CHANNEL_WALL, COLUMNS, CROWN, DOME_CURVE, FLEX, HULL_AROUND,
    HULL_TILE, LENS, LIP, LIP_CURVE, MAST_IN, MAST_LOW, MAST_TIP, RIM_GAP, RIM_SEGMENTS, RING_IN, RING_LOW, RING_NODES,
    RING_OUT, RING_TOP, RADIUS, SCALE_R, SECTORS, STEP_HIGH, STEP_LOW, STRIP, TOP_IN, TRIM_AROUND, TRIM_TILE, UNDER_CURVE,
    TOP_CURVE, cut, length,
)

ANGLES = sector_angles(COLUMNS, SECTORS)
PER_SECTOR = len(COLUMNS)
# The sector columns a window fills (shape.WINDOW): from the third column's start to the last's.
WINDOW_COLS = range(2, 6)
# The hull's edge, where the rim's channel is; the rim stands proud of the hull's surface by this much.
RIM_PROUD = 0.03


def sample(points, count, marks=()):
    """Points along a polyline at `count` even steps and at the arc lengths `marks` besides, and their arc lengths."""
    s = arcs(points)
    total = s[-1]
    want = sorted(set([total * i / count for i in range(count + 1)] + [m for m in marks if 0 < m < total]))
    # Two steps closer than a centimetre are one.
    kept = [want[0]]
    for w in want[1:]:
        if w - kept[-1] > 0.01:
            kept.append(w)
    kept[-1] = total
    out = []
    j = 0
    for w in kept:
        while j < len(points) - 2 and s[j + 1] < w:
            j += 1
        seg = s[j + 1] - s[j]
        t = 0.0 if seg <= 0 else (w - s[j]) / seg
        a, b = points[j], points[j + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out, kept


def at_radius(points, r):
    """Where a polyline going outward crosses `r`, and its outward normal there."""
    for a, b in zip(points, points[1:]):
        if (a[0] - r) * (b[0] - r) <= 0 and a[0] != b[0]:
            t = (r - a[0]) / (b[0] - a[0])
            tx, ty = b[0] - a[0], b[1] - a[1]
            l = math.hypot(tx, ty)
            return (r, a[1] + ty * t), (ty / l, -tx / l)
    raise ValueError(r)


def at_length(points, s):
    a = arcs(points)
    for i in range(len(points) - 1):
        if a[i + 1] >= s:
            t = (s - a[i]) / max(1e-9, a[i + 1] - a[i])
            p, q = points[i], points[i + 1]
            return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
    return points[-1]


def glow_uv(angles, across):
    """A uv_of for light: along the strip round the axis, `across(row, corner)` from 0 to 1 across it (the picture is
    brightest in its middle)."""
    cols = len(angles)

    def uv(i, j, k):
        col = j + (1 if k in (2, 3) else 0)
        t = angles[col] if col < cols else angles[0] + TAU
        return (t / TAU * 64, across(i, j, k))

    return uv


def column_across(i, j, k):
    """Across a glowing channel one column wide: 0 at its column's start, 1 at its end."""
    return 1.0 if k in (2, 3) else 0.0


def edge():
    """The hull's under side and top, cut at the channel the rim turns in."""
    under, _ = cut(UNDER_CURVE, CHANNEL_WALL)
    inner, _ = cut(list(reversed(TOP_CURVE)), CHANNEL_WALL)
    return under, list(reversed(inner))


def craft():
    parts = craft_parts()
    m = parts["hull"]
    for name in ("mast", "tip", "lenses"):
        m.add(parts[name])
    return m


def craft_parts(hull="hull"):
    """The craft as its separate closed parts: the turned hull, the mast, the light at its tip and the lenses. `hull`
    names the material the hull's plating wears (the wreck's is `burnt`)."""
    m = Mesh()
    a = ANGLES
    belly = BELLY_EDGE[1]

    def hull_run(points, mat_of=None, v0=0.0):
        turn(m, points, a, mat_of or (lambda i, j: hull), tiled(points, a, HULL_AROUND, HULL_TILE, v0))

    def trim_run(points, smooth=True):
        turn(m, points, a, lambda i, j: "trim", tiled(points, a, TRIM_AROUND, TRIM_TILE), smooth=smooth)

    # The lens in its belly, domed a little below the ceiling round it, brightest in its middle.
    lens = [(LENS * k / 4, belly - 0.16 * (1 - (k / 4) ** 2)) for k in range(5)]
    turn(m, lens, a, lambda i, j: "glow", glow_uv(a, lambda i, j, k: 0.5))
    # Its bezel, a sharp-edged ring, and the dark ceiling of the recess out to the lip.
    bezel = [(LENS, belly), (LENS + 0.06, belly - 0.12), (LENS + 0.24, belly - 0.12), (LENS + 0.3, belly)]
    for p, q in zip(bezel, bezel[1:]):
        trim_run([p, q], smooth=False)
    ceiling, _ = sample([(LENS + 0.3, belly), (BELLY_EDGE[0], belly)], 2)
    trim_run(ceiling, smooth=False)
    trim_run([(BELLY_EDGE[0], belly), (LIP[0], LIP[1])], smooth=False)
    # The lip round the recess and out to the step.
    lip, _ = sample(LIP_CURVE, 6)
    hull_run(lip)
    # The step: a skirt of light between two bands of trim.
    skirt = [STEP_LOW, None, None, STEP_HIGH]
    skirt[1] = tuple(STEP_LOW[k] + (STEP_HIGH[k] - STEP_LOW[k]) * 0.25 for k in range(2))
    skirt[2] = tuple(STEP_LOW[k] + (STEP_HIGH[k] - STEP_LOW[k]) * 0.75 for k in range(2))
    turn(m, skirt, a, lambda i, j: "glow" if i == 1 else "trim",
         lambda i, j, k: glow_uv(a, lambda i, j, k: 1.0 if k in (1, 2) else 0.0)(i, j, k) if i == 1 else tiled(skirt, a, TRIM_AROUND, TRIM_TILE)(i, j, k),
         smooth=False)
    # Under the hull to its edge, and the edge's wall the rim turns against.
    under, top = edge()
    under, _ = sample(under, 10)
    hull_run(under)
    trim_run([under[-1], top[0]], smooth=False)
    # Over the top to the band: a ring of light at FlexUnit's crest, and a channel of light down each sector's edge.
    ring_at = math.dist(top[0], top[0]) + sum(math.dist(p, q) for p, q in zip(top, top[1:]) if p[0] > TOP_IN[0])
    top, s = sample(top, 16, (ring_at - STRIP * 0.6, ring_at + STRIP * 0.6))
    ring_rows = {i for i in range(len(s) - 1) if s[i] >= ring_at - STRIP * 0.61 and s[i + 1] <= ring_at + STRIP * 0.61}

    def top_mat(i, j):
        return "glow" if i in ring_rows or j % PER_SECTOR == 0 else hull

    hull_uv = tiled(top, a, HULL_AROUND, HULL_TILE)
    ring_uv = glow_uv(a, lambda i, j, k: 1.0 if k in (1, 2) else 0.0)
    chan_uv = glow_uv(a, column_across)
    turn(m, top, a, top_mat, lambda i, j, k: ring_uv(i, j, k) if i in ring_rows else chan_uv(i, j, k) if j % PER_SECTOR == 0 else hull_uv(i, j, k))
    # The band under the dome: a bezel, windows in the even sectors, a bezel.
    trim_run([BAND_LOW, BAND_IN_LOW], smooth=False)
    band_len = math.dist(BAND_IN_LOW, BAND_IN_HIGH)
    band, bs = sample([BAND_IN_LOW, BAND_IN_HIGH], 1, (0.09, band_len - 0.09))

    def band_mat(i, j):
        sector, col = divmod(j, PER_SECTOR)
        return "glow" if i == 1 and sector % 2 == 0 and col in WINDOW_COLS else "trim"

    band_trim = tiled(band, a, TRIM_AROUND, TRIM_TILE)
    band_glow = glow_uv(a, lambda i, j, k: 1.0 if k in (1, 2) else 0.0)
    turn(m, band, a, band_mat, lambda i, j, k: band_glow(i, j, k) if band_mat(i, j) == "glow" else band_trim(i, j, k), smooth=False)
    trim_run([BAND_IN_HIGH, BAND_HIGH], smooth=False)
    # The dome to its crown, a ring of light round its top.
    dome_len = length(DOME_CURVE)
    crown_at = dome_len - 1.7
    dome, ds = sample(DOME_CURVE, 16, (crown_at - 0.09, crown_at + 0.09))
    crown_rows = {i for i in range(len(ds) - 1) if ds[i] >= crown_at - 0.091 and ds[i + 1] <= crown_at + 0.091}
    dome_trim = tiled(dome, a, TRIM_AROUND, TRIM_TILE)
    turn(m, dome, a, lambda i, j: "glow" if i in crown_rows else "trim", lambda i, j, k: ring_uv(i, j, k) if i in crown_rows else dome_trim(i, j, k))

    # The mast and the light at its tip.
    mast = Mesh()
    ma = uniform_angles(10)
    prof = [(0.0, CROWN[1] - 0.3), (MAST_LOW[0], CROWN[1] - 0.3), (MAST_LOW[0], MAST_LOW[1]), (MAST_IN[0], MAST_IN[1]), (MAST_TIP[0], MAST_TIP[1] - 0.05), (0.0, MAST_TIP[1] - 0.05)]
    for p, q in zip(prof, prof[1:]):
        turn(mast, [p, q], ma, lambda i, j: "trim", tiled([p, q], ma, 2, TRIM_TILE), smooth=False)
    tip = Mesh()
    ball = [(0.13 * math.sin(math.pi * k / 4), -0.13 * math.cos(math.pi * k / 4)) for k in range(5)]
    turn(tip, ball, ma, lambda i, j: "glow", glow_uv(ma, lambda i, j, k: 0.5))
    tip_at = Mesh()
    tip_at.add(tip, frame((0.0, MAST_TIP[1] + 0.05, 0.0), (0, 1, 0)))
    lenses = Mesh()

    # FlexUnit's lenses under it, where it put them: one ring on the lip, one on the cone out to the edge.
    for lens_ring in sorted({(l["r"], l["size"]) for l in FLEX["lights"]["lenses"]}):
        r = lens_ring[0] * SCALE_R
        size = lens_ring[1] * SCALE_R
        curve = LIP_CURVE if r < STEP_LOW[0] else UNDER_CURVE
        (pr, py), (nr, ny) = at_radius(curve, r)
        lens_mesh = puck(size * (0.42 if r > STEP_LOW[0] else 0.5), 0.16, 0.06, 10)
        for k in range(SECTORS):
            t = (k + 0.5) * TAU / SECTORS
            origin = (pr * math.cos(t), py, pr * math.sin(t))
            up = (nr * math.cos(t), ny, nr * math.sin(t))
            lenses.add(lens_mesh, frame(origin, up, (-math.sin(t), 0, math.cos(t))))
    return {"hull": m, "mast": mast, "tip": tip_at, "lenses": lenses}


def rim(hull="hull"):
    """The ring round the hull's edge: from its inner face, a hair outside the hull's wall, out under the hull's line to
    the knife edge and back over the top, standing a little proud of the hull. Its edge is light in segments."""
    m = Mesh()
    a = uniform_angles(RIM_SEGMENTS * 3)
    _, under = cut(UNDER_CURVE, CHANNEL_WALL)
    inner, _ = cut(list(reversed(TOP_CURVE)), CHANNEL_WALL)
    over = list(reversed(_))
    # Proud of the hull's line, and in from it at the inner face so that the two do not meet.
    def lift(points, sign):
        # Proud of the hull at its inner face, and on its line again at the knife edge.
        return [(r, y + sign * RIM_PROUD * (RADIUS - r) / (RADIUS - CHANNEL_WALL)) for r, y in points]

    under = lift(under, -1)
    over = lift(over, 1)
    under[0] = (CHANNEL_WALL + 0.02, under[0][1] + RIM_GAP)
    over[-1] = (CHANNEL_WALL + 0.02, over[-1][1] - RIM_GAP)
    tip = 0.1
    ul = length(under)
    under, us = sample(under, 6, (ul - tip,))
    ol = length(over)
    over, os_ = sample(over, 6, (tip,))
    under_glow = {i for i in range(len(us) - 1) if us[i] >= ul - tip - 1e-6}
    over_glow = {i for i in range(len(os_) - 1) if os_[i + 1] <= tip + 1e-6}

    def lit(j):
        return j % 3 != 2

    for run, glows, flip in ((under, under_glow, False), (over, over_glow, True)):
        hull_uv = tiled(run, a, RIM_SEGMENTS, HULL_TILE)
        uvg = glow_uv(a, (lambda i, j, k: 1.0 if k in (1, 2) else 0.0) if not flip else (lambda i, j, k: 0.0 if k in (1, 2) else 1.0))

        def mat(i, j, glows=glows):
            return "glow" if i in glows and lit(j) else hull

        def uv(i, j, k, glows=glows, hull_uv=hull_uv, uvg=uvg):
            return uvg(i, j, k) if i in glows and lit(j) else hull_uv(i, j, k)

        turn(m, run, a, mat, uv)
    # The inner face, hidden in the channel.
    wall = [over[-1], under[0]]
    turn(m, wall, a, lambda i, j: "trim", tiled(wall, a, RIM_SEGMENTS, TRIM_TILE), smooth=False)
    return m


def ring():
    """The ring that turns under the belly round its lens: a dark band with nodes of light under it and a dashed track
    of light between them."""
    m = Mesh()
    a = uniform_angles(96)
    mid = 0.5 * (RING_IN + RING_OUT)
    loop = [
        (RING_IN, RING_TOP), (RING_OUT, RING_TOP), (RING_OUT + 0.05, RING_TOP - 0.06), (RING_OUT + 0.05, RING_LOW + 0.06),
        (RING_OUT, RING_LOW), (mid + 0.12, RING_LOW), (mid - 0.12, RING_LOW), (RING_IN, RING_LOW),
        (RING_IN - 0.05, RING_LOW + 0.06), (RING_IN - 0.05, RING_TOP - 0.06),
    ]
    # Walked round its section so its outside is on the right: inward over the top, outward under it.
    loop = list(reversed(loop))
    n = len(loop)
    for i in range(n):
        p, q = loop[i], loop[(i + 1) % n]
        track = abs(p[1] - RING_LOW) < 1e-6 and abs(q[1] - RING_LOW) < 1e-6 and min(p[0], q[0]) > mid - 0.13 and max(p[0], q[0]) < mid + 0.13
        if track:
            turn(m, [p, q], a, lambda i, j: "glow" if j % 4 < 2 else "trim",
                 lambda i, j, k: (glow_uv(a, lambda i, j, k: 1.0 if k in (1, 2) else 0.0) if j % 4 < 2 else tiled([p, q], a, 24, TRIM_TILE))(i, j, k), smooth=False)
        else:
            turn(m, [p, q], a, lambda i, j: "trim", tiled([p, q], a, 24, TRIM_TILE), smooth=False)
    node = puck(0.26, 0.1, 0.08, 10)
    for k in range(RING_NODES):
        t = (k + 0.5) * TAU / RING_NODES
        m.add(node, frame((mid * math.cos(t), RING_LOW, mid * math.sin(t)), (0, -1, 0), (-math.sin(t), 0, math.cos(t))))
    return m
