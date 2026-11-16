# The wood tier's pieces, built to the concept in ref/concept/: a frame of hewn
# timber, pegged and bolted; weatherboards of uneven width with wavy lower edges,
# nailed at both ends and lapped bay by bay; floors of loose-laid boards on beams;
# iron where weight bears. Each piece fills the boxes of content/building.ts, and
# nothing stands out of them by more than a sill, a peg or a door ring.
#
# Levels: 0 is everything, hewn and bowed; 1 is the same boards, straight, on
# squared timbers, without pegs or most iron, still with its pictures; 2 is a few
# boxes in flat colours; 3 is the plainest solid. Every piece draws its randomness
# from its own seeds, so it is the same each build.

import math
import random

from mathutils import Matrix, Vector

from parts import BOARD_NAILS, BOARD_ROLL_V, TONES, H, Piece, band_v, beam, bent, cell_uv, custom, floor_board, grid, iron, lap_board, stud, timber, widths

WALL_T = 0.1  # half the wall's thickness
PLATE_T = 0.09  # posts and plates
SILL_T = 0.095
TOP_T = 0.1  # the top plate, the heaviest member, out to the wall's faces
JAMB_T = 0.096  # jambs, lintels and window timbers stand a little proud
MID_T = 0.087  # a wall's middle post stands a little back
BRACE_T = 0.08
BOARD_TOP = 0.04  # a weatherboard's face at its top, and at its lapped lower edge
BOARD_LIP = 0.074
ROW = 0.25  # the boards and deck pictures have twelve boards to their 3 m tile
POST = 0.14  # half a corner post: two walls side by side make a 0.28 m post
MID = 0.08  # half a wall's middle post
PLATE = 0.24
SILL = 0.22
STRAP = 0.0625
DROP = 0.02  # the top plate stands this far under the wall's top, and the sill reaches as far under its foot: a wall on a wall still meets it, and a ceiling's deck covers the plate
ROUGH = 0.011  # how far a hewn timber strays from true
WAVE = 0.016  # how far a board's lower edge wanders
SINK = 0.03  # a pillar's top stands this far under its box, and a foundation's bearer reaches as far below its own
DOOR_W, DOOR_H = 1.4, 2.3125
DOOR_BOTTOM = -H
DOOR_TOP = DOOR_BOTTOM + DOOR_H
WIN_W, WIN_SILL, WIN_H = 1.2, 1.2, 0.7
WIN_BOTTOM = -H + WIN_SILL
WIN_TOP = WIN_BOTTOM + WIN_H
Z = (0, 0, 1)
Y = (0, 1, 0)
PEG_UV = cell_uv(3, 0)


def named(base, level):
    return base + (f"_LOD{level}" if level else "")


def member(p, level, a, b, w, h, up, bands, end=None, seed=0, rough=ROUGH, along0=0.0):
    """A timber: hewn and chamfered on the finest level, squared on the next, and
    in one of the timber tones on the flat ones."""
    if level == 0:
        timber(p, a, b, w, h, up, bands, end=end, rough=rough, seed=seed, along0=along0)
    else:
        timber(p, a, b, w, h, up, bands, end=end, chamfer=0.0, along0=along0, mat="timber" if level == 1 else TONES["timber"][seed % 2])


def bay(p, x0, x1, z0, z1, seed, level, u0=0.0, flat="boards"):
    """Weatherboards across one bay between two posts, from z0 on the sill to z1
    under the plate, on both faces. Each board is its own width, its lower edge
    wanders, and some are two lengths butted together. The boards picture has nail
    columns every 1.5 m; each board is laid on it so a column falls 6 cm inside
    each of its ends, where it is nailed to the post."""
    if level >= 2:
        p.box((x0, -BOARD_TOP - 0.01, z0), (x1, BOARD_TOP + 0.01, z1), lambda label, lo, hi: (flat, lambda q: (0, 0)))
        return
    rng = random.Random(seed)
    n = max(1, round((z1 - z0) / 0.25))
    z = z0
    for k, w in enumerate(widths(rng, z1 - z0, n, 0.2)):
        row = min(11, max(0, int((z + w / 2 + H) / ROW)))
        lip = BOARD_LIP + rng.uniform(-0.005, 0.003)
        top = min(z + w + 0.03, z1) if k < n - 1 else z1
        spans = [(x0, x1)]
        if level == 0 and x1 - x0 > 0.9 and rng.random() < 0.17:
            cut = x0 + (x1 - x0) * rng.uniform(0.3, 0.7)
            spans = [(x0, cut - 0.002), (cut + 0.002, x1)]
        for a, b in spans:
            length = b - a
            if level == 0:
                rings = 4 if length > 0.5 else 3
                xs = [a + length * i / (rings - 1) for i in range(rings)]
                wander = lambda: rng.uniform(-WAVE, WAVE)
            else:
                xs = [a, b]
                wander = lambda: 0.0
            # The lowest board sits on the sill: it may only rise.
            zbs = [z + (abs(wander()) if k == 0 else wander()) for _ in xs]
            # Nail columns of the picture at u0 and u0 + 0.5, 6 cm in from each end.
            start, finish = u0 - 0.06 / 3, u0 + 0.5 + 0.06 / 3
            us = [start + (finish - start) * (x - a) / length for x in xs]
            lap_board(p, xs, zbs, w, top, lip, BOARD_TOP, row, us)
        z += w


