# The far level of every tree, level 5: what the far layer draws of it from the near store's hand-over band (152 to 184
# m on medium) out to kilometres (client/core/render/farnodes.ts, D259, D352), its reach cut by its triangles. Each is a
# few closed solids in flat colours made to the box, colours and masses of the level drawn in that band, level 3, so the
# two dissolve between overlapping shapes and a tree keeps its size, its spot and its tone.
#
# A broadleaf crown is two rings of three, one low and wide and one at its shoulders turned a sixth, roofed over the
# heads of its two halves: its roof in a lit tone and its sides in a darker, on its trunk; fourteen faces. farcheck.py
# measures the pixels it shares with level 3 at 170 m: this shape 65 to 74 in a hundred (a mangrove 54 to 73), a ring
# roofed from a third of the way up 52 to 70, as its sides met the near crown's only at its waist. Tried before and seen
# in the wood: two upright octahedra read as diamonds on a hill, a lens of three rings of three as cut crystal, clumps
# tipped as leaves lie as shards seen from above, and one low dome as a tent once the far level came as near as 150 m.

import math
from itertools import combinations, combinations_with_replacement

from kit import Mesh, add, cross, dot, mul, rng_for, sub, unit

LEVEL = 5


def solid(m, tris):
    """Triangles (three points and a colour) wound alike, as one closed solid: turned over if that winding looks in."""
    volume = sum(dot(a, cross(b, c)) for (a, b, c), _ in tris)
    for (a, b, c), colour in tris:
        m.face([m.point(a), m.point(b), m.point(c)] if volume > 0 else [m.point(a), m.point(c), m.point(b)], colour)


def fin(m, foot, head, width, turn, colour):
    """A trunk or post as one triangle seen from both sides, from `width` across at its buried foot to a point in the
    crown."""
    across = (math.cos(turn) * width / 2, 0.0, math.sin(turn) * width / 2)
    a, b = add(foot, across), sub(foot, across)
    m.face([m.point(a), m.point(b), m.point(head)], colour)
    m.face([m.point(b), m.point(a), m.point(head)], colour)


