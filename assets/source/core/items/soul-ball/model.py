# The soul ball (planning/workstreams/soul-ball.md): "ball" (core:soul_ball, empty) and "ball_full" (core:soul_ball_full,
# with a tame in it). One shape, twice: an ivory ceramic orb in two brass meridian rings that cross at its poles, a dark
# seam round its equator, a machined collar and a lens at its top, a brass foot, and four small ports round its middle
# between the rings. The full one's lens and ports are lit; the empty one's are dark glass.
#
# Held pieces are modelled as the right hand holds them (tools/art/spec.ts, PieceSpec.hold): the grip at the origin, the
# length along +Z, the top along +Y. The orb is about the origin, as the grenade is, its lens out of the fist along +Z.
#
# Materials: "shell" and "lamp", both the Meridian suit's finish (../../humans/human-bodies/meridian/finish.png), a sheet
# of sixteen square tiles. Nothing here tiles: every face lies inside one tile of that sheet, by TILE below. "lamp" is the
# same pictures drawn glowing (asset.ts), and only the full ball's lens and ports wear it.

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weapons"))

from kit import V, Part  # noqa: E402

# The finish sheet's tiles, counted from its top left, four to a row (meridian/finish.py, `swatches`).
IVORY_MARKED = 8  # ivory ceramic with the navy tab and "M / 01"
IVORY_STRIPE = 15  # ivory ceramic with the offset stripe
COBALT = 4  # the dark blue interlayer: glass with nothing lit behind it
GLOW = 5  # the lamp's blue
PADS = 6  # rubber pads; its right fifth is brass
MACHINED = 14  # dark machined metal

R = 0.044  # the orb
AROUND = 20  # its facets round
RINGS = 10  # and from pole to pole