def bolts(p, points, face, level, radius=0.018, out=0.012):
    """Hex bolt heads, iron, on both faces."""
    if level:
        return
    for x, z in points:
        for s in (-1, 1):
            stud(p, (x, s * face, z), (0, s, 0), radius, out, 4, uv=(0.31, 0.34))


def pegs(p, points, face, level, radius=0.016, out=0.01):
    """The square ends of oak pegs driven through a joint, on both faces."""
    if level:
        return
    for x, z in points:
        for s in (-1, 1):
            stud(p, (x, s * face, z), (0, s, 0), radius, out, 4, uv=PEG_UV)


def strap_z(p, x, z0, z1, face, kind="rivets"):
    """An upright iron strap on both faces of a member whose faces are at ±face."""
    for s in (-1, 1):
        y0, y1 = sorted((s * (face - 0.004), s * (face + 0.006)))
        p.box((x - STRAP / 2, y0, z0), (x + STRAP / 2, y1, z1), iron("z", kind, z0))


def plates(p, level, top_band, sill_band, seed, sill_spans=((-H, H),)):
    """The top plate the whole span, and the sill under the bays."""
    zt = (H - PLATE + H - DROP) / 2
    member(p, level, (-H, 0, zt), (H, 0, zt), 2 * TOP_T, PLATE - DROP, Z, (top_band, top_band + 1, top_band, top_band + 2), (0, 0), seed)
    zs = (-H - DROP + -H + SILL) / 2
    for i, (a, b) in enumerate(sill_spans):
        member(p, level, (a, 0, zs), (b, 0, zs), 2 * SILL_T, SILL + DROP, Z, (sill_band, sill_band + 1, sill_band, sill_band + 2), (1, 0), seed + 1 + i, along0=a + H)


def corner_posts(p, level, bands, seed):
    for s, band in zip((-1, 1), bands):
        x = s * (H - POST / 2)
        member(p, level, (x, 0, -H + SILL), (x, 0, H - PLATE), POST, 2 * PLATE_T, Y, (band, band, band + 1, band + 1), (2, 0), seed + s, ROUGH * 0.5, along0=SILL)
    if level < 3:
        # Past each end, a strip a little smaller than the sill, post and top plate it
        # runs past: in a straight run it lies inside the next piece's end; where two
        # walls meet outside it fills the square their ends would leave open, up to
        # the top. It stops 4 mm inside each face it could meet and stands 8 mm in from
        # its own, and its top and foot slope away along it, so where two meet at a
        # corner their faces cross and none lie in one plane.
        spans = ((-H - DROP + 0.004, -H + SILL, SILL_T), (-H + SILL, H - PLATE, PLATE_T), (H - PLATE, H - DROP - 0.004, TOP_T))
        if level == 2:
            spans = ((-H - DROP + 0.004, H - DROP - 0.004, PLATE_T),)
        slope = 0.012
        for s, band in zip((-1, 1), bands):
            for n, (z0, z1, face) in enumerate(spans):
                near, far = s * H, s * (H + face - 0.004)
                d = face - 0.008
                corners = {}
                for i, x in ((0, near), (1, far)):
                    lo = z0 + (slope * i if n == 0 else 0)
                    hi = z1 - (slope * i if n == len(spans) - 1 else 0)
                    for j, y in ((0, -d), (1, d)):
                        corners[(i, j, 0)] = Vector((x, y, lo))
                        corners[(i, j, 1)] = Vector((x, y, hi))
                p.block(corners, beam("z", band))


def knee(p, level, a, b, band, seed, curve=0.0):
    """A knee brace from a post up to the plate, bolted at both ends; with `curve`
    it is arched, bowing toward the corner it braces."""
    a, b = Vector((a[0], 0, a[1])), Vector((b[0], 0, b[1]))
    if level == 0 and curve:
        corner = Vector((a.x, 0, b.z))
        path = []
        for i in range(6):
            t = i / 5
            mid = (a + b) / 2 + (corner - (a + b) / 2) * curve
            path.append(a * (1 - t) ** 2 + mid * 2 * t * (1 - t) + b * t * t)
        bent(p, path, 0.1, 2 * BRACE_T, Y, band)
    else:
        member(p, level, a, b, 0.09, 2 * BRACE_T, Y, (band, band + 1, band, band + 1), seed=seed)
    d = (b - a).normalized()
    ends = [a + d * 0.12, b - d * 0.12]
    (pegs if curve else bolts)(p, [(q.x, q.z) for q in ends], BRACE_T, level)