def crown(near, colours, stem, trunk, seed, low=0.05, high=0.7, wide=1.2, shoulder=1.35, posts=(), stilts=None):
    """A broadleaf tree's far level made to its level 3, `near`, whose crown wears `colours`: a ring of three points
    `low` of the way up the crown and one `high` up turned a sixth from it, each `wide` or `shoulder` times as far out
    as the crown reaches that way about that height, for a triangle's sides cut inside a round crown; the shoulders
    roofed over two heads, the tops of the crown's two halves, so its outline is two masses and not a dome, and the low
    ring closed flat. The roof in one flat tone and the sides in a darker, the pair of level 3's colours whose mix
    comes nearest its; on a trunk `trunk` across drawn as one face both sides, on `posts` ((x, z), radius, depth) so
    drawn, or on `stilts` (reach, colour). Fourteen faces, two more a post."""
    m = Mesh(False)
    (_, y0, _), _ = box_of(near)
    lo, hi = box_of(near, colours)
    pts = [near.points[i] for idx, mat, _, _ in near.faces if mat in colours for i in idx]
    centre = ((lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2)
    tall = hi[1] - lo[1]
    turn = rng_for(seed, "far").uniform(0, 2 * math.pi / 3)
    a = reach_ring(pts, centre, lo[1] + low * tall, turn, wide, 0.15 * tall)
    b = reach_ring(pts, centre, lo[1] + high * tall, turn + math.pi / 3, shoulder, 0.15 * tall)
    heads = tops(pts, b)
    roof = roofed(b, heads)
    sides = [t for k in range(3) for t in ((a[k], a[(k + 1) % 3], b[k]), (b[k], b[(k + 1) % 3], a[(k + 1) % 3]))]
    inside = (centre[0], lo[1] + 0.4 * tall, centre[1])
    tris = [outward(t, inside) for t in roof + sides + [(a[0], a[1], a[2])]]
    upper, lower = tones(near, colours, [tris], len(roof))
    for i, t in enumerate(tris):
        m.face([m.point(p) for p in t], upper if i < len(roof) else lower)
    axis = math.atan2(heads[1][2] - heads[0][2], heads[1][0] - heads[0][0])
    if stilts is None:
        fin(m, (0.0, y0, 0.0), (0.0, lo[1] + 0.25 * tall, 0.0), 2 * trunk, axis + math.pi / 2, stem)
    else:
        # A mangrove's cage: a three-sided pyramid of stilts `reach` out, from under the crown, closed below the ground.
        reach, colour = stilts
        apex = (centre[0], lo[1] + 0.15 * tall, centre[1])
        base = [(reach * math.cos(t), y0, reach * math.sin(t)) for t in (axis + 2 * math.pi * k / 3 for k in range(3))]
        solid(m, [((apex, base[k], base[(k + 1) % 3]), colour) for k in range(3)] + [((base[2], base[1], base[0]), colour)])
    for (px, pz), pr, depth in posts:
        fin(m, (px, depth, pz), (px, lo[1] + 0.3, pz), 2 * pr, axis, stem)
    return m


def outward(t, inside):
    """A triangle wound to face away from a point inside its solid."""
    a, b, c = t
    middle = tuple((a[k] + b[k] + c[k]) / 3 for k in range(3))
    return t if dot(cross(sub(b, a), sub(c, a)), sub(middle, inside)) > 0 else (a, c, b)


def tops(pts, ring):
    """The tops of a crown's two halves: the points of its upper third split in two on the ground (k-means from the
    two farthest apart), each half's middle at its highest point, drawn in towards the middle of `ring` till well
    inside it, so the roof's edge is the ring."""
    floor = min(p[1] for p in pts)
    top = max(p[1] for p in pts)
    upper = [p for p in pts if p[1] > top - (top - floor) / 3]
    farthest = lambda q: max(upper, key=lambda p: (p[0] - q[0]) ** 2 + (p[2] - q[2]) ** 2)
    first = farthest(farthest(upper[0]))
    centres = [(first[0], first[2]), (farthest(first)[0], farthest(first)[2])]
    for _ in range(10):
        halves = [[], []]
        for p in upper:
            halves[min((0, 1), key=lambda k: (p[0] - centres[k][0]) ** 2 + (p[2] - centres[k][1]) ** 2)].append(p)
        centres = [(sum(p[0] for p in h) / len(h), sum(p[2] for p in h) / len(h)) if h else c for h, c in zip(halves, centres)]
    mid = (sum(p[0] for p in ring) / len(ring), sum(p[2] for p in ring) / len(ring))
    heads = []
    for c, h in zip(centres, halves):
        k = 1.0
        while k > 0.05 and not within(ring, (mid[0] + (c[0] - mid[0]) * k / 0.8, mid[1] + (c[1] - mid[1]) * k / 0.8)):
            k *= 0.85
        heads.append((mid[0] + (c[0] - mid[0]) * k, max((p[1] for p in h), default=top), mid[1] + (c[1] - mid[1]) * k))
    return heads


def within(ring, p):
    """Whether the point (x, z) lies inside the ring of points, convex seen from above."""
    sides = [(b[0] - a[0]) * (p[1] - a[2]) - (b[2] - a[2]) * (p[0] - a[0]) for a, b in zip(ring, ring[1:] + ring[:1])]
    return all(s > 0 for s in sides) or all(s < 0 for s in sides)


def tones(near, colours, solids, upper_count=3):
    """Of the near level's colours, the lighter and darker pair for the far level's upper and under faces whose mix by
    area, as the faces lie seen from the side, comes nearest the mix the near level's crown faces make by theirs. The
    first `upper_count` faces of each solid are its upper ones."""
    def mix_of(faces):
        acc, total = [0.0, 0.0, 0.0], 0.0
        for (a, b, c), colour in faces:
            n = cross(sub(b, a), sub(c, a))
            area = math.sqrt(dot(n, n)) / 2
            # Seen from the side, a face counts as much as it faces the level ways.
            seen = area * math.sqrt(max(0.0, 1 - (n[1] / max(2 * area, 1e-9)) ** 2))
            acc = [x + seen * y for x, y in zip(acc, linear(colour))]
            total += seen
        return [x / max(total, 1e-9) for x in acc]

    want = mix_of([([near.points[i] for i in idx], mat) for idx, mat, _, _ in near.faces if mat in colours and len(idx) == 3])
    light, mid, dark = colours
    best = None
    for upper, under in ((light, mid), (light, dark), (mid, dark)):

        got = mix_of([(t, upper if i < upper_count else under) for s in solids for i, t in enumerate(s)])
        err = sum((a - b) ** 2 for a, b in zip(got, want))
        if best is None or err < best[0]:
            best = (err, upper, under)
    return best[1], best[2]


def delaunay(pts):
    """The triangles of the Delaunay triangulation of a few points on the ground (x, z), as index triples."""
    out = []
    n = len(pts)
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                (ax, az), (bx, bz), (cx, cz) = pts[i], pts[j], pts[k]
                d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz))
                if abs(d) < 1e-9:
                    continue
                ux = ((ax * ax + az * az) * (bz - cz) + (bx * bx + bz * bz) * (cz - az) + (cx * cx + cz * cz) * (az - bz)) / d
                uz = ((ax * ax + az * az) * (cx - bx) + (bx * bx + bz * bz) * (ax - cx) + (cx * cx + cz * cz) * (bx - ax)) / d
                r2 = (ax - ux) ** 2 + (az - uz) ** 2
                if all((p[0] - ux) ** 2 + (p[1] - uz) ** 2 >= r2 - 1e-9 for q, p in enumerate(pts) if q not in (i, j, k)):
                    out.append((i, j, k))
    return out