def tile(k, a, b):
    """A point of tile `k`, `a` across it from its left and `b` up it from its bottom, 0 to 1, as Blender lays a picture."""
    return ((k % 4 + a) / 4.0, 1.0 - (k // 4 + 1 - b) / 4.0)


def within(k, a0, a1, b0, b1):
    """A function from (a, b) in 0 to 1 to the rectangle of tile `k` from (a0, b0) to (a1, b1)."""
    return lambda a, b: tile(k, a0 + (a1 - a0) * a, b0 + (b1 - b0) * b)


BRASS = within(PADS, 0.84, 0.97, 0.05, 0.95)
DARK = within(MACHINED, 0.06, 0.94, 0.06, 0.94)


def orb(part):
    """
    The ceramic: longitude from +X toward +Y, so that from outside it runs to the right and the sheet's lettering reads.
    The half about +X wears the marked tile and the half about -X the striped one; they meet under the ring in the YZ
    plane, at +Y and -Y.
    """
    def at(i, j):
        lon = -math.pi / 2 + 2 * math.pi * i / AROUND
        lat = -math.pi / 2 + math.pi * j / RINGS
        return V(R * math.cos(lat) * math.cos(lon), R * math.cos(lat) * math.sin(lon), R * math.sin(lat))

    south = part.vert(at(0, 0))
    north = part.vert(at(0, RINGS))
    rows = [[part.vert(at(i, j)) for i in range(AROUND)] for j in range(1, RINGS)]
    half = AROUND // 2
    for i in range(AROUND):
        k = IVORY_MARKED if i < half else IVORY_STRIPE
        uv = within(k, 0.03, 0.97, 0.03, 0.97)
        a0, a1 = (i % half) / half, (i % half + 1) / half
        n = (i + 1) % AROUND
        part.add([south, rows[0][n], rows[0][i]], [uv((a0 + a1) / 2, 0), uv(a1, 1 / RINGS), uv(a0, 1 / RINGS)], "shell")
        for j in range(RINGS - 2):
            b0, b1 = (j + 1) / RINGS, (j + 2) / RINGS
            part.add([rows[j][i], rows[j][n], rows[j + 1][n], rows[j + 1][i]], [uv(a0, b0), uv(a1, b0), uv(a1, b1), uv(a0, b1)], "shell")
        part.add([rows[-1][i], rows[-1][n], north], [uv(a0, 1 - 1 / RINGS), uv(a1, 1 - 1 / RINGS), uv((a0 + a1) / 2, 1)], "shell")


def ring(part, e1, e2, radius, section, uv, mat="shell", n=AROUND, start=0.0):
    """
    A closed ring about the origin in the plane of the unit vectors `e1` and `e2`, its middle `radius` out. `section` is
    its outline counter-clockwise as (out from the middle, along e2 x e1). Its picture runs once round it, from `start`
    (a share of a turn, where its seam is), and across its outline.
    """
    e1, e2 = V(*e1), V(*e2)
    t = e2.cross(e1)
    m = len(section)
    edge = [math.dist(section[k], section[(k + 1) % m]) for k in range(m)]
    upto = [sum(edge[:k]) / sum(edge) for k in range(m + 1)]
    loops = []
    for i in range(n):
        phi = 2 * math.pi * (i / n + start)
        s = e1 * math.cos(phi) + e2 * math.sin(phi)
        loops.append([part.vert(s * (radius + a) + t * b) for a, b in section])
    for i in range(n):
        j = (i + 1) % n
        for k in range(m):
            q = (k + 1) % m
            part.add([loops[i][k], loops[i][q], loops[j][q], loops[j][k]],
                     [uv(upto[k], i / n), uv(upto[k + 1], i / n), uv(upto[k + 1], (i + 1) / n), uv(upto[k], (i + 1) / n)], mat)


def lathe(part, middle, axis, east, profile, n, side, cap, mat="shell", smooth=True):
    """
    A closed turning about the line from `middle` along `axis`: `profile` is (how far along, how far out) from its near
    end to its far one, `east` a unit vector across the axis that its facets are counted from. `side` lays the picture
    round it (a round, b along) and `cap` lays it flat on both ends (a and b across, the middle at a half).
    """
    middle, d, s = V(*middle), V(*axis), V(*east)
    t = d.cross(s)
    rows = []
    for h, r in profile:
        rows.append([part.vert(middle + d * h + (s * math.cos(2 * math.pi * i / n) + t * math.sin(2 * math.pi * i / n)) * r) for i in range(n)])
    span = [0.0]
    for (h0, r0), (h1, r1) in zip(profile, profile[1:]):
        span.append(span[-1] + math.hypot(h1 - h0, r1 - r0))
    for j in range(len(profile) - 1):
        b0, b1 = span[j] / span[-1], span[j + 1] / span[-1]
        for i in range(n):
            q = (i + 1) % n
            part.add([rows[j][i], rows[j][q], rows[j + 1][q], rows[j + 1][i]], [side(i / n, b0), side((i + 1) / n, b0), side((i + 1) / n, b1), side(i / n, b1)], mat, smooth)
    widest = max(r for _, r in profile)

    def flat(i, r):
        return cap(0.5 + 0.5 * r / widest * math.cos(2 * math.pi * i / n), 0.5 + 0.5 * r / widest * math.sin(2 * math.pi * i / n))

    # The near end is seen from behind the axis, so its corners run the other way round, and its picture with them.
    part.add([rows[0][i] for i in reversed(range(n))], [flat(i, profile[0][1]) for i in reversed(range(n))], mat, False)
    part.add([rows[-1][i] for i in range(n)], [flat(i, profile[-1][1]) for i in range(n)], mat, False)


def ball(name, lit):
    part = Part(name, ["shell", "lamp"] if lit else ["shell"])
    glass = "lamp" if lit else "shell"
    lens = within(GLOW if lit else COBALT, 0.12, 0.88, 0.12, 0.88)
    orb(part)
    # The two brass meridians: flat bands 9 mm wide standing 3 mm proud, their seams under the collar.
    band = [(0.0032, -0.0036), (0.0032, 0.0036), (-0.0014, 0.0045), (-0.0014, -0.0045)]
    ring(part, (1, 0, 0), (0, 0, 1), R, band, BRASS, start=0.25)
    ring(part, (0, 1, 0), (0, 0, 1), R, band, BRASS, start=0.25)
    # The seam round the equator, a dark bead the rings and the ports sit over.
    ring(part, (1, 0, 0), (0, 1, 0), R, [(0.0012, 0.0), (-0.0012, 0.0024), (-0.0012, -0.0024)], DARK)
    # The collar at the top, which the meridians run into, and the lens it holds.
    lathe(part, (0, 0, 0), (0, 0, 1), (1, 0, 0), [(0.0365, 0.0272), (0.0455, 0.0246), (0.0492, 0.0200)], 12, DARK, DARK)
    lathe(part, (0, 0, 0), (0, 0, 1), (1, 0, 0), [(0.0482, 0.0168), (0.0530, 0.0148), (0.0564, 0.0076)], 12, lens, lens, glass)
    # The brass foot it stands on.
    lathe(part, (0, 0, 0), (0, 0, 1), (1, 0, 0), [(-0.0505, 0.0105), (-0.0485, 0.0158), (-0.0415, 0.0192), (-0.0385, 0.0182)], 12, BRASS, BRASS)
    # Four ports round the middle, one between each pair of meridians: a brass seat and a small lens.
    for k in range(4):
        lon = math.pi / 4 + k * math.pi / 2
        out, east = (math.cos(lon), math.sin(lon), 0), (-math.sin(lon), math.cos(lon), 0)
        lathe(part, (0, 0, 0), out, east, [(R - 0.0020, 0.0086), (R + 0.0022, 0.0078)], 6, BRASS, BRASS, smooth=False)
        lathe(part, (0, 0, 0), out, east, [(R, 0.0056), (R + 0.0038, 0.0048)], 6, lens, lens, glass)
    return part


for p in (ball("ball", False), ball("ball_full", True)):
    p.build()
    print(f"{p.name}: {p.triangles()} triangles")