def wall(level):
    p = Piece(named("wall", level), surface=level < 2)
    if level == 3:
        p.box((-H, -WALL_T, -H), (H, WALL_T, H), grid("boards"))
        return p.done()
    plates(p, level, 4, 9, 100)
    corner_posts(p, level, (1, 7), 110)
    member(p, level, (0, 0, -H + SILL), (0, 0, H - PLATE), 2 * MID, 2 * MID_T, Y, (5, 5, 6, 6), (3, 0), 120, ROUGH * 0.5, along0=SILL)
    for s, band in ((-1, 2), (1, 10)):
        knee(p, level, (s * (H - POST), 0.62), (s * 0.78, H - PLATE), band, 130 + s)
    bay(p, -H + POST - 0.02, -MID + 0.02, -H + SILL, H - PLATE, 140, level, 0.0)
    bay(p, MID - 0.02, H - POST + 0.02, -H + SILL, H - PLATE, 141, level, 0.5, "boards_b")
    if level == 0:
        for x in (-H + POST / 2, H - POST / 2):
            strap_z(p, x, -H + 0.04, -H + SILL + 0.3, PLATE_T)
        pegs(p, [(-H + POST / 2, H - PLATE / 2 - 0.01), (H - POST / 2, H - PLATE / 2 - 0.01), (0, H - PLATE / 2 - 0.01), (0, -H + SILL / 2)], TOP_T, level)
    return p.done()


def doorframe(level):
    p = Piece(named("doorframe", level), surface=level < 2)
    jamb = 0.18
    xj = DOOR_W / 2
    lintel_top = 1.0
    reach = xj + jamb + 0.15
    if level == 3:
        p.box((-H, -WALL_T, -H), (-xj, WALL_T, H), grid("boards"))
        p.box((xj, -WALL_T, -H), (H, WALL_T, H), grid("boards"))
        p.box((-xj, -WALL_T, DOOR_TOP), (xj, WALL_T, H), grid("boards"))
        return p.done()
    plates(p, level, 5, 9, 200, ((-H, -xj - jamb), (xj + jamb, H)))
    corner_posts(p, level, (1, 7), 210)
    for s, band in ((-1, 8), (1, 3)):
        x = s * (xj + jamb / 2)
        member(p, level, (x, 0, -H), (x, 0, DOOR_TOP), jamb, 2 * JAMB_T, Y, (band, band, band + 1, band + 1), (3, 0), 220 + s, ROUGH * 0.6)
    zl = (DOOR_TOP + lintel_top) / 2
    member(p, level, (-reach, 0, zl), (reach, 0, zl), 2 * JAMB_T + 0.004, lintel_top - DOOR_TOP, Z, (6, 7, 6, 8), (0, 1), 230, along0=H - reach)
    member(p, level, (0, 0, lintel_top), (0, 0, H - PLATE), 0.14, 2 * MID_T, Y, (11, 11, 10, 10), None, 231, ROUGH * 0.4)
    for s, band in ((-1, 10), (1, 2)):
        knee(p, level, (s * (H - POST), 0.5), (s * (reach - 0.06), H - PLATE), band, 240 + s, curve=0.45)
    bay(p, -H + POST - 0.02, -xj - jamb + 0.02, -H + SILL, H - PLATE, 250, level, 0.0)
    bay(p, xj + jamb - 0.02, H - POST + 0.02, -H + SILL, H - PLATE, 251, level, 0.5, "boards_b")
    bay(p, -xj - jamb, -0.05, lintel_top, H - PLATE, 252, level, 0.25)
    bay(p, 0.05, xj + jamb, lintel_top, H - PLATE, 253, level, 0.75, "boards_b")
    if level == 0:
        for x in (-H + POST / 2, H - POST / 2):
            strap_z(p, x, -H + 0.04, -H + SILL + 0.3, PLATE_T)
        pegs(p, [(s * (xj + jamb / 2), zl + dz) for s in (-1, 1) for dz in (-0.045, 0.045)] + [(0, H - PLATE / 2 - 0.01)], JAMB_T + 0.002, level)
        # The pintles the door hangs on, on the left jamb as seen from the front, and
        # the keeper its latch drops into, on the right.
        for z in (DOOR_BOTTOM + DOOR_H / 2 - 0.82, DOOR_BOTTOM + DOOR_H / 2 + 0.82):
            p.box((-xj, -0.066, z - 0.035), (-xj + 0.018, -0.03, z + 0.035), iron("x", "plate", -xj))
        p.box((xj - 0.016, -0.07, -0.25), (xj, -0.03, -0.17), iron("x", "plate", xj - 0.016))
    return p.done()