def roofed(ring, peaks):
    """A roof over a ring of points, convex seen from above, to `peaks` within it standing above it: its faces facing
    up."""
    pts = ring + peaks
    up = (0.0, 1.0, 0.0)
    tris = []
    for i, j, k in delaunay([(p[0], p[2]) for p in pts]):
        a, b, c = pts[i], pts[j], pts[k]
        tris.append((a, b, c) if dot(cross(sub(b, a), sub(c, a)), up) > 0 else (a, c, b))
    return tris


def reach_ring(pts, centre, height, turn, scale, band):
    """Three points round a crown at `height`, each `scale` times as far out from `centre` (x, z) as the crown's
    points within `band` of that height reach that way."""
    near = [p for p in pts if abs(p[1] - height) < band] or pts
    out = []
    for k in range(3):
        a = turn + 2 * math.pi * k / 3
        d = (math.cos(a), math.sin(a))
        r = max(0.3, max((p[0] - centre[0]) * d[0] + (p[2] - centre[1]) * d[1] for p in near)) * scale
        out.append((centre[0] + d[0] * r, height, centre[1] + d[1] * r))
    return out


def palm(near, crown, foot, hub, r_foot, r_head, tips, stem, spread):
    """A palm, twelve faces: a stem from its buried `foot` to the `hub` of its crown, following its lean, and a star of
    three of level 4's fronds (`tips`, their drooping ends), each a blade from the hub out to its end `spread` radians
    across with both sides drawn. The three are those that reach nearest as far each way as level 4's fronds (its faces
    in the colours `crown`), and the star is stretched on the ground from the hub to reach exactly so far; their
    greens are those whose mean is nearest the mean of level 4's fronds."""
    m = Mesh(False)
    lo, hi = box_of(near, crown)
    # Where the young fronds stand above the hub, the star's middle is raised to their tips.
    hub = (hub[0], max(hub[1], hi[1]), hub[2])
    column(m, foot, hub, r_foot, r_head, stem)

    def blade(tip):
        out = sub(tip, hub)
        turned = lambda a: (hub[0] + out[0] * math.cos(a) - out[2] * math.sin(a), tip[1], hub[2] + out[0] * math.sin(a) + out[2] * math.cos(a))
        return (hub, turned(-spread / 2), turned(spread / 2))

    def scales(blades):
        """How far the star is stretched each way on x and z to meet level 4's reach: x less, x more, z less, z more."""
        pts = [p for b in blades for p in b]
        return [(lo[k] - hub[k]) / min(min(p[k] for p in pts) - hub[k], -1e-3) for k in (0, 2)] + [(hi[k] - hub[k]) / max(max(p[k] for p in pts) - hub[k], 1e-3) for k in (0, 2)]

    best = min(combinations([blade(t) for t in tips], 3), key=lambda bs: max(abs(math.log(max(s, 1e-3))) for s in scales(bs)))
    xl, zl, xm, zm = scales(best)
    stretch = lambda p: (hub[0] + (p[0] - hub[0]) * (xm if p[0] > hub[0] else xl), p[1], hub[2] + (p[2] - hub[2]) * (zm if p[2] > hub[2] else zl))
    for (a, b, c), colour in zip(best, nearest_mix(near, crown, 3)):
        a, b, c = stretch(a), stretch(b), stretch(c)
        m.face([m.point(a), m.point(b), m.point(c)], colour)
        m.face([m.point(a), m.point(c), m.point(b)], colour)
    return m