def windowframe(level):
    """The window is framed by its own jambs, a head and a sill whose horns run
    past them, with a short stud above and below; full bays either side."""
    p = Piece(named("windowframe", level), surface=level < 2)
    jamb = 0.15
    xw = WIN_W / 2
    reach = xw + jamb + 0.17
    sill_bottom, head_top = WIN_BOTTOM - 0.13, WIN_TOP + 0.17
    if level == 3:
        p.box((-H, -WALL_T, -H), (H, WALL_T, H), grid("boards"))
        return p.done()
    plates(p, level, 11, 3, 300)
    corner_posts(p, level, (5, 0), 310)
    for s, band in ((-1, 8), (1, 2)):
        x = s * (xw + jamb / 2)
        member(p, level, (x, 0, WIN_BOTTOM), (x, 0, WIN_TOP), jamb, 2 * JAMB_T, Y, (band, band, band + 1, band + 1), (3, 1), 320 + s, ROUGH * 0.4)
    for z0, z1, band, seed in ((-H + SILL, sill_bottom, 9, 322), (head_top, H - PLATE, 4, 323)):
        member(p, level, (0, 0, z0), (0, 0, z1), 2 * MID * 0.8, 2 * MID_T, Y, (band, band, band + 1, band + 1), None, seed, ROUGH * 0.4)
    # The window sill stands out past the boards to both faces of the wall.
    zs = (sill_bottom + WIN_BOTTOM) / 2
    member(p, level, (-reach, 0, zs), (reach, 0, zs), 0.2, WIN_BOTTOM - sill_bottom, Z, (6, 7, 6, 7), (2, 1), 330, along0=H - reach)
    zh = (WIN_TOP + head_top) / 2
    member(p, level, (-reach + 0.03, 0, zh), (reach - 0.03, 0, zh), 2 * JAMB_T + 0.008, head_top - WIN_TOP, Z, (1, 2, 1, 3), (0, 1), 331, along0=H - reach)
    for s, band in ((-1, 10), (1, 4)):
        knee(p, level, (s * (H - POST), 0.74), (s * (reach + 0.02), H - PLATE), band, 340 + s)
    edge = H - POST + 0.02
    side = xw + jamb - 0.02
    mid = MID * 0.8 - 0.02
    bay(p, -edge, -side, -H + SILL, H - PLATE, 350, level, 0.0)
    bay(p, side, edge, -H + SILL, H - PLATE, 351, level, 0.5, "boards_b")
    bay(p, -side - 0.02, -mid, -H + SILL, sill_bottom, 352, level, 0.25, "boards_b")
    bay(p, mid, side + 0.02, -H + SILL, sill_bottom, 353, level, 0.75)
    bay(p, -side - 0.02, -mid, head_top, H - PLATE, 354, level, 0.25)
    bay(p, mid, side + 0.02, head_top, H - PLATE, 355, level, 0.75, "boards_b")
    if level == 0:
        for x in (-H + POST / 2, H - POST / 2):
            strap_z(p, x, -H + 0.04, -H + SILL + 0.3, PLATE_T)
        pegs(p, [(s * (xw + jamb / 2), zh) for s in (-1, 1)] + [(s * (reach - 0.07), zh) for s in (-1, 1)], JAMB_T + 0.004, level)
        pegs(p, [(s * (xw + jamb / 2), zs) for s in (-1, 1)] + [(s * (reach - 0.07), zs) for s in (-1, 1)], 0.1, level, out=0.004)
    return p.done()


def deck(p, top, thick, under, level, seed):
    """Floorboards across the whole cell, running along X: on the finest level
    twelve of uneven width over a boarded underlay, their ends falling short of the
    edge by up to a centimetre and their tops not quite level."""
    bottom = top - thick

    def mapping(label, lo, hi):
        if label in ("-x", "+x"):
            return "deck", lambda q: (0.1 + (q.z - lo.z) / 3, (q.y + H) / 3)
        if label == "-z":
            return under, lambda q: ((q.x + H) / 3, (H - q.y) / 3)
        return grid("deck")(label, lo, hi)

    if level >= 2:
        p.box((-H, -H, bottom), (H, H, top), mapping)
        return
    rng = random.Random(seed)
    y = -H
    for k, w in enumerate(widths(rng, 2 * H, 12, 0.2)):
        if level == 0:
            x0, x1 = -H + rng.uniform(0, 0.012), H - rng.uniform(0, 0.012)
            floor_board(p, x0, x1, y, y + w, top, thick, k, rng, lift=rng.uniform(-0.0025, 0.0))
        else:
            floor_board(p, -H, H, y, y + w, top, thick, k, rng, cup=0.0, edge=0.01)
        y += w
    p.box((-H + 0.015, -H + 0.015, bottom - 0.012), (H - 0.015, H - 0.015, bottom + 0.004), mapping)


def foundation(level):
    """A deck of floorboards on a crib of heavy timbers: half-lapped corner blocks
    showing end grain on alternate faces, two courses of hewn beams between them,
    and iron dogs bolted round each corner. The blocks reach a little into the
    ground; nothing of the crib breaks through the deck, so many tiles make one
    floor."""
    p = Piece(named("foundation", level), surface=level < 2)
    top, bottom = 0.1875, -0.1875
    thick = 0.05
    if level == 3:
        p.box((-H, -H, bottom), (H, H, top), grid("deck"))
        return p.done()
    deck(p, top, thick, "deck", level, 400)
    blk = 0.24
    r, w = 1.49, 0.2
    mid = (bottom + top - thick) / 2
    # Each corner is half-lapped: a short block running each way, one over the
    # other, so end grain shows on the two faces in turn.
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        for k, (z0, z1) in enumerate(((bottom - SINK, mid), (mid, top - thick))):
            zc = (z0 + z1) / 2
            if (k + i) % 2 == 0:
                a, b = (sx * (H - blk), sy * (H - blk / 2), zc), (sx * (H - 0.002), sy * (H - blk / 2), zc)
            else:
                a, b = (sx * (H - blk / 2), sy * (H - blk), zc), (sx * (H - blk / 2), sy * (H - 0.002), zc)
            member(p, level, a, b, blk - 0.004, z1 - z0, Z, (3, 4, 5, 6), ((i + k) % 4, 1), 410 + 2 * i + k, ROUGH * 0.4)
    inner = H - blk
    for c, (z0, z1) in enumerate(((bottom, mid), (mid, top - thick)) if level < 2 else ((bottom, top - thick),)):
        zc, hgt = (z0 + z1) / 2, z1 - z0
        for s, band in ((-1, 3 + c), (1, 7 + c)):
            y = s * (r - w / 2)
            member(p, level, (-inner, y, zc), (inner, y, zc), w, hgt, Z, (band, band + 2, band, band + 4), None, 420 + c * 4 + s, along0=blk)
            x = s * (r - w / 2)
            member(p, level, (x, -inner, zc), (x, inner, zc), w, hgt, Z, (band + 1, band + 3, band + 1, band + 5), None, 430 + c * 4 + s, along0=blk)
    if level < 2:
        # A bearer under the middle, for a pillar to stand under.
        member(p, level, (-inner, 0, (bottom - SINK + top - thick) / 2), (inner, 0, (bottom - SINK + top - thick) / 2), 0.2, top - thick - bottom + SINK, Z, (5, 6, 5, 6), seed=440)
    if level == 0:
        t = 0.008
        for sx in (-1, 1):
            for sy in (-1, 1):
                for zc in (mid - 0.075, mid + 0.075):
                    x0, x1 = sorted((sx * (H + t - 0.006), sx * (H - blk - 0.12)))
                    y0, y1 = sorted((sy * (H + t - 0.006), sy * (H - 0.008)))
                    p.box((x0, y0, zc - 0.03), (x1, y1, zc + 0.03), iron("x", "plate", x0))
                    x0, x1 = sorted((sx * (H + t - 0.006), sx * (H - 0.008)))
                    y0, y1 = sorted((sy * (H - 0.008), sy * (H - blk - 0.12)))
                    p.box((x0, y0, zc - 0.03), (x1, y1, zc + 0.03), iron("y", "plate", y0))
                    stud(p, (sx * (H - 0.3), sy * (H + t - 0.004), zc), (0, sy, 0), 0.014, 0.008, 4, uv=(0.31, 0.34))
                    stud(p, (sx * (H + t - 0.004), sy * (H - 0.3), zc), (sx, 0, 0), 0.014, 0.008, 4, uv=(0.31, 0.34))
    return p.done()


def ceiling(level):
    """Floorboards over four hewn joists inside a rim of beams, with an end-grain
    block at each corner; the joists' ends show in the rim, and the underside of
    the boards is the ceiling of the room below. Its next level is the deck as one
    board on the rim, blocks and joists, still with its pictures."""
    p = Piece(named("ceiling", level), surface=level < 2)
    top, bottom = 0.125, -0.115
    thick = 0.05
    if level == 2:
        # Down to halfway between the boards' underside and the joists' foot.
        p.box((-H, -H, (bottom + top - thick) / 2), (H, H, top), grid("deck"))
        return p.done()
    deck(p, top, thick, "boards", 2 * level, 500)
    r, w = 1.49, 0.16
    z1 = top - thick
    zc, hgt = (bottom + z1) / 2, z1 - bottom
    inner = r - w
    for s, band in ((-1, 2), (1, 6)):
        member(p, level, (-inner, s * (r - w / 2), zc), (inner, s * (r - w / 2), zc), w, hgt, Z, (band, band + 1, band, band + 3), None, 510 + s, along0=H - inner)
        member(p, level, (s * (r - w / 2), -inner, zc), (s * (r - w / 2), inner, zc), w, hgt, Z, (band + 3, band + 4, band + 3, band + 5), None, 520 + s, along0=H - inner)
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        c = (sx * (r - w / 2), sy * (r - w / 2))
        member(p, level, (c[0], c[1], bottom), (c[0], c[1], z1), w, w, Y, (4, 5, 6, 7), None, 525 + i, ROUGH * 0.3)
    for i, (x, band) in enumerate(((-0.9, 11), (-0.3, 5), (0.3, 8), (0.9, 1))):
        member(p, level, (x, -inner, zc + 0.012), (x, inner, zc + 0.012), 0.13, hgt - 0.024, Z, (band, band + 1, band, band + 1), None, 530 + i, along0=H - inner)
    if level == 0:
        # The joists' ends, flush in the rim.
        for s in (-1, 1):
            for x in (-0.9, -0.3, 0.3, 0.9):
                y0, y1 = sorted((s * r, s * (r + 0.005)))
                p.box((x - 0.065, y0, zc - 0.07), (x + 0.065, y1, zc + 0.07), custom("timber", lambda label, q, lo, hi, x=x: (0.4 + (q.z - zc) / 3, band_v(int(x * 4) % 12) + (q.x - x) / 3)))
    return p.done()