def linear(name):
    """A flat colour's name, f<rrggbb>, as linear red, green and blue."""
    c = [int(name[k : k + 2], 16) / 255 for k in (1, 3, 5)]
    return [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]


def nearest_mix(mesh, colours, n):
    """`n` of the colours `mesh` wears among `colours` whose mean comes nearest the mean of its faces in them by area."""
    acc, total = [0.0, 0.0, 0.0], 0.0
    worn = set()
    for idx, mat, _, _ in mesh.faces:
        if mat not in colours:
            continue
        worn.add(mat)
        p = [mesh.points[i] for i in idx]
        for k in range(1, len(p) - 1):
            area = 0.5 * math.sqrt(sum(v * v for v in cross(sub(p[k], p[0]), sub(p[k + 1], p[0]))))
            acc = [a + area * c for a, c in zip(acc, linear(mat))]
            total += area
    want = [a / total for a in acc]
    mixes = combinations_with_replacement(sorted(worn), n)
    return min(mixes, key=lambda mix: sum((sum(linear(c)[k] for c in mix) / n - want[k]) ** 2 for k in range(3)))


def column(m, foot, head, r_foot, r_head, colour):
    """A three-sided stem from `foot` to `head`, closed by a cap at the head and by drawing its foot in to an edge, so it
    takes six triangles and has no hole. The foot is buried."""
    axis = unit(sub(head, foot))
    side = unit(cross(axis, (0.0, 0.0, 1.0) if abs(axis[2]) < 0.9 else (1.0, 0.0, 0.0)))
    other = cross(axis, side)

    def around(c, r, a):
        return add(c, add(mul(side, r * math.cos(a)), mul(other, r * math.sin(a))))

    # Its ends lie level, so a leaning stem reaches no further up or down than its head and its foot.
    t0, t1, t2 = ((c[0], head[1], c[2]) for c in (around(head, r_head, 2 * math.pi * k / 3) for k in range(3)))
    p, q = ((c[0], foot[1], c[2]) for c in (around(foot, r_foot, 0.0), around(foot, r_foot, math.pi)))
    solid(m, [((t0, t1, q), colour), ((t0, q, p), colour), ((t1, t2, q), colour), ((t2, t0, p), colour), ((t2, p, q), colour), ((t2, t1, t0), colour)])


def box_of(mesh, colours=None):
    """The least and most corner of the faces of `mesh` drawn in `colours` (all of them if None)."""
    pts = [mesh.points[i] for idx, mat, _, _ in mesh.faces if colours is None or mat in colours for i in idx]
    return [min(p[k] for p in pts) for k in range(3)], [max(p[k] for p in pts) for k in range(3)]