def pillar(level):
    """A hewn post on a flared plinth, under a head that flares and then steps out
    into a cross of short arms, bolted through with iron plates: a post made to
    carry a beam each way."""
    p = Piece(named("pillar", level), surface=level < 2)
    if level == 3:
        p.box((-0.25, -0.25, -H), (0.25, 0.25, H), beam("z", 7))
        return p.done()
    half = 0.18
    top = H - SINK
    if level < 2:
        def flare(levels, band):
            rings = []
            for z, h in levels:
                c = min(0.03, h / 4)
                rings.append([Vector((x, y, z)) for x, y in ((h, -h + c), (h, h - c), (h - c, h), (-h + c, h), (-h, h - c), (-h, -h + c), (-h + c, -h), (h - c, -h))])

            def side(k, i, j):
                q = rings[i][j]
                return "timber", ((q.z + H) / 3, band_v(band + k // 2) + (q.x + q.y) / 6)

            def cap(i, j):
                q = rings[i][j]
                cu, cv = cell_uv(1, 0)
                return "fittings", (cu + q.x / 2, cv + q.y / 2)

            p.loft(rings, side, cap)

        flare([(-H, 0.245), (-H + 0.24, 0.245), (-H + 0.3, 0.19)], 3)
        flare([(H - 0.52, 0.19), (H - 0.42, 0.205), (top, 0.205)], 8)
        for k, band in ((0, 2), (1, 9)):
            a, b = (Vector((-0.247, 0, 0)), Vector((0.247, 0, 0))) if k == 0 else (Vector((0, -0.247, 0)), Vector((0, 0.247, 0)))
            z = top - 0.115
            member(p, level, a + Vector((0, 0, z)), b + Vector((0, 0, z)), 0.16 - 0.004 * k, 0.23 - 0.004 * k, Z, (band, band + 1, band, band + 1), (2 + k, 0), 601 + k, ROUGH * 0.3)
    else:
        p.box((-0.245, -0.245, -H), (0.245, 0.245, -H + 0.29), beam("x", 3))
        p.box((-0.205, -0.205, H - 0.51), (0.205, 0.205, top), beam("x", 8))
        p.box((-0.247, -0.08, top - 0.23), (0.247, 0.08, top), beam("x", 2))
        p.box((-0.078, -0.247, top - 0.226), (0.078, 0.247, top - 0.002), beam("y", 9))
    if level == 0:
        timber(p, (0, 0, -H + 0.29), (0, 0, H - 0.51), 2 * half, 2 * half, Y, (5, 6, 7, 8), chamfer=0.026, rough=ROUGH * 1.2, seed=600)
    else:
        member(p, level, (0, 0, -H + 0.29), (0, 0, H - 0.51), 2 * half, 2 * half, Y, (5, 6, 7, 8), None, 600)
    if level == 0:
        for z in (-H + 0.46,):
            e = half + 0.008
            p.box((-e, -e, z - STRAP / 2), (e, e, z + STRAP / 2), iron("x", "nails", -e))
        for n in (Vector((0, -1, 0)), Vector((0, 1, 0))):
            y0, y1 = sorted((n.y * 0.203, n.y * 0.214))
            p.box((-0.17, y0, H - 0.4), (0.17, y1, H - 0.33), iron("x", "plate", -0.17))
            for x in (-0.12, 0.12):
                stud(p, (x, n.y * 0.214, H - 0.365), n, 0.014, 0.008, 4, uv=(0.31, 0.34))
        for n in (Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0))):
            stud(p, n * 0.247 + Vector((0, 0, top - 0.115)), n, 0.016, 0.008, 4, uv=PEG_UV)
    return p.done()


# The door: five thick upright boards whose edges wander, so the gaps between
# them open and close; ledged and braced on the back; strap hinges on knuckles,
# a latch and a pull on the front. The front is -Y, the side it opens toward,
# and it hangs on its left (-X) edge.
DOOR_ROWS = (10, 3, 7, 0, 4)  # rows of the boards picture with no butt joint


def door_mesh(name, level, transform=None):
    p = Piece(named(name, level), surface=level < 2)
    hw, hh = DOOR_W / 2, DOOR_H / 2
    front, back = -0.036, 0.006
    if level == 3:
        p.box((-hw, -0.04, -hh), (hw, 0.04, hh), grid("boards"))
        return p.done(transform)
    rng = random.Random(700)
    if level < 2:
        ws = widths(rng, DOOR_W, len(DOOR_ROWS), 0.16)
        edges = [-hw]
        for w in ws:
            edges.append(edges[-1] + w)
        zs = [-hh + (hh * 2) * i / 4 for i in range(5)] if level == 0 else [-hh, hh]
        # Each inner edge wanders, the same for the boards either side of it, with a gap between.
        wander = [[0.0] * len(zs)] + [[rng.uniform(-0.007, 0.007) if level == 0 else 0.0 for _ in zs] for _ in edges[1:-1]] + [[0.0] * len(zs)]
        for j, row in enumerate(DOOR_ROWS):
            v0, v1 = row / 12 - BOARD_ROLL_V, (row + 1) / 12 - BOARD_ROLL_V
            c = 0.007
            rings = []
            for i, z in enumerate(zs):
                gl = 0.0 if j == 0 else 0.0025 + abs(wander[j][i]) * 0.3
                gr = 0.0 if j == len(DOOR_ROWS) - 1 else 0.0025 + abs(wander[j + 1][i]) * 0.3
                x0 = edges[j] + wander[j][i] + gl
                x1 = edges[j + 1] + wander[j + 1][i] - gr
                if i == 0:
                    z = -hh + (rng.uniform(0, 0.014) if level == 0 else 0)
                if i == len(zs) - 1:
                    z = hh - (rng.uniform(0, 0.008) if level == 0 else 0)
                sec = [(x0 + c, front), (x1 - c, front), (x1, front + c), (x1, back - c), (x1 - c, back), (x0 + c, back), (x0, back - c), (x0, front + c)]
                rings.append([Vector((x, y, z)) for x, y in sec])
            x0n, x1n = edges[j], edges[j + 1]

            mat = "boards"

            def side(k, i, jj, x0=x0n, x1=x1n, v0=v0, v1=v1, rings=rings, mat=mat):
                q = rings[i][jj]
                t = (q.x - x0) / (x1 - x0)
                if k in (6, 7, 0):  # the front face and the edges round it, nailed on the ledges
                    return mat, (BOARD_NAILS + (q.z + 0.82) / 3.28, v0 + t * (v1 - v0))
                return mat, ((H - q.z) / 3 + 0.3, v1 - t * (v1 - v0))

            def cap(i, jj, x0=x0n, v0=v0, rings=rings, mat=mat):
                q = rings[i][jj]
                return mat, (0.5 + (q.x - x0) / 3, v0 + (q.y - front) / 3)

            p.loft(rings, side, cap)
    else:
        p.box((-hw, front, -hh), (hw, back, hh), custom("boards", lambda label, q, lo, hi: ((q.z + H) / 3, (q.x + hw) / 3 + 0.04)))
    # Two ledges behind the hinge straps, and one brace between them rising from
    # the hinge side to the latch side, so it bears on the lower hinge.
    ledge = 0.18
    xs = hw - 0.025
    rails = (-hh + 0.34, hh - 0.34)
    for i, (z, band) in enumerate(zip(rails, (3, 11))):
        member(p, level, (-xs, (back + 0.04) / 2, z), (xs, (back + 0.04) / 2, z), 0.04 - back, ledge, Z, (band, band + 1, band, band + 1), None, 710 + i, ROUGH * 0.4)
    a = (-xs + 0.1, (back + 0.036) / 2, rails[0] + ledge / 2 + 0.03)
    b = (xs - 0.1, (back + 0.036) / 2, rails[1] - ledge / 2 - 0.03)
    member(p, level, a, b, 0.11, 0.036 - back, Y, (1, 1, 2, 2), None, 720, ROUGH * 0.4)
    if level < 2:
        for z in rails:
            # A strap hinge, tapering to a spade tip, on a knuckle at the door's edge.
            tip = 0.3
            outline = [(-hw, z - 0.035), (tip - 0.14, z - 0.022), (tip - 0.02, z - 0.016), (tip + 0.03, z), (tip - 0.02, z + 0.016), (tip - 0.14, z + 0.022), (-hw, z + 0.035)]
            p.extrude([(zz, xx) for xx, zz in outline], "y", -0.043, front + 0.004, iron("x", "rivets", -hw))
            stud(p, (-hw + 0.004, -0.05, z - 0.06), (0, 0, 1), 0.016, 0.12, 6, uv=(0.2, 0.43))
    if level == 0:
        for z in rails:
            for x in (-0.48, -0.18, 0.12):
                stud(p, (x, -0.043, z), (0, -1, 0), 0.011, 0.007, 4, uv=(0.31, 0.34))
        for z in rails:
            for j in range(len(DOOR_ROWS)):
                x = -hw + (j + 0.5) * DOOR_W / len(DOOR_ROWS)
                if x > 0.2:
                    stud(p, (x + 0.05, front, z + 0.04), (0, -1, 0), 0.006, 0.004, 4, uv=(0.31, 0.34))
    zp = -0.25
    if level < 2:
        # A latch bar over a keeper, and a D-shaped pull below it.
        zl, xl = 0.02, 0.38
        p.box((xl, -0.046, zl - 0.012), (hw + 0.012, front + 0.004, zl + 0.012), iron("x", "strap", xl))
        p.box((xl - 0.03, -0.044, zl - 0.04), (xl + 0.01, front + 0.004, zl + 0.04), iron("x", "plate", xl - 0.03))
        p.box((0.47, -0.042, zp - 0.12), (0.53, front + 0.004, zp + 0.12), iron("x", "plate", 0.47))
        for dz in (-0.08, 0.08):
            p.box((0.488, -0.075, zp + dz - 0.011), (0.512, -0.04, zp + dz + 0.011), iron("y", "strap", -0.075))
        p.box((0.488, -0.085, zp - 0.09), (0.512, -0.07, zp + 0.09), iron("z", "strap", zp - 0.09))
        p.box((0.47, back - 0.004, zp - 0.1), (0.53, 0.016, zp + 0.1), iron("x", "plate", 0.47))
    if level == 0:
        p.ring((0.5, 0.025, zp - 0.03), 0.045, 0.008, iron("x", "strap", 0.4))
    return p.done(transform)


def door(level):
    return door_mesh("door", level)


def door_open(level):
    # A quarter turn on the hinge: the door stands out along -Y from the doorway's left.
    m = Matrix.Translation((-DOOR_W / 2 + 0.04, -DOOR_W / 2, 0)) @ Matrix.Rotation(math.radians(-90), 4, "Z")
    return door_mesh("door_open", level, m)


# Stairs: ten steps up toward -Y (the engine's +Z): plank treads with a nosing over
# boarded risers, between two hewn stringers, solid underneath as the collision
# is, its sides and back framed like a wall.
STEPS = 10


def stairs(level):
    p = Piece(named("stairs", level), surface=level < 2)
    run = rise = 3.0 / STEPS
    s = 1.42
    nose, tread = 0.025, 0.05
    if level == 3:
        # The flight's slope midway between the steps' noses and their roots.
        p.extrude([(H, -H), (H, -H + rise / 2), (-H + run / 2, H), (-H, H), (-H, -H)], "x", -H, H, grid("boards"))
        return p.done()
    cut, back = (tread, nose) if level == 0 else (0.0, 0.0)
    rear = -H + 0.06  # the solid's back stands in behind the frame and under the top tread

    def solid(label, lo, hi):
        if label in ("-x", "+x"):
            # The sides are boarded upright.
            return "boards", lambda q: ((q.z + H) / 3, (q.y + H) / 3 * (1 if label == "+x" else -1) + 0.5)
        return grid("deck" if label == "+z" else "boards")(label, lo, hi)

    # The solid, (y, z) counter-clockwise seen from +X: along the floor toward
    # +Y, up the first riser, then up the steps to the back, and down the back.
    outline = [(rear, -H), (H - back, -H)]
    for i in range(STEPS):
        y_front = H - i * run - back
        z_top = -H + (i + 1) * rise - cut
        if i > 0:
            outline.append((y_front, z_top - rise))
        outline.append((y_front, z_top))
    outline.append((rear, H - cut))
    p.extrude(outline, "x", -s, s, solid)
    if level == 0:
        rng = random.Random(800)
        for i in range(STEPS):
            z_top = -H + (i + 1) * rise
            # Each tread two planks across the stair, along X: the wider at the nosing.
            y_back, y_nose = H - (i + 1) * run, H - i * run
            seam = y_nose - 0.17
            for y0, y1, nose_edge in ((y_back, seam - 0.0015, False), (seam + 0.0015, y_nose, True)):
                row = rng.randrange(12)
                e = 0.012 if nose_edge else 0.004
                sag = rng.uniform(0, 0.002)
                treads = [[Vector((x, y, z)) for y, z in ((y0, z_top - tread), (y1, z_top - tread), (y1, z_top - e), (y1 - e, z_top - sag), (y0 + 0.004, z_top - sag), (y0, z_top - 0.005))] for x in (-s + rng.uniform(0, 0.01), s - rng.uniform(0, 0.01))]

                def side(k, ii, jj, treads=treads, y0=y0, y1=y1, row=row):
                    q = treads[ii][jj]
                    return "deck", ((q.x + H) / 3, (row + (q.y - y0) / (y1 - y0)) / 12)

                def cap(ii, jj, treads=treads, y0=y0, y1=y1, row=row):
                    q = treads[ii][jj]
                    return "deck", (0.1 + q.z / 3, (row + (q.y - y0) / (y1 - y0)) / 12)

                p.loft(treads, side, cap)
    hi_line = 0.05 + rise
    outline = [(H, -H), (H, -H + hi_line), (-H + hi_line, H), (-H, H)]
    for x0, x1, band in ((-H, -s, 2), (s, H, 9)):

        def stringer(label, lo, hi, band=band):
            def uv(q):
                along = ((H - q.y) + (q.z + H)) / math.sqrt(2)
                across = (q.z + q.y) / math.sqrt(2)
                return (along / 3, band_v(band) + (across - hi_line / math.sqrt(2) / 2) / 3)

            return "timber", uv

        p.extrude(outline, "x", x0, x1, stringer)
    if level < 2:
        sill = -H + 0.18
        for i, sx in enumerate((-1, 1)):
            x = sx * 1.42
            member(p, level, (x, -H, (-H + sill) / 2), (x, H - 0.03, (-H + sill) / 2), 0.12, sill + H, Z, (4, 5, 4, 5) if sx < 0 else (8, 9, 8, 9), None, 810 + i)
            member(p, level, (x, -H + 0.1, sill), (x, -H + 0.1, H - tread), 0.12, 0.2, (1, 0, 0), (6, 6, 7, 7), None, 812 + i, ROUGH * 0.5)
            member(p, level, (x, 0, sill), (x, 0, 0.12), 0.12, 0.2, (1, 0, 0), (11, 11, 3, 3), None, 814 + i, ROUGH * 0.5)
        member(p, level, (-1.36, -H + 0.03, (-H + sill) / 2), (1.36, -H + 0.03, (-H + sill) / 2), 0.05, sill + H, Z, (7, 7, 7, 7), None, 816)
        member(p, level, (-1.36, -H + 0.035, 0), (1.36, -H + 0.035, 0), 0.05, 0.18, Z, (10, 10, 10, 10), None, 817)
        member(p, level, (0, -H + 0.03, sill), (0, -H + 0.03, H - tread), 0.18, 0.06, (0, 1, 0), (5, 5, 5, 5), None, 818, ROUGH * 0.4)
    return p.done()


PIECES = {
    "foundation": foundation,
    "wall": wall,
    "doorframe": doorframe,
    "windowframe": windowframe,
    "ceiling": ceiling,
    "pillar": pillar,
    "door": door,
    "door_open": door_open,
    "stairs": stairs,
}

# The ceiling goes from its second level straight to its plainest.
for name, build in PIECES.items():
    for level in range(3 if name == "ceiling" else 4):
        build(level)
